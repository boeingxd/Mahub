// The instructor endpoints for opening and closing check-in windows (task P3),
// tested at the HTTP level with a fake store: this checks the status codes,
// the error format and the input checks. The real SQL is tested against a
// real database in test/db/sectionsStore.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import type { Queryable } from '../src/db.js';
import type { ClassSession, SectionsStore } from '../src/sections/sectionsStore.js';

const INSTRUCTOR = randomUUID();
const OTHER = randomUUID();
const SECTION = randomUUID();
const ROOM = randomUUID();
const OPEN = randomUUID(); // an open window, taught by INSTRUCTOR
const CLOSED = randomUUID(); // a closed window, taught by INSTRUCTOR

const session = (id: string, closed: boolean): ClassSession => ({
  id,
  section_id: SECTION,
  room_id: ROOM,
  radius_m: 50,
  opened_by: INSTRUCTOR,
  opened_at: new Date('2026-10-26T02:00:00Z'),
  closed_at: closed ? new Date('2026-10-26T03:00:00Z') : null,
});

// A fake database. Only INSTRUCTOR teaches SECTION. SECTION already has the
// open window OPEN, so opening another one is a conflict.
let calls: string[] = [];
const store: SectionsStore = {
  async listMine(userId) {
    calls.push(`listMine:${userId}`);
    return userId === INSTRUCTOR
      ? [
          {
            id: SECTION,
            course_code: 'ITS332',
            course_name: 'Database Systems',
            term: '2026-1',
            section_no: 1,
            enrolled: 30,
            open_session_id: OPEN,
          },
        ]
      : [];
  },
  async open(userId, sectionId, roomId) {
    calls.push(`open:${userId}:${sectionId}:${roomId}`);
    if (userId !== INSTRUCTOR || sectionId !== SECTION) return { ok: false, error: 'FORBIDDEN' };
    if (roomId !== ROOM) return { ok: false, error: 'ROOM_NOT_FOUND' };
    return { ok: false, error: 'SESSION_ALREADY_OPEN' };
  },
  async close(userId, id) {
    if (userId !== INSTRUCTOR) return { ok: false, error: 'FORBIDDEN' };
    if (id === OPEN) return { ok: true, session: session(OPEN, true) };
    if (id === CLOSED) return { ok: false, error: 'SESSION_CLOSED' };
    return { ok: false, error: 'FORBIDDEN' };
  },
  async get(userId, id) {
    if (userId !== INSTRUCTOR) return { ok: false, error: 'FORBIDDEN' };
    if (id === OPEN) return { ok: true, session: session(OPEN, false) };
    if (id === CLOSED) return { ok: true, session: session(CLOSED, true) };
    return { ok: false, error: 'FORBIDDEN' };
  },
};

// The same fake Google sign-in the QR tests use: whoever "signs in" next is `nextUser`.
let nextUser = '';
const google: GoogleAuth = {
  async start() {
    return { url: 'https://accounts.google.test/', checks: { state: 's', nonce: 'n', codeVerifier: 'v' } };
  },
  async finish() {
    return { sub: nextUser, email: 'x@example.com', emailVerified: true };
  },
};
const users = {
  async findByGoogleSub(sub: string) {
    return { id: sub, email: 'x@example.com', googleSub: sub };
  },
  async getProfile() {
    return null;
  },
} as unknown as UserStore;

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  calls = [];
});

function build(sectionsStore: SectionsStore = store) {
  app = buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    auth: { google, users, sessionKey: randomBytes(32) },
    sections: { store: sectionsStore },
  });
  return app;
}

async function loginCookie(userId: string) {
  nextUser = userId;
  const start = await app!.inject({ method: 'GET', url: '/auth/login' });
  const find = (res: typeof start, name: string) => res.cookies.find((c) => c.name === name)!.value;
  const callback = await app!.inject({
    method: 'GET',
    url: '/auth/callback?code=c&state=s',
    cookies: { mahub_session: find(start, 'mahub_session') },
  });
  return find(callback, 'mahub_session');
}

// Sends a request as `userId` (or as nobody).
async function send(method: 'GET' | 'POST', url: string, userId: string | null, payload?: object) {
  build();
  return app!.inject({
    method,
    url,
    payload,
    cookies: userId ? { mahub_session: await loginCookie(userId) } : {},
  });
}

