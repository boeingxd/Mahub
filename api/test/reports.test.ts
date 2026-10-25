// The roster, report and manual-mark endpoints (task P4), tested at the HTTP
// level with a fake store. The real SQL and the views are tested against a
// real database in test/db/reportsStore.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import type { Queryable } from '../src/db.js';
import type { RateRow, ReportsStore, Roster } from '../src/reports/reportsStore.js';

const INSTRUCTOR = randomUUID();
const OTHER = randomUUID();
const SESSION = randomUUID();
const SECTION = randomUUID();
const STUDENT = randomUUID();
const NOT_ENROLLED = randomUUID();

const roster: Roster = {
  counts: { enrolled: 2, present: 1, excused: 0, absent: 1 },
  students: [
    {
      student_id: STUDENT,
      student_no: '6722780010',
      full_name: 'Somchai',
      status: 'present',
      method: 'qr',
      recorded_at: new Date('2026-10-26T02:03:11Z'),
    },
    { student_id: randomUUID(), student_no: '6722780011', full_name: 'Malee', status: 'absent', method: null, recorded_at: null },
  ],
};
const rates: RateRow[] = [
  { student_id: STUDENT, student_no: '6722780010', full_name: 'Somchai', sessions_held: 10, attended: 8, excused: 1, rate_pct: 88.9 },
  { student_id: randomUUID(), student_no: '6722780011', full_name: '=HYPERLINK("http://evil.test")', sessions_held: 0, attended: 0, excused: 0, rate_pct: null },
];

// A fake database. Only INSTRUCTOR teaches SECTION / SESSION.
let calls: string[] = [];
const store: ReportsStore = {
  async roster(userId, id) {
    calls.push(`roster:${userId}`);
    return userId === INSTRUCTOR && id === SESSION ? { ok: true, roster } : { ok: false, error: 'FORBIDDEN' };
  },
  async report(userId, id) {
    calls.push(`report:${userId}`);
    return userId === INSTRUCTOR && id === SECTION ? { ok: true, rows: rates } : { ok: false, error: 'FORBIDDEN' };
  },
  async mark(userId, id, studentId, status) {
    calls.push(`mark:${userId}:${studentId}:${status}`);
    if (userId !== INSTRUCTOR || id !== SESSION) return { ok: false, error: 'FORBIDDEN' };
    if (studentId === NOT_ENROLLED) return { ok: false, error: 'NOT_ENROLLED' };
    return {
      ok: true,
      attendance: {
        class_session_id: SESSION,
        student_id: studentId,
        status,
        method: 'manual',
        recorded_at: new Date('2026-10-26T04:00:00Z'),
        recorded_by: userId,
      },
    };
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

async function send(method: 'GET' | 'POST', url: string, userId: string | null, payload?: object, reportsStore = store) {
  app = buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    auth: { google, users, sessionKey: randomBytes(32) },
    reports: { store: reportsStore },
  });
  return app.inject({ method, url, payload, cookies: userId ? { mahub_session: await loginCookie(userId) } : {} });
}

describe('every endpoint needs a login', () => {
  for (const [method, url] of [
    ['GET', `/class-sessions/${SESSION}/roster`],
    ['GET', `/sections/${SECTION}/report`],
    ['POST', `/class-sessions/${SESSION}/attendance`],
  ] as const) {
    it(`${method} ${url.replace(/[0-9a-f-]{36}/g, ':id')}`, async () => {
      const res = await send(method, url, null, method === 'POST' ? { student_id: STUDENT, status: 'present' } : undefined);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'UNAUTHENTICATED' });
      expect(calls).toEqual([]);
    });
  }
});

