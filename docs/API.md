# API contract

Every endpoint the demo needs: who may call it, what to send, what comes back. Built from task A1 (#24). Written so far: sign-in, the QR and student check-in, the instructor endpoints and the live roster (WebSocket, proposed). The student endpoints are still to be added.

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

## Live roster (WebSocket) (B5)

The instructor's roster updates the moment a student checks in or is marked by hand, without asking again. **Proposed in task A1 (#24); boeingxd (builds `/ws`) and Yayikast (security) still need to approve it.**

How it flows: a trigger on `api.attendance` calls `pg_notify('roster', …)` after every INSERT or UPDATE. The API holds one dedicated database connection that runs `LISTEN roster`, and forwards each message to the browsers subscribed to that window. The database never talks to a browser directly.

### The Postgres NOTIFY payload

Channel `roster`, payload is JSON text (Postgres limits it to 8000 bytes; this one is about 200):

```json
{
  "class_session_id": "…",
  "student_id": "…",
  "status": "present",
  "method": "qr",
  "recorded_at": "2026-10-26T02:03:11.000Z"
}
```

`status` is `present` or `excused`, `method` is `qr` or `manual`. On purpose there is **no name, no distance and no GPS** in it: a NOTIFY goes to every listener, and the browser already has the names from `GET /api/class-sessions/:id/roster`. Absent is never sent, because absent is never stored.

### `GET /ws` (WebSocket upgrade)

- **Who:** a signed-in user. The browser sends its normal session cookie with the upgrade; there is no token in the address. No cookie: the server closes the socket with code `4401`.
- **Origin check:** the server refuses an upgrade whose `Origin` header is not our own site (close code `4403`), so another website can't open the socket with the visitor's cookie. "Our own site" is not a fixed list, because the Cloudflare Tunnel address changes every restart: the server compares the **host (and port) of `Origin` with the `Host` header of the same request**, and they must be equal. Caddy passes `Host` through unchanged, so this works for `localhost` and for any tunnel address. A request with no `Origin` header is refused too (browsers always send one on a WebSocket upgrade).
- **Caddy** already forwards `/ws` to the API with the path unchanged (no `/api` prefix).

**Browser to server.** One kind of message, sent after connecting (and again after every reconnect):

```json
{ "subscribe": "<class_session_id>" }
```

Allowed only if the signed-in user is the instructor of that window's section (checked in `withUser`, the same rule as the roster). If not, the server sends `{"error": "FORBIDDEN"}` and closes with `4403`; it does not say whether the id exists. A malformed message gets `{"error": "BAD_REQUEST"}` (zod-checked). One socket subscribes to one window; to switch, open a new socket.

**Limits on what the browser sends.** A message larger than **1 KB** is refused: the server closes the socket with code `1009` (message too big); the one real message is about 60 bytes. If no valid `subscribe` arrives within **10 s** of connecting, the server closes the socket with code `4408`, so an idle connection can't be held open for free.

**Server to browser.** JSON messages with a `type`:

| `type` | When | Fields |
|---|---|---|
| `subscribed` | The subscription was accepted | `class_session_id` |
| `roster` | A student was marked present or excused (the NOTIFY payload above, forwarded) | `class_session_id`, `student_id`, `status`, `method`, `recorded_at` |
| `closed` | The instructor closed that window (sent by the API itself when `POST /class-sessions/:id/close` succeeds, so it needs no database trigger) | `class_session_id` |
| `error` | See above | `error` (an error code from the table at the top) |

The screen updates the one student named in a `roster` message and recalculates the counts itself from its roster list. (Counts shown on the screen are only for display; the summary page still reads them from the roster view.)

**Heartbeat.** The server sends a WebSocket ping every 20 s and drops a client that doesn't answer (browsers answer pings by themselves).

**Reconnecting.** Messages are not replayed. The browser reconnects after a drop, waiting 1 s, 2 s, 4 s … (at most 30 s) between tries. After each successful reconnect it sends `subscribe` again and then **fetches `GET /api/class-sessions/:id/roster` once**, so anything missed while disconnected shows up. Until the socket works, the screen may keep polling that endpoint (today it does, every 5 s).

## Not decided yet

- **Clearing a mark.** `docs/SCREENS.md` shows a "Clear mark" action. Clearing means deleting an attendance row, and nobody can delete attendance today (no DELETE grant, on purpose). Adding it is a permissions change for Yayikast to review, so it is not part of P4.
- **A student's own rates.** The student screens (B6) need "my attendance per class". `v_section_attendance_rate` already holds it, but no student endpoint is written yet.
