import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import type { CheckinStore } from '../src/checkin/checkinStore.js';
import { makeToken, verifyToken, windowAt } from '../src/checkin/qr.js';
import type { QrStore } from '../src/checkin/qrStore.js';
import type { Queryable } from '../src/db.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const SESSION_A = randomUUID();
const SESSION_B = randomUUID();
const NOW = Date.UTC(2026, 9, 12, 9, 0, 3); // 09:00:03, 3 s into a window

// ---- the token itself (issue #34's four checks) -----------------------------

describe('QR token', () => {
  const window = windowAt(NOW);
  const token = makeToken(SECRET, SESSION_A, window);

  it('a fresh token passes', () => {
    expect(verifyToken(SECRET, SESSION_A, window, token, NOW)).toBe(true);
  });

  it('a token from the previous window still passes (clock skew)', () => {
    const old = makeToken(SECRET, SESSION_A, window - 1);
    expect(verifyToken(SECRET, SESSION_A, window - 1, old, NOW)).toBe(true);
  });

  it('a token from 40 s ago fails', () => {
    const old = makeToken(SECRET, SESSION_A, window - 4);
    expect(verifyToken(SECRET, SESSION_A, window - 4, old, NOW)).toBe(false);
  });

  it('a tampered token fails', () => {
    const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    expect(verifyToken(SECRET, SESSION_A, window, tampered, NOW)).toBe(false);
    expect(verifyToken(SECRET, SESSION_A, window, token.slice(0, 15), NOW)).toBe(false);
  });

  it("session A's token doesn't work for session B", () => {
    expect(verifyToken(SECRET, SESSION_B, window, token, NOW)).toBe(false);
  });

  it('a token made with a different secret fails', () => {
    const forged = makeToken('another-secret-that-is-also-32-characters', SESSION_A, window);
    expect(verifyToken(SECRET, SESSION_A, window, forged, NOW)).toBe(false);
  });

  it('changes every 10 seconds, and nothing is stored', () => {
    expect(makeToken(SECRET, SESSION_A, window + 1)).not.toBe(token);
  });
});

// ---- the endpoints ----------------------------------------------------------

const INSTRUCTOR = randomUUID();
const OTHER = randomUUID();
const CLOSED = randomUUID();

// A fake database: SESSION_A is open and taught by INSTRUCTOR; CLOSED is closed.
const store: QrStore = {
  async windowStateForInstructor(userId, id) {
    if (userId !== INSTRUCTOR) return null;
    return id === SESSION_A ? 'open' : id === CLOSED ? 'closed' : null;
  },
  async isOpen(id) {
    return id === SESSION_A;
  },
};

// A fake Google and user list: whoever "signs in" next is `nextUser`.
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
});

function build(trustProxy = '') {
  const built = buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    trustProxy,
    auth: { google, users, sessionKey: randomBytes(32) },
    // The check-in itself is tested in checkin.test.ts.
    checkin: { qrSecret: SECRET, store, checkins: {} as CheckinStore, now: () => NOW },
  });
  app = built;
  return built;
}

// Signs this user in through the real login routes (with the fake Google)
// and returns their login cookie.
async function loginCookie(userId: string) {
  nextUser = userId;
  const start = await app!.inject({ method: 'GET', url: '/auth/login' });
  const callback = await app!.inject({
    method: 'GET',
    url: '/auth/callback?code=c&state=s',
    cookies: { mahub_session: cookie(start, 'mahub_session')!.value },
  });
  return cookie(callback, 'mahub_session')!.value;
}

const cookie = (res: { cookies: { name: string; value: string; maxAge?: number; httpOnly?: boolean }[] }, name: string) =>
  res.cookies.find((c) => c.name === name);

