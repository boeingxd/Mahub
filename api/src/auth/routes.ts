import secureSession, { type Session } from '@fastify/secure-session';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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

// A second encrypted cookie for the QR scan (task Y3): it remembers which
// check-in window the student scanned while they sign in with Google.
export interface ScanData {
  classSessionId: string;
  scannedAt: number; // milliseconds since 1970
}
declare module 'fastify' {
  interface FastifyRequest {
    scan: Session<ScanData>;
  }
}

export interface AuthOptions {
  google: GoogleAuth;
  users: UserStore;
  // 32 random bytes. Anyone with this key could forge a login cookie.
  sessionKey: Buffer;
  // Load test only (task B8): adds POST /auth/test-login. Off unless LOAD_TEST=1.
  loadTest?: boolean;
}

const EIGHT_HOURS = 8 * 60 * 60; // seconds
export const SCAN_SECONDS = 90;

export async function registerAuth(app: FastifyInstance, { google, users, sessionKey, loadTest }: AuthOptions) {
  const cookie = {
    path: '/',
    httpOnly: true, // page JavaScript can't read it, so an XSS bug can't steal it
    secure: true, // only sent over HTTPS (browsers make an exception for localhost)
    // Sent when you click a link to our site (needed for Google's redirect
    // back to /auth/callback), but not on cross-site POSTs. That blocks
    // another website from silently logging you out or acting as you.
    sameSite: 'lax' as const,
  };
  await app.register(secureSession, [
    {
      sessionName: 'session',
      key: sessionKey,
      cookieName: 'mahub_session',
      // The encrypted contents expire after 8 h even if someone keeps the cookie.
      expiry: EIGHT_HOURS,
      cookie: { ...cookie, maxAge: EIGHT_HOURS },
    },
    {
      sessionName: 'scan',
      key: sessionKey,
      cookieName: 'mahub_scan',
      // A scan is only good for 90 s: long enough to sign in, short enough
      // that a copied cookie is about as useless as a forwarded QR photo.
      expiry: SCAN_SECONDS,
      cookie: { ...cookie, maxAge: SCAN_SECONDS },
    },
  ]);

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

  // Load test only (task B8): sign in as an email without Google, so k6 can
  // log in hundreds of students. It still runs the real login policy and
  // session code; only the Google step is skipped. loadConfig refuses
  // LOAD_TEST=1 unless the redirect URI is on localhost.
  if (loadTest) {
    app.post('/auth/test-login', async (request, reply) => {
      const body = z.strictObject({ email: z.string().max(254) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });
      const email = body.data.email.toLowerCase();
      const result = await applyLoginPolicy({ sub: `loadtest:${email}`, email, emailVerified: true }, users);
      if (!result.ok) return reply.code(403).send({ error: result.error });
      request.session.regenerate();
      request.session.set('userId', result.userId);
      return reply.code(204).send();
    });
  }

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
