// The three student endpoints (task B6), tested at the HTTP level with a fake
// store. The real SQL, the views and row-level security are tested against a
// real database in test/db/studentStore.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import type { Queryable } from '../src/db.js';
import type { ClassLine, ClassSessions, Overview, StudentStore } from '../src/student/studentStore.js';

const STUDENT = randomUUID();
const OUTSIDER = randomUUID();
const SECTION = randomUUID();

const line: ClassLine = {
  section_id: SECTION,
  course_code: 'ITS332',
  course_name: 'Database Systems',
  term: '2026-1',
  section_no: 1,
  instructor_name: null,
  sessions_held: 12,
  attended: 10,
  excused: 1,
  sessions_counted: 11,
  rate_pct: 90.9,
};
const overview: Overview = {
  overall: { sessions_held: 12, attended: 10, excused: 1, sessions_counted: 11, rate_pct: 90.9 },
  classes: [
    {
      section_id: SECTION,
      course_code: 'ITS332',
      course_name: 'Database Systems',
      section_no: 1,
      sessions_held: 12,
      attended: 10,
      excused: 1,
      sessions_counted: 11,
      rate_pct: 90.9,
    },
  ],
  recent_checkins: [
    {
      class_session_id: randomUUID(),
      section_id: SECTION,
      course_code: 'ITS332',
      course_name: 'Database Systems',
      recorded_at: new Date('2026-10-26T02:03:11Z'),
      method: 'qr',
    },
  ],
};
const detail: ClassSessions = {
  class: line,
  sessions: [
    {
      class_session_id: randomUUID(),
      opened_at: new Date('2026-10-26T02:00:00Z'),
      is_open: false,
      status: 'present',
      method: 'qr',
      recorded_at: new Date('2026-10-26T02:03:11Z'),
    },
    {
      class_session_id: randomUUID(),
      opened_at: new Date('2026-10-19T02:00:00Z'),
      is_open: false,
      status: 'absent',
      method: null,
      recorded_at: null,
    },
  ],
};

// A fake database. Only STUDENT is enrolled, in SECTION. Every call is
// recorded so a test can check who the store was asked about.
let calls: string[] = [];
const store: StudentStore = {
  async classes(userId) {
    calls.push(`classes:${userId}`);
    return userId === STUDENT ? [line] : [];
  },
  async overview(userId) {
    calls.push(`overview:${userId}`);
    return userId === STUDENT
      ? overview
      : {
          overall: { sessions_held: 0, attended: 0, excused: 0, sessions_counted: 0, rate_pct: null },
          classes: [],
          recent_checkins: [],
        };
  },
  async classSessions(userId, sectionId) {
    calls.push(`sessions:${userId}:${sectionId}`);
    return userId === STUDENT && sectionId === SECTION ? { ok: true, detail } : { ok: false, error: 'FORBIDDEN' };
  },
};

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

async function get(url: string, userId: string | null) {
  app = buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    auth: { google, users, sessionKey: randomBytes(32) },
    student: { store },
  });
  return app.inject({ method: 'GET', url, cookies: userId ? { mahub_session: await loginCookie(userId) } : {} });
}

describe('every endpoint needs a login', () => {
  for (const url of ['/my/classes', '/my/overview', `/my/classes/${SECTION}/sessions`]) {
    it(`GET ${url.replace(/[0-9a-f-]{36}/g, ':section_id')}`, async () => {
      const res = await get(url, null);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'UNAUTHENTICATED' });
      expect(calls).toEqual([]);
    });
  }
});

describe('GET /my/classes', () => {
  it('gives my classes with sessions_counted and a nullable instructor_name', async () => {
    const res = await get('/my/classes', STUDENT);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([line]);
    expect(res.json()[0].sessions_counted).toBe(res.json()[0].sessions_held - res.json()[0].excused);
    expect(res.json()[0].instructor_name).toBeNull();
  });

  it('someone with no enrollments gets an empty list, not an error', async () => {
    const res = await get('/my/classes', OUTSIDER);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('asks the store about the logged-in user only, whatever the query says', async () => {
    await get(`/my/classes?student_id=${OUTSIDER}`, STUDENT);
    expect(calls).toEqual([`classes:${STUDENT}`]);
  });
});

describe('GET /my/overview', () => {
  it('gives the overall line, the classes and the recent check-ins', async () => {
    const res = await get('/my/overview', STUDENT);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overall).toEqual(overview.overall);
    expect(body.classes).toHaveLength(1);
    expect(body.classes[0]).not.toHaveProperty('instructor_name');
    expect(body.recent_checkins[0]).toMatchObject({ method: 'qr', recorded_at: '2026-10-26T02:03:11.000Z' });
  });

  it('with nothing to divide by the rate is null', async () => {
    const res = await get('/my/overview', OUTSIDER);
    expect(res.json().overall.rate_pct).toBeNull();
    expect(res.json().classes).toEqual([]);
  });
});

describe('GET /my/classes/:section_id/sessions', () => {
  it('gives the class line and every window with my status', async () => {
    const res = await get(`/my/classes/${SECTION}/sessions`, STUDENT);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.class.sessions_counted).toBe(11);
    expect(body.sessions[0]).toMatchObject({
      is_open: false,
      status: 'present',
      method: 'qr',
      opened_at: '2026-10-26T02:00:00.000Z',
    });
    expect(body.sessions[1]).toMatchObject({ status: 'absent', method: null, recorded_at: null });
  });

  it("a class I'm not in is a 403, and so is one that doesn't exist (same answer)", async () => {
    for (const id of [SECTION, randomUUID()]) {
      const res = await get(`/my/classes/${id}/sessions`, OUTSIDER);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'FORBIDDEN' });
    }
  });

  it('a malformed id is a 400', async () => {
    const res = await get('/my/classes/nope/sessions', STUDENT);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'BAD_REQUEST' });
    expect(calls).toEqual([]);
  });
});

it('no reply carries GPS, room coordinates, recorded_by or risk flags', async () => {
  for (const url of ['/my/classes', '/my/overview', `/my/classes/${SECTION}/sessions`]) {
    const res = await get(url, STUDENT);
    expect(res.body, url).not.toMatch(/distance|accuracy|gps|latitude|longitude|location|recorded_by|risk|flag/i);
  }
});
