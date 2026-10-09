# Mahub

A secure attendance system for university classes. The instructor projects a QR code that rotates every 10 seconds, students check in with their university Google account and their phone's location, and the instructor watches a live roster.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the full plan and [docs/decisions/](docs/decisions/) for the decisions behind it.

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
