# 0003. Hosting: Docker Compose + Caddy locally, VPS for the demo

- Status: accepted
- Date: 2026-10-09

## Context
Networking is graded and the app should work as a real project. Google login, phone GPS and secure cookies need a real HTTPS domain that phones can reach. The real-time roster needs a long-running server (WebSocket + Postgres LISTEN/NOTIFY).

## Decision
- **Development:** the whole stack (db, api, web, Caddy) runs locally with Docker Compose. Caddy is our own edge from day 1.
- **Phone testing during development:** a Cloudflare Tunnel gives the laptop a temporary public HTTPS address.
- **Staging/demo (M4):** the same Compose stack on a small VPS with a real domain.
- **Fallback:** if the VPS is too much, use Render or Railway. The app code doesn't change.

## Alternatives considered
- **Vercel:** easiest, but its serverless functions can't hold a WebSocket open, and Vercel owns the edge, so most of the networking work would disappear.
- **University VM:** free, but approval is uncertain and it may not be reachable from outside. Use it as a bonus if it's offered.

## Consequences
- The team learns some Linux/server basics in M4. Claude walks through it step by step.
- A small monthly cost for the VPS and a domain.
