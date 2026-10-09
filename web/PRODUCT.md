# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Students** (SIIT undergraduates) on their own phones, in a lecture room. They have just scanned a projected QR code, and they want to be told, fast and unmistakably, that they are checked in. Outside class, they occasionally check their own attendance rate per class.
- **Instructors** on a laptop. They open a short check-in window for one of their sections and project the QR, then watch the roster fill in and close the window by hand.
- **The whole class, from the back of the room:** they read the projector screen at a distance.

## Product Purpose
Mahub records class attendance so that it's hard to fake. The server verifies a QR code that rotates every 10 s, the student's Google identity and enrollment, and that they're inside the room's geofence, all in one database transaction. The UI's job is to make that process feel instant for the student and legible for the instructor. Success for a student: "Done, I'm checked in" within seconds of scanning.

## Positioning
The QR changes every 10 seconds and the check-in is verified on the server, so attendance can't be faked by forwarding a photo. Raw GPS and IP addresses are never stored: only the distance to the room, the GPS accuracy, and an on-campus flag.

## Operating Context
- A short attendance moment in the middle of a class: the projector shows the QR and a live count, and 30–300 students scan within about 30 s.
- The instructor glances at the roster to see who hasn't checked in, and marks exceptions by hand.
- Courses are graded in Database Systems and Computer Networks. UI is the lowest-priority grade item, so screens stay plain and functional.

## Capabilities and Constraints
- **Flows** (routes in `src/App.tsx`, details in `docs/SCREENS.md`):
  - **Instructor:** sign in → My classes → live session (check-in / roster) → projector → session summary.
  - **Student:** QR → check-in → result; plus My classes, Overview and Class detail behind a bottom tab bar.
  - `/dev` lists every screen until sign-in works.
- **Data:** placeholder data comes from `src/fakeData.ts` until the API endpoints land (`docs/API.md`).
- **Strict CSP** (`default-src 'self'; img-src 'self' data:`): no inline scripts, no `style=""` attributes, nothing loaded from other origins. The app uses the device's system font, so no fonts are downloaded.
- **Attendance statuses:** present, excused, absent (absent means no row). There is no "late". Check-in errors use fixed codes (see `docs/SCREENS.md`).
- **Stack:** React 19 + Vite + plain CSS; no CSS framework.

## Brand Commitments
- The name is **Mahub**. Its mark is two stacked passes with a check (drawn in `HomePage.tsx`). SIIT/TU marks are not used without permission.
- The look follows Apple's apps (Wallet, Settings). See `CONCEPT.md`.
- The copy is plain and direct ("Checked in", "Share my location"), never punny.

## Evidence on Hand
- The fake sections in `src/fakeData.ts`: ITS332 Database Systems sec 1 (32 enrolled) and ITS323 Computer Networks sec 2 (28 enrolled).
- The fake roster: 4 students with 10-digit student numbers.
- The fake student classes with rates, history and recent check-ins, all fixed numbers.
- The error messages in `docs/SCREENS.md`.
- No real room codes, photos, or institutional assets yet. Don't invent them as fact; label placeholders.

## Product Principles
1. **The student's success moment is the product:** one action, then an unmistakable "done".
2. **Legible at distance and at a glance:** the projector is read from the back of the room, and the roster is scanned in seconds.
3. **Privacy is visible:** say plainly what is and isn't stored.
4. **Plain words over cleverness:** an error names the problem and the recovery.

## Accessibility & Inclusion
- WCAG AA contrast, touch targets of at least 44 px (Apple's minimum), and visible keyboard focus.
- Light and dark appearance follow the device.
- Respect `prefers-reduced-motion`.
- Names may be in Thai, so the font fallback must render Thai script.
