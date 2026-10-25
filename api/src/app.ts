import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth, type AuthOptions } from './auth/routes.js';
import { registerCheckin, type CheckinOptions } from './checkin/routes.js';
import type { Queryable } from './db.js';
import { registerReports, type ReportsOptions } from './reports/routes.js';
import { registerSections, type SectionsOptions } from './sections/routes.js';

export interface AppOptions {
  db: Queryable;
  logLevel?: string;
  // Comma-separated proxy IPs/ranges to trust for X-Forwarded-For ('' = none).
  trustProxy?: string;
  // Google login + session cookie. Left out by tests that don't need it.
  auth?: AuthOptions;
  // The rotating QR and the scan link (task Y3). Needs `auth` (its cookies).
  checkin?: CheckinOptions;
  // Opening and closing check-in windows (task P3). Needs `auth` too.
  sections?: SectionsOptions;
  // Rosters, attendance rates and manual marks (task P4). Needs `auth` too.
  reports?: ReportsOptions;
}

// Builds the Fastify app without starting it. server.ts calls listen();
// tests call app.inject() to send fake requests without opening a port.
export function buildApp({ db, logLevel = 'info', trustProxy = '', auth, checkin, sections, reports }: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: logLevel,
      serializers: {
        // Fastify's default request log includes the client IP address.
        // ADR 0006: we never store raw IPs, so log only these fields.
        req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
      },
    },
    // Behind Caddy, every request seems to come from Caddy's address. Caddy
    // puts the visitor's real IP in X-Forwarded-For, and Fastify uses it for
    // request.ip, but only if the request came from a proxy we trust.
    // Otherwise anyone could send a fake X-Forwarded-For header.
    trustProxy: trustProxy === '' ? false : trustProxy,
    // Every request gets an ID that appears in all of its log lines.
    // Caddy sets X-Request-Id on every request; reuse it so one ID follows
    // the request across services.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  // Send the ID back to the client too, so a bug report can quote it.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Liveness: "the process is running". Never touches the DB, so it stays
  // up even when the database is down.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Readiness: "I can actually serve requests" = the DB answers.
  app.get('/readyz', async (request, reply) => {
    try {
      await db.query('select 1');
      return { status: 'ok' };
    } catch (err) {
      // Log the real error for us, but never send it to the client: raw DB
      // errors can leak hostnames, usernames and schema details.
      request.log.error({ err }, 'readiness check failed: database unreachable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  if (auth) {
    app.register(async (scope) => {
      await registerAuth(scope, auth);
      if (checkin) await registerCheckin(scope, checkin);
      if (sections) await registerSections(scope, sections);
      if (reports) await registerReports(scope, reports);
    });
  }

  // Fastify's default error reply includes err.message, which can leak SQL,
  // table names or library internals. Log the real error for us and send the
  // client only an error code.
  app.setErrorHandler((err: { statusCode?: number }, request, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) request.log.error({ err }, 'unhandled error');
    return reply.code(status).send({ error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST' });
  });

  return app;
}
