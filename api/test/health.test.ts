import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Queryable } from '../src/db.js';

// Fake "databases": one that answers and one that is down. This lets us test
// the routes without running Postgres.
const workingDb = { query: async () => ({ rows: [{ '?column?': 1 }] }) } as unknown as Queryable;
const brokenDb = {
  query: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432 (secret detail)');
  },
} as unknown as Queryable;

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

describe('health endpoints', () => {
  it('GET /healthz returns ok', async () => {
    app = buildApp({ db: brokenDb, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    // /healthz must not depend on the DB, so it's ok even with a broken one.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns ok when the database answers', async () => {
    app = buildApp({ db: workingDb, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 503 without leaking the error when the database is down', async () => {
    app = buildApp({ db: brokenDb, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
    expect(res.body).not.toContain('secret detail');
  });

  it('returns a request ID, reusing one sent by the proxy', async () => {
    app = buildApp({ db: workingDb, logLevel: 'silent' });
    const fresh = await app.inject({ method: 'GET', url: '/healthz' });
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const forwarded = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'from-caddy-123' },
    });
    expect(forwarded.headers['x-request-id']).toBe('from-caddy-123');
  });
});

describe('real client IP behind a proxy', () => {
  // A throwaway route that echoes request.ip, added only in this test.
  const withIpRoute = (trustProxy: string) => {
    app = buildApp({ db: workingDb, logLevel: 'silent', trustProxy });
    app.get('/test-ip', async (request) => ({ ip: request.ip }));
    return app;
  };

  it('uses X-Forwarded-For when the request comes from the trusted proxy', async () => {
    const res = await withIpRoute('172.28.1.0/24').inject({
      method: 'GET',
      url: '/test-ip',
      remoteAddress: '172.28.1.5', // pretend Caddy sent it
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.json()).toEqual({ ip: '203.0.113.7' });
  });

  it('ignores X-Forwarded-For from anyone else (it could be faked)', async () => {
    const res = await withIpRoute('172.28.1.0/24').inject({
      method: 'GET',
      url: '/test-ip',
      remoteAddress: '10.9.9.9', // not Caddy
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.json()).toEqual({ ip: '10.9.9.9' });
  });

  it('trusts nobody when TRUST_PROXY is empty', async () => {
    const res = await withIpRoute('').inject({
      method: 'GET',
      url: '/test-ip',
      remoteAddress: '172.28.1.5',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.json()).toEqual({ ip: '172.28.1.5' });
  });
});
