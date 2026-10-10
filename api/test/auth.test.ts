import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { GoogleIdentity, Profile, StoredUser, UserStore } from '../src/auth/loginPolicy.js';
import { safeReturnTo } from '../src/auth/returnTo.js';
import type { Queryable } from '../src/db.js';

// --- Fakes -------------------------------------------------------------------

// A fake Google: the test says who "signs in" next. Like the real library, it
// rejects a callback whose state doesn't match the one we saved at login.
class FakeGoogle implements GoogleAuth {
  next: GoogleIdentity | undefined;
  async start() {
    const checks = { state: randomUUID(), nonce: 'n', codeVerifier: 'v' };
    return { url: `https://accounts.google.test/auth?state=${checks.state}`, checks };
  }
  async finish(query: string, checks: { state: string }) {
    if (new URLSearchParams(query).get('state') !== checks.state) throw new Error('state mismatch');
    if (!this.next) throw new Error('no identity set');
    return this.next;
  }
}

// An in-memory stand-in for the users / students / user_roles tables.
class MemoryUsers implements UserStore {
  users: (StoredUser & { fullName: string })[] = [];
  students = new Map<string, string>(); // user id -> student_no
  roles = new Map<string, Set<string>>();

  // How an admin registers an instructor: a users row plus a role, no sub yet.
  register(email: string, role: string) {
    const id = randomUUID();
    this.users.push({ id, email, googleSub: null, fullName: email });
    this.roles.set(id, new Set([role]));
    return id;
  }
  async findByGoogleSub(sub: string) {
    return this.users.find((u) => u.googleSub === sub) ?? null;
  }
  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async linkGoogleSub(userId: string, sub: string) {
    const u = this.users.find((x) => x.id === userId);
    if (u && u.googleSub === null) u.googleSub = sub;
  }
  async upsertStudent(input: { email: string; sub: string; fullName: string; studentNo: string }) {
    let u = await this.findByEmail(input.email);
    if (!u) {
      u = { id: randomUUID(), email: input.email, googleSub: input.sub, fullName: input.fullName };
      this.users.push(u as StoredUser & { fullName: string });
    }
    u.googleSub ??= input.sub;
    if (u.googleSub !== input.sub) return null;
    if (!this.students.has(u.id)) this.students.set(u.id, input.studentNo);
    this.roles.set(u.id, new Set([...(this.roles.get(u.id) ?? []), 'student']));
    return u;
  }
  async getProfile(userId: string): Promise<Profile | null> {
    const u = this.users.find((x) => x.id === userId) as (StoredUser & { fullName: string }) | undefined;
    if (!u) return null;
    return { id: u.id, email: u.email, fullName: u.fullName, roles: [...(this.roles.get(u.id) ?? [])].sort() };
  }
}

const db = { query: async () => ({ rows: [] }) } as unknown as Queryable;

// --- Helpers -----------------------------------------------------------------

let app: FastifyInstance;
let google: FakeGoogle;
let users: MemoryUsers;

beforeEach(() => {
  google = new FakeGoogle();
  users = new MemoryUsers();
  app = buildApp({ db, logLevel: 'silent', auth: { google, users, sessionKey: randomBytes(32) } });
});
afterEach(async () => {
  await app.close();
});

const sessionCookie = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === 'mahub_session');

