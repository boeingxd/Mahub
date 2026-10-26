// The live roster hub and the /ws route (task B5), with fakes instead of a
// database. The real LISTEN connection is tested in test/db/rosterListener.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { GoogleAuth } from '../src/auth/google.js';
import type { UserStore } from '../src/auth/loginPolicy.js';
import type { Queryable } from '../src/db.js';
import { createRosterHub, type RosterHub } from '../src/realtime/hub.js';

const INSTRUCTOR = randomUUID();
const STUDENT = randomUUID();
const MINE = randomUUID(); // a window the instructor teaches
const MINE_TOO = randomUUID(); // a second window the instructor teaches
const OTHER = randomUUID(); // a window someone else teaches
let signedInAs: string = INSTRUCTOR;

const google: GoogleAuth = {
  async start() {
    return { url: 'https://accounts.google.test/', checks: { state: 's', nonce: 'n', codeVerifier: 'v' } };
  },
  async finish() {
    return { sub: signedInAs, email: 'x@example.com', emailVerified: true };
  },
};
const users = {
  async findByGoogleSub(sub: string) {
    return { id: sub, email: 'x@example.com', googleSub: sub };
  },
  async getProfile() {
    return null;
  },
} as unknown as UserStore;

// Only INSTRUCTOR teaches MINE. Everything else is "not found or not yours".
const store = {
  async windowStateForInstructor(userId: string, id: string) {
    return userId === INSTRUCTOR && (id === MINE || id === MINE_TOO) ? ('open' as const) : null;
  },
};

let app: FastifyInstance;
let hub: RosterHub;
let sockets: WebSocket[] = [];
let port = 0;

async function build(pingMs?: number, subscribeTimeoutMs?: number) {
  hub = createRosterHub();
  app = buildApp({
    db: {} as Queryable,
    logLevel: 'silent',
    auth: { google, users, sessionKey: randomBytes(32) },
    realtime: { hub, store, pingMs, subscribeTimeoutMs },
  });
  // A real (local) port, because the websocket plugin lives inside the auth
  // scope and so app.injectWS isn't available on the root app.
  await app.listen({ host: '127.0.0.1', port: 0 });
  port = (app.server.address() as { port: number }).port;
}
beforeEach(() => {
  signedInAs = INSTRUCTOR;
});
afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets = [];
  await app.close();
});

async function loginCookie(as: string) {
  signedInAs = as;
  const cookie = (res: { cookies: { name: string; value: string }[] }) => res.cookies.find((c) => c.name === 'mahub_session')!.value;
  const start = await app.inject({ method: 'GET', url: '/auth/login' });
  const done = await app.inject({ method: 'GET', url: '/auth/callback?code=c&state=s', cookies: { mahub_session: cookie(start) } });
  return cookie(done);
}

// Opens /ws. Rejects with the HTTP status when the server refuses the upgrade.
function open(headers: Record<string, string> = {}, wsOptions: object = {}) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers, ...wsOptions });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

// Opens /ws as a signed-in user, from our own origin (a browser always sends
// one), and collects every text message it receives.
async function connect(as: string, headers: Record<string, string> = {}, wsOptions?: object) {
  const session = await loginCookie(as);
  const ws = await open({ cookie: `mahub_session=${encodeURIComponent(session)}`, origin: `http://127.0.0.1:${port}`, ...headers }, wsOptions);
  sockets.push(ws);
  const got: Record<string, unknown>[] = [];
  ws.on('message', (data) => got.push(JSON.parse(data.toString())));
  return { ws, got };
}
const next = (got: unknown[], n: number) =>
  new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => (got.length >= n ? resolve() : Date.now() - start > 2000 ? reject(new Error(`only ${got.length} of ${n} messages`)) : setTimeout(tick, 10));
    tick();
  });
const closedWith = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
const quiet = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const change = (class_session_id: string, status = 'present') => JSON.stringify({ class_session_id, student_id: randomUUID(), status });

