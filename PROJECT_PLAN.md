# Mahub: Secure Attendance System (Project Plan)

> Read this file before writing code. It is the spec for the whole project.
> Mahub replaces the *SIIT Smart Attendance* MVP (React + Supabase). We keep what worked and rebuild with **database design**, **database security** and **networking** as the main strengths.
> The team is new to databases and backend work, so the plan is a **step-by-step learning path** (see §9). Each step ends with something you can see working.
> Decisions are recorded in `docs/decisions/` (ADRs 0001–0006).

---

## 1. What we are building

A web app for taking attendance in university classes:

1. During class, the instructor **opens a check-in window** and projects a **QR code that changes every 10 seconds**.
2. Students scan it with their phones and sign in with their **university Google account**.
3. The server checks the evidence (a valid QR, the right student, enrolled in the section, physically in the room) and records attendance **in one database transaction**.
4. The instructor watches a **live roster** fill in, closes the window, and later exports reports.

### Goals (in priority order)
1. **Hard to cheat.** Checking in for an absent friend, or from outside the room, should be hard, and every attempt is logged.
2. **Strong database design.** A normalised schema with constraints, built only from migrations.
3. **Strong database security.** Least privilege, row-level security (RLS), an append-only audit log, no way for a user to promote their own role, and privacy by design (store nothing we don't need).
4. **Strong networking.** We run our own edge server (Caddy) for HTTPS, security headers and rate limits; a real-time WebSocket roster; resilience on bad classroom Wi-Fi; and a measured load capacity.
5. UI/UX: clean and functional, the lowest priority.

### Non-goals
- Native mobile apps (it's a web app)
- Integration with the registrar system (we import CSV instead)
- Device binding or passkeys (ADR 0004)
- A "late" status or automatically closing check-in windows (ADR 0005)

---

## 2. Lessons from the predecessor

### Keep
- **The server makes every decision.** The client never writes attendance.
- **A scan survives the login redirect.** Scanning creates a short-lived claim that lasts through the Google login round-trip.
- **`UNIQUE(class_session_id, student_id)`** in the database stops duplicate check-ins.
- **The live roster is driven by database change events**, not polling.
- **The email domain is checked in two places:** Google's `hd` hint and a server-side check.

### Fix (each bug gets a test that fails if it comes back)
| Predecessor bug | Root cause | Rule for this project |
|---|---|---|
| Students could set their own `users.role` to `admin` | An update policy with no column restriction | Roles live in a separate `user_roles` table that only admins can write |
| The geofence was skipped by sending `lat: "x"` (`NaN > radius` is false) | No input validation | Validate every request body with zod. Add DB CHECK constraints |
| Any student could create a class and run sessions | The insert policy checked ownership but not role | Every write path checks **role and ownership** (RLS + tests) |
| A claim could be used twice by concurrent requests | Check, insert and delete ran outside a transaction | Use claims atomically: `DELETE … RETURNING` in the same transaction as the insert |
| The schema could not be rebuilt from the repo | Tables were created in a dashboard | **Migrations are the only source of truth** |
| CORS `*`, raw errors leaked, no rate limiting | Platform defaults | Origin allowlist, error codes only, rate limits at the edge and in the app |
| The QR wrote to the database every 10s | Tokens were stored rows | **Stateless HMAC tokens** (§5) |
| The "fingerprint" field was always true | Never implemented | Removed. We don't claim device binding we don't have (ADR 0004) |
| Raw GPS was kept forever | No retention policy | **Raw GPS and IPs are never stored** (ADR 0006) |

---

## 3. Architecture

```
┌────────────┐   ┌────────────┐
│ Student    │   │ Projector  │   (browser)
│ phone      │   │ screen     │
└─────┬──────┘   └─────┬──────┘
      │ HTTPS + WSS    │
┌─────▼────────────────▼──────────────────────────┐
│ Edge: Caddy                                      │
│  TLS · HSTS · CSP · CORS allowlist · rate limit  │
└─────────────────────┬───────────────────────────┘
┌─────────────────────▼───────────────────────────┐
│ API: Node 22 + TypeScript + Fastify              │
│  /auth     Google sign-in, login sessions        │
│  /checkin  claim + verify + record (one tx)      │
│  /admin    sections, rooms, enrollments, reports │
│  /ws       live roster hub (WebSocket)           │
└──────────┬───────────────────────▲──────────────┘
           │ SQL (connection pool) │ LISTEN/NOTIFY
┌──────────▼───────────────────────┴──────────────┐
│ PostgreSQL 16 + PostGIS                          │
│  schemas: api · private · audit                  │
│  RLS on every api table · audit triggers         │
└──────────────────────────────────────────────────┘
Everything runs locally with Docker Compose; the same setup is deployed to a VPS in M4 (ADR 0003).
```

### Stack
| Area | Choice | ADR |
|---|---|---|
| Database | PostgreSQL 16 + PostGIS (Docker image `imresamu/postgis:16-3.5`, which has Apple Silicon builds) | — |
| Migrations | `dbmate` (plain SQL files with `up` and `down` sections) | 0001 |
| DB tests | pgTAP (SQL tests for constraints and RLS) | — |
| API | Node 22 + TypeScript + Fastify, zod for validation, `pg` for SQL, vitest for tests | 0001 |
| Login | Our own Google sign-in via `openid-client`; login sessions stored in Postgres; HttpOnly cookie | 0002 |
| Real-time | WebSocket hub fed by Postgres `LISTEN/NOTIFY` | — |
| Edge | Caddy | 0003 |
| Frontend | React + Vite, plain CSS | — |
| Hosting | Docker Compose locally, a VPS for staging/demo, Cloudflare Tunnel for phone testing during development | 0003 |
| Load testing | k6 | — |
| CI | GitHub Actions | — |

---

## 4. Database design

### 4.1 Entities
```
terms ─┬─< courses ─< sections ─┬─< enrollments >── users
                                └─< class_sessions ─┬─< attendance >── users
                                                    ├─< checkin_attempts
                                                    └─< checkin_claims
rooms ─< class_sessions (geofence copied when the session opens)
users ─< user_roles
users ─< auth_sessions
attendance ─< excuse_requests
audit.events (append-only, written by triggers)
```
> Naming: **`class_sessions`** are attendance windows in a class. **`auth_sessions`** are login sessions. They have separate names so they're never confused.

### 4.2 Tables
| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email (citext, unique, domain CHECK), full_name, created_at | No `role` column |
| `user_roles` | user_id, role (`enum app_role`: student, instructor, admin), granted_by, granted_at | PK(user_id, role). Only admins can write. Audited |
| `auth_sessions` | id, user_id, token_hash, created_at, expires_at | Login sessions. The cookie holds the token; the DB stores only its hash |
| `terms` | id, code (`2026-1`), starts_on, ends_on | CHECK starts_on < ends_on |
| `courses` | id, code (`ITS332`), name | unique(code) |
| `sections` | id, course_id, term_id, section_no, instructor_id, required_rate (default 80) | unique(course_id, term_id, section_no) |
| `rooms` | id, name, building, location `geography(Point)`, radius_m, campus_cidrs `cidr[]` | CHECK radius_m between 10 and 500 |
| `enrollments` | section_id, student_id, enrolled_at | PK(section_id, student_id) |
| `class_sessions` | id, section_id, room_id, location, radius_m, opened_by, opened_at, closed_at | Geofence copied from the room on open. Partial unique index: one open session per section |
| `private.class_session_secrets` | class_session_id, token_secret (bytea) | The app reaches it only through a SECURITY DEFINER function |
| `attendance` | class_session_id, student_id, status (`present`/`excused`), method (`qr`/`manual`), recorded_at, recorded_by, distance_m, gps_accuracy_m, on_campus, risk_flags | PK(class_session_id, student_id). **Absent = enrolled with no row**, derived in a view |
| `checkin_attempts` | id, class_session_id, user_id, at, outcome (enum), distance_m, gps_accuracy_m, on_campus | Every attempt, including failures. Used for fraud review |
| `checkin_claims` | id, class_session_id, user_id (null until login), expires_at | Single-use, 90s TTL |
| `excuse_requests` | id, class_session_id, student_id, reason, status, decided_by, decided_at | pending → approved/rejected. Approval inserts an `excused` attendance row |
| `audit.events` | id, at, actor, table_name, op, row_pk, before, after | Written by triggers. Nobody has UPDATE or DELETE |

### 4.3 Design rules
- `uuid` PKs (or natural composite PKs), `timestamptz` timestamps, `NOT NULL` unless null has a clear meaning.
- Enums for statuses (`attendance_status`, `attempt_outcome`, `app_role`, `excuse_status`).
- **CHECK constraints** for anything with a valid range (radius, rates, time ordering, accuracy ≥ 0).
- Every FK has an explicit `ON DELETE`. Prefer `RESTRICT`, plus soft-delete (`archived_at`) for academic records.
- Index every FK used in joins, plus partial indexes for hot paths (`class_sessions WHERE closed_at IS NULL`).
- Reports come from **views** (`v_session_roster`, `v_section_attendance_rate`), never from client-side aggregation.

---

## 5. Check-in protocol

### 5.1 Rotating QR (stateless)
```
window = floor(unix_time / 10)
token  = base64url( HMAC-SHA256(token_secret, class_session_id || window) )[0..16]
QR URL = https://<host>/c/<class_session_id>.<window>.<token>
```
- The server accepts `window ∈ {now-1, now, now+1}` (±10s of clock skew).
- **No database write per rotation.** The projector gets the current token from the API or over the WebSocket.

### 5.2 Flow
1. The student opens the QR URL. The server verifies the HMAC window and that the session is open, then creates a **claim** (90s TTL) and remembers it in an HttpOnly cookie. This lets the scan survive the Google login if the student isn't signed in yet.
2. If needed, the student signs in with Google. The claim is then bound to their `user_id`.
3. The browser asks for GPS (`lat, lng, accuracy`) and calls `POST /checkin/complete {claim_id, lat, lng, accuracy}`. This runs as **one transaction**:
   ```sql
   DELETE FROM checkin_claims WHERE id = $1 AND user_id = $2 AND expires_at > now() RETURNING class_session_id;
   -- check: enrolled, session still open, ST_DWithin(session.location, point, radius_m + accuracy budget)
   INSERT INTO attendance (...) ON CONFLICT DO NOTHING;   -- stores distance_m, never lat/lng
   INSERT INTO checkin_attempts (...);
   ```
4. A trigger fires `NOTIFY roster`, and the WebSocket hub pushes the update to the instructor's screen.

### 5.3 Evidence
| Signal | Type |
|---|---|
| Valid HMAC window | Hard gate |
| Signed in with the university domain (verified `hd` claim + server check) | Hard gate |
| Enrolled in the section, session open | Hard gate |
| Distance ≤ radius (allowing for GPS accuracy) | Hard gate |
| GPS accuracy suspiciously perfect | Soft → `risk_flags` |
| Request not from `rooms.campus_cidrs` (campus Wi-Fi) | Soft → `risk_flags` |

Flagged check-ins show up in the roster for the instructor. Flags never silently reject a student. When a hard gate fails (bad GPS, phone can't get a location), the instructor can use **manual check-in**.

### 5.4 Threat model (Role B keeps `docs/THREAT_MODEL.md`)
Covers at least: proxy attendance, a forwarded QR photo, GPS spoofing, replay, role escalation, IDOR on the admin APIs, token brute force, DoS of the check-in burst, leaked backups, and insider (admin) abuse.

---

## 6. Database security

- **Schemas:** `api` (app tables), `private` (secrets and helper functions), `audit` (append-only).
- **Roles (no superuser at runtime):**
  | Role | Can |
  |---|---|
  | `migrator` | Run DDL. Used only by dbmate/CI |
  | `app_rw` | DML on `api`, EXECUTE on approved functions. Subject to RLS |
  | `app_ro` | SELECT for reports |
  | `auditor` | SELECT on `audit` only |
- **RLS on every `api` table.** For each request, the API runs `SET LOCAL app.user_id = …` inside the transaction, and policies read it through `private.current_user_id()`.
- **SECURITY DEFINER functions** use `SET search_path = pg_catalog, private` and are owned by a non-login role.
- **Audit:** triggers write `audit.events` for attendance, enrollments and user_roles.
- **Secrets** live in `.env` (gitignored). `.env.example` is committed.
- **Privacy by design (ADR 0006):** no raw GPS and no IP addresses in the database. Only `distance_m`, `gps_accuracy_m` and `on_campus`. Caddy access logs (which contain IPs) are kept 7 days.
- **Backups:** a nightly `pg_dump`, plus a restore that is tested once per milestone.

**pgTAP tests are required.** Each predecessor bug in §2 gets a test that fails if the bug comes back.

---

## 7. Networking

- **Edge (Caddy):** TLS 1.2+, HSTS, `Content-Security-Policy` (no inline scripts), `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` (geolocation only on the check-in page). CORS allows only our own origin.
- **Rate limits:** at the edge, per IP and generous (a whole class shares one campus Wi-Fi IP). In the app, per user on `/checkin/*` (e.g. 5 per minute). Counters live in memory and are never stored.
- **Real-time:** the WebSocket authenticates on connect and subscribes only to sessions the user may see. Heartbeat every 20s. The client reconnects with backoff and re-fetches the full roster after reconnecting.
- **Projector resilience:** the QR keeps showing the last valid window, with a "connection degraded" badge instead of an error screen.
- **Time:** the server is authoritative. The API returns `server_time` so clients can correct clock drift.
- **Real client IP:** Caddy forwards `X-Forwarded-For`, and the API trusts it only from Caddy (needed for the campus Wi-Fi check).
- **Capacity target:** 300 students checking in within 30s → p95 < 500ms, 0 errors (k6 script in `load/`).
- **Observability:** a request ID from edge → API → DB, `/healthz` and `/readyz`, structured JSON logs.

---

## 8. Team split (3 people)

Everyone builds the plain screens for their own feature, using shared components in `web/src/ui/`.

| | **A: Data Architect** | **B: Security Engineer** | **C: Network & Platform Engineer** |
|---|---|---|---|
| Owns | `db/migrations`, `db/seeds`, views, reports, CSV import/export | Roles/grants/RLS, `audit`, Google sign-in, the check-in transaction, threat model | Docker, Caddy, CI, WebSocket hub, rate limits, logs, load test, deployment |
| Reviews | B's SQL policies | A's schema (security lens) and C's edge config | Everyone's performance (EXPLAIN plans, load) |

**Agree on these before building on top of them:**
- A ↔ B: the table/column list and a role × table × operation matrix (`docs/PERMISSIONS.md`).
- B ↔ C: the check-in API contract (`docs/API.md`) and the rate-limit numbers.
- A ↔ C: the NOTIFY payload format and the DB connection pool settings.

---

## 9. Learning path and milestones

Every step has the same shape: **learn** the idea (short explanation) → **build** it → **check** it works. Steps are small on purpose. Owners are in brackets.

### M0: Foundations (weeks 1–2)
| Step | Build | You learn |
|---|---|---|
| 0.1 | Install the tools: Git, Node 22, Docker Desktop, dbmate, VS Code. Clone the repo | Tooling, Git branches and PRs |
| 0.2 | Repo skeleton: folders, `.gitignore`, `.env.example`, CODEOWNERS, PR template | Project structure, secrets hygiene |
| 0.3 | `docker-compose.yml` with only Postgres + PostGIS; connect with a DB client [C] | Containers, ports, environment variables |
| 0.4 | First migration: extensions, schemas, enums, DB roles [A+B] | What a migration is, `up`/`down` |
| 0.5 | Academic tables + seed data + ERD (`docs/ERD.md`) [A] | Keys, foreign keys, constraints, normalisation |
| 0.6 | Fastify "hello" + `/healthz` that queries the DB [C] | HTTP servers, connection pools |
| 0.7 | Caddy in front with local HTTPS and security headers [C] | Reverse proxies, TLS, headers |
| 0.8 | CI: GitHub Actions runs migrations, pgTAP and API tests [C] | Automated checks |
| 0.9 | `THREAT_MODEL.md` v1 + `PERMISSIONS.md` [B] | Thinking like an attacker, least privilege |

### M1: Walking skeleton (weeks 3–4)
| Step | Build | You learn |
|---|---|---|
| 1.1 | Google sign-in, `users` + `auth_sessions`, domain check [B] | OAuth/OIDC, cookies, sessions |
| 1.2 | `user_roles` + first RLS policies + pgTAP test for the "student makes self admin" bug [B] | RLS, testing security |
| 1.3 | Instructor opens/closes a class session; projector shows the rotating HMAC QR [B+A] | HMAC, stateless tokens |
| 1.4 | Student check-in: claim → login → GPS → one transaction [B] | Transactions, race conditions, PostGIS distance |
| 1.5 | Live roster: NOTIFY → WebSocket hub → browser [C] | LISTEN/NOTIFY, WebSockets |
| 1.6 | Cloudflare Tunnel so you can test on real phones [C] | Why phones need real HTTPS |

**M1 done when:** an instructor opens a session → the projector shows the QR → a student signs in on a phone → the check-in is recorded → the roster updates live.

### M2: Hardening (weeks 5–6)
- zod validation on every route, error codes only, CORS allowlist [B+C]
- Rate limits in Caddy and the app [C]
- Audit triggers → `audit.events` [B]
- Risk flags (GPS accuracy, campus network) shown in the roster [B]
- pgTAP tests covering every §2 bug [B]
- WebSocket reconnect + re-sync; projector "degraded" badge [C]

### M3: Academic features (weeks 7–8)
- CSV import for sections and enrollments [A]
- Manual check-in by the instructor [A+B]
- Excuse workflow (request → approve/reject) [A]
- Report views (roster with absents, attendance rate per section) + CSV export [A]

### M4: Deploy and polish (weeks 9–10)
- Deploy the Compose stack to a VPS with a real domain [C]
- Nightly `pg_dump` + a tested restore [A+C]
- k6 load test against the capacity target [C]
- Demo script [all]

### Stretch goals (only if the core is done)
Table partitioning for `attendance`, materialized views, pgaudit, point-in-time recovery, Prometheus/Grafana dashboards, a weekly class schedule (`section_meetings`).

---

## 10. Repository layout
```
.
├── PROJECT_PLAN.md
├── README.md
├── CLAUDE.md
├── docker-compose.yml
├── .env.example
├── .github/  (CODEOWNERS, pull_request_template.md, workflows/ci.yml)
├── db/
│   ├── migrations/   ← dbmate SQL files (A)
│   ├── seeds/        ← fake terms/courses/students (A)
│   └── tests/        ← pgTAP (B)
├── api/              ← Fastify + TS (src/auth, checkin, admin, reports, realtime)
├── web/              ← React + Vite
├── infra/caddy/Caddyfile
├── load/             ← k6 scripts
└── docs/
    ├── decisions/    ← ADRs
    ├── THREAT_MODEL.md, PERMISSIONS.md, API.md, NETWORK.md, ERD.md
```

---

## 11. Working agreement
- **Branches:** `<initial>/<short-topic>` (e.g. `a/terms-schema`). Never commit directly to `main`.
- **PRs:** small and single-purpose. The description says *what, why, how tested*. Schema or permission changes need **B's** review.
- **Definition of done:** tests pass in CI, migrations are reversible, docs are updated, and there are no secrets in the diff.
- **Security bugs:** write a regression test **before** the fix.
- **Weekly:** a 30-minute sync covering the demo of what merged, blockers, and the next step.
