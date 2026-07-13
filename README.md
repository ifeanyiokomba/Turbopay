# TurboPay

Consumer-facing fintech web application — a digital banking platform for everyday users.

> Like OPay, PalmPay, Kuda, Wise, or Revolut.

## Architecture

```
turbopay-complete-latest/    # Next.js 16 + React 19 + Prisma + PostgreSQL (THE APP)
src/                         # Payment orchestration SDK (DEPRECATED — being consolidated)
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
| Deployment | Vercel + Docker |

## Getting Started

```bash
cd turbopay-complete-latest
cp .env.example .env
# Fill in your DATABASE_URL, JWT_SECRET, and provider keys
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

## Running Tests

```bash
cd turbopay-complete-latest
# Tests require a PostgreSQL database (set DATABASE_URL in .env)
npx vitest run
```

## Security

See `audit4_src_report.md` for the full security audit. All critical and high severity issues have been fixed:
- Password hashing: SHA-256 → scrypt
- JWT_SECRET required (no fallback)
- CORS restricted to configured origins
- Rate limiting on all routes
- Webhook validation enforced
- Input validation on POST routes
- TLS/HTTPS support
- Credential files removed

## Documentation

- `research/turbopay-fintech/REPORT.md` — Research-backed strategic plan
- `STRATEGIC_BUILD_PLAN.md` — 6-phase execution roadmap
- `IMPROVEMENT_PLAN.md` — Pre-research improvement plan
- `audit4_src_report.md` — Security audit report
- `turbopay-complete-latest/docs/` — Architecture, API, security docs

## License

MIT
