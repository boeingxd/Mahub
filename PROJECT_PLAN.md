# Mahub: Secure Attendance System (Project Plan)

> Read this before writing code. It is the spec.
> **New to all this?** Read [docs/BASICS.md](docs/BASICS.md) first (15 minutes).
> Timeline: **2 weeks to a working demo + 1 buffer week** (ADR 0008 explains why the plan shrank).
> Mahub is graded in two courses: **Database Systems** and **Computer Networks**. Every feature below is either core to the app or shows a skill one of those courses grades.

---

## 1. What we are building

A web app that takes attendance in a university class:

1. The instructor signs in and clicks **Open check-in** for their section.
2. The projector shows a **QR code that changes every 10 seconds**, so a photo sent to a friend stops working almost at once.
3. A student scans it, signs in with their **SIIT Google account**, and allows location.
4. The server checks: valid QR, enrolled in the section, window open, and within the room's radius. Then it saves attendance in **one database transaction**.
5. The instructor's **roster updates live**. Every attempt, including failed ones, is logged as anti-cheating evidence.

**Demo goal (Fri 23 Oct):** steps 1–5 work end to end on real phones.

### Priorities
1. Hard to cheat (server decides everything, every attempt logged).
2. Database design (normalised tables, constraints, views, a transaction, a trigger).
3. Database security (DB roles, least privilege, row-level security, no self-promotion to admin, no raw GPS/IP stored).
4. Networking (Docker networks, Caddy reverse proxy with HTTPS and headers, real client IP, WebSocket, tunnel, rate limits, load test).
5. UI: plain and functional.

### Not doing
Native apps, registrar integration, device binding (ADR 0004), a "late" status or auto-close (ADR 0005), excuse requests, CSV import, a VPS deploy, pgTAP.

---

## 2. Lessons from the old app (each gets a test)

The predecessor (React + Supabase) had these bugs. Each one gets a test that fails if the bug comes back.

| Old bug | Our rule |
|---|---|
| A student set their own `users.role` to `admin` | No `role` column. Roles live in `user_roles`, only admins can write it (RLS) |
| The GPS check was skipped by sending `lat: "x"` | Validate every request body with zod; CHECK constraints in the DB |
| Any student could create a class | Every write checks **role and ownership** (RLS) |
| One check-in counted twice under concurrent requests | Check-in is one transaction; `PRIMARY KEY (class_session_id, student_id)` |
| Tables were made by clicking in a dashboard | **Migrations are the only source of truth** |
| CORS `*`, raw errors shown to users, no rate limit | Origin allowlist, error codes only, rate limits |
| The QR wrote to the DB every 10 s | Stateless HMAC tokens (§5) |
| Raw GPS kept forever | Never store raw GPS or IPs (ADR 0006) |

---

## 3. Architecture

```
 Student phone / Projector / Instructor laptop   (browser)
                 │  HTTPS + WSS
        ┌────────▼─────────┐
        │ Cloudflare Tunnel │  public HTTPS address for phones (demo + testing)
        └────────┬─────────┘
        ┌────────▼─────────┐
        │ Caddy (edge)      │  TLS, security headers, X-Forwarded-For, serves web/
        └───┬──────────┬───┘
            │ /api, /ws│ /
   ┌────────▼───┐  ┌───▼──────┐
   │ API        │  │ Web      │  React + Vite (static files)
   │ Fastify    │  └──────────┘
   └────┬───▲───┘
   SQL  │   │ LISTEN/NOTIFY
   ┌────▼───┴────────────────┐
   │ PostgreSQL 16 + PostGIS  │  schemas api · private · audit, RLS
   └──────────────────────────┘
 All of it runs in Docker Compose on one laptop. Only Caddy is reachable from outside.
```

| Area | Choice |
|---|---|
| Database | PostgreSQL 16 + PostGIS (`imresamu/postgis:16-3.5`) |
| Migrations | `dbmate`, plain SQL with `-- migrate:up` / `-- migrate:down` |
| API | Node 22 + TypeScript + Fastify, zod, `pg`, vitest (ADR 0001) |
| Login | Google OpenID Connect via `openid-client`, encrypted session cookie (ADR 0002, amended by 0008) |
| Real-time | WebSocket fed by Postgres `LISTEN/NOTIFY` |
| Edge | Caddy |
| Frontend | React + Vite, plain CSS |
| Hosting | Docker Compose on a laptop + Cloudflare Tunnel (ADR 0003, amended by 0008) |
| Tests | vitest for the API **and** the database security tests (one tool) |
| Load test | k6 |

---

## 4. Database design

### 4.1 Tables (11)

```
courses ─< sections >─ users (instructor)
              │ ├─< enrollments >── students ── users
              │ └─< class_sessions ─┬─< attendance >── students
rooms ────────┘ (copied on open)    └─< checkin_attempts
users ─< user_roles
audit.events  (written by a trigger)
```

