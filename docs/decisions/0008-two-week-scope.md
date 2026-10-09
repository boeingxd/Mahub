# 0008. Two-week scope

- Status: accepted
- Date: 2026-10-09

## Context
The original plan assumed 10 weeks, 16 tables and five milestones. We actually have 3 weeks and want a working demo in 2. The team is new to backend work, and the old tasks started with abstract concepts before anything could be seen working. The project is graded in **Database Systems** and **Computer Networks**, so what we keep must still show those skills.

## Decision
- **Timeline:** week 1 foundations, week 2 the full demo (due Fri 23 Oct), week 3 buffer and graded extras.
- **Tables 16 → 11.** Cut:
  - `terms`: a `term` text column on `sections`.
  - `auth_sessions`: an encrypted, HttpOnly session cookie (`@fastify/secure-session`). Amends ADR 0002.
  - `checkin_claims`: a signed, HttpOnly `scan` cookie that lasts 90 s carries the scan through the Google login. Double use is still impossible because `attendance` has `PRIMARY KEY (class_session_id, student_id)`.
  - `private.class_session_secrets`: one `QR_SECRET` in `.env`; the session id is part of the HMAC input, so tokens still differ per session.
  - `excuse_requests`: instructors mark a student excused by hand.
- **Kept for the Database Systems grade:** constraints, enums, a partial unique index, views, the check-in transaction, triggers (audit + NOTIFY), DB roles, RLS, PostGIS.
- **Kept for the Computer Networks grade:** Docker networking, Caddy (HTTPS, headers, reverse proxy), real client IP, WebSocket, Cloudflare Tunnel, rate limits, k6 load test.
- **Cut or postponed:** pgTAP (security tests are written in vitest against a real database), the VPS deploy (the demo runs on a laptop behind Cloudflare Tunnel; amends ADR 0003), CSV import (seed data instead).

## Consequences
- Logout can't revoke a session server-side: the cookie simply expires (8 h). Accepted for a class project.
- A student could copy their own `scan` cookie to a friend within 90 s. It's the same risk as forwarding a QR photo; the GPS check is the real defence.
- One test tool (vitest) instead of two.
- Old issues #6–#21 are closed and replaced with week-based issues (`[W1] P2 …`).
