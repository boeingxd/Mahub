import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { makeToken, verifyToken, WINDOW_SECONDS, windowAt } from './qr.js';
import type { QrStore } from './qrStore.js';

export interface CheckinOptions {
  qrSecret: string;
  store: QrStore;
  now?: () => number; // milliseconds; tests pass a fixed clock
}

// What a scanned QR link looks like: /c/<class_session_id>.<window>.<token>
// zod checks the shape before anything else runs (old bug 2: never trust input).
const ScanParts = z.object({
  id: z.uuid(),
  window: z.coerce.number().int().nonnegative(),
  token: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
});

const ClassSessionId = z.object({ id: z.uuid() });

// Must be registered in the same scope as registerAuth (it uses its cookies).
export async function registerCheckin(app: FastifyInstance, { qrSecret, store, now = Date.now }: CheckinOptions) {
  // The projector asks for the current QR every few seconds (task B6).
  // Only the instructor of that section gets it.
  app.get('/class-sessions/:id/qr', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const params = ClassSessionId.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'NOT_FOUND' });
    const { id } = params.data;

    const state = await store.windowStateForInstructor(userId, id);
    if (state === null) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (state === 'closed') return reply.code(409).send({ error: 'SESSION_CLOSED' });

    const t = now();
    const window = windowAt(t);
    const path = `/c/${id}.${window}.${makeToken(qrSecret, id, window)}`;
    return {
      // The full address the phone camera opens. Behind Caddy (and the tunnel)
      // request.protocol and request.host come from the proxy's
      // X-Forwarded-Proto / Host headers, which we only trust from Caddy.
      url: `${request.protocol}://${request.host}${path}`,
      window,
      // Seconds until this window ends and the QR should change.
      expires_in: WINDOW_SECONDS - Math.floor((t / 1000) % WINDOW_SECONDS),
      // The server's clock is the one that counts (PROJECT_PLAN.md §6).
      server_time: new Date(t).toISOString(),
    };
  });

  // What the phone opens after scanning. Checks the QR, remembers the scan in
  // a 90 s encrypted cookie, then sends the student to sign in (if needed) and
  // on to the check-in page. Nothing is written to the database here.
  app.get<{ Params: { scan: string } }>('/c/:scan', async (request, reply) => {
    const [id, window, token] = request.params.scan.split('.');
    const scan = ScanParts.safeParse({ id, window, token });
    // Any problem (bad shape, forged or old token) looks the same to the
    // student: "this QR has expired, scan again". The web page shows it.
    if (!scan.success || !verifyToken(qrSecret, scan.data.id, scan.data.window, scan.data.token, now())) {
      return reply.redirect('/checkin?error=QR_EXPIRED', 303);
    }
    if (!(await store.isOpen(scan.data.id))) {
      return reply.redirect('/checkin?error=SESSION_CLOSED', 303);
    }

    request.scan.set('classSessionId', scan.data.id);
    request.scan.set('scannedAt', now());

    // Already signed in: straight to the check-in page. Otherwise sign in
    // first; the login keeps returnTo and brings them back.
    // (/c/* reaches the API through Caddy unchanged, while sign-in lives
    // under /api, hence the full path.)
    if (request.session.get('userId')) return reply.redirect('/checkin', 303);
    return reply.redirect('/api/auth/login?returnTo=%2Fcheckin', 303);
  });
}
