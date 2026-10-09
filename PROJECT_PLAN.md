# Mahub: Secure Attendance System (Project Plan)

> This file is the starting point for the repo: read it fully before writing code.
> It is the successor to the *SIIT Smart Attendance* MVP (React + Supabase). We keep the features that worked and rebuild the system with the **database design**, **database security** and **networking** as the main strengths.

---

## 1. What we are building

A web-based attendance system for university classes:

1. The instructor starts a session and projects a **rotating QR code**.
2. Students scan it on their phones and sign in with their **university Google account**.
3. The server checks several pieces of evidence (a valid token, the student's identity and device, location, and network) and records attendance **atomically**.
4. The instructor watches a **live roster** update in real time, then exports reports.

### Goals (in priority order)
1. **Hard to cheat.** Make proxy attendance (checking in for an absent friend) and checking in from outside the room *expensive*, and log every attempt.
2. **Strong database design.** A normalised, constrained, migration-driven schema that models the real academic structure.
3. **Strong database security.** Least privilege, RLS, an append-only audit log, no self-promotion of roles, and PDPA-aware data retention.
4. **Strong networking.** We own the edge (TLS, headers, rate limits), real-time transport, resilience on unreliable classroom Wi-Fi, and proven load capacity.
5. UI/UX: clean and functional, the lowest priority.

### Non-goals (for now)
- Native mobile apps (the system is a web app / PWA only)
- Integration with the university registrar system (we import CSV instead)
- Fancy design or theming

---

## 2. Lessons from the predecessor

### Keep (these patterns worked)
- **Server-side decisions only.** The client never writes attendance.
- **The claim step that survives the login redirect.** Scanning creates a short-lived claim that lasts through the OAuth round-trip.
- **A database-level `UNIQUE(session_id, student_id)`** to stop duplicate check-ins.
- **A live roster driven by database change events**, not polling.
- **The email domain enforced in two places** (the OAuth `hd` hint and a server-side check).
- **Small PRs, CODEOWNERS, and specs before building.**

### Fix (bugs found in the predecessor that must not come back)
| Predecessor bug | Root cause | Rule for this project |
|---|---|---|
| Students could update their own `users.role` to `admin` | An RLS update policy with no column restriction | Roles live in a separate `user_roles` table that only admins can write. Use column-level grants. |
| Geofence skipped by sending `lat: "x"` (`NaN > radius` is false) | No input validation | Validate every request body with a schema (zod or similar). Use DB CHECK constraints on coordinates. |
| Any student could create a class and run sessions | The insert policy checked ownership but not role | Every write path checks **role and ownership**. Covered by RLS tests. |
| A claim could be used twice under concurrent requests | Check, then insert, then delete, outside a transaction | Use claims **atomically**: `DELETE … RETURNING` inside the same transaction as the insert. |
| The schema could not be rebuilt from the repo | Tables were created in a dashboard | **Migrations are the only source of truth** from commit #1. |
| CORS `*`, raw errors leaked, no rate limiting | Platform defaults | Origin allowlist, error codes only, rate limits at the edge and in the app. |
| The QR caused a database write every 10s per session | Tokens were stored rows | **Stateless HMAC tokens** (see §5). |
| The "fingerprint" field was always true | Never implemented | **WebAuthn passkey** device binding. |
| Raw GPS kept forever | No retention policy | Coarsen or delete precise location after N days (PDPA). |

---

## 3. Architecture

```
┌────────────┐   ┌────────────┐
│ Student    │   │ Projector  │  (browser / PWA)
│ phone      │   │ screen     │
└─────┬──────┘   └─────┬──────┘
      │ HTTPS + WSS    │
┌─────▼────────────────▼──────────────────────────┐
│ Edge: Caddy (or Nginx)                          │
│  TLS · HSTS · CSP · CORS allowlist · rate limit │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│ API service (Node 22 + TypeScript + Fastify)    │
│  /auth     Google OIDC login, sessions/JWT       │
│  /checkin  claim + verify + record (one tx)      │
│  /admin    classes, rooms, enrollments, reports  │
│  /ws       live roster hub (WebSocket)           │
└──────────┬───────────────────────▲──────────────┘
           │ SQL (pool)            │ LISTEN/NOTIFY
┌──────────▼───────────────────────┴──────────────┐
│ PostgreSQL 16 + PostGIS                          │
│  schemas: api · private · audit                  │
│  roles:   app_rw · app_ro · migrator · auditor   │
│  RLS on every api table · pgaudit · WAL backups  │
└──────────────────────────────────────────────────┘
Observability: structured JSON logs → Loki/Grafana (or hosted), Prometheus metrics
Everything runs locally via Docker Compose; the same images are used in deployment.
```

### Stack decisions
| Area | Choice | Why | Alternative |
|---|---|---|---|
| DB | PostgreSQL 16 + PostGIS | RLS, partitioning, geography types, LISTEN/NOTIFY | none; this is fixed |
| Migrations | `dbmate` or `sqitch` (plain SQL) | SQL-first, reviewable | Prisma Migrate (hides SQL, so avoid) |
| DB tests | pgTAP | Lets us test RLS and constraints directly | — |
| API | Node 22 + TypeScript + Fastify | The team already knows JS; fast; schema validation built in | Go (more performance, more learning curve) |
| Validation | zod / Fastify JSON schema | Fixes the NaN-style bugs | — |
| Auth | Google OIDC (verify the ID token server-side, check the `hd` claim) | No third-party auth platform hiding behaviour | Keep Supabase Auth only |
| Device binding | WebAuthn (`@simplewebauthn/server`) | Stops one phone checking in for many people | — |
| Real-time | WebSocket hub fed by Postgres `LISTEN/NOTIFY` | We own the transport (a networking deliverable) | SSE |
| Edge | Caddy | Automatic TLS, simple config | Nginx |
| Frontend | React + Vite, plain CSS | Low priority, keep it simple | — |
| Load testing | k6 | Scriptable, gives p95 numbers in CI | Locust |
| CI | GitHub Actions | — | — |

> Open decisions are listed in §11. Settle them in week 1.

---

## 4. Database design

### 4.1 Entity overview
```
terms ─┬─< courses ─< sections ─┬─< section_meetings (weekly schedule)
       │                        ├─< enrollments >── users
       │                        └─< sessions ─┬─< attendance >── users
       │                                      └─< checkin_attempts
rooms ─< section_meetings, sessions (snapshot of geofence at start)
users ─< user_roles
users ─< webauthn_credentials
attendance ─< excuse_requests
audit.events (append-only, written by triggers)
```

### 4.2 Tables (first draft, refined by Role A)
| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email (unique, domain CHECK), full_name, created_at | No `role` column |
| `user_roles` | user_id, role (`enum app_role`), granted_by, granted_at | PK(user_id, role). Only admins can write. Every change is audited |
| `terms` | id, code (`2026-1`), starts_on, ends_on | CHECK starts < ends |
| `courses` | id, code (`ITS332`), name | unique(code) |
| `sections` | id, course_id, term_id, section_no, instructor_id, required_rate (default 80) | unique(course, term, section_no) |
| `section_meetings` | id, section_id, weekday, starts_at, ends_at, room_id | The schedule; drives "late" thresholds |
| `rooms` | id, name, building, location `geography(Point)`, radius_m, campus_cidrs `cidr[]` | CHECK radius 10–500 |
| `enrollments` | section_id, student_id, enrolled_at | PK(section_id, student_id) |
| `sessions` | id, section_id, started_at, ended_at, location, radius_m, token_secret (bytea, private), late_after | Geofence *copied* at start. Partial unique index: one open session per section |
| `attendance` | session_id, student_id, status (`enum`), recorded_at, method (`qr`/`manual`), evidence (jsonb), risk_score | PK(session_id, student_id). **Partitioned by term** |
| `checkin_attempts` | id, session_id, user_id, at, outcome (enum), reason, ip (inet), gps_accuracy_m, distance_m | Every attempt, including failures. Used for fraud review |
| `checkin_claims` | id, session_id, user_id, credential_id, expires_at | Used once, short TTL, purged by a cron job |
| `webauthn_credentials` | id, user_id, public_key, sign_count, created_at, last_used_at | Rule for how many devices a student may have |
| `excuse_requests` | id, session_id, student_id, reason, status, decided_by | Workflow: pending → approved/rejected |
| `audit.events` | id, at, actor, table, op, row_pk, before, after | Trigger-written. Nobody has UPDATE/DELETE |

### 4.3 Design rules
- Every table uses `uuid` PKs (or natural composite PKs where they make sense), `timestamptz` timestamps, and `NOT NULL` unless null has a clear meaning.
- Enums for statuses (`attendance_status`: present, late, excused, absent; `attempt_outcome`; `app_role`).
- **CHECK constraints** for anything with a valid range: lat/lng are enforced by the geography type, plus radius, rates, and time ordering.
- Foreign keys always have an explicit `ON DELETE` behaviour. Prefer `RESTRICT` and soft-delete (`archived_at`) for academic records.
- Index every FK used in joins, and add partial indexes for hot paths (`sessions WHERE ended_at IS NULL`).
- Reports come from **views / materialized views** (`v_section_attendance_rate`, `mv_term_summary`), never from client-side aggregation.

---

## 5. Check-in protocol (security core)

### 5.1 Rotating QR (stateless)
```
window = floor(unix_time / 10)
token  = base64url( HMAC-SHA256(session.token_secret, session_id || window) )[0..16]
QR URL = https://<host>/c/<session_id>.<window>.<token>
```
- The server accepts `window ∈ {now-1, now, now+1}` (±10s of clock skew).
- **No database write per rotation.** The projector calls `GET /sessions/:id/qr` or computes the token from a WebSocket push.
- `token_secret` is generated at session start, lives in the `private` schema, and the app role only reaches it through a SECURITY DEFINER function.

### 5.2 Flow
1. The student opens the QR URL. If not logged in, Google OIDC runs and the URL is preserved through `state`.
2. `POST /checkin/claim {qr}` → the server verifies the HMAC window and that the session is open, then creates a **claim tied to user_id**. TTL is 90s.
3. The client does a **WebAuthn assertion** (passkey) and gets GPS (`lat, lng, accuracy`).
4. `POST /checkin/complete {claim_id, webauthn_assertion, lat, lng, accuracy}` runs as **one transaction**:
   ```sql
   DELETE FROM checkin_claims WHERE id = $1 AND user_id = $2 AND expires_at > now() RETURNING session_id;
   -- verify enrollment, open session, ST_DWithin(location, point, radius_m + accuracy budget)
   INSERT INTO attendance (...) ON CONFLICT DO NOTHING;
   INSERT INTO checkin_attempts (...);
   ```
5. A trigger fires `NOTIFY roster_<session_id>`, and the WebSocket hub pushes the update to the instructor.

### 5.3 Evidence and risk scoring
| Signal | Hard gate or soft signal |
|---|---|
| Valid HMAC window | Hard gate |
| Logged-in user from the university domain (verified `hd` claim) | Hard gate |
| Enrolled in the section, session open | Hard gate |
| WebAuthn passkey valid for this user | Hard gate (fallback: manual check-in by the instructor) |
| Distance ≤ radius (accounting for GPS accuracy) | Hard gate |
| GPS accuracy suspiciously perfect, or impossible movement | Soft → `risk_score` |
| Source IP inside `rooms.campus_cidrs` (campus Wi-Fi) | Soft → `risk_score` |
| Same passkey or device used for several students in one session | Soft → flag for review |

Instructors see flagged check-ins in the roster. Flags never silently reject a student.

### 5.4 Threat model (Role B maintains `docs/THREAT_MODEL.md`)
Covers at least: proxy attendance, a forwarded QR photo, GPS spoofing, replay, role escalation, IDOR on the admin APIs, token brute force, DoS of the check-in burst, leaked backups, and insider (admin) abuse.

---

## 6. Database security

- **Schemas:** `api` (tables the app touches), `private` (secrets, helper functions), `audit` (append-only).
- **Roles (no superuser at runtime):**
  | Role | Can |
  |---|---|
  | `migrator` | Run DDL. Used only by CI/migrations |
  | `app_rw` | DML on `api`, EXECUTE on approved functions. Subject to RLS |
  | `app_ro` | SELECT for reports and analytics |
  | `auditor` | SELECT on `audit` only |
- **RLS on every `api` table.** The API sets `SET LOCAL app.user_id = …` per request/transaction, and policies read it through `private.current_user_id()`.
- **SECURITY DEFINER functions** always use `SET search_path = pg_catalog, private` and are owned by a non-login role.
- **Column-level grants** where needed (for example, students can never select `sessions.token_secret`).
- **pgaudit** logs DDL and role changes. A trigger-based `audit.events` covers data changes on attendance, enrollments and user_roles.
- **Secrets** live in env / Docker secrets, never in git. `.env.example` is committed and `.env` is ignored.
- **Backups:** daily base backup plus WAL archiving (point-in-time recovery). The restore is **tested** once per milestone.
- **PDPA / privacy:**
  - Precise lat/lng is kept 30 days, then reduced to `distance_m` only.
  - IPs are kept 30 days, then truncated to /24.
  - Students can export their own data.
  - Retention runs as a `pg_cron` job.

**RLS/permission tests are required (pgTAP).** Each predecessor bug in §2 becomes a test that must stay red if the bug is reintroduced.

---

## 7. Networking

- **Edge (Caddy):**
  - TLS 1.2+ and HSTS.
  - `Content-Security-Policy` (no inline scripts), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (geolocation only on the check-in route).
  - CORS: allowlist our own origin only.
- **Rate limits:**
  - Edge: per IP, generous enough for many students behind the same campus Wi-Fi address (NAT).
  - App: per user/claim on `/checkin/*`, e.g. 5 attempts per minute per user.
- **Real-time:**
  - The WebSocket hub authenticates on connect and subscribes only to sessions the user may see.
  - Heartbeat every 20s; the client reconnects with backoff and re-syncs (fetches the full roster after a reconnect).
- **Projector resilience:** the QR keeps showing the last valid window. A "connection degraded" badge appears instead of an error screen.
- **Time:** the server is authoritative; the API returns `server_time` so clients correct clock drift. Containers sync via NTP.
- **Campus network detection:** `rooms.campus_cidrs` holds the campus Wi-Fi egress ranges, and the edge forwards the real client IP via `X-Forwarded-For` from **trusted proxies only**.
- **Capacity target:** 300 students checking in within 30s → p95 < 500ms, 0 errors (k6 script in `load/`).
- **Observability:**
  - A request ID is propagated edge → API → DB (`application_name` / log field).
  - `/healthz`, `/readyz`, and Prometheus `/metrics`.

---

## 8. Team split (3 people)

UI is shared: each person builds the plain screens for their own feature using shared basic components in `web/src/ui/`.

| | **A: Data Architect** | **B: Security Engineer** | **C: Network & Platform Engineer** |
|---|---|---|---|
| Owns | `db/migrations`, `db/seeds`, views, reporting, imports/exports | Roles/grants/RLS, `audit` schema, auth (OIDC + WebAuthn), check-in protocol, threat model, privacy jobs | `infra/`, Caddy, Docker, CI/CD, WebSocket hub, rate limiting, observability, load tests |
| Week-1 deliverable | ER diagram + first migrations + seed data | `THREAT_MODEL.md` + role/grant matrix | `docker compose up` runs db + api + web + caddy with TLS locally |
| Core deliverables | Academic model, partitioning, materialized views, CSV/XLSX import & export, report APIs | pgTAP RLS suite, atomic check-in transaction, passkey flow, risk scoring, retention jobs, attack test scripts | Network diagram, WS hub with reconnect, edge security headers, rate limits, k6 report, dashboards, deploy pipeline |
| Reviews | B's SQL policies | A's schema (security lens) and C's edge config | Everyone's performance (EXPLAIN plans, load) |

**Contracts between areas (agree on them before building on top):**
- A ↔ B: table and column list plus a role/permission matrix (`docs/PERMISSIONS.md`), agreed **before** the API is written.
- B ↔ C: the check-in API contract (`docs/API.md`, OpenAPI) plus rate-limit numbers.
- A ↔ C: the NOTIFY payload format for the roster hub and the DB connection pool settings.

---

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | **Foundations** (week 1–2) | Repo, CI green, compose stack up, first migrations, threat model v1, permission matrix |
| M1 | **Walking skeleton** (week 3–4) | Instructor starts a session → projector shows HMAC QR → student logs in with Google → check-in recorded → roster updates live. No passkeys yet |
| M2 | **Hardening** (week 5–6) | Passkeys, atomic claims, risk signals, audit log, rate limits, pgTAP suite covers all §2 bugs, first k6 run |
| M3 | **Academic features** (week 7–8) | Terms/sections/schedule, late threshold from meetings, manual check-in, excuse workflow, reports and export |
| M4 | **Ops and polish** (week 9–10) | Backups and a tested restore, retention jobs, dashboards, load target met, deploy to a staging server, demo script |

---

## 10. Getting started

### 10.1 Repository layout
```
.
├── PROJECT_PLAN.md          ← this file
├── README.md                ← short: what it is + how to run
├── docker-compose.yml
├── .env.example
├── .github/
│   ├── CODEOWNERS
│   ├── pull_request_template.md
│   └── workflows/ci.yml
├── db/
│   ├── migrations/          ← plain SQL, timestamped (A)
│   ├── seeds/               ← fake terms/courses/students (A)
│   └── tests/               ← pgTAP (B)
├── api/                     ← Fastify + TS
│   ├── src/
│   │   ├── auth/            (B)
│   │   ├── checkin/         (B)
│   │   ├── admin/           (A)
│   │   ├── reports/         (A)
│   │   └── realtime/        (C)
│   └── test/
├── web/                     ← React + Vite (everyone, thin)
├── infra/
│   ├── caddy/Caddyfile      (C)
│   └── grafana/             (C)
├── load/                    ← k6 scripts (C)
└── docs/
    ├── THREAT_MODEL.md      (B)
    ├── PERMISSIONS.md       (A+B)
    ├── API.md / openapi.yaml(B+C)
    ├── NETWORK.md           (C)
    ├── ERD.md               (A)
    └── decisions/           ← ADRs: 0001-stack.md, 0002-...
```

### 10.2 Day-1 checklist
- [ ] Create the GitHub repo, add all 3 members, protect `main` (PR + 1 review + CI required)
- [ ] Add this file, `README.md`, `.gitignore` (include `.env`), `.env.example`, `CODEOWNERS`
- [ ] Settle the open decisions in §11 and record each as an ADR in `docs/decisions/`
- [ ] **A:** `db/migrations/0001_init.sql` (extensions: `postgis`, `pgcrypto`, `citext`; schemas; enums)
- [ ] **B:** `docs/THREAT_MODEL.md` skeleton + `docs/PERMISSIONS.md` role × table × operation grid
- [ ] **C:** `docker-compose.yml` with `db` (postgis/postgis:16), `api`, `web`, `caddy`; CI runs lint + migrations + pgTAP
- [ ] Create a Google Cloud OAuth client (redirect: `https://localhost/auth/callback`) and share the credentials via a password manager, **not chat**

### 10.3 Init commands (adjust once the stack is confirmed)
```bash
git clone git@github.com:boeingxd/Mahub.git && cd Mahub
mkdir -p db/{migrations,seeds,tests} api web infra/caddy load docs/decisions .github/workflows
npm create vite@latest web -- --template react-ts
cd api && npm init -y && npm i fastify zod pg @simplewebauthn/server && npm i -D typescript tsx vitest @types/node && cd ..
docker compose up -d db && dbmate up
```

---

## 11. Open decisions (settle in week 1, record as ADRs)
1. **API language:** Node/TypeScript (default) or Go?
2. **Auth:** our own Google OIDC (default) or keep Supabase Auth for login only?
3. **Hosting for the demo:** university VM, a cheap VPS, or local only plus a recorded demo?
4. **Passkey fallback:** when a student's device can't do WebAuthn, is instructor manual check-in the only route?
5. **Late rule:** minutes after the scheduled meeting start (from `section_meetings`) or a per-session setting?
6. **Retention periods:** 30 days for precise GPS/IP is a proposal; confirm with the advisor or course requirements.

---

## 12. Working agreement
- **Branches:** `<initial>/<short-topic>` (e.g. `a/terms-schema`). Never commit directly to `main`.
- **PRs:** small and single-purpose; the description says *what, why, how tested*. Schema or permission changes need **B's** review.
- **Definition of done:** tests pass in CI, migrations are reversible or forward-fixed, docs are updated (API/ERD/permissions), and there are no new secrets in the diff.
- **Security bugs:** get a pgTAP or API regression test **before** the fix.
- **Weekly:** a 30-minute sync covering the demo of what merged, blockers, and the next milestone check.
