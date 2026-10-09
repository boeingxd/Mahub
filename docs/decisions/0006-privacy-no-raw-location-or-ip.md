# 0006. Privacy: never store raw GPS or IP addresses

- Status: accepted
- Date: 2026-10-09

## Context
The predecessor kept raw GPS forever. Thailand's PDPA expects data minimisation. We only need location and IP to make a decision at check-in time.

## Decision
- The server receives `lat, lng, accuracy`, calculates the distance to the room inside the check-in transaction, and stores only `distance_m` and `gps_accuracy_m`. The coordinates are thrown away.
- The IP is used only for rate limiting, in memory, and is never stored. There is no "on campus" check or flag (dropped 2026-10-10: students may use mobile data, and we don't have SIIT's address ranges).
- Rate-limit counters live in memory and are never persisted.
- Caddy access logs (which contain IPs) are kept for 7 days.

## Consequences
- No retention or cleanup job is needed for the database.
- Fraud review can't see exact positions or cluster check-ins by IP. It works from distance, accuracy and the attempt history.