| Table | Key columns | Notes |
|---|---|---|
| `users` | id uuid, email citext unique, google_sub unique (null until first login), full_name, created_at | **No `role` column** |
| `user_roles` | user_id, role (`app_role`: student/instructor/admin), granted_by, granted_at | PK(user_id, role). Only admins write it |
| `students` | user_id PK → users, student_no unique CHECK `^[0-9]{10}$` | From the email prefix (ADR 0007) |
| `courses` | id, code unique (`ITS332`), name | |
| `sections` | id, course_id, term text (`2026-1`), section_no, instructor_id → users | unique(course_id, term, section_no) |
| `rooms` | id, name, location `geography(Point)`, radius_m CHECK 10–500 | |
| `enrollments` | section_id, student_id | PK(section_id, student_id) |
| `class_sessions` | id, section_id, room_id, location, radius_m, opened_by, opened_at, closed_at | Geofence copied from the room on open. **Partial unique index: one open session per section** |
| `attendance` | class_session_id, student_id, status (`present`/`excused`), method (`qr`/`manual`), recorded_at, recorded_by, distance_m, gps_accuracy_m | PK(class_session_id, student_id). **Absent = enrolled with no row**, derived in a view |
| `checkin_attempts` | id, class_session_id, user_id, at, outcome (`attempt_outcome` enum), distance_m, gps_accuracy_m | Every attempt, including failures |
| `audit.events` | id, at, actor, table_name, op, row_pk, before jsonb, after jsonb | Trigger-written. Nobody can UPDATE or DELETE |

### 4.2 Design rules
- `uuid` PKs (or natural composite PKs), `timestamptz`, `NOT NULL` unless null means something.
- Enums for statuses. CHECK constraints for ranges (radius, accuracy ≥ 0, opened_at < closed_at).
- Every FK has an explicit `ON DELETE` (default `RESTRICT`). Index FKs used in joins.
- Reports come from **views**: `v_session_roster` (present / excused / absent per session) and `v_section_attendance_rate`. Never computed in the browser.

### 4.3 Database security
- **Schemas:** `api` (tables), `private` (helper functions), `audit` (append-only log).
- **Roles:** `migrator` (runs migrations), `app_rw` (the API; subject to RLS), `app_ro` (reports, read-only), `auditor` (reads `audit` only). No superuser at runtime.
- **RLS on every `api` table.** Per request, the API runs `SET LOCAL app.user_id = '<uuid>'` inside a transaction; policies read it via `private.current_user_id()`.
- **SECURITY DEFINER** helpers (e.g. `private.has_role()`) use `SET search_path = pg_catalog, private`.
- **Privacy (ADR 0006):** store `distance_m` and `gps_accuracy_m` only. Never raw lat/lng or IP.

---

## 5. Check-in protocol

### 5.1 Rotating QR (no DB write per rotation)
```
window = floor(unix_seconds / 10)
token  = base64url( HMAC-SHA256(QR_SECRET, class_session_id + ":" + window) ), first 16 chars
QR URL = https://<host>/c/<class_session_id>.<window>.<token>
```
`QR_SECRET` lives in `.env`. The server accepts `window` ∈ {now−1, now, now+1} (±10 s clock skew).

### 5.2 Flow
1. **Scan:** `GET /c/:id.:window.:token`. The server checks the token and that the session is open, then sets a signed, HttpOnly `scan` cookie (`class_session_id`, `scanned_at`) that lasts **90 s**. This is how the scan survives the Google login.
2. **Login if needed.** The original URL is kept through the redirect.
3. **GPS:** the browser asks for location, then `POST /api/checkin/complete {lat, lng, accuracy}` (zod-validated). **One transaction:**
   ```sql
   -- inside BEGIN … COMMIT, with SET LOCAL app.user_id
   -- 1. read the scan cookie (must be < 90 s old) → class_session_id
   -- 2. check: enrolled, session still open, ST_DWithin(session.location, point, radius_m + accuracy budget)
   INSERT INTO api.attendance (...) VALUES (...) ON CONFLICT DO NOTHING;   -- distance_m only, never lat/lng
   INSERT INTO api.checkin_attempts (...) VALUES (...);                    -- success or the failure reason
   ```
4. A trigger on `attendance` runs `pg_notify('roster', …)`, and the WebSocket hub pushes it to the instructor's screen.

### 5.3 Evidence
| Signal | Effect |
|---|---|
| Valid QR window, signed in as a student, enrolled, session open | Hard gate (reject if not) |
| Distance ≤ radius (with GPS accuracy budget) | Hard gate |
| _No soft signals._ There are no risk flags (no "unusual GPS", no campus Wi-Fi check): the instructor marks exceptions by hand | |