describe('every endpoint needs a login', () => {
  for (const [method, url] of [
    ['GET', '/my/sections'],
    ['POST', `/sections/${SECTION}/class-sessions`],
    ['POST', `/class-sessions/${OPEN}/close`],
    ['GET', `/class-sessions/${OPEN}`],
  ] as const) {
    it(`${method} ${url.replace(/[0-9a-f-]{36}/g, ':id')}`, async () => {
      const res = await send(method, url, null, method === 'POST' ? { room_id: ROOM } : undefined);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'UNAUTHENTICATED' });
      expect(calls).toEqual([]); // never reached the database
    });
  }
});

describe('GET /my/sections', () => {
  it("lists the instructor's sections", async () => {
    const res = await send('GET', '/my/sections', INSTRUCTOR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: SECTION,
        course_code: 'ITS332',
        course_name: 'Database Systems',
        term: '2026-1',
        section_no: 1,
        enrolled: 30,
        open_session_id: OPEN,
      },
    ]);
  });

  it('asks the database as the signed-in user, not as someone the client names', async () => {
    await send('GET', `/my/sections?user_id=${OTHER}`, INSTRUCTOR);
    expect(calls).toEqual([`listMine:${INSTRUCTOR}`]);
  });
});

describe('POST /sections/:id/class-sessions (open a window)', () => {
  const url = `/sections/${SECTION}/class-sessions`;

  it('a second open window for the same section is a 409', async () => {
    const res = await send('POST', url, INSTRUCTOR, { room_id: ROOM });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'SESSION_ALREADY_OPEN' });
  });

  it("another instructor (or a student) can't open a window for this section: 403", async () => {
    const res = await send('POST', url, OTHER, { room_id: ROOM });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('an unknown room is a 404', async () => {
    const res = await send('POST', url, INSTRUCTOR, { room_id: randomUUID() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'ROOM_NOT_FOUND' });
  });

  it('a bad body or id is a 400 and never reaches the database (zod)', async () => {
    for (const payload of [undefined, {}, { room_id: 'x' }, { room_id: 42 }, { room_id: null }, { room_id: ROOM, extra: 1 }]) {
      const res = await send('POST', url, INSTRUCTOR, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: 'BAD_REQUEST' });
    }
    const badId = await send('POST', '/sections/not-a-uuid/class-sessions', INSTRUCTOR, { room_id: ROOM });
    expect(badId.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('POST /class-sessions/:id/close', () => {
  it('closes an open window', async () => {
    const res = await send('POST', `/class-sessions/${OPEN}/close`, INSTRUCTOR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: OPEN, closed_at: '2026-10-26T03:00:00.000Z' });
  });

  it('closing a closed window is a 409', async () => {
    const res = await send('POST', `/class-sessions/${CLOSED}/close`, INSTRUCTOR);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'SESSION_CLOSED' });
  });

  it("someone else can't close it: 403", async () => {
    const res = await send('POST', `/class-sessions/${OPEN}/close`, OTHER);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('a malformed id is a 400', async () => {
    const res = await send('POST', '/class-sessions/nope/close', INSTRUCTOR);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /class-sessions/:id', () => {
  it("gives the instructor the window, with no location (we don't send coordinates)", async () => {
    const res = await send('GET', `/class-sessions/${OPEN}`, INSTRUCTOR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: OPEN,
      section_id: SECTION,
      room_id: ROOM,
      radius_m: 50,
      opened_by: INSTRUCTOR,
      opened_at: '2026-10-26T02:00:00.000Z',
      closed_at: null,
    });
  });

  it("someone else can't read it: 403", async () => {
    const res = await send('GET', `/class-sessions/${OPEN}`, OTHER);
    expect(res.statusCode).toBe(403);
  });
});

describe('errors never leak', () => {
  it('a database failure is a plain 500 INTERNAL, without the real message', async () => {
    const broken: SectionsStore = {
      ...store,
      async listMine() {
        throw new Error('relation "api.secret_table" does not exist');
      },
    };
    build(broken);
    const res = await app!.inject({
      method: 'GET',
      url: '/my/sections',
      cookies: { mahub_session: await loginCookie(INSTRUCTOR) },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL' });
    expect(res.body).not.toContain('secret_table');
  });
});
