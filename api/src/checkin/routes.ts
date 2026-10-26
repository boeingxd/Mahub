import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SCAN_SECONDS } from '../auth/routes.js';
import type { CheckinOutcome, CheckinStore } from './checkinStore.js';
import { makeToken, verifyToken, WINDOW_SECONDS, windowAt } from './qr.js';
import type { QrStore } from './qrStore.js';

export interface CheckinOptions {
  qrSecret: string;
  store: QrStore;
  checkins: CheckinStore; // the check-in transaction (task Y4)
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

// What the phone sends to check in. z.number() refuses strings, so the old
// app's `lat: "x"` (which became NaN and skipped the GPS check) is a 400
// here. .strict() refuses extra fields too: the client can't send a
// "status" or a "student_id" and hope it gets used.
const CheckinBody = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(5000),
  })
  .strict();

// How each outcome is answered. Codes are listed in docs/API.md.
const REFUSALS: Record<Exclude<CheckinOutcome, 'ok'>, { status: number; error: string }> = {
  session_closed: { status: 409, error: 'SESSION_CLOSED' },
  not_enrolled: { status: 403, error: 'NOT_ENROLLED' },
  out_of_range: { status: 422, error: 'OUT_OF_RANGE' },
  already_present: { status: 409, error: 'ALREADY_PRESENT' },
};

// Must be registered in the same scope as registerAuth (it uses its cookies).
export async function registerCheckin(app: FastifyInstance, { qrSecret, store, checkins, now = Date.now }: CheckinOptions) {
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

  // The student's phone sends its location here after the scan (and sign-in).
  // The server checks everything and records attendance itself, in one
  // transaction (checkinStore.ts). The client never writes attendance.
  app.post('/checkin/complete', async (request, reply) => {
    const userId = request.session.get('userId');
    if (!userId) return reply.code(401).send({ error: 'UNAUTHENTICATED' });

    const body = CheckinBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'BAD_REQUEST' });

    // Which window? Only the scan cookie says, and only for 90 s after the
    // scan. (The cookie also expires by itself, but its contents are
    // checked too, against our clock.) The client can't pick a window.
    const classSessionId = request.scan.get('classSessionId');
    const scannedAt = request.scan.get('scannedAt');
    if (!classSessionId || !scannedAt || now() - scannedAt > SCAN_SECONDS * 1000) {
      return reply.code(400).send({ error: 'QR_EXPIRED' });
    }

    const { outcome, distanceM } = await checkins.complete(userId, classSessionId, body.data);

    // The scan is used up, so the same cookie can't be sent again. Except
    // after OUT_OF_RANGE: then the student may retry with a better GPS fix
    // within the same 90 s.
    if (outcome !== 'out_of_range') request.scan.delete();

    if (outcome === 'ok') return { result: 'present', distance_m: distanceM };
    const { status, error } = REFUSALS[outcome];
    return reply.code(status).send({ error });
  });
}