// Walks through the whole login like a browser would:
// /auth/login -> (Google) -> /auth/callback, carrying the cookie between them.
async function signIn(identity: GoogleIdentity, returnTo?: string) {
  google.next = identity;
  const start = await app.inject({
    method: 'GET',
    url: '/auth/login',
    query: returnTo === undefined ? {} : { returnTo },
  });
  const state = new URL(start.headers.location as string).searchParams.get('state');
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/callback?code=fake&state=${state}`,
    cookies: { mahub_session: sessionCookie(start)!.value },
  });
  const cookie = sessionCookie(callback)?.value;
  const me = cookie ? await app.inject({ method: 'GET', url: '/me', cookies: { mahub_session: cookie } }) : undefined;
  return { start, callback, me };
}

const student = (no = '6722782164'): GoogleIdentity => ({
  sub: `sub-${no}`,
  email: `${no}@g.siit.tu.ac.th`,
  emailVerified: true,
  name: 'Test Student',
});

// --- Login policy (ADR 0007) ---------------------------------------------------

describe('login policy', () => {
  it('a SIIT student email creates a student with the email prefix as student_no', async () => {
    const { callback, me } = await signIn(student('6722782164'));
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/student');
    expect(me!.json()).toMatchObject({ email: '6722782164@g.siit.tu.ac.th', roles: ['student'] });
    expect([...users.students.values()]).toEqual(['6722782164']);
  });

  it('a returning student is matched by Google sub, even if their email changed', async () => {
    await signIn(student('6722782164'));
    const { me } = await signIn({ ...student('6722782164'), email: 'renamed@example.com' });
    expect(me!.statusCode).toBe(200);
    expect(users.users).toHaveLength(1);
  });

  it('a random Gmail is rejected and sent to /not-registered', async () => {
    const { callback, me } = await signIn({ sub: 'x', email: 'someone@gmail.com', emailVerified: true });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/not-registered');
    expect(me).toBeUndefined(); // no login cookie was set
    expect(users.users).toHaveLength(0);
  });

  it('look-alike student emails are not students', async () => {
    for (const email of [
      '6722782164@g.siit.tu.ac.th.evil.com',
      '672278216@g.siit.tu.ac.th', // 9 digits
      'a6722782164@g.siit.tu.ac.th',
      '6722782164@siit.tu.ac.th', // staff domain, not the student one
    ]) {
      const { callback } = await signIn({ sub: email, email, emailVerified: true });
      expect(callback.headers.location, email).toBe('/not-registered');
    }
  });

  it('an unverified email is rejected', async () => {
    const { callback } = await signIn({ ...student(), emailVerified: false });
    expect(callback.headers.location).toBe('/not-registered');
  });

  it('a pre-registered instructor signs in with any Google account and gets no student role', async () => {
    const id = users.register('prof@outsource.example', 'instructor');
    const { callback, me } = await signIn({ sub: 'prof-sub', email: 'Prof@Outsource.example', emailVerified: true });
    expect(callback.headers.location).toBe('/instructor');
    expect(me!.json()).toMatchObject({ id, roles: ['instructor'] });
    expect(users.users[0]?.googleSub).toBe('prof-sub');
  });

  it('a registered email already linked to another Google account is rejected', async () => {
    users.register('prof@outsource.example', 'instructor');
    await signIn({ sub: 'real-prof', email: 'prof@outsource.example', emailVerified: true });
    const { callback } = await signIn({ sub: 'impostor', email: 'prof@outsource.example', emailVerified: true });
    expect(callback.headers.location).toBe('/not-registered');
  });

  it('a SIIT student email never gets the instructor role', async () => {
    const { me } = await signIn(student());
    expect(me!.json().roles).not.toContain('instructor');
    expect(me!.json().roles).not.toContain('admin');
  });
});

// --- returnTo (open redirect) -------------------------------------------------

describe('returnTo', () => {
  it('sends the user back to a path on our site after login', async () => {
    const { callback } = await signIn(student(), '/c/abc.123.token');
    expect(callback.headers.location).toBe('/c/abc.123.token');
  });

  it('ignores returnTo=https://evil.com', async () => {
    const { callback } = await signIn(student(), 'https://evil.com');
    expect(callback.headers.location).toBe('/student');
  });

  it.each(['https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', 'evil.com', ''])(
    'safeReturnTo rejects %j',
    (value) => {
      expect(safeReturnTo(value)).toBeUndefined();
    },
  );
});

// --- Session cookie and endpoints ------------------------------------------------

describe('session', () => {
  it('the login cookie is HttpOnly, Secure, SameSite=Lax and lasts 8 hours', async () => {
    const { callback } = await signIn(student());
    const cookie = sessionCookie(callback)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 8 * 60 * 60 });
  });

  it('GET /me without a cookie is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('a tampered cookie is treated as logged out', async () => {
    const { callback } = await signIn(student());
    const value = sessionCookie(callback)!.value;
    const tampered = value.slice(0, -4) + (value.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const res = await app.inject({ method: 'GET', url: '/me', cookies: { mahub_session: tampered } });
    expect(res.statusCode).toBe(401);
  });

  it('a callback with the wrong state is refused', async () => {
    google.next = student();
    const start = await app.inject({ method: 'GET', url: '/auth/login' });
    const res = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=fake&state=attacker',
      cookies: { mahub_session: sessionCookie(start)!.value },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'LOGIN_FAILED' });
  });

  it('a callback with no login in progress is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/callback?code=fake&state=x' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'LOGIN_EXPIRED' });
  });

  it('logout clears the cookie', async () => {
    const { callback } = await signIn(student());
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { mahub_session: sessionCookie(callback)!.value },
    });
    expect(res.statusCode).toBe(204);
    expect(sessionCookie(res)?.value).toBe('');
  });

  it('a database error is not leaked to the client', async () => {
    users.getProfile = async () => {
      throw new Error('relation "api.users" does not exist (secret detail)');
    };
    const { callback } = await signIn(student());
    expect(callback.statusCode).toBe(500);
    expect(callback.json()).toEqual({ error: 'INTERNAL' });
    expect(callback.body).not.toContain('secret detail');
  });
});
