// Load test (task B8): 300 students check in within about 30 seconds.
// See load/README.md for how to run it.
//
// What each fake student does, like a real phone, minus Google:
//   1. sign in            POST /api/auth/test-login   (needs LOAD_TEST=1 on the API)
//   2. scan the QR        GET  /c/<id>.<window>.<token>  (sets the scan cookie)
//   3. send the location  POST /api/checkin/complete
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://caddy:8080';
const QR_SECRET = __ENV.QR_SECRET;
const STUDENTS = Number(__ENV.STUDENTS || 300);
const SPREAD_SECONDS = Number(__ENV.SPREAD_SECONDS || 25);
// Ids and place from db/seeds/seed.sql: ITS332 section 1, Building A room 101.
const SECTION = '00000000-0000-0000-0000-0000000000e1';
const ROOM = '00000000-0000-0000-0000-0000000000f1';
const HERE = { lat: 14.069, lng: 100.615, accuracy: 10 };
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

const rateLimited = new Counter('rate_limited_429');

export const options = {
  scenarios: {
    class: { executor: 'per-vu-iterations', vus: STUDENTS, iterations: 1, maxDuration: '2m' },
  },
  insecureSkipTLSVerify: true,
  thresholds: {
    // The goal from issue #39: 95% of requests under half a second, no failures.
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

// Same as makeToken in api/src/checkin/qr.ts: base64url(HMAC-SHA256(secret, "<id>:<window>")), first 16 characters.
function token(id, window) {
  const mac = crypto.hmac('sha256', QR_SECRET, `${id}:${window}`, 'base64');
  return mac.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 16);
}

// The API's cookies are marked Secure (HTTPS only) and k6 obeys that, but we
// talk to Caddy over plain HTTP inside Docker. So copy each cookie the API
// set into k6's cookie jar by hand, as a normal one.
function keepCookies(res) {
  const jar = http.cookieJar();
  for (const name in res.cookies) jar.set(BASE, name, res.cookies[name][0].value, { path: '/' });
}

// Runs once: the instructor opens the check-in window.
export function setup() {
  if (!QR_SECRET) throw new Error('Pass QR_SECRET (the same one the API uses): -e QR_SECRET=...');
  const login = http.post(`${BASE}/api/auth/test-login`, JSON.stringify({ email: 'instructor1@example.com' }), JSON_HEADERS);
  keepCookies(login);
  if (login.status !== 204) throw new Error(`instructor login failed (${login.status}). Is LOAD_TEST=1 set on the API?`);
  const open = http.post(`${BASE}/api/sections/${SECTION}/class-sessions`, JSON.stringify({ room_id: ROOM }), JSON_HEADERS);
  if (open.status !== 201) throw new Error(`could not open the window (${open.status}): ${open.body}`);
  return { id: open.json('id') };
}

export default function (data) {
  // Students don't all scan on the same second.
  sleep(Math.random() * SPREAD_SECONDS);
  const email = `67300${String(__VU - 1).padStart(5, '0')}@g.siit.tu.ac.th`;

  const login = http.post(`${BASE}/api/auth/test-login`, JSON.stringify({ email }), JSON_HEADERS);
  keepCookies(login);
  const window = Math.floor(Date.now() / 1000 / 10);
  const scan = http.get(`${BASE}/c/${data.id}.${window}.${token(data.id, window)}`, { redirects: 0 });
  keepCookies(scan);
  const done = http.post(`${BASE}/api/checkin/complete`, JSON.stringify(HERE), JSON_HEADERS);

  for (const r of [login, scan, done]) if (r.status === 429) rateLimited.add(1);
  check(null, {
    'login 204': () => login.status === 204,
    'scan accepted (303 to /checkin)': () => scan.status === 303 && scan.headers.Location === '/checkin',
    'check-in recorded': () => done.status === 200 && done.json('result') === 'present',
  });
}

// Runs once at the end: close the window.
export function teardown(data) {
  keepCookies(http.post(`${BASE}/api/auth/test-login`, JSON.stringify({ email: 'instructor1@example.com' }), JSON_HEADERS));
  http.post(`${BASE}/api/class-sessions/${data.id}/close`);
}
