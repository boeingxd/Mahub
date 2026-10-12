import secureSession from '@fastify/secure-session';
import type { FastifyInstance } from 'fastify';
import type { GoogleAuth, LoginChecks } from './google.js';
import { applyLoginPolicy, homePathFor, type UserStore } from './loginPolicy.js';
import { safeReturnTo } from './returnTo.js';

// What we keep in the session cookie. It's encrypted with SESSION_KEY, so the
// browser can store it but can't read or change it (ADR 0008: no table needed).
declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string;
    // Only while a login is in progress (between /auth/login and /auth/callback).
    login: LoginChecks & { returnTo?: string };
  }
}

export interface AuthOptions {
  google: GoogleAuth;
  users: UserStore;
  // 32 random bytes. Anyone with this key could forge a login cookie.
  sessionKey: Buffer;
}

const EIGHT_HOURS = 8 * 60 * 60; // seconds

export async function registerAuth(app: FastifyInstance, { google, users, sessionKey }: AuthOptions) {
  await app.register(secureSession, {
    key: sessionKey,
    cookieName: 'mahub_session',
    // The encrypted contents expire after 8 h even if someone keeps the cookie.
    expiry: EIGHT_HOURS,
    cookie: {
      path: '/',
      httpOnly: true, // page JavaScript can't read it, so an XSS bug can't steal it
      secure: true, // only sent over HTTPS (browsers make an exception for localhost)
      // Sent when you click a link to our site (needed for Google's redirect
      // back to /auth/callback), but not on cross-site POSTs. That blocks
      // another website from silently logging you out or acting as you.
      sameSite: 'lax',
      maxAge: EIGHT_HOURS,
    },
  });

  // Step 1: the "Sign in with Google" button links here.
  app.get<{ Querystring: { returnTo?: string } }>('/auth/login', async (request, reply) => {
    const { url, checks } = await google.start();
    request.session.set('login', { ...checks, returnTo: safeReturnTo(request.query.returnTo) });
    return reply.redirect(url);
  });

  // Step 2: Google sends the browser back here with ?code=...&state=...
  app.get('/auth/callback', async (request, reply) => {
    const login = request.session.get('login');
    request.session.set('login', undefined); // single use
    if (!login) {
      // No login in progress: the cookie expired, or someone opened this URL directly.
      return reply.code(400).send({ error: 'LOGIN_EXPIRED' });
    }

    let identity;
    try {
      const query = new URL(request.url, 'http://placeholder').search.slice(1);
      identity = await google.finish(query, login);
    } catch (err) {
      // Bad state, cancelled login, forged token... Log details for us only.
      request.log.warn({ err }, 'google login failed');
      request.session.delete();
      return reply.code(400).send({ error: 'LOGIN_FAILED' });
    }

    const result = await applyLoginPolicy(identity, users);
    if (!result.ok) {
      // Don't log the email: it's personal data we don't need to keep.
      request.log.info({ reason: result.error }, 'login refused');
      request.session.delete();
      return reply.redirect('/not-registered', 303);
    }

    // Start a fresh session for the logged-in user, so nothing from before
    // login carries over.
    request.session.regenerate();
    request.session.set('userId', result.userId);

    const profile = await users.getProfile(result.userId);
    return reply.redirect(login.returnTo ?? homePathFor(profile?.roles ?? []), 303);
  });

  // POST, not GET, so a link or <img src> on another site can't log you out.
  app.post('/auth/logout', async (request, reply) => {
    request.session.delete();
    return reply.code(204).send();
  });

  // Who am I? The web app calls this to decide which screens to show.
  app.get('/me', async (request, reply) => {
    const userId = request.session.get('userId');
    const profile = userId ? await users.getProfile(userId) : null;
    if (!profile) {
      request.session.delete();
      return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    }
    return profile;
  });
}
