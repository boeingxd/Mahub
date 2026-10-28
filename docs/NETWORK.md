# Network

How a request travels through Mahub, which ports are open, and who trusts whom. Updated by every networking task (B2, B4, B5, B7).

## The hops

Two ways in, both ending at Caddy. Your browser uses door 1. Phones use door 2 (the tunnel, started only when you need it).

```
 A phone on mobile data              Your browser (on the laptop)
      │  HTTPS  https://xxxx.trycloudflare.com        │  HTTPS  https://localhost
      ▼                                               │  (port 443; port 80 only redirects to 443)
 Cloudflare  (HTTPS ends here)                        │
      │  a connection that cloudflared opened         │
      │  OUT from your laptop                         │
      ▼                                               │
 ┌─────────────────────────────┐                      │
 │ tunnel (cloudflared)        │                      │
 │  172.28.1.10, not published │                      │
 └──────────────┬──────────────┘                      │
                │  plain HTTP, caddy:8080 (door 2)    │
                ▼                                     ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ caddy   door 1: 127.0.0.1:80/:443   door 2: :8080 (Docker)  │
 │  · TLS with its own local certificate authority             │
 │  · adds security headers to every response                  │
 │  · sets a fresh X-Request-Id and the real X-Forwarded-For   │
 │  · /api/*  → api:3000  (prefix /api removed)                │
 │  · /c/*, /ws → api:3000 (path unchanged)                    │
 │  · /       → the React web app (static files in /srv)       │
 └───────────────────────┬─────────────────────────────────────┘
        frontend network │ 172.28.1.0/24, plain HTTP inside Docker
 ┌───────────────────────▼─────────────────────────────────────┐
 │ api              NOT published (no port on the laptop)      │
 │  · trusts X-Forwarded-For only from 172.28.1.0/24 (Caddy)   │
 └───────────────────────┬─────────────────────────────────────┘
         backend network │ SQL, port 5432
 ┌───────────────────────▼─────────────────────────────────────┐
 │ db               published on 127.0.0.1:5432 (for dbmate)   │
 └─────────────────────────────────────────────────────────────┘
```

**Network segmentation:** Caddy is on `frontend` only, the database on `backend` only, and the API on both. So Caddy can't reach the database even if it's misconfigured or compromised.

## Ports

| Service | Inside Docker | On the laptop | Reachable from your Wi-Fi? |
|---|---|---|---|
| caddy | 80, 443, 8080 | 127.0.0.1:80, 127.0.0.1:443 (8080 is not published) | No (127.0.0.1 only). Phones come in through the tunnel |
| tunnel | none | not published | It only dials out to Cloudflare |
| api | 3000 | not published | No |
| db | 5432 | 127.0.0.1:5432 | No |

`npm run dev` (in `api/`) is the exception for quick coding. It runs the API on your laptop at `http://localhost:3000`, without Caddy.

## Security headers (set by Caddy)

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=300` (5 min) locally | "Use HTTPS only" for this site. Kept short on localhost because it applies to every port on localhost; set `HSTS_MAX_AGE=31536000` in `.env` for the demo |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Only our own scripts and styles run (no inline scripts); no framing by other sites |
| `X-Content-Type-Options` | `nosniff` | The browser must not guess file types |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites see only our origin, not full URLs |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=()` | Only our pages may ask for location |
| `Server` | removed | Don't advertise our server software |

## Who trusts whom