If a student's phone can't get a location, the instructor marks them present by hand (`method = 'manual'`).

---

## 6. Networking

- **Docker networks:** only Caddy publishes a port. The API and DB are reachable only inside Compose.
- **Caddy:** local HTTPS, HSTS, CSP (no inline scripts), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Routes `/api/*` and `/ws` to the API and everything else to the web app. Sets `X-Request-Id`.
- **Real client IP:** Caddy forwards `X-Forwarded-For`; the API trusts it only from Caddy. Used for rate limits only, and never stored.
- **Cloudflare Tunnel:** gives the laptop a public HTTPS address, so phones get GPS and secure cookies.
- **WebSocket:** authenticates on connect, only instructors of that section can subscribe to its roster. Heartbeat every 20 s; the client reconnects with backoff and re-fetches the roster.
- **Rate limits:** per user on `/api/checkin/*` (e.g. 5/min) in the API; generous per IP (a whole class shares one IP).
- **Load test (k6):** 300 check-ins in 30 s → p95 < 500 ms, 0 errors.
- **Observability:** `/healthz`, `/readyz`, JSON logs with a request ID from Caddy through the API.

---

## 7. Team

| | boeingxd: Network + UI | postscrippt: Database | Yayikast: Security + check-in |
|---|---|---|---|
| Owns | Docker, Caddy, Tunnel, WebSocket, rate limits, CI, load test, **all screens** | Migrations, tables, seeds, ERD, open/close check-in, views, audit trigger, indexes | Google login, RLS + DB roles, QR tokens, check-in transaction, threat model, security tests |
| Reviews | API changes that affect screens | Yayikast's policies | All schema and permission changes |

Agree before building on top of them: `docs/API.md` (task A1, everyone, days 1–2) and the NOTIFY payload (postscrippt + boeingxd).

---

## 8. Schedule

Each task is a GitHub issue titled `[W1] P2 …` (week, then owner letter: **A** = all, **B** = boeingxd, **P** = postscrippt, **Y** = Yayikast). Every issue says what to build, the idea in plain words, the steps, and exactly how to check it works.

### Week 1 (12–18 Oct): foundations
| Task | Build | Depends on |
|---|---|---|
| A1 | `docs/API.md`: every endpoint, request/response, error codes | — |
| B1 | API skeleton: Fastify, `/healthz`, `/readyz` (**done**) | — |
| B2 | Caddy: local HTTPS + security headers; API no longer published directly | B1 |
| B3 | Web app skeleton + login page (React + Vite behind Caddy) | B2 |
| B4 | Cloudflare Tunnel: open the app on a phone | B2 |
| P1 | First migration: extensions, schemas, enums, DB roles | — |
| P2 | All tables + seed data + ERD | P1 |
| Y1 | Google sign-in + login policy (ADR 0007) | P2, A1 |
| Y2 | RLS policies + grants + tests ("student can't make self admin") | P2 |

### Week 2 (19–25 Oct): the full demo — **due Fri 23 Oct**
| Task | Build | Depends on |
|---|---|---|
| P3 | Instructor opens/closes a check-in window | P2, Y2 |
| P4 | Views: roster (present/absent) + attendance rate; manual mark | P2 |
| Y3 | Rotating QR token + projector endpoint | P3 |
| Y4 | Student check-in: scan → login → GPS → one transaction | Y1, Y3 |
| B5 | Live roster: NOTIFY → WebSocket → browser | P3, B2 |
| B6 | Screens: instructor, projector, student check-in, roster | B3, A1 |

### Week 3 (26 Oct – 1 Nov): buffer + graded extras
| Task | Build | Depends on |
|---|---|---|
| B7 | Rate limits + real client IP | B2, Y4 |
| B8 | CI (GitHub Actions) + k6 load test | B1, P1 |
| P5 | Audit trigger → `audit.events` | P2 |
| P6 | Indexes + `EXPLAIN ANALYZE` write-up | P4 |
| Y5 | Threat model write-up (`docs/THREAT_MODEL.md`) | Y4 |
| Y6 | A test for every old bug in §2 | Y2, Y4 |
| A2 | Demo rehearsal + slides | everything |

---

## 9. Working agreement
- **Branches:** `<github-username>/<short-topic>`. Never commit to `main` directly.
- **PRs:** small; the description says what, why, and how you tested it, plus `Closes #<issue>`. Schema or permission changes need Yayikast's review.
- **Done means:** tests pass, migrations roll back cleanly (`dbmate rollback`), docs updated, no secrets in the diff.
- **Security bugs:** write the failing test first, then the fix.
- **Daily:** a 5-minute message in the group chat: what I finished, what's next, what's blocking me.