describe('GET /class-sessions/:id/roster', () => {
  it('gives the instructor the counts and every enrolled student', async () => {
    const res = await send('GET', `/class-sessions/${SESSION}/roster`, INSTRUCTOR);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts).toEqual({ enrolled: 2, present: 1, excused: 0, absent: 1 });
    expect(body.students[0]).toEqual({
      student_id: STUDENT,
      student_no: '6722780010',
      full_name: 'Somchai',
      status: 'present',
      method: 'qr',
      recorded_at: '2026-10-26T02:03:11.000Z',
    });
    expect(body.students[1]).toMatchObject({ status: 'absent', method: null, recorded_at: null });
  });

  it('has no risk flags or warnings of any kind (the instructor decides)', async () => {
    const res = await send('GET', `/class-sessions/${SESSION}/roster`, INSTRUCTOR);
    expect(res.body).not.toMatch(/risk|flag|suspicious|warning/i);
  });

  it("refuses someone who doesn't teach the section: 403", async () => {
    const res = await send('GET', `/class-sessions/${SESSION}/roster`, OTHER);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('a malformed id is a 400', async () => {
    const res = await send('GET', '/class-sessions/nope/roster', INSTRUCTOR);
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('GET /sections/:id/report', () => {
  it('gives the rates as JSON by default', async () => {
    const res = await send('GET', `/sections/${SECTION}/report`, INSTRUCTOR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(res.json()[0]).toMatchObject({ sessions_held: 10, attended: 8, excused: 1, rate_pct: 88.9 });
    expect(res.json()[1].rate_pct).toBeNull();
  });

  it('?format=csv is a file download', async () => {
    const res = await send('GET', `/sections/${SECTION}/report?format=csv`, INSTRUCTOR);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[A-Za-z0-9_.-]+\.csv"$/);
    const lines = res.body.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('student_no,full_name,sessions_held,attended,excused,rate_pct');
    expect(lines[1]).toBe('6722780010,Somchai,10,8,1,88.9');
    // The evil name is defused and the missing rate is an empty cell.
    expect(lines[2]).toBe(`6722780011,"'=HYPERLINK(""http://evil.test"")",0,0,0,`);
  });

  it('?format=anything-else is a 400', async () => {
    for (const format of ['xml', 'CSV', '']) {
      const res = await send('GET', `/sections/${SECTION}/report?format=${format}`, INSTRUCTOR);
      expect(res.statusCode, format).toBe(400);
    }
  });

  it("refuses someone who doesn't teach the section: 403", async () => {
    const res = await send('GET', `/sections/${SECTION}/report`, OTHER);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN' });
  });
});

describe('POST /class-sessions/:id/attendance (manual mark)', () => {
  const url = `/class-sessions/${SESSION}/attendance`;

  it('marks a student excused, signed by the logged-in instructor', async () => {
    const res = await send('POST', url, INSTRUCTOR, { student_id: STUDENT, status: 'excused' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'excused', method: 'manual', recorded_by: INSTRUCTOR });
    expect(calls).toEqual([`mark:${INSTRUCTOR}:${STUDENT}:excused`]);
  });

  it("another instructor can't mark: 403", async () => {
    const res = await send('POST', url, OTHER, { student_id: STUDENT, status: 'present' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('a student who is not in the section is a 404 NOT_ENROLLED', async () => {
    const res = await send('POST', url, INSTRUCTOR, { student_id: NOT_ENROLLED, status: 'present' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_ENROLLED' });
  });

  it('refuses a bad body (zod) without touching the database', async () => {
    for (const payload of [
      undefined,
      {},
      { student_id: STUDENT },
      { status: 'present' },
      { student_id: 'x', status: 'present' },
      { student_id: STUDENT, status: 'absent' }, // absent is never stored
      { student_id: STUDENT, status: 'late' }, // there is no "late" (ADR 0005)
      { student_id: STUDENT, status: 'PRESENT' },
      { student_id: STUDENT, status: 'present', recorded_by: OTHER }, // the server decides who signed it
    ]) {
      const res = await send('POST', url, INSTRUCTOR, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: 'BAD_REQUEST' });
    }
    expect(calls).toEqual([]);
  });
});

describe('errors never leak', () => {
  it('a database failure is a plain 500 INTERNAL without the real message', async () => {
    const broken: ReportsStore = {
      ...store,
      async roster() {
        throw new Error('relation "api.v_secret" does not exist');
      },
    };
    const res = await send('GET', `/class-sessions/${SESSION}/roster`, INSTRUCTOR, undefined, broken);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL' });
    expect(res.body).not.toContain('v_secret');
  });
});
