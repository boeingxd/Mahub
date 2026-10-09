# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

The repo has no code yet, only docs. **Read `PROJECT_PLAN.md` before writing anything.** It is the spec, and §9 is the step-by-step learning path the team follows. Decisions are in `docs/decisions/` (ADRs). If code and the plan disagree, ask before changing either. Update this file once real build/test commands exist.

Mahub is a secure university attendance system. The instructor opens a short check-in window and projects a QR that rotates every 10 seconds. Students scan it and sign in with Google, the server verifies the evidence and records attendance in one transaction, and a live roster updates over WebSocket. The priorities, in order, are anti-cheating, database design, database security and networking. UI comes last and should stay plain.

## How to work with this team

The team are **beginners** in databases and backend development. They want to focus on building and design, and to learn as they go:
- Work in the small steps from plan §9. Each step ends with something they can run and see working.
- Before building, briefly explain the concept in plain language (what it is, why it matters here). Afterwards, give the commands to run and how to check the result.
- Comment code where it teaches something non-obvious. Prefer simple, readable code over clever abstractions.
- Don't pull in stretch goals (partitioning, materialized views, pgaudit, PITR, dashboards) unless asked.

## Stack (decided, not set up yet)

- PostgreSQL 16 + PostGIS in Docker. Migrations are `dbmate` plain SQL in `db/migrations/` (`-- migrate:up` / `-- migrate:down`). DB tests use pgTAP in `db/tests/`.
- API: Node 22 + TypeScript + Fastify, with zod, `pg` and vitest, in `api/`. Login is our own Google OIDC via `openid-client`, with sessions stored in Postgres (`auth_sessions`).
- Web: React + Vite + plain CSS in `web/`.
- Edge: Caddy (`infra/caddy/Caddyfile`). Everything runs locally with Docker Compose. Cloudflare Tunnel is used for phone testing, and the same Compose stack deploys to a VPS in M4.

## Non-negotiable invariants

Each one comes from a bug in the predecessor system (plan §2) and needs a pgTAP or API test that fails if the bug comes back. Write that test **before** the fix.

- **Migrations are the only source of truth.** No schema changes outside `db/migrations/`.
- **There is no `role` column on `users`.** Roles live in `user_roles`, only admins can write them, and changes are audited.
- **Every write path checks both role and ownership**, enforced by RLS on every `api` table. The API sets `SET LOCAL app.user_id` per transaction, and policies read it via `private.current_user_id()`.
- **The client never writes attendance.** Check-in completion is one transaction: `DELETE FROM checkin_claims … RETURNING`, then the enrollment, open-session and geofence (`ST_DWithin`) checks, then `INSERT … ON CONFLICT DO NOTHING` into `attendance`, then a log row in `checkin_attempts`.
- **QR tokens are stateless HMAC** (`HMAC-SHA256(token_secret, class_session_id || floor(t/10))`, accepting windows now±1), so a QR rotation causes no DB write. `token_secret` lives in `private` and is reached only through a SECURITY DEFINER function.
- **Validate every request body with zod**, and add DB CHECK constraints for ranges (the predecessor's `lat: "x"` NaN bypass).
- **Never store raw GPS or IP addresses** (ADR 0006). Store only `distance_m`, `gps_accuracy_m` and `on_campus`.
- **SECURITY DEFINER functions** use `SET search_path = pg_catalog, private` and are owned by a non-login role.
- **Soft signals** (GPS accuracy, off campus network) only add `risk_flags`. They never reject a student.
- **No CORS `*` and no raw errors to clients.** Rate-limit at the edge (generous per IP, because of campus NAT) and in the app (per user on `/checkin/*`).

## Domain rules that are easy to get wrong

- `class_sessions` (attendance windows) and `auth_sessions` (logins) are different things. Never name a table plain `sessions`.
- There is no `late` status and no auto-close. Attendance status is `present` or `excused`. **Absent means enrolled with no attendance row**, derived in a view. The instructor opens and closes windows by hand.
- No device binding or passkeys (ADR 0004). Identity is the Google account.
- **Login policy (ADR 0007):** a `^[0-9]{10}@g.siit.tu.ac.th` email signs in as a student (`students.student_no` = the prefix). Any other email must already be registered by an admin. Instructor and admin roles are never derived from an email, and there is no domain CHECK on `users.email`. After first login, match users by Google `sub`.
- Reports come from SQL views, never from client-side aggregation.

## Database conventions

- Schemas: `api` (app tables), `private` (secrets and helpers), `audit` (append-only `audit.events`, written by triggers; nobody has UPDATE or DELETE on it).
- Roles: `migrator` (DDL only), `app_rw` (subject to RLS), `app_ro`, `auditor`. There is no superuser at runtime.
- Use `uuid` PKs (or natural composite PKs), `timestamptz`, `NOT NULL` by default, and enums for statuses. Every FK has an explicit `ON DELETE` (prefer `RESTRICT` plus `archived_at`). Index join FKs, and add partial indexes on hot paths.

## Team (plan §8)

- **boeingxd:** network and platform (Docker, Caddy, CI, WebSocket hub, deploy, load tests) **and all UI screens**.
- **postscrippt:** schema, migrations, seeds, admin and professor features, reports.
- **Yayikast:** Google login, roles/RLS, audit, QR tokens, the check-in transaction, threat model, pgTAP.

## Working agreement

- Branches are named `<initial>/<short-topic>`. Never commit directly to `main`. PRs are small, and the description covers what changed, why, and how it was tested. Schema or permission changes need Yayikast's (Security) review.
- Agree on the cross-area contracts in plan §8 (`docs/PERMISSIONS.md`, `docs/API.md`, the NOTIFY payload format, pool settings) before building on top of them.
