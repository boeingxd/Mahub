# 0004. No device binding (no passkeys)

- Status: accepted
- Date: 2026-10-09

## Context
The original plan used WebAuthn passkeys to stop one phone checking in for several students. That's the most complex part of the plan, and it has gaps: passkeys sync between devices, a friend can register a new one, and lost phones need a recovery process.

## Decision
Identity relies on the user's Google account (ADR 0007). We assume students won't share their Google passwords. We don't build device binding.

## Consequences
- A large reduction in scope (no credential table, registration flow or recovery process).
- What still protects check-in: the QR rotates every 10s, the GPS geofence, single check-in per student, the short window the instructor controls, and the instructor's own visual check.
- Residual risk, documented in the threat model: a student who shares their Google password could be checked in by a friend who is in the room.
