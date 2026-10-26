// Old bug 7: the QR wrote a new row to the database every 10 s.
// Fix: the QR is a stateless HMAC (api/src/checkin/qr.ts). Showing it and
// scanning it only READ the database.
//
// How we prove "zero writes": the API's database connections here are
// read-only (default_transaction_read_only). Any INSERT, UPDATE or DELETE
// would fail, the endpoint would answer 500, and the test would go red.
// That catches writes to any table, which counting rows in a few tables
// would not.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { GoogleAuth } from '../../src/auth/google.js';
import type { UserStore } from '../../src/auth/loginPolicy.js';
import type { CheckinStore } from '../../src/checkin/checkinStore.js';
import { createQrStore } from '../../src/checkin/qrStore.js';
import type { Queryable } from '../../src/db.js';
import { openWindowFor, pools } from './helpers.js';

const testDb = inject('testDb');
const SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe.skipIf(!testDb)('old bug 7: the QR writes to the database', () => {
  const { admin, app: rw } = testDb ? pools(testDb) : ({} as ReturnType<typeof pools>);
  const readOnly = testDb
    ? new pg.Pool({ connectionString: testDb.appUrl, options: '-c default_transaction_read_only=on' })
    : ({} as pg.Pool);
  let session: string;
  let instructor: string;

  beforeAll(async () => {
    ({ session, instructor } = await openWindowFor(admin, 507, []));
  });
  afterAll(async () => {
    await admin?.end();
    await rw?.end();
    await readOnly?.end?.();
  });

  it('the read-only connection really refuses writes (so the test below means something)', async () => {
    await expect(
      readOnly.query(`INSERT INTO api.checkin_attempts (class_session_id, user_id, outcome) VALUES ($1, $2, 'ok')`, [
        session,
        instructor,
      ]),
    ).rejects.toThrow(/read-only transaction/);
  });

  it('60 s of projecting and scanning the QR writes nothing', async () => {
    let clock = Date.UTC(2026, 9, 28, 2, 0, 0);
    const google: GoogleAuth = {
      async start() {
        return { url: 'https://accounts.google.test/', checks: { state: 's', nonce: 'n', codeVerifier: 'v' } };
      },
      async finish() {
        return { sub: instructor, email: 'x@example.com', emailVerified: true };
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
    const app = buildApp({
      db: {} as Queryable,
      logLevel: 'silent',
      auth: { google, users, sessionKey: randomBytes(32) },
      checkin: { qrSecret: SECRET, store: createQrStore(readOnly), checkins: {} as CheckinStore, now: () => clock },
    });

    try {
      // Sign in as the section's instructor (fake Google).
      const start = await app.inject({ method: 'GET', url: '/auth/login' });
      const callback = await app.inject({
        method: 'GET',
        url: '/auth/callback?code=c&state=s',
        cookies: { mahub_session: start.cookies.find((c) => c.name === 'mahub_session')!.value },
      });
      const login = callback.cookies.find((c) => c.name === 'mahub_session')!.value;

      const urls = new Set<string>();
      for (let s = 0; s <= 60; s += 5, clock += 5000) {
        // The projector asks for the QR every 5 s...
        const qr = await app.inject({ method: 'GET', url: `/class-sessions/${session}/qr`, cookies: { mahub_session: login } });
        expect(qr.statusCode, `projector at ${s} s`).toBe(200);
        urls.add(qr.json().url);
        // ...and a phone scans it.
        const scan = await app.inject({ method: 'GET', url: new URL(qr.json().url).pathname });
        expect(scan.statusCode, `scan at ${s} s`).toBe(303);
        expect(scan.headers.location).toBe('/api/auth/login?returnTo=%2Fcheckin');
      }
      expect(urls.size).toBeGreaterThanOrEqual(6); // the QR really changed every 10 s
    } finally {
      await app.close();
    }
  });
});
