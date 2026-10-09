# Mahub

A secure attendance system for university classes. The instructor projects a QR code that rotates every 10 seconds, students check in with their university Google account and their phone's location, and the instructor watches a live roster.

New to backend work? Start with [docs/BASICS.md](docs/BASICS.md). See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the full plan and [docs/decisions/](docs/decisions/) for the decisions behind it.

## Run it locally

Requirements: Docker Desktop, Node 22, [dbmate](https://github.com/amacneil/dbmate) (`brew install dbmate`).

```bash
cp .env.example .env     # then edit the password
docker compose up -d     # start Postgres + PostGIS
docker compose ps        # wait until db shows "healthy"
dbmate create            # create the "mahub" database
```

Connect to the database:

```bash
docker compose exec db psql -U postgres -d mahub
```

## Run the API

The API lives in `api/` (Node 22 + TypeScript + Fastify). There are two ways to run it.

**While coding** (restarts automatically when you save a file):

```bash
cd api
npm install              # first time only
npm run dev              # reads settings from ../.env
```

**In Docker, behind Caddy**, the way it runs for the demo:

```bash
docker compose up -d --build
docker compose ps        # api shows "healthy" once it can reach the DB
docker compose logs api  # JSON logs, one line per event
```

Caddy is the only way in: `https://localhost/api/...`. The API itself isn't published. The first time, trust Caddy's local certificate on your Mac (see [docs/NETWORK.md](docs/NETWORK.md#trust-caddys-certificate-on-your-mac-once)); until then, add `-k` to curl.

Check it:

```bash
curl https://localhost/api/healthz   # {"status":"ok"}: the process is up
curl https://localhost/api/readyz    # {"status":"ok"}: the database answers
docker compose stop db
curl https://localhost/api/readyz    # 503 {"status":"unavailable"}
docker compose start db
```

Other commands (run inside `api/`): `npm test` (vitest), `npm run lint` (TypeScript type-check), `npm run build` (compile to `dist/`).

## Run the web app

The React app lives in `web/`. In Docker, Caddy serves it at **https://localhost/**:

```bash
docker compose up -d --build caddy   # rebuild after changing web/
```

**While coding** (instant reload on save):

```bash
cd web
npm install              # first time only
npm run dev              # open http://127.0.0.1:5173 (not localhost, see web/vite.config.ts)
```

API calls from the dev server (`/api/...`) are forwarded to the Docker stack, so keep `docker compose up` running. Other commands in `web/`: `npm run build`, `npm run lint`. Screens are listed in [docs/SCREENS.md](docs/SCREENS.md).

