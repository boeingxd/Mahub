import { randomBytes } from 'node:crypto';
import secureSession from '@fastify/secure-session';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Queryable } from '../src/db.js';
import { CHECKIN_LIMIT, IP_LIMIT, registerCheckinLimit, registerIpLimit } from '../src/rateLimit.js';

const db = { query: async () => ({ rows: [] }) } as unknown as Queryable;

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

describe('per-IP limit', () => {
  const LIMIT = 20; // the real one (3000) would make this test slow
  const hit = (headers: Record<string, string>, remoteAddress: string) =>
    app.inject({ method: 'GET', url: '/healthz', headers, remoteAddress });

  it('answers 429 RATE_LIMITED after too many requests from one IP, and not for another IP', async () => {
    app = buildApp({ db, logLevel: 'silent', trustProxy: '172.28.1.0/24', ipLimit: LIMIT });
    const caddy = '172.28.1.5';
    for (let i = 0; i < LIMIT; i++) {
      expect((await hit({ 'x-forwarded-for': '203.0.113.7' }, caddy)).statusCode).toBe(200);
    }
    const limited = await hit({ 'x-forwarded-for': '203.0.113.7' }, caddy);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'RATE_LIMITED' });

    // Someone else behind the same proxy is not affected.
    expect((await hit({ 'x-forwarded-for': '203.0.113.8' }, caddy)).statusCode).toBe(200);
  });

  it("a forged X-Forwarded-For from outside the proxy doesn't dodge the limit", async () => {
    app = buildApp({ db, logLevel: 'silent', trustProxy: '172.28.1.0/24', ipLimit: LIMIT });
    // Same real source (not Caddy) pretending to be a new visitor every time.
    for (let i = 0; i < LIMIT; i++) {
      await hit({ 'x-forwarded-for': `198.51.100.${i % 250}` }, '10.9.9.9');
    }
    expect((await hit({ 'x-forwarded-for': '198.51.100.250' }, '10.9.9.9')).statusCode).toBe(429);
  });
});

it('allows a whole lecture hall behind one IP: the default is 3000 a minute', () => {
  expect(IP_LIMIT).toBe(3000);
});

describe('per-user check-in limit', () => {
  // A small app with just the cookie, a fake login, the limit and a /checkin route.
  async function build() {
    app = Fastify();
    await app.register(secureSession, { key: randomBytes(32), cookie: { path: '/' } });
    app.get<{ Params: { id: string } }>('/login/:id', async (request) => {
      request.session.set('userId', request.params.id);
      return {};
    });
    registerIpLimit(app);
    registerCheckinLimit(app);
    app.post('/checkin/attempt', async () => ({ ok: true }));
    app.get('/other', async () => ({ ok: true }));
  }

  async function loginAs(id: string) {
    const res = await app.inject({ method: 'GET', url: `/login/${id}` });
    return { mahub: res.cookies[0]!.value };
  }
  const attempt = (cookies: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/checkin/attempt', cookies, remoteAddress: '203.0.113.7' });

  it('the 6th check-in request within a minute is 429, per user and not per IP', async () => {
    await build();
    // secure-session's default cookie name is "session"
    const a = { session: (await loginAs('user-a')).mahub };
    const b = { session: (await loginAs('user-b')).mahub };
    for (let i = 0; i < CHECKIN_LIMIT; i++) expect((await attempt(a)).statusCode).toBe(200);
    expect((await attempt(a)).statusCode).toBe(429);
    // Another student on the same IP (campus NAT) can still check in.
    expect((await attempt(b)).statusCode).toBe(200);
  });

  it('only counts /checkin/*, and not people who are signed out', async () => {
    await build();
    const a = { session: (await loginAs('user-a')).mahub };
    for (let i = 0; i < CHECKIN_LIMIT + 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/other', cookies: a })).statusCode).toBe(200);
      expect((await attempt({})).statusCode).toBe(200); // signed out: the route itself would answer 401
    }
  });
});
