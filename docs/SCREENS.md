# Screens

Every screen, who uses it, its URL, and the data it needs. Endpoint names are **provisional** until the API contract (`docs/API.md`, task A1) is agreed; update this table to match it.

Pages live in `web/src/pages/`. Shared components (Pass, List, Button, Badge, Card, Table, SegmentedControl, Stat, Layout, StudentLayout) live in `web/src/ui/`. Colours, fonts and spacing are in `web/src/ui/tokens.css`. The look is described in `web/CONCEPT.md` and `web/DESIGN.md`.

## The two flows

```
Instructor (laptop, mirrored to the projector)
  /  sign in ─▶ /instructor  My classes ─[Start check-in]─▶ /session/:id  Check-in | Roster
                                                              ├─[Present full screen]─▶ /projector/:id
                                                              └─[End session]─▶ /summary/:id

Student (phone)
  QR scan ─▶ /checkin ─(sign in if needed)─▶ [Share my location] ─▶ "Checked in" pass
  /  sign in ─▶ /student  My classes  ⇄  /student/overview      (bottom tab bar)
                    └─▶ /student/class/:id
```

After sign-in, the API sends instructors to `/instructor` and students to `/student`, or back to `/checkin` if they came from a QR (task Y1). There's no menu of screens: each screen leads to the next. Until sign-in works, `/dev` lists every screen with sample data.

## Instructor

| Screen | URL | Needs from the API | Built in |
|---|---|---|---|
| Sign in | `/` | link to `GET /api/auth/login` (redirects to Google) | B3, Y1 |
| My classes | `/instructor` | `GET /api/me` (name); my sections (course, name, section no, enrolled, room, **colour**, open session id if live); open a window → session id | B6, P3 |
| Live session | `/session/:id` | the session (section, started at); `GET /api/class-sessions/:id/qr` every 10 s; live count + roster (WebSocket); close the window | B6, Y3, B5, P3 |
| Projector | `/projector/:id` | same QR and count as the session; **no names** | B6, Y3, B5 |
| Session summary | `/summary/:id` | counts (enrolled, present, excused, absent) and roster from the report view; CSV export | B6, P4 |

The roster (student no, name, check-in time, status) appears on the session's **Roster** segment and on the summary. It is never shown on the projector.

- There are **no flags**: no "unusual GPS" and no "off campus" label. The instructor decides by looking at the room, and marks exceptions by hand.
- **Manual marks** (task P4): **Change** on a row → Mark present · Mark excused · Clear mark. API: set or clear a student's status for the session (`student_id`, `status`), stored with `method = 'manual'`. This is how students are excused (excuse requests were cut, ADR 0008).

## Student

| Screen | URL | Needs from the API | Built in |
|---|---|---|---|
| Check in | `/checkin` | the session from the scan (course, name, section, room, colour); browser location (`lat`, `lng`, `accuracy`) → `POST /api/checkin/complete`; a message per error code | B6, Y4 |
| My classes | `/student` | my classes with my rate (attended / held, from a report view), instructor, colour | B6, P4 |
| Overview | `/student/overview` | overall rate; rate per class; last 5 check-ins | B6, P4 |
| Class detail | `/student/class/:id` | my sessions for this class: date, present/absent, check-in time (24 h) | B6, P4 |

`/checkin?preview=done` shows the finished "Checked in" pass with sample data, for previews only.

## Other

| Screen | URL | Notes |
|---|---|---|
| Not registered | `/not-registered` | The API redirects here for `NOT_REGISTERED` (ADR 0007) |
| Screen previews | `/dev` | Temporary; delete once sign-in routes people by role |
| Not found | any other URL | |

Old links still work: `/login` → `/`, and `/roster/:id` → `/session/:id`.

## Error messages on the student screen

| Code | Message shown |
|---|---|
| `QR_EXPIRED` | "That QR code has expired. Scan the one on screen again." |
| `NOT_ENROLLED` | "You're not enrolled in this class." |
| `SESSION_CLOSED` | "Check-in for this class has closed." |
| `OUT_OF_RANGE` | "You seem to be outside the classroom. Move closer, or ask your instructor." |
| `ALREADY_PRESENT` | "You're already checked in." |
| `RATE_LIMITED` | "Too many tries. Wait a minute and try again." |

Location problems in the browser (blocked, unavailable) get a title and a recovery step; see `CheckinPage.tsx`.

## Rules
- Plain and functional. Mobile-first for every student screen.
- Every screen has a loading state, an error state and a done state.
- No inline `<script>` and no `style="..."` in HTML: Caddy's Content-Security-Policy blocks them. Use CSS classes in `web/src/ui/ui.css`.
- Use the system font only (nothing downloaded). Colours, sizes and spacing come from `web/src/ui/tokens.css`, with light and dark values.
- **Class colours identify a class, never a status.** Status is a small Badge.
- Never calculate reports in the browser; show what the API's views return.
