# Demo script (task A2)

About 8 minutes. One laptop mirrored to the projector (instructor), one phone (student), one terminal. Every moment below says which course it shows. The last section maps each topic to a demo step and a file.

## Before you start (10 minutes, do it once)

1. Docker Desktop running; `docker compose up -d --build`; `curl -k https://localhost/api/readyz` answers `{"status":"ok"}`.
2. `.env` has the Google credentials and `DEV_INSTRUCTOR_EMAIL` (your real Google email); `npm run db:dev-instructor` has been run. **No Google credentials yet?** Start with `LOAD_TEST=1` and sign in through `POST /auth/test-login` instead, and say so out loud: Google sign-in is the one part not shown live.
3. Phone test: `docker compose --profile tunnel up -d tunnel`, wait 10 s, copy the address (`docs/NETWORK.md`, "Phone testing"). Add it to the Google redirect URIs.
4. Open three things in advance: the instructor page, a terminal with `docker compose exec db psql -U postgres -d mahub`, and a second terminal in `api/`.
5. Sign the phone in once as a student enrolled in ITS332 (a `67…@g.siit.tu.ac.th` account), then sign out, so the demo starts at the sign-in screen.

## The script

| # | Do | Say / point at | Course |
|---|---|---|---|
| 1 | Instructor signs in with Google, opens **Start check-in** for ITS332, picks the room | The QR is not stored: it is `HMAC(secret, session + 10 s window)`, so rotating it writes nothing to the database | DB, Net |
| 2 | **Present full screen** (projector): QR and the count, no names | The projector never shows names (privacy, ADR 0006) | DB |
| 3 | Phone: scan, sign in with Google, **Share my location** | The scan sets a 90 s encrypted cookie; the check-in is one transaction: window open, enrolled, inside the room (`ST_DWithin`), insert, log | DB |
| 4 | Instructor screen: the student appears **without a reload** | Live roster: a trigger sends `pg_notify`, the API listens and pushes over a WebSocket, only to the instructor of that window | DB, Net |
| 5 | Phone: scan again | "You're already checked in": `PRIMARY KEY` plus `ON CONFLICT DO NOTHING`, not application code | DB |
| 6 | Photograph the QR, wait 30 s, scan the photo | "QR expired": the window number is inside the signed token | Net, DB |
| 7 | psql: `SELECT at, outcome, distance_m, gps_accuracy_m FROM api.checkin_attempts ORDER BY at DESC LIMIT 5;` | Every attempt is logged, refused or not. Distance and accuracy only: no coordinates, no IP | DB |
| 8 | psql: `\d api.attendance` and `SELECT * FROM audit.events ORDER BY id DESC LIMIT 3;` | Row-level security on every table; the audit trigger writes `audit.events`, and nobody can update or delete it | DB |
| 9 | Instructor: **Change** a row, **Mark excused**; then re-run the audit query | The manual mark is stored with `method = 'manual'` and shows up in the audit log | DB |
| 10 | Instructor: **End session**, then **Download CSV** | The summary and the CSV come from SQL views (`api.v_session_roster`, `api.v_section_attendance_rate`), never from the browser | DB |
| 11 | Terminal: `curl -kI https://localhost/api/healthz` and `curl -I http://localhost/api/healthz` | TLS at Caddy, HSTS, CSP, no `Server` header; plain HTTP redirects to HTTPS; the API is not published | Net |
| 12 | Open `infra/caddy/Caddyfile`, line `header_up X-Forwarded-For {client_ip}` | Caddy overwrites the header with the address it really saw, and the API trusts it only from Caddy's network (`TRUST_PROXY`), so a visitor can't fake their IP to dodge the per-IP limit. Proof: `api/test/rateLimit.test.ts` | Net |
| 13 | Phone or terminal: send 6 check-ins in a minute | 6th answers `429 RATE_LIMITED`: 5 a minute per user, 3000 a minute per IP (campus NAT) | Net |
| 14 | Show the k6 result table (`docs/NETWORK.md`, "Load test") or run `load/checkin.js` | 300 students in 25 s: 300 of 300 checked in, p95 8.7 ms | Net, DB |
| 15 | Terminal in `api/`: `npm test -- regressions` | One green test per bug of the old system (self-promotion to admin, GPS `NaN` bypass, double check-in, CORS `*`, …) | DB |

If time is short, keep 1 to 6, 10, 11 and 14. Cut 12, 13 and 15 first.

## If something breaks

- **Phone can't open the tunnel address:** use `https://localhost` on the laptop in a second browser window as the "student" (location may be refused: say why the geofence matters and show step 7 instead).
- **Google sign-in fails:** switch to the test login (see "Before you start", step 2) and say so.
- **Live roster stops updating:** it falls back to refreshing every 30 s; wait or reload, and say the socket reconnects by itself.
- **Window left open by mistake:** instructor **End session**, or `UPDATE api.class_sessions SET closed_at = now() WHERE closed_at IS NULL;` as `postgres`.

## What is not in this demo

- The three student screens (My classes, Overview, Class detail) are built on sample data and wait for the student endpoints (PR #77, #78). The student side of the demo is scan, then check-in.
- The real Google sign-in has not been run end to end on the team's machines yet (see `docs/STATUS.md`).

## Topic map

By topic, because we have no written rubric. If a rubric turns up, match its lines to these rows.

| Topic | Moment(s) | Where the proof is in the repo |
|---|---|---|
| DB: schema, keys, constraints | 3, 5, 7 | `db/migrations/`, `docs/ERD.md` |
| DB: transactions, concurrency | 3, 5, 15 | `api/src/checkin/checkinStore.ts`, `api/test/regressions/04-double-checkin.test.ts` |
| DB: security (roles, RLS, audit) | 8, 9 | `docs/PERMISSIONS.md`, `api/test/db/rls.test.ts`, `api/test/db/audit.test.ts` |
| DB: views and reports | 10 | `db/migrations/20261026090000_report_views.sql` |
| DB: indexes, `EXPLAIN ANALYZE` | (show the tables) | `docs/PERFORMANCE.md` |
| DB: triggers, `LISTEN`/`NOTIFY` | 4, 8 | `db/migrations/20261028090000_roster_notify.sql` |
| Net: reverse proxy, TLS, headers | 11 | `infra/caddy/Caddyfile`, `docs/NETWORK.md` |
| Net: trust boundaries, client IP | 12 | `docs/NETWORK.md` ("Who trusts whom") |
| Net: rate limiting | 13 | `api/src/rateLimit.ts`, `api/test/rateLimit.test.ts` |
| Net: WebSocket | 4 | `api/src/realtime/`, `docs/API.md` ("Live roster") |
| Net: public access, tunnel | 3 | `docs/NETWORK.md` ("Phone testing") |
| Net: load and performance | 14 | `load/checkin.js`, `docs/NETWORK.md` ("Load test") |