describe('GET /class-sessions/:id/qr (the projector)', () => {
  it('needs a login', async () => {
    const res = await build().inject({ method: 'GET', url: `/class-sessions/${SESSION_A}/qr` });
    expect(res.statusCode).toBe(401);
  });

  it("gives the section's instructor the current QR link", async () => {
    build();
    const res = await app!.inject({
      method: 'GET',
      url: `/class-sessions/${SESSION_A}/qr`,
      cookies: { mahub_session: await loginCookie(INSTRUCTOR) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const window = windowAt(NOW);
    expect(body).toEqual({
      url: `http://localhost:80/c/${SESSION_A}.${window}.${makeToken(SECRET, SESSION_A, window)}`,
      window,
      expires_in: 7, // 3 s into the window
      server_time: new Date(NOW).toISOString(),
    });
  });

  it('gives nobody else the QR (404, without saying whether it exists)', async () => {
    build();
    const res = await app!.inject({
      method: 'GET',
      url: `/class-sessions/${SESSION_A}/qr`,
      cookies: { mahub_session: await loginCookie(OTHER) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a closed window', async () => {
    build();
    const res = await app!.inject({
      method: 'GET',
      url: `/class-sessions/${CLOSED}/qr`,
      cookies: { mahub_session: await loginCookie(INSTRUCTOR) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'SESSION_CLOSED' });
  });

  it('uses the public address when behind Caddy or the tunnel', async () => {
    build('172.28.1.0/24');
    const res = await app!.inject({
      method: 'GET',
      url: `/class-sessions/${SESSION_A}/qr`,
      remoteAddress: '172.28.1.5', // Caddy
      headers: { 'x-forwarded-proto': 'https', host: 'abc.trycloudflare.com' },
      cookies: { mahub_session: await loginCookie(INSTRUCTOR) },
    });
    expect(res.json().url).toMatch(/^https:\/\/abc\.trycloudflare\.com\/c\//);
  });
});

describe('GET /c/:id.:window.:token (the scan)', () => {
  const scanUrl = (id: string, window: number, token = makeToken(SECRET, id, window)) => `/c/${id}.${window}.${token}`;

  it('a valid scan sets the 90 s scan cookie and sends the student to sign in', async () => {
    const res = await build().inject({ method: 'GET', url: scanUrl(SESSION_A, windowAt(NOW)) });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/api/auth/login?returnTo=%2Fcheckin');
    expect(cookie(res, 'mahub_scan')).toMatchObject({ httpOnly: true, maxAge: 90 });
  });

  it('a signed-in student goes straight to the check-in page', async () => {
    build();
    const res = await app!.inject({
      method: 'GET',
      url: scanUrl(SESSION_A, windowAt(NOW)),
      cookies: { mahub_session: await loginCookie(OTHER) },
    });
    expect(res.headers.location).toBe('/checkin');
    expect(cookie(res, 'mahub_scan')).toBeDefined();
  });

  it('an old QR (a forwarded photo) is refused, with no scan cookie', async () => {
    const res = await build().inject({ method: 'GET', url: scanUrl(SESSION_A, windowAt(NOW) - 4) });
    expect(res.headers.location).toBe('/checkin?error=QR_EXPIRED');
    expect(cookie(res, 'mahub_scan')).toBeUndefined();
  });

  it('a forged or malformed QR is refused the same way', async () => {
    build();
    for (const url of [
      scanUrl(SESSION_A, windowAt(NOW), 'AAAAAAAAAAAAAAAA'),
      `/c/not-a-uuid.${windowAt(NOW)}.AAAAAAAAAAAAAAAA`,
      `/c/${SESSION_A}.x.AAAAAAAAAAAAAAAA`,
      `/c/${SESSION_A}`,
    ]) {
      const res = await app!.inject({ method: 'GET', url });
      expect(res.headers.location, url).toBe('/checkin?error=QR_EXPIRED');
    }
  });

  it('a valid QR for a closed window is refused', async () => {
    const res = await build().inject({ method: 'GET', url: scanUrl(CLOSED, windowAt(NOW)) });
    expect(res.headers.location).toBe('/checkin?error=SESSION_CLOSED');
    expect(cookie(res, 'mahub_scan')).toBeUndefined();
  });
});
