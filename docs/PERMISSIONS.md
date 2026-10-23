# Permissions

Who may read and write what. The real rules are in `db/migrations/20261012120000_rls.sql` (task Y2), and `api/test/db/rls.test.ts` tests them. Change both together, and ask Yayikast to review.

## Database roles

| Role | Logs in? | Can |
|---|---|---|
| `postgres` | yes | Everything. Runs migrations (dbmate) and seeds. **Never used by the API**: it skips row-level security |
| `mahub_api` | yes | The API's user, a member of `app_rw`. Created by `npm run db:app-user` (password from `.env`) |
| `app_rw` | no | SELECT, INSERT, UPDATE on `api` tables (no DELETE), under row-level security |
| `app_ro` | no | SELECT on `api` tables, under row-level security |
| `auditor` | no | SELECT on `audit.events` only |
| `rls_definer` | no | Owns the `private` helper functions (BYPASSRLS, but only a few table rights) |
| `migrator` | no | Created by P1, not used yet |

The API refuses to start if its database user is a superuser or has BYPASSRLS (`assertRlsApplies` in `api/src/db.ts`).

## Who is asking?

Every API request that touches the database runs inside `withUser(pool, userId, fn)` (`api/src/db.ts`). It starts a transaction and sets `app.user_id`, which every policy reads through `private.current_user_id()`. **With no user id, every table looks empty.**

The exceptions are the moments before we know the user: sign-in (Y1) calls the `private.login_*` functions, which do only what the login policy (ADR 0007) needs, and a QR scan (Y3) calls `private.class_session_is_open()`, which only answers "is this check-in window open?".

## Row-level security, table by table

"Admin" means the user has the `admin` role in `user_roles`. Admins may read and write every table below except `checkin_attempts`, which they can only read.

| Table | Read | Write |
|---|---|---|
| `users` | yourself; an instructor sees the students in their sections | admin only (sign-in uses `private.login_*`) |
| `user_roles` | your own roles | **admin only** (old bug 1) |
| `students` | yourself; your instructors | admin only |
| `courses`, `rooms` | anyone signed in | admin only |
| `sections` | its instructor; its enrolled students | **admin only** (old bug 3) |
| `enrollments` | your own; the section's instructor | admin only |
| `class_sessions` | the section's instructor; its enrolled students | the section's instructor opens it (`opened_by` = themselves) and closes it (P3) |
| `attendance` | your own; the section's instructor | a student adds **only themselves**, `method = 'qr'`, `status = 'present'`, to an **open** window of their section (Y4). The instructor adds or changes `method = 'manual'` marks signed with `recorded_by` = themselves (P4) |
| `checkin_attempts` | your own; the section's instructor; admins | you add your own; nobody changes them |
| `audit.events` | `auditor` only | triggers only (P5); nobody can UPDATE or DELETE |

## Notes for other tasks

- **P3 (open/close):** run the INSERT and UPDATE on `class_sessions` inside `withUser(...)` as the instructor. Copy `location` and `radius_m` from `rooms` (anyone signed in may read rooms).
- **P4 (views):** create views with `WITH (security_invoker = true)`. Otherwise a view runs with its owner's rights and **skips RLS**, so a student could read everyone's attendance through it. Marking a student absent means deleting their row, and `app_rw` has no DELETE yet: we'll add a DELETE policy for the section's instructor when P4 needs it.
- **New tables:** RLS is off by default. Every new `api` table needs `ENABLE ROW LEVEL SECURITY`, policies, and a GRANT to `app_rw`/`app_ro` in the same migration.