- **Through the tunnel, the real client IP is in `CF-Connecting-IP`.** Anyone can send a header with that name, so Caddy believes it only when the request comes from the tunnel container, which has a fixed address (`172.28.1.10`, `trusted_proxies` in the Caddyfile). Door 2 then copies that IP into `X-Forwarded-For` for the API. Door 1 does the same with the real connection address. From anyone else the header is ignored. (The per-IP rate limit uses this IP; it's never stored.)
- **The real client IP.** Caddy overwrites `X-Forwarded-For` with the address it actually received the connection from, so a visitor can't fake it. The API believes that header only when the request comes from `172.28.1.0/24` (`TRUST_PROXY`), the `frontend` network where Caddy lives. Tests in `api/test/health.test.ts` check both cases.
- **Request IDs.** Caddy replaces any `X-Request-Id` the client sends with a fresh UUID. The API logs it on every line and returns it in the response, so one ID traces a request through both services.
- **No IPs stored** (ADR 0006). The API doesn't log IPs, and Caddy's access log is off.

## Rate limits (API, `api/src/rateLimit.ts`)

| Where | Limit | Counted per | Why |
|---|---|---|---|
| Every endpoint | 3000 a minute (`RATE_LIMIT_IP`) | IP (`request.ip`, the real visitor behind Caddy) | Stops a flood from one machine. Generous, because a whole lecture hall shares one campus IP (NAT) and each student makes about 5 API calls to check in. The k6 load test showed that 300 was far too low (see "Load test") |
| `/checkin/*` | 5 a minute | signed-in user | A student needs one try, a few if the signal is bad. Per user, not per IP, for the same NAT reason. Signed-out requests aren't counted here (the route answers 401) |

Over the limit the API answers `429` with `{"error":"RATE_LIMITED"}`. A request to `/checkin/*` counts against both limits.

- **Counters live in memory** and are keyed by IP or user id. Nothing is written to disk or the database, and no log line contains an IP (ADR 0006). They reset when the API restarts and aren't shared between several API containers (we run one; Redis would be the next step).
- **A forged `X-Forwarded-For` can't dodge the per-IP limit.** The API only believes that header from Caddy's network (`TRUST_PROXY`); from anyone else `request.ip` is the real connection address. `api/test/rateLimit.test.ts` checks it, and `api/test/health.test.ts` checks the trust rule itself.
- **Edge limit in Caddy: not done.** Caddy has no built-in rate limiter (it needs a plugin and a custom image build), so the generous per-IP limit lives in the API. It still sees the real IP because Caddy sets `X-Forwarded-For`.

## Load test (k6, `load/`)

Goal (issue #39): a whole class of 300 students checks in within about 30 seconds, 95% of requests answer in under 500 ms, and nothing fails.

Each fake student does what a phone does, minus Google: sign in, open the scan link, send the location. They start at random moments over 25 seconds. k6 runs in Docker on the Compose network and talks to Caddy's HTTPS door by its Compose name (`https://caddy`; door 1 answers to both `localhost` and `caddy`), so the traffic passes Caddy, the API and the database, like a real check-in. The tunnel's door (`:8080`) answers `404` for `/api/auth/test-login` on purpose, so the load-test login can never be reached through the tunnel.

**Results** (laptop, Docker Desktop, 300 students, 904 requests):

| | First run, per-IP limit 300/min | Second run, limit 3000/min |
|---|---|---|
| Check-ins recorded | 94 of 300 | **300 of 300** (300 attendance rows in the database) |
| Requests answered `429` | 617 of 904 | 0 |
| p95 response time | 7 ms | **8.7 ms** (limit: 500 ms) |
| Slowest request | 31 ms | 30 ms |
| Checks passed | 31% | **100%** |

**What it found:** the first run failed on the per-IP rate limit from B7, not on speed. A whole class sits behind one campus IP, and each student makes about 3 API calls here (more on a real phone: the Google redirects and `/me`), so 300 a minute let in only about 100 students. The per-IP limit is now 3000 a minute (`RATE_LIMIT_IP`). The real protection against abuse is the per-user limit of 5 a minute on `/checkin/*`.

**What this does not prove:** it ran on one laptop with fake sign-in (`POST /auth/test-login`), so Google's own speed and a real mobile network aren't included. Rows are inserted by one API process with a pool of 10 database connections; it was nowhere near that limit (p95 under 10 ms).

**Run it yourself** (needs the stack running, with `LOAD_TEST=1`):

```bash
# 1. Load the base seed, then the 300 students (a local database only!)
docker compose exec -T db psql -U postgres -d mahub -v ON_ERROR_STOP=1 < db/seeds/seed.sql
docker compose exec -T db psql -U postgres -d mahub -v ON_ERROR_STOP=1 < load/seed.sql
# 2. Start the stack with the test login on (it refuses unless the Google redirect URI is on localhost)
LOAD_TEST=1 docker compose up -d --build
# 3. Run k6 (QR_SECRET is the one in your .env)
docker run --rm -i --network mahub_frontend -e QR_SECRET=<your QR_SECRET> -v "$PWD/load:/load:ro" grafana/k6 run /load/checkin.js
```

If the run stops at `SESSION_ALREADY_OPEN`, a window from an earlier run is still open: close it in the app first. Turn `LOAD_TEST` off again afterwards (`docker compose up -d`).

## Trust Caddy's certificate on your Mac (once)

Caddy creates its own certificate authority (CA) the first time it starts and keeps it in the `caddy-data` volume. Until your Mac trusts that CA, browsers show a warning and you need `curl -k`.

```bash
docker compose up -d
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy-root.crt
rm caddy-root.crt
```

Restart the browser, then open https://localhost/api/healthz: padlock, no warning. Only redo this if you delete the volume (`docker compose down -v`).

## Phone testing (the Cloudflare Tunnel)

A phone can't reach `https://localhost`, that is your laptop only. The tunnel gives your laptop a temporary public HTTPS address. Phones need HTTPS to allow the location prompt.

```bash
docker compose --profile tunnel up -d tunnel      # start it
docker compose logs tunnel | grep "trycloudflare.com " | tail -1   # find the address (wait ~10 s; empty = not ready yet)
docker compose stop tunnel                         # stop it when you're done
```

- The first start can take a minute: it retries a few times before Cloudflare answers.
- **Anyone who has the address can open the app while the tunnel is running.** Stop it when you aren't testing, and don't post the address in public.
- **A network drop kills the address for good (27 Oct).** The laptop lost its network for a few minutes; the tunnel kept retrying but never came back, and Cloudflare had already removed the address (`ERR_NAME_NOT_RESOLVED` everywhere). The only fix is `docker compose --profile tunnel up -d --force-recreate tunnel`, which gives a new address; then update `DOCKER_GOOGLE_REDIRECT_URI` in `.env`, recreate the API (`docker compose up -d api`) and have the Google console updated. Keep the laptop awake (`caffeinate -dimsu`) and on one stable network. Check `curl https://<address>/api/readyz` a few minutes before a demo.
- **More stable options** (not built; see ADR 0003): a Cloudflare *named* tunnel on a domain you own (fixed address, reconnects by itself, laptop still has to be on); a small VPS running this same Compose stack with a real domain (Caddy gets the certificate itself; works anywhere, the original plan); Render or Railway (more rework). Vercel can't hold the WebSocket and would remove the Caddy and networking work.
- **The address changes every time the tunnel restarts.** When login exists, the Google OAuth redirect URI (`https://<address>/api/auth/callback`) must be updated in the Google console (Yayikast) each time. Quick tunnels have no uptime guarantee, so start it early before a demo.
- Test it: on your phone, with Wi-Fi off (mobile data), open the address. You should see the app with a padlock. On `/checkin`, tap **Share my location**; the browser asks for permission.
- Door 2 (`caddy:8080`) is plain HTTP and only exists inside Docker. Don't publish it in `docker-compose.yml`.

## Check it yourself

```bash
curl -kI https://localhost/api/healthz        # 200, all headers above, an x-request-id
curl -I  http://localhost/api/healthz         # 308 redirect to https://
curl     http://localhost:3000/healthz        # fails: the API isn't published (unless npm run dev is running)
docker compose stop db
curl -k  https://localhost/api/readyz         # 503 {"status":"unavailable"}
docker compose start db
```
