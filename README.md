# TurboPay

Consumer-facing fintech web application — a digital banking platform for everyday users.

> Like OPay, PalmPay, Kuda, Wise, or Revolut.

## Architecture

```
turbopay-complete-latest/    # Next.js 16 + React 19 + Prisma + PostgreSQL (THE APP)
```

**The Next.js app (`turbopay-complete-latest/`) is the single source of truth.**

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind 4, shadcn/ui |
| Backend | Next.js API routes + server actions |
| Database | PostgreSQL 16 + Prisma |
| Cache | Redis |
| Auth | Custom + Passkeys (WebAuthn) + MFA |
| State | Zustand |
| Testing | Vitest + Testcontainers |
| Monitoring | Sentry |
| Deployment | Render (primary), Docker alternative |

## Getting Started

```bash
cd turbopay-complete-latest
cp .env.example .env
# Fill in your DATABASE_URL, JWT_SECRET, and provider keys
bun install
bunx prisma generate
bunx prisma migrate dev
bun run dev
```

## Running Tests

```bash
cd turbopay-complete-latest
bun run test   # auto-provisions an isolated local PostgreSQL and runs vitest
```

`bun run test` provisions a dedicated, isolated PostgreSQL cluster on port 5433
(`.testdb/`, git-ignored) and applies Prisma migrations automatically. Tests
**never** touch the production/dev/staging database — see
`turbopay-complete-latest/docs/test-database.md` for full details, including
how CI provisions its own PostgreSQL service container and how to reset or
troubleshoot the test database.

## Deployment

TurboPay deploys to **Render** via `render.yaml` at the repository root.

```
render.yaml → rootDir: turbopay-complete-latest
              buildCommand: bun install --frozen-lockfile && bun run db:generate && bun run build
              startCommand: bun .next/standalone/server.js
```

Docker deployment is also supported via `turbopay-complete-latest/Dockerfile`.

## Documentation

- `turbopay-complete-latest/docs/` — Architecture, API, security, deployment docs
- `turbopay-complete-latest/DEPLOYMENT.md` — Deployment guide

## License

MIT
