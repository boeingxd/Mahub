# 0005. Attendance window: no "late" status, no auto-close

- Status: accepted
- Date: 2026-10-09

## Context
Instructors open check-in only briefly, during the attendance part of the class. They don't need to measure lateness.

## Decision
- No `late` status. Attendance statuses are `present` and `excused`. **Absent means enrolled with no attendance row**, and a view derives it.
- The instructor opens and closes the window by hand. Nothing closes it automatically.
- The weekly schedule (`section_meetings`) is no longer needed for the core and becomes a stretch goal.

## Consequences
- A simpler schema and less M3 work.
- If an instructor forgets to close a session, it stays open. The GPS check still blocks remote students, and the UI should make the "Close" button obvious.
