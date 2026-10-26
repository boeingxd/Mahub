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
  // A socket must send a valid subscribe within this long, or it is closed.
  subscribeTimeoutMs?: number;
}

// The only message a browser may send: "tell me about this window".
const Subscribe = z.strictObject({ subscribe: z.guid() });
const MAX_MESSAGE_BYTES = 1024; // bigger: the socket is closed with code 1009
// Close codes in the 4000s are ours (docs/API.md, "Live roster").
const CLOSE_FORBIDDEN = 4403;
const CLOSE_NO_SUBSCRIBE = 4408;

// Another website must not be able to open the socket with a visitor's
// cookie. "Our own site" is whatever address this request was sent to (the
// Cloudflare Tunnel address changes on every restart, so no fixed list): the
// Origin's host and port must equal the request's Host header. A request with
// no Origin is refused too: every browser sends one on a WebSocket.
function sameOrigin(request: FastifyRequest): boolean {
  const { origin, host } = request.headers;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Must be registered in the same scope as registerAuth (it reads the login cookie).
export async function registerRealtime(app: FastifyInstance, { hub, store, pingMs = 20_000, subscribeTimeoutMs = 10_000 }: RealtimeOptions) {
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
      let watching: string | undefined; // one window per socket; to switch, open a new socket
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

      // An idle connection must not be held open for free.
      const noSubscribe = setTimeout(() => {
        if (!watching) socket.close(CLOSE_NO_SUBSCRIBE);
      }, subscribeTimeoutMs);

      socket.on('message', async (raw) => {
        try {
          let json: unknown;
          try {
            json = JSON.parse(raw.toString());
          } catch {
            return reply({ error: 'BAD_REQUEST' });
          }
          const message = Subscribe.safeParse(json);
          if (!message.success || (watching && watching !== message.data.subscribe)) {
            return reply({ error: 'BAD_REQUEST' });
          }
          const id = message.data.subscribe;
          // Same answer for "no such window" and "not yours" (we don't say which).
          if ((await store.windowStateForInstructor(userId, id)) === null) {
            reply({ error: 'FORBIDDEN' });
            return socket.close(CLOSE_FORBIDDEN);
          }
          if (!watching) hub.subscribe(id, sender);
          watching = id;
          clearTimeout(noSubscribe);
          reply({ subscribed: id });
        } catch (err) {
          request.log.error({ err }, 'websocket message failed');
          reply({ error: 'INTERNAL' });
        }
      });

      socket.on('close', () => {
        clearTimeout(noSubscribe);
        clearInterval(heartbeat);
        hub.unsubscribeAll(sender);
      });
    },
  );
}
