# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repo has no code yet: only `PROJECT_PLAN.md` (the spec) and a stub `README.md`. **Read `PROJECT_PLAN.md` before writing anything.** It is the source of truth for the architecture, schema, check-in protocol and team ownership. If code and the plan disagree, ask before changing either. Update this file once real build/test commands exist.

Mahub is a secure university attendance system: the instructor projects a rotating QR, students scan it and sign in with university Google accounts, the server verifies the evidence and records attendance atomically, and a live roster updates over WebSocket. The priorities, in order, are anti-cheating, database design, database security and networking. UI comes last and should stay plain.

## Planned stack and commands (not set up yet)

- PostgreSQL 16 + PostGIS. Migrations are plain SQL via `dbmate` (or `sqitch`, decision pending) in `db/migrations/`. DB tests use pgTAP in `db/tests/`.
- API: Node 22 + TypeScript + Fastify, with zod validation, `pg`, `@simplewebauthn/server`, and vitest for tests. Lives in `api/`.
- Web: React + Vite + plain CSS in `web/`, with shared components in `web/src/ui/`.
- Edge: Caddy (`infra/caddy/Caddyfile`). Load tests: k6 in `load/`. CI: GitHub Actions.
- Local stack: `docker compose up` (db, api, web, caddy with local TLS). Migrations run with `dbmate up`.

Open decisions (plan §11) are recorded as ADRs in `docs/decisions/`. Check them before assuming a default.

## Non-negotiable invariants

Each one comes from a bug in the predecessor system (plan §2). Every one must be covered by a pgTAP or API regression test that fails if the bug comes back. Write that test **before** the fix.

- **Migrations are the only source of truth.** No schema changes outside `db/migrations/`.
- **There is no `role` column on `users`.** Roles live in `user_roles`, only admins can write them, and changes are audited. Use column-level grants.
- **Every write path checks both role and ownership**, enforced by RLS on every `api` table. The API sets `SET LOCAL app.user_id` per transaction, and policies read it via `private.current_user_id()`.
- **The client never writes attendance.** Check-in completion is one transaction: `DELETE FROM checkin_claims … RETURNING` (atomic claim consumption), then the enrollment, session and geofence checks, then `INSERT … ON CONFLICT DO NOTHING` into `attendance`, then a log row in `checkin_attempts`. `UNIQUE(session_id, student_id)` is enforced in the DB.
- **QR tokens are stateless HMAC**, so a QR rotation causes no DB write: `HMAC-SHA256(token_secret, session_id || floor(t/10))`, and windows now±1 are accepted. `token_secret` lives in the `private` schema and is reachable only through a SECURITY DEFINER function.
- **Validate every request body with a schema**, and add DB CHECK constraints for ranges. The predecessor's geofence was bypassed with `lat: "x"` (NaN).
- **SECURITY DEFINER functions** use `SET search_path = pg_catalog, private` and are owned by a non-login role.
- **Soft signals** (GPS accuracy, campus CIDR, a shared passkey) feed `risk_score` or flags. They never silently reject a student.
- **No CORS `*` and no raw errors to clients.** Return error codes only. Rate-limit at the edge (NAT-friendly per IP) and in the app (per user on `/checkin/*`).
- **Reports come from views or materialized views**, never from client-side aggregation.

## Database conventions

- Schemas: `api` (app tables), `private` (secrets and helpers), `audit` (append-only `audit.events`, written by triggers; nobody has UPDATE or DELETE on it).
- Runtime roles: `app_rw` (subject to RLS), `app_ro`, `auditor`. `migrator` is used for DDL only. There is no superuser at runtime.
- Use `uuid` PKs (or natural composite PKs), `timestamptz`, `NOT NULL` by default, and enums for statuses. Every FK has an explicit `ON DELETE` (prefer `RESTRICT` plus `archived_at` soft-delete). Index every join FK and add partial indexes on hot paths.
- `sessions` copies the room's geofence when it starts. A partial unique index allows one open session per section. `attendance` is partitioned by term.
- PDPA retention: precise lat/lng and IPs are kept 30 days, then reduced (to `distance_m` only, and IPs to /24) by a `pg_cron` job.

## Cross-area contracts

Agree on these docs before building on top of them: `docs/PERMISSIONS.md` (role × table × operation), `docs/API.md` / OpenAPI (the check-in contract and rate-limit numbers), the NOTIFY payload format for the roster hub, and the DB pool settings. Schema or permission changes need the Security Engineer's (Role B's) review. CODEOWNERS will reflect the A/B/C ownership in plan §8.

## Working agreement

- Branches are named `<initial>/<short-topic>` (e.g. `a/terms-schema`). Never commit directly to `main`.
- Keep PRs small and single-purpose. The description covers what changed, why, and how it was tested.
- Done means: CI is green, migrations are reversible or forward-fixed, the docs (API/ERD/permissions) are updated, and no secrets are in the diff (`.env` is gitignored and `.env.example` is committed).
