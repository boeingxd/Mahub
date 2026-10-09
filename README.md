# Mahub

**Take attendance in a university class in under 30 seconds, in a way that's hard to fake.**

The instructor shows a QR code on the projector. Students scan it with their phone, sign in with their SIIT Google account, and allow their location. A moment later they're checked in, and the instructor watches the list fill up live.

Mahub is the next version of [SIIT Smart Attendance](https://github.com/boeingxd/Attendance). It keeps the flow that worked and rebuilds the rest with the database, database security and networking as its strengths. It's a team project for **Database Systems** and **Computer Networks**.

> **New here? Read this page top to bottom.** Everything above "Run it locally" is for people. Everything below is for computers.

---

## The problem

Calling names or passing round a sheet of paper takes minutes, and it's easy to cheat: a friend signs for you, or a photo of the QR code gets sent to someone who isn't in the room. Mahub makes cheating hard and takes only seconds.

## How a class works

**The instructor** (on a laptop, mirrored to the projector)

1. Sign in with Google and open **My classes**.
2. Tap **Start check-in** on today's class.
3. Project the QR code. It changes every 10 seconds, so a photo of it stops working almost at once.
4. Watch the count and the roster fill in as students check in.
5. Fix anyone by hand: mark a student **present** (their phone died) or **excused** (an approved absence).
6. Tap **End session**. Anyone who didn't check in is absent. The summary shows who was there.

**The student** (on their phone)

1. Scan the QR code with the phone's camera.
2. Sign in with your SIIT Google account (the first time).
3. Tap **Share my location**.
4. Done: the class's pass slides up and says **Checked in**.

Students can also open Mahub any time to see their own attendance rate in each class.

```
 Instructor opens check-in
          │
          ▼
 Projector shows a QR code ──(changes every 10 s)
          │
          ▼
 Student scans ─▶ signs in ─▶ shares location
          │
          ▼
 The server checks everything, then records attendance
          │
          ▼
 Instructor's roster updates live ─▶ End session ─▶ Summary
```

## Why it's hard to cheat

The **server** decides everything. The phone only sends what it has: it can't say "mark me present". A check-in is accepted only if **all** of these are true:

| Check | What it stops |
|---|---|
| **The QR code is the current one** (it changes every 10 seconds) | Sending a photo of the code to a friend who isn't there |
| **Signed in with a real Google account.** Students need their SIIT account; instructors must be registered by an admin first | Anonymous check-ins, or someone typing a made-up name |
| **Enrolled in this class** | A student from another class checking in |
| **The check-in window is open** (the instructor opens and closes it) | Checking in after class |
| **The phone is inside the classroom** (checked against the room's location) | Checking in from the cafeteria |
| **Only one check-in per student per class** | Counting someone twice |

Every attempt, including failed ones, is logged, so the instructor can see what happened. If something goes wrong (a dead phone, a bad GPS fix), the instructor can mark the student by hand.

**What Mahub doesn't keep:** it works out how far you are from the room and throws your exact location away. It stores only the distance (and how accurate the phone's GPS was). It never stores IP addresses.

**What it can't stop:** a student who gives a friend their Google password, and that friend is in the room. We decided to trust SIIT Google accounts rather than lock check-ins to one phone. (See [ADR 0004](docs/decisions/0004-no-device-binding.md).)

## What each person sees

| Who | Screens |
|---|---|
| **Instructor** | My classes → live session (QR + count, and a roster) → full-screen projector view → session summary |
| **Student** | Check-in (after scanning) → "Checked in" pass; and My classes, Overview, and a page for each class with their own rate |
| **Admin** | Registers instructors (not designed yet) |

Every class has its own colour, and it stays the same on every screen. The full list of screens, and what each needs from the server, is in [docs/SCREENS.md](docs/SCREENS.md). **You can click through all of them with sample data at `https://localhost/dev`** once the app is running (see [Run the web app](#run-the-web-app)).

## How it's different from the old app

The old app worked, but it had real problems: a student could make themselves an admin, a GPS check could be skipped, and the database could only be rebuilt by hand. Mahub fixes each of them, and every fix gets a test that fails if the bug ever comes back. The list is in [PROJECT_PLAN.md](PROJECT_PLAN.md#2-lessons-from-the-old-app-each-gets-a-test).

## Where the project is

**Demo day: Friday 23 October.** The plan is 2 weeks of building plus 1 buffer week.

| Done (merged) | Not built yet |
|---|---|
| The database running in Docker | Google sign-in |
| A small server (the API) with health checks | The database tables |
| Caddy, the secure front door (HTTPS) | Generating and checking the QR codes |
| All the screens for both flows, with sample data | The check-in logic itself |
| | The live roster, and saving manual marks |

Right now the screens work but show made-up data. The work left is connecting them to a real database and a real check-in. The tasks are GitHub issues, one per person per step; see the **Issues** tab, or ask Claude Code *"what should I work on?"*.

## Who builds what

| Person | Owns |
|---|---|
| **boeingxd** | Networking and platform (Docker, Caddy, the tunnel, live updates, rate limits) and **all the screens** |
| **postscrippt** | The database design, seed data, the instructor's open/close and reports |
| **Yayikast** | Google sign-in, database security, the QR codes, the check-in itself, the threat model |

## Where to read next

| If you want to… | Read |
|---|---|
| Understand the words (database, API, Docker…) | [docs/BASICS.md](docs/BASICS.md), 15 minutes, no experience needed |
| See the full plan, week by week | [PROJECT_PLAN.md](PROJECT_PLAN.md) |
| See every screen and what it needs | [docs/SCREENS.md](docs/SCREENS.md) |
| Build a screen the right way | [web/DESIGN.md](web/DESIGN.md) |
| See how the pieces connect (network) | [docs/NETWORK.md](docs/NETWORK.md) |
| Know why we chose something | [docs/decisions/](docs/decisions/) (short decision records) |
| Work on code with Claude Code | [CLAUDE.md](CLAUDE.md) |

---

## Run it locally

Requirements: Docker Desktop, Node 22, [dbmate](https://github.com/amacneil/dbmate) (`brew install dbmate`).

```bash
cp .env.example .env     # then edit the password
docker compose up -d     # start Postgres + PostGIS
docker compose ps        # wait until db shows "healthy"
dbmate create            # create the "mahub" database
```

Connect to the database:

```bash
docker compose exec db psql -U postgres -d mahub
```

## Run the API

The API lives in `api/` (Node 22 + TypeScript + Fastify). There are two ways to run it.

**While coding** (restarts automatically when you save a file):

```bash
cd api
npm install              # first time only
npm run dev              # reads settings from ../.env
```

**In Docker, behind Caddy**, the way it runs for the demo:

```bash
docker compose up -d --build
docker compose ps        # api shows "healthy" once it can reach the DB
docker compose logs api  # JSON logs, one line per event
```

Caddy is the only way in: `https://localhost/api/...`. The API itself isn't published. The first time, trust Caddy's local certificate on your Mac (see [docs/NETWORK.md](docs/NETWORK.md#trust-caddys-certificate-on-your-mac-once)); until then, add `-k` to curl.

Check it:

```bash
curl https://localhost/api/healthz   # {"status":"ok"}: the process is up
curl https://localhost/api/readyz    # {"status":"ok"}: the database answers
docker compose stop db
curl https://localhost/api/readyz    # 503 {"status":"unavailable"}
docker compose start db
```

Other commands (run inside `api/`): `npm test` (vitest), `npm run lint` (TypeScript type-check), `npm run build` (compile to `dist/`).

## Run the web app

The React app lives in `web/`. In Docker, Caddy serves it at **https://localhost/**:

```bash
docker compose up -d --build caddy   # rebuild after changing web/
```

**While coding** (instant reload on save):

```bash
cd web
npm install              # first time only
npm run dev              # open http://127.0.0.1:5173 (not localhost, see web/vite.config.ts)
```

API calls from the dev server (`/api/...`) are forwarded to the Docker stack, so keep `docker compose up` running. Other commands in `web/`: `npm run build`, `npm run lint`. Screens are listed in [docs/SCREENS.md](docs/SCREENS.md).

