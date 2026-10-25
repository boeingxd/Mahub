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
| 409 | `SESSION_ALREADY_OPEN` | That section already has an open check-in window |
| 409 | `SESSION_CLOSED` | The window is already closed |
| 500 | `INTERNAL` | Our bug. Details are in the server log, never in the reply |

## Sections and check-in windows (P3)

A **check-in window** is a row in `class_sessions`. The instructor opens it by hand, students can check in while it's open, and the instructor closes it by hand. Nothing closes it automatically (ADR 0005). Only the instructor of a section can use these four endpoints.

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

## Not decided yet

- **Room list for the "open" screen.** Opening needs a `room_id`, so the screen needs the list of rooms (name + id). Rooms are readable by anyone signed in already, so `GET /api/rooms` would be a few lines. It is not part of P3 as written: boeingxd and postscrippt to agree whether to add it.
