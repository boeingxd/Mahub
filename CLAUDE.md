# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**Read `PROJECT_PLAN.md` before writing anything.** It is the spec, and §8 is the 3-week schedule (2 weeks to the demo on Fri 23 Oct, then 1 buffer week; ADR 0008). `docs/BASICS.md` explains every concept in plain English, so point teammates there. Decisions are in `docs/decisions/` (ADRs). If code and the plan disagree, ask before changing either. Keep the commands below up to date as more pieces land.

So far: Postgres, the API skeleton (`/healthz`, `/readyz`), Caddy, and the web app skeleton (React pages with fake data) in Docker Compose. Caddy is the only way in: `https://localhost/` (web) and `https://localhost/api/...` (API). `docs/NETWORK.md` has the hops, ports and trust rules; `docs/SCREENS.md` lists the screens. No migrations yet.

## Commands

- Database: `docker compose up -d db`, `dbmate create`, `dbmate up`. Connect with `docker compose exec db psql -U postgres -d mahub`.
- API (run in `api/`): `npm run dev` (reads `../.env`), `npm test` (vitest), `npm run lint` (`tsc --noEmit`), `npm run build`.
- Full stack in Docker: `docker compose up -d --build`, then `curl -k https://localhost/api/readyz`. The API isn't published; `infra/caddy/Caddyfile` strips `/api` before forwarding.
- Web (run in `web/`): `npm run dev` (http://127.0.0.1:5173, proxies `/api` to the stack), `npm run build`, `npm run lint` (oxlint). The Caddy image (`infra/caddy/Dockerfile`) builds `web/` into `/srv`, so rebuild it after web changes: `docker compose up -d --build caddy`.
- CSP forbids inline scripts and inline `style` attributes: style with classes in `web/src/ui/ui.css` and tokens in `web/src/ui/tokens.css`.
- `api/src/app.ts` builds the Fastify app without listening, so tests use `app.inject()` with a fake `db`. `api/src/server.ts` is the real entrypoint.

Mahub is graded in two courses, **Database Systems** and **Computer Networks**, so keep the features that show those skills. Mahub is a secure university attendance system. The instructor opens a short check-in window and projects a QR that rotates every 10 seconds. Students scan it and sign in with Google, the server verifies the evidence and records attendance in one transaction, and a live roster updates over WebSocket. The priorities, in order, are anti-cheating, database design, database security and networking. UI comes last and should stay plain.

## How to work with this team

The team are **beginners** in databases and backend development. They want to focus on building and design, and to learn as they go:
- Work in the small steps from plan §8. Each step ends with something they can run and see working.
- Time is short (3 weeks total). Build the simplest version that meets the issue; don't add scope.
- Before building, briefly explain the concept in plain language (what it is, why it matters here). Afterwards, give the commands to run and how to check the result.
- Comment code where it teaches something non-obvious. Prefer simple, readable code over clever abstractions.
- Don't pull in stretch goals (partitioning, materialized views, pgaudit, PITR, dashboards) unless asked.

## Stack

- PostgreSQL 16 + PostGIS in Docker. Migrations are `dbmate` plain SQL in `db/migrations/` (`-- migrate:up` / `-- migrate:down`). Database security tests are written in vitest against a real database (no pgTAP; ADR 0008).
- API: Node 22 + TypeScript + Fastify, with zod, `pg` and vitest, in `api/`. Login is our own Google OIDC via `openid-client`, with an encrypted HttpOnly session cookie (no `auth_sessions` table; ADR 0008).
- Web: React + Vite + plain CSS in `web/`.
- Edge: Caddy (`infra/caddy/Caddyfile`). Everything runs locally with Docker Compose. Cloudflare Tunnel gives phones a public HTTPS address, for testing and for the demo (no VPS; ADR 0008).

## Non-negotiable invariants

Each one comes from a bug in the predecessor system (plan §2) and needs a vitest test (API or database) that fails if the bug comes back. Write that test **before** the fix.

- **Migrations are the only source of truth.** No schema changes outside `db/migrations/`.
- **There is no `role` column on `users`.** Roles live in `user_roles`, only admins can write them, and changes are audited.
- **Every write path checks both role and ownership**, enforced by RLS on every `api` table. The API sets `SET LOCAL app.user_id` per transaction, and policies read it via `private.current_user_id()`.
- **The client never writes attendance.** Check-in completion is one transaction: read the signed 90 s `scan` cookie, then the enrollment, open-session and geofence (`ST_DWithin`) checks, then `INSERT … ON CONFLICT DO NOTHING` into `attendance`, then a log row in `checkin_attempts`.
- **QR tokens are stateless HMAC** (`HMAC-SHA256(QR_SECRET, class_session_id + ":" + floor(t/10))`, accepting windows now±1), so a QR rotation causes no DB write. `QR_SECRET` lives only in `.env`.
- **Validate every request body with zod**, and add DB CHECK constraints for ranges (the predecessor's `lat: "x"` NaN bypass).
- **Never store raw GPS or IP addresses** (ADR 0006). Store only `distance_m`, `gps_accuracy_m` and `on_campus`.
- **SECURITY DEFINER functions** use `SET search_path = pg_catalog, private` and are owned by a non-login role.
- **Soft signals** (GPS accuracy, off campus network) only add `risk_flags`. They never reject a student.
- **No CORS `*` and no raw errors to clients.** Rate-limit at the edge (generous per IP, because of campus NAT) and in the app (per user on `/checkin/*`).

## Domain rules that are easy to get wrong

- `class_sessions` are attendance windows; logins are session cookies. Never name a table plain `sessions`.
- There is no `late` status and no auto-close. Attendance status is `present` or `excused`. **Absent means enrolled with no attendance row**, derived in a view. The instructor opens and closes windows by hand.
- No device binding or passkeys (ADR 0004). Identity is the Google account.
- **Login policy (ADR 0007):** a `^[0-9]{10}@g.siit.tu.ac.th` email signs in as a student (`students.student_no` = the prefix). Any other email must already be registered by an admin. Instructor and admin roles are never derived from an email, and there is no domain CHECK on `users.email`. After first login, match users by Google `sub`.
- Reports come from SQL views, never from client-side aggregation.

## Database conventions

- Schemas: `api` (app tables), `private` (secrets and helpers), `audit` (append-only `audit.events`, written by triggers; nobody has UPDATE or DELETE on it).
- Roles: `migrator` (DDL only), `app_rw` (subject to RLS), `app_ro`, `auditor`. There is no superuser at runtime.
- Use `uuid` PKs (or natural composite PKs), `timestamptz`, `NOT NULL` by default, and enums for statuses. Every FK has an explicit `ON DELETE` (prefer `RESTRICT` plus `archived_at`). Index join FKs, and add partial indexes on hot paths.

## Finding what to work on

Tasks are GitHub issues in `boeingxd/Mahub`, one per task in plan §8, assigned to their owner. When someone asks "what should I do?" or "work on my next task":
1. Find out who they are (`gh api user -q .login`, or the GitHub MCP `get_me` tool).
2. List their open issues. Titles look like `[W1] P2 …` (week, then owner letter: A all, B boeingxd, P postscrippt, Y Yayikast). Suggest the earliest-week issue whose "Depends on" issues are closed.
3. Read the issue and follow its sections (What you'll build / The idea / Steps / Check it works), teaching as you go.
4. Branch as `<username>/<short-topic>`, and open the PR with `Closes #<n>` in the description.

## Team (plan §7)

- **boeingxd:** network and platform (Docker, Caddy, Cloudflare Tunnel, WebSocket hub, rate limits, CI, load test) **and all UI screens**.
- **postscrippt:** migrations, tables, seeds, ERD, open/close check-in, report views, audit trigger, indexes.
- **Yayikast:** Google login, DB roles and RLS, QR tokens, the check-in transaction, threat model, security tests.

## Working agreement

- Branches are named `<github-username>/<short-topic>`. Never commit directly to `main`. PRs are small, and the description covers what changed, why, and how it was tested. Schema or permission changes need Yayikast's (Security) review.
- Agree on the cross-area contracts before building on top of them: `docs/API.md` (task A1) and the NOTIFY payload format.
