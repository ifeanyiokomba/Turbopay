# TurboPay Developer Guide

## Getting Started

### Prerequisites
- Node.js 18+ or Bun
- PostgreSQL 16
- Redis 7 (optional for dev)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/ifeanyiokomba/Turbocore.git
cd Turbocore

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Start development server
npm run dev
```

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── auth/                 # Authentication (21 routes)
│   │   ├── admin/                # Admin portal (33 route groups)
│   │   ├── cron/                 # Background jobs (11 workers)
│   │   ├── v1/                   # Versioned API endpoints
│   │   └── [domain]/             # Domain-specific routes
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Landing page
├── components/                   # React components
│   ├── turbopay/                 # TurboPay-specific components
│   │   ├── views/                # Page views (22 modules)
│   │   └── parts/                # Shared UI parts
│   └── ui/                       # shadcn/ui components
├── hooks/                        # React hooks
│   └── use-passkey.ts            # WebAuthn client hooks
├── lib/                          # Business logic
│   ├── turbocore/                # Platform services (39 modules)
│   │   ├── providers/            # Provider abstraction
│   │   ├── events/               # Event bus + schema registry
│   │   ├── analytics/            # Analytics service
│   │   ├── configuration/        # Config management
│   │   ├── testing/              # Chaos testing
│   │   └── [domain]/             # Domain services
│   └── turbopay/                 # Application logic (27 files)
│       ├── auth.ts               # Session management
│       ├── ledger.ts             # Double-entry ledger
│       ├── wallet.ts             # Wallet operations
│       ├── payments.ts           # Payment orchestrator
│       ├── advisory-lock.ts      # PostgreSQL advisory locks
│       └── [utility]/            # Utilities
├── middleware.ts                 # Next.js middleware
└── db.ts                         # Prisma client
```

## Architecture Principles

### Domain-Driven Design
- **`src/lib/turbocore/`** — Platform-level services (provider abstraction, RBAC, billing)
- **`src/lib/turbopay/`** — Application business logic (auth, ledger, wallet, payments)

### Provider Abstraction
All external dependencies are expressed as interfaces. Business logic never calls providers directly.

```typescript
// Good: through provider registry
const bp = await providers.billPayment();
const result = await bp.pay(input);

// Bad: direct provider call
import { BaxiClient } from "baxi-sdk";
const client = new BaxiClient();
```

### Financial Integrity
- Double-entry ledger (every movement posts DEBIT + CREDIT)
- Immutable entries (corrections use REVERSAL)
- Atomic transactions with conditional updates
- Advisory locks for concurrent debit serialization

## Key Patterns

### Hold-Confirm-Reverse
```typescript
// 1. Hold: debit wallet + create PENDING transaction
// 2. Confirm: mark SUCCESS on provider success
// 3. Reverse: auto-reverse on provider failure
await executeProviderDebit({
  userId, walletId, type, amountKobo,
  providerCall: () => provider.pay(input),
});
```

### Event Publishing
```typescript
import { events } from "@/lib/turbocore/events";
await events.publish("payment.succeeded", { userId, transactionId, amountKobo });
```

### Rate Limiting
```typescript
import { rateLimit } from "@/lib/turbopay/rate-limit";
const limited = await rateLimit(req, { key: "login", limit: 10, windowMs: 60_000 });
if (limited) return limited;
```

## Testing

### Run Tests
```bash
npm test                    # All tests
npx vitest run src/lib/turbopay/__tests__/ledger.test.ts  # Specific file
```

### Writing Tests
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("Feature", () => {
  beforeAll(async () => { /* setup */ });
  afterAll(async () => { /* cleanup */ });
  
  it("should do something", async () => {
    // Arrange, Act, Assert
  });
});
```

## Code Style

- TypeScript strict mode
- Files: `kebab-case.ts` for utilities, `PascalCase.tsx` for components
- Variables/functions: `camelCase`
- Types/interfaces: `PascalCase`
- Database models: `PascalCase` (Prisma convention)

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add new feature
fix: bug fix
docs: documentation changes
test: adding tests
chore: maintenance tasks
```

## Common Tasks

### Add a New API Route
1. Create `src/app/api/[domain]/[route]/route.ts`
2. Import `requireUser()` or `requireAdmin()`
3. Add rate limiting with `rateLimit()`
4. Add to middleware `PROTECTED_API` list if needed

### Add a New Database Model
1. Add model to `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name <name>`
3. Update TypeScript types in `src/lib/turbopay/types.ts`

### Add a New Provider Adapter
1. Implement the provider interface in `src/lib/turbocore/providers/adapters/`
2. Register in `src/lib/turbocore/providers/registry.ts`
3. Add to `adapter-factory.ts` for DB-backed routing

### Add a New Cron Job
1. Create route in `src/app/api/cron/[job]/route.ts`
2. Add `x-cron-secret` authentication
3. Add to `vercel.json` crons section
4. Add Kubernetes CronJob manifest in `k8s/cronjobs/`

## Debugging

### Enable Debug Logging
```bash
DEBUG=turbopay:* npm run dev
```

### Check Health
```bash
curl http://localhost:3000/api/health
```

### View Audit Logs
```bash
curl http://localhost:3000/api/admin/audit?category=AUTH
```

### Database Queries
```bash
# Connect to database
docker compose exec postgres psql -U turbopay turbopay

# Check slow queries
SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```
