# Status

One page: what is built, what is next, and who needs what from whom. Update it when a task lands (a quick edit in the same PR is enough). The full plan is `PROJECT_PLAN.md`; the task list is the GitHub issues. Last updated: 27 Oct 2026.

**Demo: Wed 28 Oct 2026** (the date written on 26 Oct, moved from Fri 23 Oct). On 27 Oct boeingxd said the date matters less than finishing everything ASAP: **confirm the real date with the team** and fix this line.

## Built

| Piece | State | Notes |
|---|---|---|
| Database | Done | Migrations: init, tables, row-level security, QR helper, report views, GPS checks, audit trigger (P5), the roster NOTIFY trigger (#75) and the student views (#82). Indexes and `EXPLAIN ANALYZE` write-up (P6, `docs/PERFORMANCE.md`). Seed: 2 courses, rooms, instructors, students. ERD done |
| Login | Done (code) | Google sign-in with the ADR 0007 policy, `GET /api/me`. The API logs in as `mahub_api` under row-level security, never as a superuser. **Never completed against real Google yet**: the credentials arrived on 27 Oct, but Google answered `redirect_uri_mismatch` for the tunnel address, so Yayikast is checking the OAuth client |
| QR | Done | Rotating HMAC QR for the projector and the scan link (`/c/...`) |
| Check-in windows | Done | `GET /my/sections`, `GET /rooms`, open, close, get one window |
| Roster, reports, manual marks | Done | `GET /class-sessions/:id/roster`, `GET /sections/:id/report` (JSON or CSV), `POST /class-sessions/:id/attendance` |
| Student check-in | Done | `POST /checkin/complete` (Y4): scan cookie, enrolment, PostGIS geofence, one transaction, every attempt logged |
| Rate limits | Done (#72) | 3000 a minute per IP (`RATE_LIMIT_IP`) and 5 a minute per signed-in user on `/checkin/*`. See `docs/NETWORK.md` |
| CI | Done (#73) | GitHub Actions on every PR: migrations up, rollback, up; API lint, build, tests; web lint and build. **Branch protection on `main` is not set** (boeingxd: GitHub settings, needs admin) |
| Load test | Done (#74) | k6, 300 students in about 25 s: all 300 checked in, 0 failed requests, p95 under 10 ms. Results in `docs/NETWORK.md`. It found the first per-IP limit (300) far too low |
| Test login (for the load test and demos without Google) | Done (#74, locked down in #76) | `POST /auth/test-login` exists only when the API runs with `LOAD_TEST=1` and the Google redirect is on localhost. The tunnel door answers 404 for it and it accepts only load-test emails (checked with `LOAD_TEST=1` on: door 1 gives 204 or 403, the tunnel door 404) |
| Live roster (WebSocket) | Done (#75) | A trigger on `attendance` sends `pg_notify`, the API pushes it over `/ws` to the instructor of that window, the browser reconnects by itself. Design in `docs/API.md` ("Live roster") |
| Student endpoints | Done (#77 contract, #82 code) | `GET /my/classes`, `/my/overview`, `/my/classes/:id/sessions` (migration `20261027120000_student_views.sql`). Checked on the live stack on 27 Oct with a test-login student: 403 for a class that student isn't in, 401 signed out. `instructor_name` is filled in for enrolled students (Yayikast approved the small function that reads it); the screens still cope with `null` |
| Regression tests | Done | Y6: one file per old bug in `api/test/regressions/` |
| Threat model | Written | `docs/THREAT_MODEL.md` (Y5). Yayikast will add the known limit that an open socket outlives logout |
| Caddy, Cloudflare Tunnel | Done | See `docs/NETWORK.md` |

## The web app: real or sample?

| Screen | State |
|---|---|
| Sign in (`/`) | Real link to `/api/auth/login` |
| Instructor dashboard (`/instructor`) | **Real** (`/me`, `/my/sections`) |
| Start check-in (room picker) | **Real** (`/rooms`, opens a window) |
| Live session (`/session/:id`) | **Real**: QR, count, roster, mark present/excused, end session. Updates live over the WebSocket (#75) |
| Projector (`/projector/:id`) | **Real**: QR and count |
| Session summary (`/summary/:id`) | **Real**. The CSV button downloads the whole section's report |
| Student check-in (`/checkin`) | **Real** (`POST /checkin/complete`) |
| Student classes, overview, class detail | **Real** (#78): read the student endpoints. Checked on 27 Oct in a phone-size browser against the live API (7 of 10 present); the Excused and Open now rows have only been seen with mocked answers |
| `/dev`, `/checkin?preview=done`, `web/src/fakeData.ts` | Temporary. Delete when no screen needs them |

**Checked on 27 Oct:** the whole instructor and student flow end to end on the real stack (Caddy, API, database), signing in with the test login instead of Google: open a check-in, scan, check in, live count, manual mark, end session, summary. The student and instructor screens were also looked at in a browser at phone size in light and dark, and on a real phone against sample data. The student screens were then checked against the real student endpoints (27 Oct, after #82). **Still untested:** real Google sign-in, and a real phone through the tunnel on the real stack.

How the web app talks to the API: `web/src/api.ts` (`useApi`, `apiPost`, friendly text per error code), `web/src/useLiveSession.ts` and `web/src/realtime.ts`, `web/src/ui/LiveQr.tsx`, `web/src/ui/ApiStatus.tsx`, `web/src/studentFormat.ts`. New screens should use these (loading, error, done) rather than call `fetch` directly.

## Next (open issues and PRs)

| Task | Who | Notes |
|---|---|---|
| #24 A1 API contract (`docs/API.md`) | all three | Live roster (#71) and student endpoints (#77) are in |
| Real Google sign-in, full run | boeingxd, Yayikast | Credentials and `.env` are ready and the tunnel address is registered in the Google console, but Google still answers `redirect_uri_mismatch`. Yayikast is checking that the URI is on the same OAuth client as the client ID in `.env` |
| #44 A2 demo script, slides, rehearsals | all three | Script written (`docs/DEMO.md`, #81), not rehearsed. There is no written rubric, so it ends with a topic map. Slides and two rehearsals are still to do |

After the screens are real, boeingxd plans a **UI revamp** (a new look; see "Decisions"). It is not started and is not needed for the demo.

## Run the real stack on your machine

1. Docker Desktop running.
2. `.env` from `.env.example`, with: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (from Yayikast, through a password manager, never chat or git), `SESSION_KEY` and `QR_SECRET` (make your own, the command is in `.env.example`), `APP_DB_PASSWORD` and `API_DATABASE_URL`, and for instructor screens `DEV_INSTRUCTOR_EMAIL` (your real Google email). For phones, start the tunnel, then set `DOCKER_GOOGLE_REDIRECT_URI=https://<tunnel address>/api/auth/callback` in `.env` and recreate the API; open the tunnel address on the laptop too.
3. `docker compose up -d db`, then `dbmate up` and load the seed (see the README).
4. In `api/`: `npm run db:app-user`, then `npm run db:dev-instructor`.
5. `docker compose up -d --build`, open `https://localhost/`. Google must list `https://localhost/api/auth/callback` as a redirect URI.

**Without Google credentials (testing the flow yourself):** start the stack with `LOAD_TEST=1` (any non-empty `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` will do, and the redirect must stay on localhost). Then, in the browser console on `https://localhost`, sign in with `fetch('/api/auth/test-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'instructor1@example.com'})})`, and open `/instructor`. Use a private window for a student (`6730000001@g.siit.tu.ac.th` and so on; `load/seed.sql` adds 300 of them, after `db/seeds/seed.sql`). Turn `LOAD_TEST` off again afterwards. It only works at `https://localhost`, never through the tunnel. The k6 load test is in `load/` (see `docs/NETWORK.md`).

## Who needs what from whom

- **Yayikast → boeingxd:** a working Google sign-in: the OAuth client whose ID is in `.env` must list the tunnel callback `https://<tunnel address>/api/auth/callback`, and every account that will sign in must be a test user (the Google app is in "Testing" mode). Her answer on the `redirect_uri_mismatch` blocks the full run.
- **boeingxd → Yayikast:** the tunnel address, and the phone accounts to add as test users. The address changes on every tunnel restart, so don't restart it.
- **boeingxd:** set branch protection on `main`, rehearse the demo, and confirm the demo date.
- **Everyone:** agree the API contract (A1) before building on top of it. Schema or permission changes need Yayikast's review ("Clear mark" needs a DELETE grant on attendance; see `docs/API.md`, "Not decided yet").

## Decisions

- **UI revamp (boeingxd, chosen 25 Oct):** do it after the screens are real, so the new look includes the real loading, error and empty states. Method: the `personal-site-workflow` skill, adapted from a personal site to this app (evidence from the product's real users, not style words). Fixed whatever the look: the strict CSP (no inline styles, no outside fonts), routes and component names in `web/src/ui/`, 44px tap targets, light and dark, class colours never mean status. The current look is "Wallet passes" (`web/CONCEPT.md`, `web/DESIGN.md`).
- **No risk flags** and no campus-Wi-Fi check (ADR 0006, `CLAUDE.md`). **No late status, no auto-close** (ADR 0005).
- **Rate limits (27 Oct):** the per-IP limit is generous (3000 a minute) because a whole class shares one campus IP and each student makes about 5 API calls to check in; the real protection is 5 a minute per user on `/checkin/*`.
- **Live roster design (#71, #75):** one `subscribe` per socket and one window per socket, only for the instructor of that window; a 10 s subscribe timeout; the browser asks the roster endpoint again after each message, so the endpoint stays the single source of truth.
- **Student rates (#77):** the overall rate is pooled across classes; an open window counts in "held" (the same number the instructor sees); an excused window counts neither for nor against.
