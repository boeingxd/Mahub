# Status

One page: what is built, what is next, and who needs what from whom. Update it when a task lands (a quick edit in the same PR is enough). The full plan is `PROJECT_PLAN.md`; the task list is the GitHub issues. Last updated: 26 Oct 2026.

**Demo: Wed 28 Oct 2026** (moved from Fri 23 Oct).

## Built

| Piece | State | Notes |
|---|---|---|
| Database | Done for the instructor side | Migrations: init, tables, row-level security, QR helper, report views. Seed: 2 courses, rooms, instructors, students. ERD done |
| Login | Done (code) | Google sign-in with the ADR 0007 policy, `GET /api/me`. The API logs in as `mahub_api` under row-level security, never as a superuser |
| QR | Done (code) | Rotating HMAC QR for the projector and the scan link (`/c/...`) |
| Check-in windows | Done (code) | `GET /my/sections`, `GET /rooms`, open, close, get one window |
| Roster, reports, manual marks | Done (code) | `GET /class-sessions/:id/roster`, `GET /sections/:id/report` (JSON or CSV), `POST /class-sessions/:id/attendance` |
| Student check-in | Done (code) | `POST /checkin/complete` (Y4): scan cookie, enrolment, PostGIS geofence, one transaction, every attempt logged |
| Live roster (WebSocket) | Not built | Task B5 (#36). The web app asks again every 5 seconds meanwhile |
| Rate limits, real client IP | Not built | Task B7 (#38). The tunnel passes `CF-Connecting-IP` to Caddy, but nothing limits requests yet |
| CI and load test | Not started | Task B8 (#39) |
| Audit trigger, indexes | Not built | P5 (#40), P6 (#41) |
| Regression tests | Done | Y6: one file per old bug in `api/test/regressions/`. Also tightened the GPS CHECKs so the database refuses `NaN` and `Infinity` |
| Caddy, Cloudflare Tunnel | Done | See `docs/NETWORK.md` |

## The web app: real or sample?

| Screen | State |
|---|---|
| Sign in (`/`) | Real link to `/api/auth/login` |
| Instructor dashboard (`/instructor`) | **Real** (`/me`, `/my/sections`) |
| Start check-in (room picker) | **Real** (`/rooms`, opens a window) |
| Live session (`/session/:id`) | **Real**: QR, count, roster, mark present/excused, end session |
| Projector (`/projector/:id`) | **Real**: QR and count |
| Session summary (`/summary/:id`) | **Real** (`/class-sessions/:id`, `/my/sections`, roster). The CSV button downloads the whole section's report |
| Student check-in (`/checkin`) | Location prompt only. **Must now send it to `POST /api/checkin/complete`** (see `docs/API.md`) |
| Student classes, overview, class detail | Sample data. No student endpoints exist or are documented yet |
| `/dev`, `/checkin?preview=done`, `web/src/fakeData.ts` | Temporary. Delete when the screens above are real |

**None of the real screens has been run against the real API yet.** They were checked in a browser against mocked answers only. Also untested: the strict CSP under Caddy, dark mode on the new states, and scanning the QR with a phone.

How the web app talks to the API: `web/src/api.ts` (`useApi`, `apiPost`, friendly text per error code), `web/src/useLiveSession.ts`, `web/src/ui/LiveQr.tsx`, `web/src/ui/ApiStatus.tsx`. New screens should use these (loading, error, done) rather than call `fetch` directly.

## Next (open issues)

| Task | Who | Notes |
|---|---|---|
| #24 A1 API contract (`docs/API.md`) | all three | Sign-in, QR, check-in, instructor, rooms and roster are written. Missing: live roster (WebSocket), student endpoints |
| #37 B6 screens | boeingxd | Instructor screens are all wired; the student screens wait for endpoints |
| #36 B5 live roster (WebSocket) | boeingxd | Check-ins now exist (Y4), so this can be shown |
| #38 B7 rate limits, #39 B8 CI + k6 | boeingxd | No dependencies, can be done any time |
| #40, #41 | postscrippt | Audit trigger, indexes + EXPLAIN |
| #42 | Yayikast | Threat model |
| #44 A2 demo rehearsal + slides | all three | |

After #37 is done, boeingxd plans a **UI revamp** (a new look; see "Decisions"). It is not started.

## Run the real stack on your machine

1. Docker Desktop running.
2. `.env` from `.env.example`, with: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (from Yayikast, through a password manager, never chat or git), `SESSION_KEY` and `QR_SECRET` (make your own, the command is in `.env.example`), `APP_DB_PASSWORD` and `API_DATABASE_URL`, and for instructor screens `DEV_INSTRUCTOR_EMAIL` (your real Google email).
3. `docker compose up -d db`, then `dbmate up` and load the seed (see the README).
4. In `api/`: `npm run db:app-user`, then `npm run db:dev-instructor`.
5. `docker compose up -d --build`, open `https://localhost/`. Google must list `https://localhost/api/auth/callback` as a redirect URI.

## Who needs what from whom

- **Yayikast → boeingxd:** the Google client ID and secret, the redirect URI `https://localhost/api/auth/callback` listed in the Google console, and (if the Google app is in "Testing" mode) boeingxd's SIIT email as a test user. This blocks running anything for real.
- **boeingxd → Yayikast:** the tunnel address when you test login on phones. It changes every restart; the Google redirect URI must be updated each time.
- **Yayikast, postscrippt, boeingxd:** write the student endpoints (my classes, rates, class history) into `docs/API.md`. Nobody owns this yet; the student screens can't be wired until it exists.
- **postscrippt → boeingxd:** nothing outstanding. Rooms and `db:dev-instructor` landed.
- **Everyone:** agree the API contract (A1) before building on top of it. Schema or permission changes need Yayikast's review ("Clear mark" needs a DELETE grant on attendance; see `docs/API.md`, "Not decided yet").

## Decisions

- **UI revamp (boeingxd, chosen 25 Oct):** do it **after #37**, so the new look includes the real loading, error and empty states. Method: the `personal-site-workflow` skill, adapted from a personal site to this app (evidence from the product's real users, not style words). Fixed whatever the look: the strict CSP (no inline styles, no outside fonts), routes and component names in `web/src/ui/`, `fakeData` until deleted, 44px tap targets, light and dark, class colours never mean status. The current look is "Wallet passes" (`web/CONCEPT.md`, `web/DESIGN.md`).
- **No risk flags** and no campus-Wi-Fi check (ADR 0006, `CLAUDE.md`). **No late status, no auto-close** (ADR 0005).
