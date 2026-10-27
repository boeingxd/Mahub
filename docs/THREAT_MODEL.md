# Threat model

How someone could cheat or attack Mahub, and what stops them. Task Y5 (#42).

For each threat: **attack** (what they'd do), **impact** (how bad), **defence** (or "accepted risk" and why), and **proof** (the test or demo step that shows the defence works). Test paths are under `api/test/`. The plan's priorities are anti-cheating first, then database security, then networking (`PROJECT_PLAN.md`).

## Who we defend against

- **A student** who wants attendance without being in the room, or wants to see or change things that aren't theirs. The most likely attacker by far.
- **Someone on the internet** who finds the tunnel address: guessing, flooding, trying old bugs.
- **An insider** (instructor or admin) who misuses their rights, or a teammate who leaks a secret by mistake.

## What a check-in has to pass

Every check-in goes through all of these, in one database transaction (`api/src/checkin/checkinStore.ts`):

1. A QR scanned in the last 20 to 30 s (an HMAC token, `api/src/checkin/qr.ts`).
2. Signed in with Google, as a student (ADR 0007).
3. The check-in window is open (the instructor opens and closes it by hand).
4. Enrolled in that section.
5. Inside the room's circle: `radius_m` plus the GPS accuracy, capped at 30 m (PostGIS `ST_DWithin`).
6. Not already checked in (`PRIMARY KEY` plus `ON CONFLICT DO NOTHING`).

Every attempt, refused or not, is logged in `checkin_attempts`.

## Cheating

| # | Attack | Impact | Defence | Proof |
|---|---|---|---|---|
| C1 | **Checking in for an absent friend** with the friend's Google password | A false "present" | **Accepted risk** (ADR 0004: no device binding). The person checking in still has to be in the room with a fresh QR, and each account counts once. The instructor can compare the count with the heads in the room and fix it by hand. | Demo: the roster count next to a head count. `db/checkinStore.test.ts` "checking in twice gives ALREADY_PRESENT" |
| C2 | **Forwarding a photo of the QR** to a friend at home | A false "present" | The token changes every 10 s and is accepted for at most 30 s. The friend also fails the GPS check. | `qr.test.ts` "a token from 40 s ago fails". Demo: photograph the QR, wait 30 s, scan the photo, and get "QR expired" |
| C3 | **Streaming the QR live** (video call) to a friend at home | A false "present" | The QR is fresh, but the friend is far away, so the GPS check refuses them (`OUT_OF_RANGE`), and the attempt and its distance are logged. Beating this needs C4 as well. | `db/checkinStore.test.ts` "a student far away is refused, and the failed attempt is still logged" |
| C4 | **A GPS spoofing app** that reports the classroom's position | A false "present" | **Accepted risk.** A browser can't tell a fake location from a real one, and we decided on no risk flags or "unusual GPS" signals (`CLAUDE.md`, ADR 0006). What limits it: the spoofer still needs a live QR from someone in the room within 30 s, the accuracy bonus is capped at 30 m (so claiming a 5 km accuracy doesn't help), and every attempt is logged with its distance and accuracy for the instructor. | `db/checkinStore.test.ts` "poor GPS accuracy widens the circle, but by 30 m at most" |
| C5 | **Replaying an old QR link** | A false "present" | The window number is inside the signed token, and only the current window ±1 is accepted. | `qr.test.ts` "an old QR (a forwarded photo) is refused, with no scan cookie" |
| C6 | **Replaying the `mahub_scan` cookie** (sharing it, or keeping it for later) | A false "present" | The cookie is encrypted (it can't be edited), expires after 90 s, and the server checks the scan time against its own clock. It is deleted after a check-in. It only names the window: the person still has to sign in as themselves and pass GPS. | `checkin.test.ts` "a scan older than 90 s has expired" and "the scan cookie is used up after a check-in" |
| C7 | **Sending a fake body**: `lat: "x"`, `NaN`, a huge accuracy, an extra `status` or `student_id` field | The GPS check is skipped (old bug 2) | zod accepts only three finite numbers in range and no extra fields. The database CHECKs also refuse `NaN`, `Infinity` and impossible values. The student and window always come from the cookies, never from the body. A huge accuracy widens the room's circle by 30 m at most; over 100 m a refusal only changes its wording (`LOCATION_IMPRECISE`, "turn on precise location"), and it is still logged as `out_of_range`. | `regressions/02-gps-nan-bypass.test.ts`, `checkin.test.ts` "refuses a body that is not three numbers in range" and "out of range with a poor accuracy…" |
| C8 | **Two check-ins at once** to be counted twice | Inflated attendance (old bug 4) | `PRIMARY KEY (class_session_id, student_id)` plus `INSERT … ON CONFLICT DO NOTHING`. Postgres makes the second insert wait, then it inserts nothing. | `regressions/04-double-checkin.test.ts` (10 at once → 1 row) |
| C9 | **Writing attendance directly** (calling the database or a hidden API) | A false "present" or "excused" | The browser has no endpoint that writes attendance except check-in. In the database, RLS lets a student insert only themselves, by QR, as present, in an open window of their own section. Only the section's instructor can mark by hand. | `db/rls.test.ts` "a student can check in themselves, but not someone else" and "…cannot … mark themselves manual or excused" |

## Rights and data

| # | Attack | Impact | Defence | Proof |
|---|---|---|---|---|
| R1 | **A student makes themselves admin** | Full control (old bug 1) | `users` has no `role` column. Roles live in `user_roles`, which only admins can write (RLS). Instructor and admin roles never come from an email (ADR 0007). | `regressions/01-student-makes-self-admin.test.ts`, `auth.test.ts` "a SIIT student email never gets the instructor role" |
| R2 | **A student creates a class or opens a window** | Fake classes and attendance (old bug 3) | RLS checks role AND ownership on every write. | `regressions/03-student-creates-section.test.ts` |
| R3 | **IDOR**: changing an id in the URL to read or change another section | Reading other students' records, marking them | Every query runs as the signed-in user (`withUser` sets `app.user_id`), so RLS filters every table. A wrong id gets `403`/`404` with no hint whether it exists. | `sections.test.ts` "someone else can't read it: 403", `reports.test.ts` "refuses someone who doesn't teach the section: 403", `qr.test.ts` "gives nobody else the QR", `db/rls.test.ts` "an instructor sees their own section's attendance, and nobody else's" |
| R4 | **The API itself is tricked** (a bug in our code) into reading everything | A data leak | The API logs in as `mahub_api`: not a superuser, under RLS, with no DELETE grant. It refuses to start as a superuser. A bug in our code still can't see past the policies. | `db/rls.test.ts` "assertRlsApplies refuses a superuser…" and "nobody can DELETE through the API user" |
| R5 | **SQL injection** | Anything | Every query uses `$1` parameters; no SQL is built from user text. | Code review: `api/src/**/*Store.ts` |
| R6 | **An admin abuses their power** (gives roles, edits attendance) | Silent cheating by an insider | Every role and attendance change should go to `audit.events`, which nobody can UPDATE or DELETE. **Status: the trigger is task P5 (#40), not built yet.** The table and its grants exist. | P5's test (pending). Demo: change a role, then show the audit row |
| R7 | **Collecting where students are** | Privacy (PDPA) | We never store raw GPS or IP addresses (ADR 0006): only the distance and accuracy. | `regressions/08-no-raw-gps-or-ip.test.ts` |

## The web and the network

| # | Attack | Impact | Defence | Proof |
|---|---|---|---|---|
| N1 | **Guessing a QR token** | A check-in without the QR | 16 base64url characters = 96 bits, and only 3 windows are valid at a time. Compared with `timingSafeEqual`, so timing doesn't leak it. Without `QR_SECRET` nobody can make one. | `qr.test.ts` "a tampered token fails" and "a token made with a different secret fails" |
| N2 | **Flooding check-in during class** | Students can't check in | **Status: rate limits are task B7 (#38), not built yet.** Planned: a generous per-IP limit in Caddy (campus NAT means many students share one IP) and a per-user limit on `/checkin/*` in the API, with counters in memory only. Today: the DB pool caps the API at 10 connections, and each check-in is one short transaction. | B7's tests and the k6 load test (B8, #39) |
| N3 | **Another website calls the API as you** (CORS `*`, CSRF) | Actions in your name (old bug 6) | No CORS headers at all: the app is on one origin behind Caddy. Login cookies are `SameSite=Lax`, so other sites' POSTs carry no cookie. Logout is a POST. | `regressions/06-cors-and-raw-errors.test.ts`, `auth.test.ts` "the login cookie is HttpOnly, Secure, SameSite=Lax…" |
| N4 | **Raw errors leak SQL or stack traces** | Helps an attacker (old bug 6) | One error handler sends only a code; details go to the server log. | `regressions/06-cors-and-raw-errors.test.ts`, `health.test.ts` "…without leaking the error" |
| N5 | **Stealing the login cookie** (XSS, plain HTTP) | Impersonation | `HttpOnly` (page scripts can't read it), `Secure` (HTTPS only), HSTS, and a CSP with no inline scripts. Encrypted and signed, so it can't be edited. | `auth.test.ts` "a tampered cookie is treated as logged out". Headers in `infra/caddy/Caddyfile` |
| N6 | **A login link that sends you to a fake site** (open redirect) | Phishing | `returnTo` must be a path on our site. | `auth.test.ts` "ignores returnTo=https://evil.com" |
| N7 | **A forged `X-Forwarded-For` / `CF-Connecting-IP`** to dodge limits | Gets around rate limits | Caddy believes `CF-Connecting-IP` only from the tunnel; the API believes `X-Forwarded-For` only from Caddy. | `health.test.ts` "ignores X-Forwarded-For from anyone else" |
| N8 | **Making the QR write to the DB** (old bug 7: a row every 10 s) | Load, and a growing table | The QR is a stateless HMAC: showing and scanning it only read. | `regressions/07-qr-writes-nothing.test.ts` (runs on read-only connections) |

## Secrets

| # | Attack | Impact | Defence | Proof |
|---|---|---|---|---|
| S1 | **A leaked `.env`** (committed, pasted in chat, laptop stolen) | `SESSION_KEY`: forge a login as anyone (worst). `QR_SECRET`: make valid QR tokens any time (GPS and enrolment still apply). `GOOGLE_CLIENT_SECRET`: pose as our app to Google. DB passwords: direct database access (still under RLS for `mahub_api`). | `.env` is in `.gitignore`; secrets are shared through a password manager, never chat or git. The API's DB user is under RLS. **Recovery:** make new values and restart. A new `SESSION_KEY` logs everyone out; a new `QR_SECRET` ends every QR now on screen. **Accepted:** no secret manager; it's a local demo (ADR 0008). | `.gitignore`; `git log --all -- .env` is empty |
| S2 | **Changing the schema outside migrations** | Unknown, untested database (old bug 5) | Migrations are the only source of truth; tests build their database from them. | `regressions/05-migrations-only.test.ts` |

## The old app's bugs (`PROJECT_PLAN.md` §2)

| Old bug | Row above | Regression test |
|---|---|---|
| 1. A student set their own role to admin | R1 | `regressions/01-student-makes-self-admin.test.ts` |
| 2. `lat: "x"` skipped the GPS check | C7 | `regressions/02-gps-nan-bypass.test.ts` |
| 3. Any student could create a class | R2 | `regressions/03-student-creates-section.test.ts` |
| 4. One check-in counted twice | C8 | `regressions/04-double-checkin.test.ts` |
| 5. Tables made by clicking in a dashboard | S2 | `regressions/05-migrations-only.test.ts` |
| 6. CORS `*`, raw errors, no rate limit | N2, N3, N4 | `regressions/06-cors-and-raw-errors.test.ts` (rate limits: B7) |
| 7. The QR wrote to the DB every 10 s | N8 | `regressions/07-qr-writes-nothing.test.ts` |
| 8. Raw GPS kept forever | R7 | `regressions/08-no-raw-gps-or-ip.test.ts` |

## Still open

- **N2 rate limits** (B7, #38) and **R6 audit trigger** (P5, #40) are planned but not built. Until then, these rows are design, not proof.
- **C1 and C4 are accepted risks.** The instructor's own eyes and the manual mark are the backstop. That is a deliberate choice (ADR 0004, no risk flags), not a gap.

## Demo script (5 minutes)

1. Open a window, project the QR, and check in from a phone in the room: the count goes up.
2. Photograph the QR, wait 30 s, scan the photo: "QR expired" (C2).
3. Scan again from the same phone: "already present" (C6, C8).
4. Show the `checkin_attempts` rows in psql: outcomes and distances, no coordinates (C3, R7).
5. Run `npm test -- regressions`: one green test per old bug.
