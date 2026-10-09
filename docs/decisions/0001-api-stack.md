# 0001. API stack: Node + TypeScript + Fastify, dbmate migrations

- Status: accepted
- Date: 2026-10-09

## Context
The team is new to backend work and already knows JavaScript from the React frontend. The load target (300 check-ins in 30s, about 10 requests/s) is small, so performance doesn't decide the language.

## Decision
- API: Node 22 + TypeScript + Fastify, zod for validation, `pg` for SQL, vitest for tests.
- Migrations: `dbmate`, with plain SQL files that each have an `up` and a `down` section.

## Alternatives considered
- **Go:** fast, with strong concurrency, but a new language to learn mid-project.
- **Python/FastAPI:** a third language in the repo.
- **Prisma Migrate:** hides the SQL, and the SQL is what we're graded on.

## Consequences
- One language for the frontend and backend, so types can be shared.
- We need discipline with types and with async error handling.
