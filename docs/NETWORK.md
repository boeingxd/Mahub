# Network

How a request travels through Mahub, which ports are open, and who trusts whom. Updated by every networking task (B2, B4, B5, B7).

## The hops

```
 Your browser (on the laptop)
      │  HTTPS  https://localhost        (port 443; port 80 only redirects to 443)
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ caddy            published on 127.0.0.1:80 and :443         │
 │  · TLS with its own local certificate authority             │
 │  · adds security headers to every response                  │
 │  · sets a fresh X-Request-Id and the real X-Forwarded-For   │
 │  · /api/*  → api:3000  (prefix /api removed)                │
 │  · /c/*, /ws → api:3000 (path unchanged)                    │
 │  · /       → placeholder (web app in task B3)               │
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
| caddy | 80, 443 | 127.0.0.1:80, 127.0.0.1:443 | No (127.0.0.1 only). Phones come in through the tunnel (task B4) |
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

- **The real client IP.** Caddy overwrites `X-Forwarded-For` with the address it actually received the connection from, so a visitor can't fake it. The API believes that header only when the request comes from `172.28.1.0/24` (`TRUST_PROXY`), the `frontend` network where Caddy lives. Tests in `api/test/health.test.ts` check both cases.
- **Request IDs.** Caddy replaces any `X-Request-Id` the client sends with a fresh UUID. The API logs it on every line and returns it in the response, so one ID traces a request through both services.
- **No IPs stored** (ADR 0006). The API doesn't log IPs, and Caddy's access log is off.

## Trust Caddy's certificate on your Mac (once)

Caddy creates its own certificate authority (CA) the first time it starts and keeps it in the `caddy-data` volume. Until your Mac trusts that CA, browsers show a warning and you need `curl -k`.

```bash
docker compose up -d
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ./caddy-root.crt
rm caddy-root.crt
```

Restart the browser, then open https://localhost/api/healthz: padlock, no warning. Only redo this if you delete the volume (`docker compose down -v`).

## Check it yourself

```bash
curl -kI https://localhost/api/healthz        # 200, all headers above, an x-request-id
curl -I  http://localhost/api/healthz         # 308 redirect to https://
curl     http://localhost:3000/healthz        # fails: the API isn't published (unless npm run dev is running)
docker compose stop db
curl -k  https://localhost/api/readyz         # 503 {"status":"unavailable"}
docker compose start db
```
