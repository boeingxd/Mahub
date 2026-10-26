// The test-only login for the k6 load test (task B8). The danger is it
// leaking into a real deployment, so these tests check that it is off by
// default and that the config refuses to turn it on away from localhost.
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import { loadConfig } from '../src/config.js';
import type { Queryable } from '../src/db.js';

const google = {} as GoogleAuth;
const STUDENT = randomUUID();
const users = {
  async findByGoogleSub() {
    return null;
  },
  async findByEmail() {
    return null;
  },
  async upsertStudent() {
    return { id: STUDENT, email: '6730000001@g.siit.tu.ac.th', googleSub: 'x' };
  },
  async getProfile() {
    return { id: STUDENT, email: '6730000001@g.siit.tu.ac.th', fullName: 'x', roles: ['student'] };
  },
} as unknown as UserStore;

const build = (loadTest?: boolean) =>
  buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    auth: { google, users, sessionKey: randomBytes(32), loadTest },
  });
const login = (app: ReturnType<typeof build>, email: string) =>
  app.inject({ method: 'POST', url: '/auth/test-login', payload: { email } });

describe('POST /auth/test-login', () => {
  it('does not exist unless LOAD_TEST is on', async () => {
    const app = build();
    expect((await login(app, '6730000001@g.siit.tu.ac.th')).statusCode).toBe(404);
    await app.close();
  });

  it('signs a student in when LOAD_TEST is on, and /me then answers', async () => {
    const app = build(true);
    const res = await login(app, '6730000001@g.siit.tu.ac.th');
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === 'mahub_session')!;
    const me = await app.inject({ method: 'GET', url: '/me', cookies: { mahub_session: cookie.value } });
    expect(me.json()).toMatchObject({ id: STUDENT });
    await app.close();
  });

  it('still applies the login policy: an unregistered email is refused', async () => {
    const app = build(true);
    const res = await login(app, 'stranger@example.com');
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('LOAD_TEST config', () => {
  const env = {
    API_DATABASE_URL: 'postgres://u:p@localhost:5432/mahub',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    QR_SECRET: 'q'.repeat(40),
    SESSION_KEY: 'ab'.repeat(32),
  };
  it('is allowed on localhost, off by default', () => {
    expect(loadConfig({ ...env, GOOGLE_REDIRECT_URI: 'https://localhost/api/auth/callback', LOAD_TEST: '1' }).LOAD_TEST).toBe('1');
    expect(loadConfig({ ...env, GOOGLE_REDIRECT_URI: 'https://mahub.example.com/api/auth/callback' }).LOAD_TEST).toBe('');
  });
  it('is refused anywhere else, like the demo tunnel or a real domain', () => {
    for (const host of ['mahub.example.com', 'random-words.trycloudflare.com']) {
      expect(() => loadConfig({ ...env, GOOGLE_REDIRECT_URI: `https://${host}/api/auth/callback`, LOAD_TEST: '1' })).toThrow(/LOAD_TEST/);
    }
  });
});
