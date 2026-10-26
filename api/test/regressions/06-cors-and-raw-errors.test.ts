// Old bug 6: CORS `*` (any website could call the API as you), and raw
// errors shown to users (SQL and stack traces leaked).
// Fix: no CORS headers at all (the web app is on the same origin, behind
// Caddy), and the error handler in api/src/app.ts sends only a code.
// The rate-limit half of this bug is task B7 (#38).
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { GoogleAuth } from '../../src/auth/google.js';
import type { UserStore } from '../../src/auth/loginPolicy.js';
import type { Queryable } from '../../src/db.js';

const db = { query: async () => ({ rows: [{}] }) } as unknown as Queryable;
const auth = { google: {} as GoogleAuth, users: {} as UserStore, sessionKey: randomBytes(32) };

let app: ReturnType<typeof buildApp>;
afterEach(async () => {
  await app.close();
});

describe('old bug 6: CORS * and raw errors', () => {
  it('another website gets no CORS permission, even on a preflight', async () => {
    app = buildApp({ db, logLevel: 'silent', auth });
    for (const method of ['GET', 'OPTIONS'] as const) {
      const res = await app.inject({
        method,
        url: '/readyz',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(res.headers['access-control-allow-origin'], method).toBeUndefined();
      expect(res.headers['access-control-allow-credentials'], method).toBeUndefined();
    }
  });

  it('a crash sends only {"error": "INTERNAL"}, never the message or stack', async () => {
    app = buildApp({ db, logLevel: 'silent', auth });
    app.get('/boom', async () => {
      throw new Error('relation "api.secret_table" does not exist at /app/src/x.ts:12');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL' });
    expect(res.body).not.toMatch(/relation|secret_table|\.ts|stack/);
  });

  it('broken JSON gets a code, not the parser message', async () => {
    app = buildApp({ db, logLevel: 'silent', auth });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'content-type': 'application/json' },
      payload: '{"lat": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'BAD_REQUEST' });
  });
});
