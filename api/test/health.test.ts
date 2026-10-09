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
