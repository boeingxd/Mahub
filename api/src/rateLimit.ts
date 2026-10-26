import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

// Rate limits (task B7). Counters live in memory and are keyed by the visitor's
// IP or user id; nothing is written to disk or the database, and no IP is
// logged (ADR 0006). shortcut: in-memory counters reset on restart and aren't
// shared between API instances; fine for one container, move to Redis if we scale out.
export const IP_LIMIT = 300; // per IP per minute, everywhere. Generous: a whole class shares one campus IP (NAT)
export const CHECKIN_LIMIT = 5; // per signed-in user per minute, on /checkin/*
const timeWindow = '1 minute';

// What a limited client gets. Our error handler turns it into { error: 'RATE_LIMITED' }.
const errorResponseBuilder = () => ({ statusCode: 429 });

// The per-IP limit on every route. request.ip is the real visitor only when
// the request came through Caddy (TRUST_PROXY); otherwise a forged
// X-Forwarded-For is ignored, so it can't be used to dodge the limit.
// It's a hook, not `global: true`, because that only covers routes declared
// AFTER the plugin has loaded, and buildApp declares its routes straight away.
export function registerIpLimit(app: FastifyInstance) {
  app.register(rateLimit, { global: false, timeWindow, errorResponseBuilder });
  app.after(() => app.addHook('onRequest', app.rateLimit({ max: IP_LIMIT })));
}

// The tight per-user limit on /checkin/*. Per user, not per IP, so a lecture
// hall behind one IP can still all check in. Register it in the same scope as
// the session cookie (it reads the user from it), after registerAuth and
// registerIpLimit.
export function registerCheckinLimit(app: FastifyInstance) {
  app.after(() => {
    // createRateLimit, not rateLimit(): the plugin runs only one rateLimit()
    // hook per request, and the per-IP hook has already used it.
    const check = app.createRateLimit({
      max: CHECKIN_LIMIT,
      // Only /checkin/* and only signed-in users; nobody else is counted here
      // (not signed in = a 401 from the route, and the per-IP limit still applies).
      allowList: (request) => !request.url.startsWith('/checkin/') || !request.session.get('userId'),
      // The prefix keeps these counters apart from the per-IP ones.
      keyGenerator: (request) => `checkin:${request.session.get('userId')}`,
    });
    app.addHook('onRequest', async (request) => {
      const limit = await check(request);
      if (!limit.isAllowed && limit.isExceeded) throw errorResponseBuilder();
    });
  });
}
