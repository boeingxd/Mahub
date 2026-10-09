# The basics, in plain English

Read this once before you start. It explains the words the plan and the issues use. No prior backend experience needed.

---

## 1. The big picture: what happens when a student checks in

```
Phone ──► Cloudflare Tunnel ──► Caddy ──► API ──► Database
(browser)  (public address)     (door)    (brain)  (memory)
```

1. The student's **browser** sends a request: "I'm at these coordinates, check me in."
2. **Cloudflare Tunnel** gives our laptop a public web address, so a phone anywhere can reach it.
3. **Caddy** is the front door. It handles HTTPS (the padlock), adds security headers, and passes the request inward.
4. The **API** is our TypeScript program. It decides: is this QR valid? Is this student enrolled? Are they in the room?
5. The **database** remembers everything: who's enrolled, who's present, every attempt.

The API answers, and the browser shows "You're checked in". At the same moment the database tells the API "new attendance row", and the API pushes it to the instructor's screen over a **WebSocket**.

---

## 2. The database

### What is it?
A program whose only job is to **store data safely and answer questions about it**. We use **PostgreSQL** ("Postgres"). Data lives in **tables**, like spreadsheets:

`api.students`

| user_id | student_no |
|---|---|
| 3f2a…   | 6722782164 |
| 9b1c…   | 6722780001 |

- A **row** is one thing (one student). A **column** is one fact about it.
- You talk to it in **SQL**: `SELECT student_no FROM api.students;`

### Where does it live?
On **your laptop**, inside a **Docker container** (see §4). Each of us has our own copy with fake data, so we can't break each other's work. For the demo, one laptop runs everything and the tunnel makes it reachable.

The actual data is saved in a **Docker volume** (a folder Docker manages). Stopping the container doesn't lose data; `docker compose down -v` deletes it (a fresh start).

### Keys and constraints: the database protecting itself
- **Primary key (PK):** the column(s) that uniquely identify a row. `attendance` has PK `(class_session_id, student_id)`, so a student **cannot** be marked present twice in one session, even if two requests arrive at the same instant.
- **Foreign key (FK):** "this value must exist in that other table". `enrollments.student_id` must be a real student.
- **CHECK constraint:** a rule on values. `student_no ~ '^[0-9]{10}$'` means "exactly 10 digits", so junk is rejected by the database itself, even if the API has a bug.
- **Index:** like a book's index; makes lookups fast.

### Views
A **view** is a saved query you can read like a table. `v_session_roster` joins enrollments with attendance and labels everyone as present, excused or **absent** (absent = enrolled but no attendance row). Reports read views, so the logic lives in one place.

### Transactions
A **transaction** groups several steps into one all-or-nothing unit (`BEGIN … COMMIT`). Check-in is: verify → insert attendance → log the attempt. If anything fails halfway, **nothing** is saved. No half-finished check-ins.

### Triggers
A **trigger** is code the database runs automatically when a row changes. We use one to write an audit log, and one to announce "new attendance" (`NOTIFY`) for the live roster.

---

## 3. Migrations

A **migration** is a SQL file that changes the **shape** of the database: create a table, add a column, add a rule. Example `db/migrations/20261012_create_courses.sql`:

```sql
-- migrate:up
CREATE TABLE api.courses (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

-- migrate:down
DROP TABLE api.courses;
```

- `up` makes the change; `down` undoes it.
- `dbmate up` runs every migration you haven't run yet, in order. `dbmate rollback` undoes the last one.
- Migrations are committed to git, so **all three laptops (and the demo laptop) get exactly the same tables** by running one command.

Think of them as **git commits for the database's structure**. The old app broke because tables were created by clicking in a web dashboard, and nobody could rebuild them. Rule: **never change tables by hand**; always write a migration.

Migrations change the *shape*. **Seeds** (`db/seeds/`) fill in fake *data* (students, courses) so there's something to look at.

---

## 4. Docker and Docker Compose

