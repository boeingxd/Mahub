# 0006. Privacy: never store raw GPS or IP addresses

- Status: accepted
- Date: 2026-10-09

## Context
The predecessor kept raw GPS forever. Thailand's PDPA expects data minimisation. We only need location and IP to make a decision at check-in time.

## Decision
- The server receives `lat, lng, accuracy`, calculates the distance to the room inside the check-in transaction, and stores only `distance_m` and `gps_accuracy_m`. The coordinates are thrown away.
- The IP is checked against `rooms.campus_cidrs` at request time, and only `on_campus` (true/false) is stored.
- Rate-limit counters live in memory and are never persisted.
- Caddy access logs (which contain IPs) are kept for 7 days.

## Consequences
- No retention or cleanup job is needed for the database.
- Fraud review can't see exact positions or cluster check-ins by IP. It works from distance, accuracy, on-campus status and the attempt history.
