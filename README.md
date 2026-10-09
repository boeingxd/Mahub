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

**In Docker**, the way it will run on the server:

```bash
docker compose up -d --build api
docker compose ps        # api shows "healthy" once it can reach the DB
docker compose logs api  # JSON logs, one line per event
```

Don't run both at once: they share `API_PORT` (default 3000).

Check it:

```bash
curl localhost:3000/healthz   # {"status":"ok"}: the process is up
curl localhost:3000/readyz    # {"status":"ok"}: the database answers
docker compose stop db
curl localhost:3000/readyz    # 503 {"status":"unavailable"}
docker compose start db
```

Other commands (run inside `api/`): `npm test` (vitest), `npm run lint` (TypeScript type-check), `npm run build` (compile to `dist/`).

