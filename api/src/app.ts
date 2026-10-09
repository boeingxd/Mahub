import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Queryable } from './db.js';

export interface AppOptions {
  db: Queryable;
  logLevel?: string;
  // Comma-separated proxy IPs/ranges to trust for X-Forwarded-For ('' = none).
  trustProxy?: string;
}

// Builds the Fastify app without starting it. server.ts calls listen();
// tests call app.inject() to send fake requests without opening a port.
export function buildApp({ db, logLevel = 'info', trustProxy = '' }: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: logLevel,
      serializers: {
        // Fastify's default request log includes the client IP address.
        // ADR 0006: we never store raw IPs, so log only these fields.
        req: (req) => ({ method: req.method, url: req.url }),
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

  return app;
}
