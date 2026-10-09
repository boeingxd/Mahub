# 0007. Login policy: who may sign in

- Status: accepted
- Date: 2026-10-09
- Refines: 0002 (replaces its "email domain check")

## Context
Students all have SIIT Google accounts whose email prefix is their student ID (e.g. `6722782164@g.siit.tu.ac.th`). Some instructors don't have SIIT accounts and use another Google account. A single "SIIT domain only" rule would lock those instructors out.

## Decision
After the server verifies the Google ID token (and `email_verified` is true), it applies three rules in order:

1. **Student email** (`^[0-9]{10}@g\.siit\.tu\.ac\.th$`): sign in. On first login, create the `users` row, the `students` row (`student_no` = the email prefix) and the `student` role if they don't already exist. A CSV enrollment import may have created them in advance.
2. **Email already registered by an admin** (any Google account): sign in. On first login, store the Google `sub` on the user. This is how instructors and admins get in.
3. **Anything else:** reject with "not registered".

- **The instructor and admin roles are never derived from an email.** Only an admin grants them, in `user_roles`.
- After the first login, users are matched by Google `sub` (stable), not by email.
- We don't send Google's `hd` parameter, because it would hide instructors' non-SIIT accounts in the account picker. The server-side rules above are the real check.
- The first admin is created by a seed script (dev) or a one-off SQL script run by `migrator` (prod).

## Consequences
- There is no domain CHECK on `users.email`. Correctness moves to the login code, which needs a test for each rule, including "a random Gmail is rejected" and "a SIIT student email doesn't get the instructor role".
- Admins need a small "register instructor" form (email + name), owned by postscrippt.
- A student who also teaches (e.g. a TA) can hold both roles.
