# Contributing to TurboPay

Thank you for your interest in contributing to TurboPay! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18+ or Bun
- PostgreSQL 16 (or Docker)
- Redis 7 (optional for dev)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/ifeanyiokomba/Turbocore.git
cd Turbocore

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes
│   │   ├── auth/           # Authentication routes
│   │   ├── admin/          # Admin routes
│   │   ├── cron/           # Cron job routes
│   │   └── ...             # Domain-specific routes
│   └── ...                 # Pages and layouts
├── components/             # React components
│   ├── turbopay/           # TurboPay-specific components
│   └── ui/                 # Shared UI components (shadcn)
├── hooks/                  # React hooks
├── lib/                    # Business logic
│   ├── turbocore/          # Platform services (39 modules)
│   └── turbopay/           # Application logic (27 files)
└── middleware.ts           # Next.js middleware
```

## Architecture Principles

### Domain-Driven Design

- **`src/lib/turbocore/`** — Platform-level services (provider abstraction, RBAC, billing, etc.)
- **`src/lib/turbopay/`** — Application business logic (auth, ledger, wallet, payments, etc.)

### Provider Abstraction

All external dependencies are expressed as interfaces. Business logic never depends directly on provider SDKs.

### Financial Integrity

- Double-entry ledger (every movement posts DEBIT + CREDIT)
- Immutable ledger entries (corrections use REVERSAL entries)
- Atomic database transactions
- Idempotent operations

## Code Style

### TypeScript

- Use strict TypeScript (`strict: true` in tsconfig)
- Prefer interfaces over type aliases for object shapes
- Use `readonly` for immutable data
- Avoid `any` type

### Naming Conventions

- Files: `kebab-case.ts` for utilities, `PascalCase.tsx` for components
- Variables/functions: `camelCase`
- Types/interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Database models: `PascalCase` (Prisma convention)

### File Organization

- One export per file for services
- Co-locate tests with source files (`__tests__/` directory)
- Keep components small and focused

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run src/lib/turbopay/__tests__/ledger.test.ts

# Run tests in watch mode
npx vitest watch
```

### Writing Tests

- Use Vitest for unit and integration tests
- Test one behavior per `it()` block
- Use descriptive test names
- Clean up test data in `afterAll`/`beforeEach`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("Feature name", () => {
  beforeAll(async () => {
    // Setup test data
  });

  afterAll(async () => {
    // Cleanup test data
  });

  it("should do something specific", async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting changes
refactor: code refactoring
test: adding tests
chore: maintenance tasks
```

Examples:
```
feat: add international transfer send route
fix: wire fee calculation into BillSwift pay route
docs: add API documentation for new endpoints
test: add advisory lock concurrent debit tests
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Write tests for new functionality
4. Run the test suite
5. Update documentation if needed
6. Submit a pull request with a clear description

## Architecture Decisions

When making significant architectural changes:

1. Document the decision in `docs/adr/` (Architecture Decision Records)
2. Explain the context, options considered, and rationale
3. Get review from at least one other contributor

## Security

- Never commit secrets or API keys
- Use environment variables for sensitive configuration
- Follow the security guidelines in `docs/architecture.md`
- Report security vulnerabilities privately to the maintainers

## Questions?

If you have questions about contributing, please open an issue or reach out to the maintainers.
