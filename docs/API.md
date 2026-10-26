# API contract

Every endpoint the demo needs: who may call it, what to send, what comes back. Built from task A1 (#24). **Only the instructor section below is written so far** (task P3). The auth, QR/check-in and live-roster sections are still to be added by their owners.

Caddy strips `/api` before the request reaches the API, so inside the API a route is `/my/sections`, but the browser calls `/api/my/sections`. Paths below are the browser's.

## Errors

One format for every error: `{"error": "CODE"}`. The code is for the screen to translate into words; we never send raw error messages (they can leak database details).

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | The request body or an id in the address isn't the right shape |
| 401 | `UNAUTHENTICATED` | Not signed in |
| 403 | `FORBIDDEN` | Signed in, but not the instructor of that section. Also sent when the id doesn't exist, so nobody can probe which ids are real |
| 404 | `ROOM_NOT_FOUND` | `room_id` is not a room |
| 404 | `NOT_ENROLLED` | The student you tried to mark is not in this section |
| 409 | `SESSION_ALREADY_OPEN` | That section already has an open check-in window |
| 409 | `SESSION_CLOSED` | The window is already closed |
| 429 | `RATE_LIMITED` | Too many requests. Per IP on every endpoint (300 a minute); per signed-in user on `/checkin/*` (5 a minute). See `docs/NETWORK.md` |
| 500 | `INTERNAL` | Our bug. Details are in the server log, never in the reply |

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

## Not decided yet

- **Clearing a mark.** `docs/SCREENS.md` shows a "Clear mark" action. Clearing means deleting an attendance row, and nobody can delete attendance today (no DELETE grant, on purpose). Adding it is a permissions change for Yayikast to review, so it is not part of P4.
- **A student's own rates.** The student screens (B6) need "my attendance per class". `v_section_attendance_rate` already holds it, but no student endpoint is written yet.