describe('/ws', () => {
  it('refuses a socket that is not signed in', async () => {
    await build();
    await expect(open()).rejects.toThrow(/401/);
  });

  it('refuses a socket opened from another website', async () => {
    await build();
    await expect(connect(INSTRUCTOR, { origin: 'https://evil.example' })).rejects.toThrow(/403/);
    // Our own site is fine, whatever its address (here a different port is not).
    await expect(connect(INSTRUCTOR, { origin: `http://127.0.0.1:${port + 1}` })).rejects.toThrow(/403/);
    const ok = await connect(INSTRUCTOR);
    expect(ok.ws.readyState).toBe(1);
  });

  it('refuses a socket with no Origin header', async () => {
    await build();
    const session = await loginCookie(INSTRUCTOR);
    await expect(open({ cookie: `mahub_session=${encodeURIComponent(session)}` })).rejects.toThrow(/403/);
  });

  it("the instructor gets their window's changes, and only theirs", async () => {
    await build();
    const { ws, got } = await connect(INSTRUCTOR);
    ws.send(JSON.stringify({ subscribe: MINE }));
    await next(got, 1);
    expect(got[0]).toEqual({ subscribed: MINE });

    const mine = JSON.parse(change(MINE, 'excused'));
    hub.publish(JSON.stringify(mine));
    hub.publish(change(OTHER)); // another window: must not arrive
    await next(got, 2);
    await quiet();
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual({ type: 'roster', ...mine });
  });

  it('a student who tries to subscribe is refused and hears nothing', async () => {
    await build();
    const { ws, got } = await connect(STUDENT);
    const closed = closedWith(ws);
    ws.send(JSON.stringify({ subscribe: MINE }));
    await next(got, 1);
    expect(got[0]).toEqual({ error: 'FORBIDDEN' });
    expect(await closed).toBe(4403);
    hub.publish(change(MINE));
    await quiet();
    expect(got).toHaveLength(1);
    expect(hub.subscriberCount(MINE)).toBe(0);
  });

  it('a window that does not exist is refused the same way (nobody can probe ids)', async () => {
    await build();
    const { ws, got } = await connect(INSTRUCTOR);
    const closed = closedWith(ws);
    ws.send(JSON.stringify({ subscribe: randomUUID() }));
    await next(got, 1);
    expect(got[0]).toEqual({ error: 'FORBIDDEN' });
    expect(await closed).toBe(4403);
  });

  it('one socket watches one window: asking for a second is refused', async () => {
    await build();
    const { ws, got } = await connect(INSTRUCTOR);
    ws.send(JSON.stringify({ subscribe: MINE }));
    await next(got, 1);
    ws.send(JSON.stringify({ subscribe: MINE_TOO }));
    await next(got, 2);
    expect(got[1]).toEqual({ error: 'BAD_REQUEST' });
    expect(hub.subscriberCount(MINE_TOO)).toBe(0);
    expect(hub.subscriberCount(MINE)).toBe(1);
  });

  it('closes a socket that never subscribes (4408), but not one that did', async () => {
    await build(undefined, 150);
    const idle = await connect(INSTRUCTOR);
    const busy = await connect(INSTRUCTOR);
    busy.ws.send(JSON.stringify({ subscribe: MINE }));
    expect(await closedWith(idle.ws)).toBe(4408);
    await quiet(200);
    expect(busy.ws.readyState).toBe(1);
  });

  it('closes a socket that sends more than 1 KB (1009)', async () => {
    await build();
    const { ws } = await connect(INSTRUCTOR);
    const closed = closedWith(ws);
    ws.send('x'.repeat(2000));
    expect(await closed).toBe(1009);
  });

  it('refuses messages that are not exactly {"subscribe": "<id>"}', async () => {
    await build();
    const { ws, got } = await connect(INSTRUCTOR);
    for (const bad of ['not json', '{}', '{"subscribe":"x"}', `{"subscribe":"${MINE}","extra":1}`]) ws.send(bad);
    await next(got, 4);
    expect(got).toEqual(Array(4).fill({ error: 'BAD_REQUEST' }));
  });

  it('stops sending when the socket closes', async () => {
    await build();
    const { ws, got } = await connect(INSTRUCTOR);
    ws.send(JSON.stringify({ subscribe: MINE }));
    await next(got, 1);
    expect(hub.subscriberCount(MINE)).toBe(1);
    ws.close();
    await quiet();
    expect(hub.subscriberCount(MINE)).toBe(0);
  });

  it('resync tells every watcher to re-fetch the roster', async () => {
    await build();
    const { ws, got } = await connect(INSTRUCTOR);
    ws.send(JSON.stringify({ subscribe: MINE }));
    await next(got, 1);
    hub.resync();
    await next(got, 2);
    expect(got[1]).toEqual({ type: 'resync' });
  });
});

describe('heartbeat', () => {
  it('pings, and keeps a socket that answers', async () => {
    await build(40);
    const { ws } = await connect(INSTRUCTOR);
    let pings = 0;
    ws.on('ping', () => pings++);
    await quiet(250);
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(ws.readyState).toBe(1);
  });

  it('drops a socket that stops answering', async () => {
    await build(40);
    const { ws } = await connect(INSTRUCTOR, {}, { autoPong: false });
    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()));
    await Promise.race([closed, quiet(500).then(() => Promise.reject(new Error('still open')))]);
  });
});

describe('hub', () => {
  it('ignores text that is not a roster message', () => {
    const h = createRosterHub();
    const heard: string[] = [];
    h.subscribe(MINE, { send: (t) => heard.push(t) });
    for (const bad of ['nope', '{}', JSON.stringify({ class_session_id: MINE, student_id: 'x', status: 'present' }), change(MINE, 'late')]) h.publish(bad);
    expect(heard).toEqual([]);
  });
});
