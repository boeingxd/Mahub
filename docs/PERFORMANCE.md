# Performance: indexes and `EXPLAIN ANALYZE` (task P6)

**Short version:** with a term's worth of data (50,857 attendance rows) every
important query already uses an index and finishes in under 1 ms, except the
two report views, which are slower because of row-level security (RLS), not
because of missing indexes. We tested the indexes the issue suggested: they
already exist, so this task adds **no new index**. Adding one that no query
needs would only slow down writes.

## How to read this (no database background needed)

- An **index** is like the index at the back of a book: Postgres jumps straight
  to the rows it needs.
- The slow alternative is a **Seq Scan** (sequential scan): reading the whole
  table row by row.
- `EXPLAIN ANALYZE <query>` runs a query and prints the plan Postgres used, with
  the real time of each step. We look for `Seq Scan` on big tables, and for
  `Index Scan`, `Index Only Scan` or `Bitmap Index Scan` (all three use an index).
- "Execution Time" below is the time of one run, taken after a warm-up run.
  Times on your laptop will differ a little; the plan shapes and the ratios
  should not.

## The test data

`db/seeds/bulk.sql` invents a busy term with `generate_series`:

| Table | Rows |
|---|---|
| students | 2,030 |
| sections | 23 (20 bulk, about 200 students each) |
| enrollments | 4,060 |
| class_sessions (attendance windows) | 300 (20 still open) |
| attendance | 50,857 |
| checkin_attempts | 59,847 |

**Reproduce it on a throwaway database** (never your everyday `mahub`):

```bash
docker compose exec -T db psql -U postgres -c "CREATE DATABASE mahub_perf"
dbmate --url "postgres://postgres:<password>@localhost:5432/mahub_perf?sslmode=disable" up
docker compose exec -T db psql -U postgres -d mahub_perf -v ON_ERROR_STOP=1 < db/seeds/seed.sql
docker compose exec -T db psql -U postgres -d mahub_perf -v ON_ERROR_STOP=1 < db/seeds/bulk.sql
```

Then put `EXPLAIN (ANALYZE, SUMMARY)` in front of any query below, in
`docker compose exec db psql -U postgres -d mahub_perf`. To see what the API
sees (RLS on), start the transaction like this first:

```sql
BEGIN;
SET LOCAL ROLE app_rw;
SELECT set_config('app.user_id', '<the user id>', true);
-- EXPLAIN ANALYZE ... here
ROLLBACK;
```

## 1. Queries that were already fast (every index is used)

Measured as the superuser (no RLS), so this is the raw cost of the query.

| # | Query | Plan | Time |
|---|---|---|---|
| Q1 | Roster of one window (`v_session_roster`, 200 students) | `Index Scan` on `class_sessions_pkey`, `Index Only Scan` on `enrollments_pkey`, `Index Scan` on `attendance_student_idx` | 3.0 ms |
| Q3 | Check-in: is the student enrolled in the section? | `Index Only Scan` on `enrollments_pkey` | 0.025 ms |
| Q4 | Check-in: is this window open? (by id) | `Index Scan` on `class_sessions_pkey` | 0.018 ms |
| Q4b | Which window is open in this section? | `Index Scan` on `class_sessions_one_open_per_section` (the partial unique index) | 0.012 ms |
| Q5 | Check-in: `INSERT INTO attendance ... ON CONFLICT DO NOTHING` | one insert into the table and its 3 indexes | 0.050 ms |
| Q6 | Check-in: `INSERT INTO checkin_attempts` | one insert | 0.46 ms |
| Q7 | A student's own history (22 rows out of 50,857) | `Bitmap Index Scan` on `attendance_student_idx` | 0.077 ms |
| Q8 | Every attempt in one window (192 of 59,847) | `Bitmap Index Scan` on `checkin_attempts_session_idx` | 0.078 ms |
| Q9 | Instructor dashboard (my sections, enrolled count, open window) | `Index Only Scan` on `enrollments_pkey`, `Index Scan` on the partial index (the 23-row `sections` table is read with a Seq Scan, which is correct for a table that small) | 0.31 ms |

The two `INSERT`s (Q5, Q6) also pay for their foreign-key checks: each is an
index lookup in the referenced table, 0.05 to 0.27 ms per check.

### The check-in as a student, with RLS on

The real check-in transaction (Y4) runs as the student, so we measured its
statements that way: enrollment and open-window check **0.69 ms**, geofence
`ST_DWithin` **6 ms** (the slowest step; it reads one window by primary key and runs a
PostGIS distance test, and we did not dig into why it costs more than the rest),
attendance insert **1.5 ms** (including the RLS check
and 3 foreign-key checks), log insert **0.62 ms**. About **9 ms** in total, far
below anything a student would notice.

