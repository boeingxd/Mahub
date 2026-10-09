# Screens

Every screen in the demo: who uses it, its URL, and the data it needs. Endpoint names are **provisional** until the API contract (`docs/API.md`, task A1) is agreed; update this table to match it.

Pages live in `web/src/pages/`; shared components (Button, Card, Table, Badge, Layout) in `web/src/ui/`; colours and spacing in `web/src/ui/tokens.css`.

| Screen | URL | Who | Needs from the API | Built in |
|---|---|---|---|---|
| Home | `/` | anyone | none | B3 |
| Sign in | `/login` | anyone | link to `GET /api/auth/login` (redirects to Google) | B3, Y1 |
| Not registered | `/not-registered` | anyone | none (the API redirects here for `NOT_REGISTERED`) | B3, Y1 |
| My sections | `/instructor` | instructor | `GET /api/me`; my sections (course, section no, enrolled count); open a window (`room_id`) | B6, P3 |
| Projector | `/projector/:id` | instructor (on the projector) | `GET /api/class-sessions/:id/qr` every 10 s (`url`, `window`, `server_time`); live check-in count (WebSocket) | B6, Y3, B5 |
| Student check-in | `/checkin` | student | browser location (`lat`, `lng`, `accuracy`) → `POST /api/checkin/complete`; a message per error code | B6, Y4 |
| Live roster | `/roster/:id` | instructor | session roster (student no, name, status, risk flags); WebSocket updates; manual mark (`student_id`, `status`); close the window | B6, P4, B5 |

## Error messages on the student screen

| Code | Message shown |
|---|---|
| `QR_EXPIRED` | "That QR code has expired. Scan the one on screen again." |
| `NOT_ENROLLED` | "You're not enrolled in this class." |
| `SESSION_CLOSED` | "Check-in for this class has closed." |
| `OUT_OF_RANGE` | "You seem to be outside the classroom. Move closer, or ask your instructor." |
| `ALREADY_PRESENT` | "You're already checked in." |
| `RATE_LIMITED` | "Too many tries. Wait a minute and try again." |

## Rules
- Plain and functional (UI is the lowest priority). Mobile-first for the student screen.
- Every screen has a loading state, an error state and a done state.
- No inline `<script>` and no `style="..."` in HTML: Caddy's Content-Security-Policy blocks them. Use CSS classes in `web/src/ui/ui.css`.
- Never calculate reports in the browser; show what the API's views return.
