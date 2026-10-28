# Hosting: getting off the laptop

Written 28 Oct 2026. Two plans are on the table. Nothing here is decided yet: try them and keep the one that works better.

**Why:** today the stack runs on boeingxd's laptop behind a Cloudflare *quick* tunnel. The address changes on every restart (Google must re-register the callback each time), and it dies when the laptop sleeps or its network drops (`docs/NETWORK.md`, "Phone testing"). We want an address that stays the same and stays up without the laptop.

## Plan A: free VPS + free domain (keeps everything we built)

Same `docker compose` stack, moved to a small always-on server, reached through a Cloudflare **named** tunnel on our own domain. No code changes except one compose line.

**Where it's free:**

| Piece | Free from | Limit |
|---|---|---|
| Server (VPS) | Azure for Students: $100 credit, no card, school email | Credit runs out (B1ms, 2 GB: about 6 months). Shut it down after the course |
| Domain | GitHub Student Developer Pack: Namecheap `.me` free for 1 year (or Name.com / get.tech) | Paid after a year (about $20 for `.me`) |
| DNS, HTTPS front door, tunnel | Cloudflare free plan | — |

**Status (28 Oct):** Azure for Students is active (boeingxd). The GitHub Pack is approved; its offers unlock 72 hours after approval (about 30 Oct). Before that, a domain can be bought on Cloudflare instead (about $10 a year).

**Steps:**
1. Azure: create an Ubuntu 24.04 VM, size B1ms (or B2s), region Southeast Asia, SSH key login, inbound port **22 only** (the tunnel dials out, so 80/443 stay closed).
2. On the VM: install Docker, clone the repo, write `.env` (never in git), `docker compose up -d --build`, then dbmate, the seed, `npm run db:app-user`, `npm run db:dev-instructor`. Today's local-only demo room and section 2 changes have to be re-added.
3. Until the domain is ready, a quick tunnel on the VM already works (it doesn't sleep), but the address still changes if the tunnel restarts.
4. Domain: claim it from the Pack, add it to Cloudflare (free plan), set the two Cloudflare nameservers at the registrar, wait for "Active".
5. Cloudflare → Zero Trust → Tunnels: create a named tunnel pointing to `http://caddy:8080`. In `docker-compose.yml` change the tunnel command from `--url http://caddy:8080` to `tunnel run --token ${TUNNEL_TOKEN}`, with `TUNNEL_TOKEN` only in the server's `.env`.
6. Yayikast registers `https://<domain>/api/auth/callback` in Google, once.

**Good:** always on, fixed address, no code rewrite, every graded networking piece stays (Caddy, our WebSocket hub, `LISTEN`/`NOTIFY`, rate limits), plus real DNS and a closed firewall to talk about.
**Costs:** we run a server (SSH, updates, `.env` on it, backups). It changes ADR 0003/0008 ("no VPS"), so write a short ADR if we keep it.

## Plan B: Cloudflare-only (cut things down)

Being discussed by boeingxd and a friend: host on Cloudflare (Pages for the web app, Workers for the API) and accept losing the networking parts of the grade.

**What has to change:**

| Piece | Now | On Cloudflare |
|---|---|---|
| Web app | Built into the Caddy image | Cloudflare Pages (easy, static files) |
| API | Fastify, a long-running Node server | Rewrite for Workers (for example Hono); Fastify doesn't run there |
| Live roster | Our `/ws` hub + Postgres `LISTEN` | Durable Objects, new code. `LISTEN` likely doesn't work through Hyperdrive (unverified) |
| Database | Our Postgres + PostGIS in Docker | Must move to a hosted Postgres (Neon or Supabase), reached through Hyperdrive. Roles (`mahub_api`, `app_rw`), RLS and migrations set up again there |
| Rate limits | In the API's memory + Caddy | Durable Objects or KV, or Cloudflare's own rules |
| Caddy, TLS, headers, client-IP trust | Ours | Gone: Cloudflare does it |

**Good:** always on, no server to run, free tier, Cloudflare's edge in front.
**Costs:** days of rewriting, every invariant in `CLAUDE.md` re-proved on a new runtime (one-transaction check-in, RLS, no superuser at runtime), and most of the Computer Networks demo (steps 4 and 11–13 in `docs/DEMO.md`) disappears. The database still has to live somewhere always-on, so it is still two services, not one.

For comparison, the predecessor (`boeingxd/Attendance`) and `cheatsheets.npwitk.com` both work this way: a static site (Vercel) plus rented services for the parts with a server (Supabase; Google Cloud Run + Stream). Vercel itself never ran their live updates.

## Not chosen

- **Vercel:** no WebSocket server and no Docker; same rewrite as Plan B with fewer pieces available.
- **Named tunnel on the laptop:** fixed address, but the laptop still has to stay awake and online.
- **Google Cloud Run:** runs our API container and supports WebSockets, but needs exactly one instance kept running (for `LISTEN` and the in-memory rate limit) and Cloud SQL for the database: more setup and cost than a VPS.