- A **container** is a sealed box with a program and everything it needs. The Postgres container has Postgres already installed and configured, so nobody installs it by hand.
- **Docker Compose** starts several containers together from one file, `docker-compose.yml`: `db`, `api`, later `caddy` and `web`.
- Containers talk to each other by **service name**: the API connects to host `db`, not `localhost`.

| Command | What it does |
|---|---|
| `docker compose up -d` | Start everything in the background |
| `docker compose ps` | What's running, and is it healthy? |
| `docker compose logs api` | Read a service's logs |
| `docker compose stop db` | Stop one service (data kept) |
| `docker compose down -v` | Stop everything and **delete the data** |

---

## 5. The API

The **API** is a program that waits for **HTTP requests** and sends back **responses** (usually JSON).

```
GET  /api/me                 → {"email": "...", "roles": ["student"]}
POST /api/checkin/complete   body {"lat": 14.07, "lng": 100.61, "accuracy": 12}
                             → {"result": "present"}
```

- **Method + URL** say what you want: `GET` reads, `POST` does something.
- **Status codes:** 200 OK, 400 bad input, 401 not logged in, 403 not allowed, 503 not ready.
- **zod** checks every request body. `lat: "x"` is rejected before it gets near the database.
- A **connection pool** keeps a few database connections open and lends one to each request (opening a new one every time is slow).
- `docs/API.md` lists every endpoint. Screens and server are built against it in parallel.

---

## 6. The network

- **localhost / 127.0.0.1** means "this computer". `localhost:3000` is port 3000 on your own laptop.
- A **port** is a numbered door on a computer. Postgres listens on 5432, our API on 3000, HTTPS on 443.
- **HTTPS** encrypts traffic. Phones **refuse to give GPS** to a page that isn't HTTPS, and secure cookies need it too.
- **Caddy** is a **reverse proxy**: the single front door. It does HTTPS, adds **security headers** (rules telling the browser what's allowed), and forwards `/api` to the API and everything else to the web app. Only Caddy is reachable from outside.
- **X-Forwarded-For:** because Caddy forwards requests, the API would only see Caddy's address. Caddy adds this header with the real client IP. We use it for rate limits, then throw it away (never stored).
- **Cloudflare Tunnel:** a program on the laptop that connects out to Cloudflare and gets a public `https://…trycloudflare.com` address. Phones on mobile data can reach the laptop with real HTTPS.
- **WebSocket:** a normal request is ask → answer → done. A WebSocket stays **open**, so the server can push "new check-in!" to the instructor's screen the moment it happens.
- **Rate limit:** "at most 5 check-in requests per minute per user", which stops scripts hammering the server.

---

## 7. Security words

- **Authentication** = who are you? (Google sign-in.) **Authorization** = what may you do? (roles + ownership.)
- **Role:** student, instructor or admin, stored in `user_roles`. Roles are never guessed from an email (ADR 0007).
- **Database roles** are different: they're *login accounts for programs*. The API connects as `app_rw`, which can read and write data but can't change tables or bypass security.
- **Row-level security (RLS):** rules **inside the database** that filter rows per user. Even if the API has a bug, a student's query only ever sees their own rows, and only admins can insert into `user_roles`. The API tells the database who's asking with `SET LOCAL app.user_id = '…'` at the start of each transaction.
- **HMAC:** a signature made with a secret key. The QR token is `HMAC(secret, session + time window)`. Only the server knows the secret, so nobody can forge a valid QR, and it expires after ~20 seconds.
- **Cookie (HttpOnly):** a small value the browser sends back automatically. HttpOnly means page JavaScript can't read it, so a malicious script can't steal it.

---

## 8. How we work with git

1. `git checkout main && git pull`: get the latest.
2. `git checkout -b <your-username>/<topic>`: a branch for your task.
3. Make the change, run the checks from the issue, `git commit`.
4. `git push -u origin <branch>`, then open a **pull request (PR)** with `Closes #<issue>` in the description.
5. A teammate reviews, you merge, and the issue closes itself.

With Claude Code: open the repo and say **"work on issue #N"**. It reads the issue and this plan, explains the idea, builds it with you, and tells you how to check it works.