## 2. Does each index earn its place? (before / after)

The tables already had the indexes the task suggests (`attendance(student_id)`,
`checkin_attempts(class_session_id, at)`). To show what they buy, we dropped
each one **inside a transaction that was rolled back** (so nothing really
changed), ran the query, and compared:

| Index | Query | Without it ("before") | With it ("after") | Speed-up |
|---|---|---|---|---|
| `attendance_student_idx` | Q7 student history | `Seq Scan`, reads all 50,857 rows, **3.48 ms** | `Bitmap Index Scan`, **0.077 ms** | 45x |
| `checkin_attempts_session_idx` | Q8 attempts per window | `Seq Scan`, reads all 59,847 rows, **3.92 ms** | `Bitmap Index Scan`, **0.078 ms** | 50x |
| `class_sessions_one_open_per_section` | Q4b open window of a section | `Seq Scan` of 300 rows, 0.074 ms | `Index Scan`, 0.012 ms | 6x (it also enforces "one open window per section") |
| `enrollments_pkey` | Q3 enrollment check | falls back to `enrollments_student_idx`, 0.064 ms | `Index Only Scan`, 0.025 ms | 2.5x (a second index covers for it) |

A Seq Scan's cost grows with the table: 3.5 ms now is about 35 ms with ten times
the data, while the index stays near 0.1 ms. That is the argument for keeping
them. Nothing was missing, so `db/migrations/` is unchanged by this task.

## 3. The slow part: the report views under row-level security

Measured as the instructor of the section, through `app_rw` with RLS on (this is
what the API really runs):

| # | Query | Time | Where the time goes |
|---|---|---|---|
| R1 | Roster of one window, 200 students | 27 ms | about 0.03 to 0.04 ms per row, spent calling the policy functions |
| R2 | Attendance rate of a whole section (200 students x 15 windows = 3,000 attendance lookups) | 100 to 125 ms | `attendance_select` calls `private.teaches_class_session(...)` for each of the 3,000 rows |
| R3 | `SELECT ... FROM attendance` as a student **without** `WHERE student_id = ...` | 4,560 ms (!) | a `Seq Scan` that calls the policy functions on all 50,857 rows |

For comparison, the attendance-rate view **without** RLS (superuser, Q2) takes
18.6 ms and is the one plan in this document with a `Seq Scan` on `attendance`
(a hash join reading all 50,857 rows to match the 3,000 it needs). That is the
planner choosing well for a query that touches many rows, not a missing index:
the primary key `(class_session_id, student_id)` is exactly the index it needs,
and under RLS, where it costs more to visit each row, the planner uses it.

Plans R1 and R2 do use indexes everywhere (`attendance_pkey`, `students_pkey`,
`enrollments_pkey` ...). The cost is the policy itself: policies like
`student_id = private.current_user_id() OR private.teaches_class_session(class_session_id)`
call a function once per candidate row.

What we tried, so nobody repeats it:

- **A covering index** `attendance (class_session_id, student_id) INCLUDE (status)`
  made R2 an `Index Only Scan`, but R2 went from 124 ms to 121 ms. Rejected: the
  time is in the function calls, not in finding the rows.
- **Wrapping the policy calls as `(SELECT private.current_user_id())` and
  `(SELECT private.has_role('admin'))`** so Postgres evaluates them once per
  query: R2 went from 111 ms to 100 ms (about 10%). Not worth a permissions
  change by itself, but see the follow-up below.

**What this means in practice**

- A roster (27 ms) and the full-term report (about 0.1 s) are fast enough for an
  instructor clicking a button or downloading a CSV.
- R3 is a warning, not a bug: always filter with `WHERE student_id = ...` (as Q7
  does: 0.18 ms under RLS) and never read `api.attendance` unfiltered as a
  student. The API's student history, when it exists, must filter.
- **Follow-up for Yayikast (RLS owner):** if reports ever feel slow, the lever is
  making `teaches_class_session` cheaper per row or evaluated once per distinct
  window rather than once per row. That is a permissions change, so it was not
  done here (working agreement: schema and permission changes need Security's review).

## 4. Checklist from the task

- [x] `db/seeds/bulk.sql` with about 2,000 students, 20 sections, 300 windows, about 50,000 attendance rows
- [x] `EXPLAIN ANALYZE` on the roster view, the attendance-rate view and the check-in queries (sections 1 and 3)
- [x] Missing indexes: none found (section 2); one candidate tried and rejected (section 3)
- [x] Every query that matters uses an `Index Scan`, `Index Only Scan` or `Bitmap Index Scan`, with the timings above (the one exception, Q2 without RLS, is explained in section 3)
