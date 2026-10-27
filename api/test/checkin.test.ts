// POST /checkin/complete (task Y4) with a fake database: the request checks
// (login, body, scan cookie) and how each outcome is answered. The real SQL
// is tested in test/db/checkinStore.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import type { CheckinOutcome, CheckinStore, Gps } from '../src/checkin/checkinStore.js';
import { makeToken, windowAt } from '../src/checkin/qr.js';
import type { QrStore } from '../src/checkin/qrStore.js';
import type { Queryable } from '../src/db.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const SESSION = randomUUID();
const STUDENT = randomUUID();
// Who the fake Google says just signed in. A test that sends many requests
// signs in as a new student each time, so the 5/min per-user limit isn't hit.
let signedInAs = STUDENT;
const START = Date.UTC(2026, 9, 26, 9, 0, 3);
const GOOD_BODY = { lat: 14.07, lng: 100.6, accuracy: 12 };

// The clock the app sees. Tests move it forward to make a scan go stale.
let clock = START;

const qrStore: QrStore = {
  async windowStateForInstructor() {
    return null;
  },
  async isOpen(id) {
    return id === SESSION;
  },
};

// A fake check-in store: answers `nextOutcome` and remembers each call.
let nextOutcome: CheckinOutcome = 'ok';
let calls: { userId: string; classSessionId: string; gps: Gps }[] = [];
const checkins: CheckinStore = {
  async complete(userId, classSessionId, gps) {
    calls.push({ userId, classSessionId, gps });
    return { outcome: nextOutcome, distanceM: 12.5 };
  },
};

const google: GoogleAuth = {
  async start() {
    return { url: 'https://accounts.google.test/', checks: { state: 's', nonce: 'n', codeVerifier: 'v' } };
  },
  async finish() {
    return { sub: signedInAs, email: 'x@example.com', emailVerified: true };
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

let app: FastifyInstance;
beforeEach(() => {
  clock = START;
  signedInAs = STUDENT;
  nextOutcome = 'ok';
  calls = [];
  app = buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    auth: { google, users, sessionKey: randomBytes(32) },
    checkin: { qrSecret: SECRET, store: qrStore, checkins, now: () => clock },
  });
});
afterEach(async () => {
  await app.close();
});

const cookie = (res: { cookies: { name: string; value: string; maxAge?: number }[] }, name: string) =>
  res.cookies.find((c) => c.name === name);

async function loginCookie() {
  const start = await app.inject({ method: 'GET', url: '/auth/login' });
  const callback = await app.inject({
    method: 'GET',
    url: '/auth/callback?code=c&state=s',
    cookies: { mahub_session: cookie(start, 'mahub_session')!.value },
  });
  return cookie(callback, 'mahub_session')!.value;
}

// Scans the current QR through the real scan route and returns the scan cookie.
async function scanCookie() {
  const window = windowAt(clock);
  const res = await app.inject({ method: 'GET', url: `/c/${SESSION}.${window}.${makeToken(SECRET, SESSION, window)}` });
  return cookie(res, 'mahub_scan')!.value;
}

async function complete(body: unknown, cookies: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/checkin/complete', payload: body as object, cookies });
}

