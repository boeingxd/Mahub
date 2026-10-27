# API contract

Every endpoint the demo needs: who may call it, what to send, what comes back. Built from task A1 (#24). Written so far: sign-in, the QR and student check-in, the instructor endpoints and the live roster (WebSocket). The student endpoints are still to be added.

Caddy strips `/api` before the request reaches the API, so inside the API a route is `/my/sections`, but the browser calls `/api/my/sections`. Paths below are the browser's.

## Errors

One format for every error: `{"error": "CODE"}`. The code is for the screen to translate into words; we never send raw error messages (they can leak database details).

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | The request body or an id in the address isn't the right shape |
| 400 | `QR_EXPIRED` | Check-in without a scan in the last 90 s. Scan the QR again |
| 400 | `LOGIN_EXPIRED`, `LOGIN_FAILED` | Google sign-in didn't finish (only on `/api/auth/callback`) |
| 401 | `UNAUTHENTICATED` | Not signed in |
| 403 | `NOT_ENROLLED` | Check-in: you are not in this section |
| 403 | `FORBIDDEN` | Signed in, but not the instructor of that section. Also sent when the id doesn't exist, so nobody can probe which ids are real |
| 404 | `ROOM_NOT_FOUND` | `room_id` is not a room |
| 404 | `NOT_ENROLLED` | The student you tried to mark is not in this section |
| 409 | `SESSION_ALREADY_OPEN` | That section already has an open check-in window |
| 404 | `NOT_FOUND` | The projector QR: no such window, or not yours (we don't say which) |
| 409 | `SESSION_CLOSED` | The window is already closed |
| 409 | `ALREADY_PRESENT` | Check-in: you are already marked for this window |
| 422 | `OUT_OF_RANGE` | Check-in: you are too far from the room |
| 429 | `RATE_LIMITED` | Too many requests. Per IP on every endpoint (3000 a minute); per signed-in user on `/checkin/*` (5 a minute). See `docs/NETWORK.md` |
| 500 | `INTERNAL` | Our bug. Details are in the server log, never in the reply |

## Sign-in (Y1)

Google sign-in with our own login cookie (`mahub_session`: encrypted, HttpOnly, 8 h). Who may sign in is ADR 0007: a `<10 digits>@g.siit.tu.ac.th` account becomes a student; anyone else must already be registered by an admin.

### `GET /api/auth/login?returnTo=/path`

The "Sign in with Google" button links here. Redirects to Google. `returnTo` (optional) must be a path on this site; anything else is ignored.

### `GET /api/auth/callback`

Google sends the browser back here. On success: a `303` redirect to `returnTo`, or else the home screen for the user's role (`/instructor` or `/student`). A refused email goes to `/not-registered`.

Errors: `400 LOGIN_EXPIRED` (no sign-in in progress), `400 LOGIN_FAILED` (Google said no, or the answer was forged).

### `POST /api/auth/logout`

Deletes the login cookie. No body. Response `204`. It is a POST so another website can't log you out with a link.

### `GET /api/me`

Who is signed in. The web app uses it to choose screens.

Response `200`:

```json
{ "id": "…", "email": "6722781026@g.siit.tu.ac.th", "fullName": "Yayikast", "roles": ["student"] }
```

Errors: `401 UNAUTHENTICATED`.

## QR and student check-in (Y3, Y4)

How a check-in works, end to end:

1. The projector shows a QR that changes every 10 s (`GET /api/class-sessions/:id/qr`).
2. The student's phone camera opens the QR's link (`/c/...`). The server checks it and remembers the scan for 90 s in a second cookie (`mahub_scan`), then sends the student to sign in if needed, and on to `/checkin`.
3. The `/checkin` page asks the phone for its location and sends it to `POST /api/checkin/complete`. The server decides and records attendance. The browser never writes attendance itself.

### `GET /api/class-sessions/:id/qr`

The current QR for the projector. Only the section's instructor. Ask again when `expires_in` runs out (or every few seconds).

Response `200`:

```json
{
  "url": "https://<host>/c/<class_session_id>.<window>.<token>",
  "window": 179298000,
  "expires_in": 7,
  "server_time": "2026-10-26T02:00:03.000Z"
}
```

`url` is what the QR encodes. A QR is accepted for 20 to 30 s (its own 10 s window and one either side), so a photo sent to a friend stops working almost at once. Showing the QR writes nothing to the database.

Errors: `401`, `404 NOT_FOUND` (no such window, or not your section), `409 SESSION_CLOSED`.

### `GET /c/:id.:window.:token` (the scan)

Not under `/api`: this is the link inside the QR. It never answers with JSON, only redirects:

| Situation | Redirect to | Scan cookie |
|---|---|---|
| Good QR, not signed in | `/api/auth/login?returnTo=%2Fcheckin` | set (90 s) |
| Good QR, signed in | `/checkin` | set (90 s) |
| Old, forged or malformed QR | `/checkin?error=QR_EXPIRED` | not set |
| Window closed | `/checkin?error=SESSION_CLOSED` | not set |

### `POST /api/checkin/complete`

The student checks in. Needs the login cookie and a scan from the last 90 s. The window comes from the scan cookie, never from the body.

Request body (all three required, all numbers, nothing else allowed):

```json
{ "lat": 14.0690, "lng": 100.6150, "accuracy": 12 }
```

`lat` −90 to 90, `lng` −180 to 180, `accuracy` 0 to 5000 metres (the browser's `coords.accuracy`).

The server, in one transaction: checks the window is open, checks the student is enrolled, measures the distance to the room in PostGIS (allowed if within `radius_m` plus the accuracy, but the accuracy counts for at most 30 m), then inserts the attendance row (`ON CONFLICT DO NOTHING`, so two taps make one row). Every attempt, refused or not, is logged in `checkin_attempts`. Latitude and longitude are never stored, only the distance (ADR 0006).

Response `200`:

```json
{ "result": "present", "distance_m": 12.4 }
```

Errors: `400 BAD_REQUEST` (body), `400 QR_EXPIRED` (no scan, or older than 90 s), `401`, `403 NOT_ENROLLED`, `409 SESSION_CLOSED`, `409 ALREADY_PRESENT`, `422 OUT_OF_RANGE`.

The scan is used up after an answer, so scanning again is needed for another try. The one exception is `OUT_OF_RANGE`: the scan is kept, so the student can retry with a better GPS fix within the same 90 s.

## Sections and check-in windows (P3)

A **check-in window** is a row in `class_sessions`. The instructor opens it by hand, students can check in while it's open, and the instructor closes it by hand. Nothing closes it automatically (ADR 0005). Only the instructor of a section can use the endpoints below, except `GET /api/rooms`, which any signed-in user may call.

### `GET /api/my/sections`

The signed-in instructor's sections, for the "My classes" screen.

Response `200`:

```json
[
  {
    "id": "00000000-0000-0000-0000-0000000000e1",
    "course_code": "ITS332",
    "course_name": "Database Systems",
    "term": "2026-1",
    "section_no": 1,
    "enrolled": 30,
    "open_session_id": null
  }
]
```

`open_session_id` is the id of the section's open window, or `null` if there is none. The screen uses it to show "Open" or "Go to live session".

### `GET /api/rooms`

The rooms to pick from on the "Start check-in" screen. Any signed-in user may call it (it is just a list of names). Each room is only its `id` and `name`: the coordinates and radius never leave the database, and the server copies them into the window itself when it opens.

Response `200`, sorted by name:

```json
[
  { "id": "00000000-0000-0000-0000-0000000000f1", "name": "SIIT Building A, Room 101" },
  { "id": "00000000-0000-0000-0000-0000000000f2", "name": "SIIT Building B, Room 201" }
]
```

Errors: `401 UNAUTHENTICATED`.

### `POST /api/sections/:id/class-sessions`

Opens a check-in window for section `:id`. The room's location and radius are copied into the window, so editing the room later doesn't change past windows.

Request body: `{"room_id": "<uuid>"}`

Response `201`:

```json
{
  "id": "…",
  "section_id": "…",
  "room_id": "…",
  "radius_m": 50,
  "opened_by": "…",
  "opened_at": "2026-10-26T02:00:00.000Z",
  "closed_at": null
}
```

Errors: `400`, `401`, `403` (not your section), `404 ROOM_NOT_FOUND`, `409 SESSION_ALREADY_OPEN`.

### `POST /api/class-sessions/:id/close`

Closes window `:id` (sets `closed_at` to now). No body. After this, the section can open a new window.

Response `200`: the same shape as above, with `closed_at` filled in.

Errors: `400`, `401`, `403`, `409 SESSION_CLOSED` (already closed).

### `GET /api/class-sessions/:id`

One window, for the live-session screen.

Response `200`: the same shape as above.

Errors: `400`, `401`, `403`.

## Student endpoints (B6)

For the three student screens: My classes, Overview and Class detail (`docs/SCREENS.md`). **Approved (task A1, #24) and built in `api/src/student/`. The function behind `instructor_name` (`private.student_instructor_name`) is a permissions change and goes to Yayikast for review.**

The rules are the same as everywhere else:

- **Who is asking comes from the login cookie only.** No endpoint takes a `student_id`; a student can't ask about someone else because there is nothing to put it in.
- **Row-level security decides what they can see**: a student's own enrollments, the windows of their own sections, and their own attendance rows. The queries also say `WHERE student_id = <me>` themselves (the policy alone would still be correct, but would be slow: see `docs/PERFORMANCE.md`).
- **Absent is never stored.** A window you are enrolled for, with no row of yours in `attendance`, is absent.
- **Rates come from SQL views**, never from the browser. They are the same rule as the instructor's report (`v_section_attendance_rate`):

  > rate = windows attended / (windows held − windows excused), as a percentage with one decimal.

  So an **excused** window counts neither for nor against you: it is taken out of the bottom line. If nothing is left to divide by (no windows yet, or all excused), `rate_pct` is `null` and the screen shows "—", not 0.
- **`sessions_counted` is the bottom line itself:** `sessions_counted = sessions_held − excused`, exactly the number `rate_pct` divides by. Every rate in this section comes with it, so the screens can show "X of Y sessions" (`attended` of `sessions_counted`) next to the rate without doing any arithmetic. With one excused window, a student who attended 10 of 12 windows sees "10 of 11" next to 90.9%, not "10 of 12".
- **`instructor_name` is `string | null`.** It is `null` (and the screens leave the name out) when there is no name to show; it is nullable so a missing name never breaks a screen. The name is read through a narrow `SECURITY DEFINER` function, see "Decided" at the end.
- **Never any GPS.** No `distance_m`, `gps_accuracy_m`, room coordinates or `recorded_by` is returned, only who/when/status.
- "Windows held" are all of the section's check-in windows, including one that is still open (same as the instructor's report). The windows list below marks the open one, so the screen can say "Open now" instead of "Absent".
- Times are ISO 8601 UTC strings. The screen formats them (date, and 24 h time) in the viewer's time zone, like the instructor screens do.
- The pass colour is not sent: the screen derives it from `course_code`, as it does today.

### `GET /api/my/classes`

My classes: every section I am enrolled in, with my rate. Any signed-in user may call it; someone with no enrollments (an instructor, for example) gets `[]`. Sorted by course code, then section number.

Response `200`:

```json
[
  {
    "section_id": "00000000-0000-0000-0000-0000000000e1",
    "course_code": "ITS332",
    "course_name": "Database Systems",
    "term": "2026-1",
    "section_no": 1,
    "instructor_name": "Dev Instructor One",
    "sessions_held": 12,
    "attended": 11,
    "excused": 0,
    "sessions_counted": 12,
    "rate_pct": 91.7
  },
  {
    "section_id": "00000000-0000-0000-0000-0000000000e3",
    "course_code": "ITS323",
    "course_name": "Computer Networks",
    "term": "2026-1",
    "section_no": 1,
    "instructor_name": null,
    "sessions_held": 12,
    "attended": 10,
    "excused": 1,
    "sessions_counted": 11,
    "rate_pct": 90.9
  }
]
```

`attended` counts `present` windows only. `sessions_counted` is `sessions_held − excused` (the second class: 12 − 1 = 11, and 10 / 11 = 90.9%). `instructor_name` is `string | null` (shown `null` in the second class). Errors: `401 UNAUTHENTICATED`.

### `GET /api/my/overview`

The Overview screen in one request: the overall rate, the rate per class, and my last 5 check-ins.

Response `200`:

```json
{
  "overall": { "sessions_held": 24, "attended": 21, "excused": 1, "sessions_counted": 23, "rate_pct": 91.3 },
  "classes": [
    {
      "section_id": "00000000-0000-0000-0000-0000000000e1",
      "course_code": "ITS332",
      "course_name": "Database Systems",
      "section_no": 1,
      "sessions_held": 12,
      "attended": 11,
      "excused": 0,
      "sessions_counted": 12,
      "rate_pct": 91.7
    },
    {
      "section_id": "00000000-0000-0000-0000-0000000000e3",
      "course_code": "ITS323",
      "course_name": "Computer Networks",
      "section_no": 1,
      "sessions_held": 12,
      "attended": 10,
      "excused": 1,
      "sessions_counted": 11,
      "rate_pct": 90.9
    }
  ],
  "recent_checkins": [
    {
      "class_session_id": "…",
      "section_id": "…",
      "course_code": "ITS332",
      "course_name": "Database Systems",
      "recorded_at": "2026-10-26T02:03:11.000Z",
      "method": "qr"
    }
  ]
}
```

- `overall` adds up all my classes and then applies the same rule once: `sum(attended) / (sum(held) − sum(excused))`, and `sessions_counted` is `sum(held) − sum(excused)`. In the example: held 12 + 12 = 24, attended 11 + 10 = 21, excused 0 + 1 = 1, counted 24 − 1 = 23, and 21 / 23 = 91.3%. It is **not** the average of the per-class rates (a class with 4 windows would count as much as one with 40); this is decided. `rate_pct` is `null` when there is nothing to divide by.
- `classes` is the same data as `GET /api/my/classes` without the instructor and term (the Overview screen doesn't show them), including `sessions_counted`.
- `recent_checkins` are my **last 5 `present` rows, newest first** (fewer if I have fewer). `method` is `qr` or `manual`, so the screen can tell "you checked in" from "your instructor marked you". An excused mark is not a check-in and is not listed.

Errors: `401`.

### `GET /api/my/classes/:section_id/sessions`

Class detail: all the check-in windows of one class I'm in, newest first, with what happened to me in each.

Response `200`:

```json
{
  "class": {
    "section_id": "…",
    "course_code": "ITS332",
    "course_name": "Database Systems",
    "term": "2026-1",
    "section_no": 1,
    "instructor_name": "Dev Instructor One",
    "sessions_held": 12,
    "attended": 11,
    "excused": 0,
    "sessions_counted": 12,
    "rate_pct": 91.7
  },
  "sessions": [
    {
      "class_session_id": "…",
      "opened_at": "2026-10-26T02:00:00.000Z",
      "is_open": false,
      "status": "present",
      "method": "qr",
      "recorded_at": "2026-10-26T02:03:11.000Z"
    },
    {
      "class_session_id": "…",
      "opened_at": "2026-10-19T02:00:00.000Z",
      "is_open": false,
      "status": "absent",
      "method": null,
      "recorded_at": null
    }
  ]
}
```

`status` is `present`, `excused` or `absent` (absent = no row); `method` and `recorded_at` are `null` when absent. `class` is the same line as in `GET /api/my/classes` (including `sessions_counted`, and `instructor_name` as `string | null`), so the header of the screen needs no second request. `:section_id` is checked as an id (`400 BAD_REQUEST`).

Errors: `400`, `401`, `403 FORBIDDEN`: you are not enrolled in that section. The same code is sent when the id doesn't exist, so nobody can probe which ids are real.

### How it is built

- **Views** (migration, `security_invoker = true` like the P4 views, so RLS still applies): `v_section_attendance_rate` already has one line per enrolled student and section with `sessions_held`, `attended`, `excused` and `rate_pct`, plus a new column `sessions_counted` (`sessions_held − excused`, added at the end of the view), so My classes and `classes` reuse it with `WHERE student_id = <me>`, joined to `sections` and `courses` for the course code, name and term. The windows list reuses `v_session_roster` with `opened_at` and `is_open` added at the end. A small new view gives the overall line and the last 5 check-ins.
- **Code:** `api/src/student/` with `studentStore.ts` (every query in `withUser`) and `routes.ts`, in the same style as `api/src/reports/`, plus tests (a fake-db route test, and database tests that run as a real student under RLS: only my own rows, excused handling, a student of another section gets `403`, no GPS fields in any reply).

### Decided

Decisions from Yayikast's review of this PR (Yayikast approved the contract):

1. **Instructor name: option (a), a narrow `SECURITY DEFINER` function.** Today a student cannot read the instructor's `users` row: the `users_select` policy only lets you see yourself and students you teach. So the name comes from a function owned by `rls_definer` (with `SET search_path = pg_catalog, private`) that returns only the name, and only for a section the caller is enrolled in. `instructor_name` is **nullable** in the contract (`string | null`), so the screens leave the name out when there is none. The function is a permissions change: **when it is built in step 2 it goes to Yayikast for review** before it merges.
2. **Overall rate: pooled** across classes (as written above), so it follows the same rule as the rate per class. **boeingxd still has the final say on this one.**
3. **Open windows still count in "held"**, so a student's rate is the same number their instructor sees, and goes up straight away when they check in. The "Open now" row explains the dip to everyone else.

## Rosters, reports and manual marks (P4)

Again only the instructor of that section may use these. **Absent is never stored**: a student is absent when they are enrolled but have no attendance row. The roster and report come from SQL views (`v_session_roster`, `v_section_attendance_rate`), so the browser only shows what it is given and never counts anything itself.

### `GET /api/class-sessions/:id/roster`

Every enrolled student for one window, with their status, plus the counts for the summary screen.

Response `200`:

```json
{
  "counts": { "enrolled": 30, "present": 21, "excused": 2, "absent": 7 },
  "students": [
    {
      "student_id": "…",
      "student_no": "6722780001",
      "full_name": "Somchai Jaidee",
      "status": "present",
      "method": "qr",
      "recorded_at": "2026-10-26T02:03:11.000Z"
    },
    {
      "student_id": "…",
      "student_no": "6722780002",
      "full_name": "Malee Rakthai",
      "status": "absent",
      "method": null,
      "recorded_at": null
    }
  ]
}
```

`status` is `present`, `excused` or `absent`. `method` is `qr` or `manual`, and `null` when absent. There are no flags or warnings: the instructor decides by looking at the room. Students are sorted by student number.

Errors: `400`, `401`, `403`.

### `GET /api/sections/:id/report`

How often each student attended, over every window the section has held.

Response `200` (JSON, the default):

```json
[
  {
    "student_id": "…",
    "student_no": "6722780001",
    "full_name": "Somchai Jaidee",
    "sessions_held": 10,
    "attended": 8,
    "excused": 1,
    "rate_pct": 88.9
  }
]
```

`rate_pct` is `attended ÷ (sessions_held − excused)`, so an excused session never counts against a student. It is `null` when there is nothing to divide by (no sessions yet).

`GET /api/sections/:id/report?format=csv` sends the same table as a file download (`text/csv`, `Content-Disposition: attachment`) that opens in Excel or Google Sheets, Thai names included. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so a malicious name can't run as a spreadsheet formula.

Errors: `400` (bad id, or `format` is not `json` or `csv`), `401`, `403`.

### `POST /api/class-sessions/:id/attendance`

The instructor sets a student's status for a window by hand. This is how students are excused, and how a missed scan is fixed. It works whether the window is open or closed.

Request body: `{"student_id": "<uuid>", "status": "present" | "excused"}`

It stores `method = 'manual'` and `recorded_by` = the instructor. If the student already has a row (for example a QR check-in), it is replaced and the old distance is dropped. Doing the same mark twice is fine.

Response `200`:

```json
{
  "class_session_id": "…",
  "student_id": "…",
  "status": "excused",
  "method": "manual",
  "recorded_at": "2026-10-26T04:00:00.000Z",
  "recorded_by": "…"
}
```

Errors: `400` (including `status: "absent"`, which is not a status; to leave someone absent, don't mark them), `401`, `403`, `404 NOT_ENROLLED` (that student is not in this section).

## Live roster (B5)

How the instructor's roster updates without a refresh. Two hops: the database tells the API, and the API tells the browser.

**Hop 1: Postgres to the API (`LISTEN roster`).** A trigger on `api.attendance` (after every INSERT or UPDATE, migration `20261028090000_roster_notify.sql`) calls `pg_notify('roster', …)`. Postgres delivers it only when the transaction commits, so a refused or rolled-back check-in sends nothing. The message is text holding this JSON, ids and status only (no name, no email, no GPS):

```json
{ "class_session_id": "…", "student_id": "…", "status": "present" }
```

`status` is `present` or `excused`. It says "this row changed"; the roster endpoint above stays the source of truth, and the browser re-fetches the roster after a reconnect.

**Hop 2: the API to the browser (`/ws`).** A WebSocket (Caddy passes `/ws` to the API unchanged). The upgrade is refused before it starts, with a plain HTTP status:

- `401`: no login cookie (the cookie is sent with the upgrade; there is no token in the address).
- `403`: the `Origin` header is missing, or its host and port are not the `Host` header of the same request. "Our own site" is not a fixed list, because the Cloudflare Tunnel address changes on every restart. Browsers always send `Origin` on a WebSocket, so a page on another website can't open the socket with the visitor's cookie.

The browser then sends one message, once:

```json
{ "subscribe": "<class_session_id>" }
```

Only the instructor of that window's section is accepted (the same rule as the projector QR). **One socket watches one window**; to switch, open a new socket. The answers:

| Answer | Meaning |
|---|---|
| `{"subscribed": "<id>"}` | Accepted. |
| `{"error": "FORBIDDEN"}`, then the socket closes with code `4403` | Not the instructor of that window, or no such window: we don't say which. |
| `{"error": "BAD_REQUEST"}` | Not exactly `{"subscribe": "<uuid>"}`, or any message after the first valid `subscribe` (a repeat, or a second window). Refused without a database query, so a socket can't be used to load the database. |

**Limits.** A message over 1 KB closes the socket with code `1009` (the real one is about 60 bytes). If no valid `subscribe` arrives within 10 s of connecting, the server closes it with code `4408`, so an idle connection can't be held open for free.

After subscribing the browser receives:

| Message | When | What the browser does |
|---|---|---|
| `{"type":"roster","class_session_id":"…","student_id":"…","status":"present"}` | An attendance row of that window changed (hop 1) | Ask `GET …/roster` again |
| `{"type":"resync"}` | The API lost its database connection for a moment and got it back, so messages may have been missed | Ask `GET …/roster` again |

The API pings every 20 s and drops a socket that doesn't answer. `web/src/realtime.ts` reconnects after 1, 2, 4 … up to 30 seconds and asks for the roster again once it is back (it does not retry after `4403`); the roster screen also refreshes itself every 30 s as a safety net.

## Not decided yet

- **Clearing a mark.** `docs/SCREENS.md` shows a "Clear mark" action. Clearing means deleting an attendance row, and nobody can delete attendance today (no DELETE grant, on purpose). Adding it is a permissions change for Yayikast to review, so it is not part of P4.
