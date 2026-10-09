# Status

One page: what is built, what is next, and who needs what from whom. Update it when a task lands (a quick edit in the same PR is enough). The full plan is `PROJECT_PLAN.md`; the task list is the GitHub issues. Last updated: 10 Oct 2026.

## Built

| Piece | State | Notes |
|---|---|---|
| Database container | Running, **empty** | Postgres 16 + PostGIS in Docker. `db/migrations` has no migrations yet |
| API | Skeleton only | Answers `/healthz` and `/readyz`. No login, no check-in |
| Caddy (front door) | Done | HTTPS, security headers, routes to the API and web app |
| Cloudflare Tunnel | Done | Phones can open the app. See "Phone testing" in `docs/NETWORK.md` |
| Web screens | Done, **sample data only** | Every instructor and student screen works and looks finished, but the data is made up (`web/src/fakeData.ts`). `/dev` lists every screen |
| CI and load test | Not started | Task B8 |

## Next (from the issues)

| Week | Task | Who |
|---|---|---|
| W1 | A1 API contract (`docs/API.md`) | all three |
| W1 | P1 first migration, P2 all tables and seeds | postscrippt |
| W1 | Y1 Google sign-in, Y2 row-level security and first tests | Yayikast |
| W2 | P3 open/close check-in, P4 roster/rate views and manual mark | postscrippt |
| W2 | Y3 rotating QR, Y4 check-in transaction | Yayikast |
| W2 | B5 live roster (WebSocket), B6 connect the screens to the real API | boeingxd |
| W3 | B7 rate limits and real client IP, B8 CI and k6 | boeingxd |
| W3 | P5 audit trigger, P6 indexes, Y5 threat model, Y6 regression tests | postscrippt, Yayikast |
| W3 | A2 demo rehearsal and slides | all three |

Demo: Fri 23 Oct. One buffer week after it.

## Who needs what from whom

- **From boeingxd to Yayikast:** the tunnel address when you test login together. It changes every time the tunnel restarts, and the Google redirect URI (`https://<address>/api/auth/callback`) must be updated each time.
- **From boeingxd to everyone:** the screen list in `docs/SCREENS.md` says what data each screen needs. That is boeingxd's half of the API contract (A1).
- **From postscrippt to boeingxd:** the tables and seed data (P2), so the screens can show real classes, students and attendance. Roster and rate views (P4) feed the roster and summary screens.
- **From Yayikast to boeingxd:** sign-in (Y1) so the screens know who is signed in and which role they have. The temporary `/dev` page and `?preview=done` get removed then.
- **From postscrippt and Yayikast to each other:** schema and permission changes need Yayikast's review.
- **Everyone:** agree the API contract (A1) before building on top of it.
