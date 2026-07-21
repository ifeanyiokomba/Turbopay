# ⚠️ DEPRECATED — This directory is no longer the primary codebase

**Date:** 2026-07-20

## What happened

The `src/` directory was the original standalone SDK prototype for TurboPay. It has been **superseded by the Next.js application** at `turbopay-complete-latest/`, which is the production codebase.

## Why it was deprecated

| Concern | `src/` (SDK) | `turbopay-complete-latest/` (Next.js) |
|---------|-------------|----------------------------------------|
| **Storage** | In-memory `Map<>` + JSON files | PostgreSQL via Prisma ORM |
| **Auth** | In-memory sessions, no refresh tokens | Prisma sessions, refresh tokens, iframe tokens, MFA, passkeys |
| **Providers** | 13 adapter classes | 27 adapters in TurboCore registry |
| **Circuit Breaker** | In-memory, single-instance | Redis-backed, distributed |
| **Ledger** | In-memory double-entry | Prisma double-entry with OCC, advisory locks |
| **AML/Fraud** | None | Full AML engine, fraud detection, velocity checks |
| **UI** | None (API only) | Full React 19 + Next.js 16 app |
| **Tests** | 130 tests | Vitest suite (in progress) |

## What was ported

Before deprecation, the following unique utilities were ported to the Next.js app:

| Utility | From | To |
|---------|------|----|
| `toMinorUnits(amount, currency)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/money.ts` |
| `fromMinorUnits(amount, currency)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/money.ts` |
| `formatAmount(amount, currency)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/money.ts` |
| `validateBVN(bvn)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/crypto.ts` |
| `validateNIN(nin)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/crypto.ts` |
| `validateEmail(email)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/crypto.ts` |
| `validatePhoneNumber(phone)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/crypto.ts` |
| `maskCardNumber(card)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/mask.ts` |
| `maskAccountNumber(acct, n)` | `src/utils/crypto.ts` | `turbopay-complete-latest/src/lib/turbopay/mask.ts` |

## What should NOT be done

- Do NOT add new features to `src/`
- Do NOT fix bugs in `src/` (use the Next.js app instead)
- Do NOT import from `src/` in the Next.js app

## What CAN still be done

- Run existing tests: `npx jest` (from project root)
- Use as reference for provider API integration patterns
- Extract provider adapter logic if needed for new TurboCore adapters

## Migration guide

If you have code that imports from `src/`:

```typescript
// OLD (SDK)
import { hashPassword } from './src/utils/crypto';
import { validateBVN } from './src/utils/crypto';
import { maskCardNumber } from './src/utils/crypto';

// NEW (Next.js app)
import { hashPassword } from '@/lib/turbopay/crypto';
import { validateBVN } from '@/lib/turbopay/crypto';
import { maskCardNumber } from '@/lib/turbopay/mask';
```