describe('POST /checkin/complete', () => {
  it('needs a login', async () => {
    const res = await complete(GOOD_BODY, { mahub_scan: await scanCookie() });
    expect(res.statusCode).toBe(401);
    expect(calls).toEqual([]);
  });

  it('marks the student present for the window they scanned', async () => {
    const cookies = { mahub_session: await loginCookie(), mahub_scan: await scanCookie() };
    const res = await complete(GOOD_BODY, cookies);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'present', distance_m: 12.5 });
    expect(calls).toEqual([{ userId: STUDENT, classSessionId: SESSION, gps: GOOD_BODY }]);
  });

  // Old bug 2 (PROJECT_PLAN.md §2): `lat: "x"` became NaN and every
  // distance comparison with NaN is false, so the GPS check was skipped.
  it('refuses a body that is not three numbers in range (lat: "x")', async () => {
    const scan = await scanCookie();
    for (const body of [
      { ...GOOD_BODY, lat: 'x' },
      { ...GOOD_BODY, lat: '14.07' },
      { ...GOOD_BODY, lat: 91 },
      { ...GOOD_BODY, lng: -181 },
      { ...GOOD_BODY, accuracy: -1 },
      { ...GOOD_BODY, accuracy: 5001 },
      { lat: 14.07, lng: 100.6 },
      { ...GOOD_BODY, extra: 1 },
    ]) {
      signedInAs = randomUUID();
      const res = await complete(body, { mahub_session: await loginCookie(), mahub_scan: scan });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'BAD_REQUEST' });
    }
    expect(calls).toEqual([]);
  });

  it('without a scan, says the QR has expired', async () => {
    const res = await complete(GOOD_BODY, { mahub_session: await loginCookie() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'QR_EXPIRED' });
    expect(calls).toEqual([]);
  });

  it('a scan older than 90 s has expired', async () => {
    const cookies = { mahub_session: await loginCookie(), mahub_scan: await scanCookie() };
    clock += 91_000;
    const res = await complete(GOOD_BODY, cookies);
    expect(res.json()).toEqual({ error: 'QR_EXPIRED' });
    expect(calls).toEqual([]);
  });

  it('the scan cookie is used up after a check-in', async () => {
    const cookies = { mahub_session: await loginCookie(), mahub_scan: await scanCookie() };
    const res = await complete(GOOD_BODY, cookies);
    expect(cookie(res, 'mahub_scan')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('answers each refusal with its code', async () => {
    const expected: [CheckinOutcome, number, string][] = [
      ['session_closed', 409, 'SESSION_CLOSED'],
      ['not_enrolled', 403, 'NOT_ENROLLED'],
      ['out_of_range', 422, 'OUT_OF_RANGE'],
      ['already_present', 409, 'ALREADY_PRESENT'],
    ];
    const session = await loginCookie();
    for (const [outcome, status, code] of expected) {
      nextOutcome = outcome;
      const res = await complete(GOOD_BODY, { mahub_session: session, mahub_scan: await scanCookie() });
      expect(res.statusCode, outcome).toBe(status);
      expect(res.json()).toEqual({ error: code });
    }
  });

  it('keeps the scan after OUT_OF_RANGE, so the student can retry with better GPS', async () => {
    nextOutcome = 'out_of_range';
    const cookies = { mahub_session: await loginCookie(), mahub_scan: await scanCookie() };
    const res = await complete(GOOD_BODY, cookies);
    expect(cookie(res, 'mahub_scan')).toBeUndefined();
  });

  // Chrome's "approximate location" reports an accuracy of about 2000 m and a
  // point that can be far off, so the student was told "too far" while
  // standing in the room (real run, 27 Oct). Tell them how to fix it instead.
  it('out of range with a poor accuracy (over 100 m) answers LOCATION_IMPRECISE and keeps the scan', async () => {
    nextOutcome = 'out_of_range';
    const cookies = { mahub_session: await loginCookie(), mahub_scan: await scanCookie() };
    const res = await complete({ ...GOOD_BODY, accuracy: 2000 }, cookies);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'LOCATION_IMPRECISE' });
    expect(cookie(res, 'mahub_scan')).toBeUndefined();
  });

  it('a 100 m accuracy still counts as precise: OUT_OF_RANGE', async () => {
    nextOutcome = 'out_of_range';
    const res = await complete({ ...GOOD_BODY, accuracy: 100 }, { mahub_session: await loginCookie(), mahub_scan: await scanCookie() });
    expect(res.json()).toEqual({ error: 'OUT_OF_RANGE' });
  });

  it('a poor accuracy inside the room is still a check-in', async () => {
    nextOutcome = 'ok';
    const res = await complete({ ...GOOD_BODY, accuracy: 2000 }, { mahub_session: await loginCookie(), mahub_scan: await scanCookie() });
    expect(res.statusCode).toBe(200);
  });
});
