import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { QrStore } from '../checkin/qrStore.js';
import type { RosterHub } from './hub.js';

export interface RealtimeOptions {
  hub: RosterHub;
  // Reuses the projector's rule: only the instructor of a window's section.
  store: Pick<QrStore, 'windowStateForInstructor'>;
  // How often to ping each socket. A socket that missed the last ping is dropped.
  pingMs?: number;
}

// The only message a browser may send: "tell me about this window".
const Subscribe = z.strictObject({ subscribe: z.guid() });
const MAX_WATCHED = 5; // windows per socket
const MAX_MESSAGE_BYTES = 1024;

// A browser opening a socket from another website would still send our
// cookie in some browsers' settings. Refuse a socket whose Origin isn't us.
function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // not a browser (curl, tests)
  try {
    return new URL(origin).host === request.host;
  } catch {
    return false;
  }
}

// Must be registered in the same scope as registerAuth (it reads the login cookie).
export async function registerRealtime(app: FastifyInstance, { hub, store, pingMs = 20_000 }: RealtimeOptions) {
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

  app.get(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade, so a refusal is a normal 401 / 403 reply.
      onRequest: async (request, reply) => {
        if (!request.session.get('userId')) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
        if (!sameOrigin(request)) return reply.code(403).send({ error: 'FORBIDDEN' });
      },
    },
    (socket, request) => {
      const userId = request.session.get('userId')!;
      const sender = { send: (text: string) => socket.send(text) };
      const watching = new Set<string>();
      const reply = (message: object) => socket.send(JSON.stringify(message));

      // Heartbeat: every pingMs, drop a socket that never answered the last
      // ping (a phone that left the Wi-Fi, a laptop that went to sleep).
      let alive = true;
      socket.on('pong', () => (alive = true));
      const heartbeat = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
      }, pingMs);

      socket.on('message', async (raw) => {
        try {
          let json: unknown;
          try {
            json = JSON.parse(raw.toString());
          } catch {
            return reply({ error: 'BAD_REQUEST' });
          }
          const message = Subscribe.safeParse(json);
          if (!message.success || (watching.size >= MAX_WATCHED && !watching.has(message.data.subscribe))) {
            return reply({ error: 'BAD_REQUEST' });
          }
          const id = message.data.subscribe;
          // Same answer for "no such window" and "not yours" (we don't say which).
          if ((await store.windowStateForInstructor(userId, id)) === null) return reply({ error: 'NOT_FOUND' });
          watching.add(id);
          hub.subscribe(id, sender);
          reply({ subscribed: id });
        } catch (err) {
          request.log.error({ err }, 'websocket message failed');
          reply({ error: 'INTERNAL' });
        }
      });

      socket.on('close', () => {
        clearInterval(heartbeat);
        hub.unsubscribeAll(sender);
      });
    },
  );
}
