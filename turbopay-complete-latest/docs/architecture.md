# TurboPay Architecture

## Overview

TurboPay is a modern Nigerian fintech platform built on Next.js 16 with a domain-driven architecture. It operates as a financial platform with its own core domain model and provider abstraction layer, not a wrapper around payment APIs.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + TypeScript |
| Runtime | Bun |
| Database | PostgreSQL 16 |
| ORM | Prisma 6.11 |
| Cache | Redis 7 (ioredis) |
| UI | React 19, Radix UI, Tailwind CSS 4 |
| State | Zustand + TanStack React Query |
| Auth | Custom session-based (access + refresh tokens) |
| Monitoring | Sentry |
| Testing | Vitest |

## Architecture Principles

### Domain-Driven Design

The codebase follows a modular, domain-driven architecture with clear separation of concerns:

- **`src/lib/turbocore/`** — Platform-level services (39 modules): provider abstraction, RBAC, billing engine, reconciliation, events, compliance, referrals, rewards, vouchers, virtual cards, savings, investments, international payments, knowledge base, support, notifications, scheduled payments, statements, disputes, feature flags, fees, FX, cron locks, queue, outbox, analytics, configuration.

- **`src/lib/turbopay/`** — Application business logic (27 files): auth, ledger, wallet, payments, AML, PIN, crypto, MFA, rate limiting, CSRF, audit, idempotency, money, errors, API helpers, security headers, types, device info, OTP verification, pagination.

### Provider Abstraction

All external dependencies are expressed as interfaces. TurboCore never depends directly on provider SDKs. Adapters (Mock / Sandbox / Production) implement these contracts and are registered in the ProviderRegistry.

**11 Provider Contracts:**
- `IVirtualAccountProvider` — Virtual account creation
- `IWalletFundingProvider` — Wallet funding
- `ILocalTransferProvider` — Local bank transfers
- `IInternationalTransferProvider` — Outbound international transfers
- `IInternationalReceivingProvider` — Inbound international payments
- `ICrossBorderSettlementProvider` — Cross-border settlement
- `IExchangeRateProvider` — FX rate quotes
- `IBillPaymentProvider` — Bill payments
- `IKYCProvider` — Identity verification
- `INotificationProvider` — SMS/Email/Push notifications
- `IVirtualCardProvider` — Card issuing

**9 Production Adapters:** Monnify, Paystack, Baxi, Dojah, Termii, Resend, Sandbox-Intl, Turbopay-Cards, Mock

### Financial Integrity

- **Double-entry ledger**: Every financial movement posts TWO ledger entries (DEBIT + CREDIT)
- **Immutable entries**: Ledger entries are never edited; corrections use REVERSAL entries
- **Atomic transactions**: All financial paths run inside `db.$transaction()` with conditional updates
- **Idempotent operations**: `IdempotencyRecord` model + webhook deduplication
- **Reversals instead of edits**: Provider failures auto-trigger reversal
- **Reconciliation**: Daily cron job compares wallet cache against ledger sum
- **Balance derived from ledger**: `getLedgerBalance()` computes balance via SQL aggregate

## Core Domains

### Identity
- User model with authentication (password, Google OAuth, WebAuthn passkeys)
- Session management (access + refresh tokens, 24h/30d TTL)
- MFA (TOTP with replay prevention, backup codes)
- KYC tiers (1-3) with configurable limits

### Wallet
- Per-user balance cache with optimistic concurrency control
- Atomic conditional updates (`WHERE balanceKobo >= amount`)
- Advisory locks for PostgreSQL serialization

### Ledger
- Double-entry: DEBIT reduces balance, CREDIT increases
- Immutable entries with `balanceAfterKobo` for auditability
- Reversal entries for failed operations

### Payments
- Hold-Confirm-Reverse pattern for provider-backed debits
- AML checks integrated into hold transaction
- Transaction state machine (INITIATED → HOLD_POSTED → PROVIDER_CALLED → SETTLED/REVERSED)

### International Payments
- FX Engine with currency-pair whitelist and spread/markup
- Rate comparison across multiple providers
- Outbound transfers with hold-confirm-reverse
- Inbound settlement with idempotent webhook processing

### BillSwift
- Provider connectors behind common interface (Baxi production adapter)
- Bulk processing with background worker
- Fee calculation via configurable fee engine

### Savings
- 6 types: FLEXIBLE, LOCKED, TARGET, GOAL, ROUND_UP, AUTO_SAVE
- Interest accrual (daily compounding)
- Auto-save execution (DAILY/WEEKLY/MONTHLY)
- Goal tracking with notifications

### Virtual Cards
- Luhn-valid PAN generation
- AES-256-GCM encryption at rest
- Fund/withdraw with ledger integration
- Freeze/unfreeze/terminate operations
- Spending controls

### Referrals & Vouchers
- Referral codes with campaign linkage
- Voucher validation with 10+ checks
- Atomic redemption with counter tracking

## Security Architecture

### Authentication
- Short-lived access tokens (24h) + refresh tokens (30d)
- SHA-256 hashed tokens at rest
- Dual transport: cookie (browser) + Bearer header (iframe)
- Timing-safe password comparison with dummy hash

### Authorization
- RBAC with role-based permissions
- Per-route admin checks
- Feature flag system

### MFA
- TOTP with replay prevention (mfaLastStep tracking)
- Backup codes (scrypt-hashed, encrypted at rest)
- WebAuthn passkeys (second-factor + passwordless)

### Rate Limiting
- Redis-backed sliding window (in-memory fallback)
- Per-IP, per-user, and per-identifier scoping
- RFC 6585 compliant (Retry-After header)

### CSRF Protection
- Origin validation on all state-changing API requests
- Bearer-token exemption (inherently CSRF-immune)
- Webhook/cron exemption (use HMAC/secret)

### Encryption
- AES-256-GCM for PII (BVN, NIN, TOTP secrets, card PANs/CVV)
- Scrypt for passwords and PINs
- CSPRNG for tokens and OTPs

## API Routes

### User-Facing (34 route groups)
- Auth: register, login, logout, refresh, sessions, MFA, recovery
- Wallet: balance, funding, history
- Transfers: internal, external
- Bills: electricity, utilities, BillSwift
- International: quote, send, receive
- Savings: create, deposit, withdraw
- Investments: catalog, invest, liquidate, portfolio
- Virtual Cards: create, fund, withdraw, freeze, terminate
- Referrals: code, stats, lookup
- Vouchers: list, redeem
- Support: tickets, chat, knowledge base
- Security: devices, step-up, location guard

### Admin (33 route groups)
- Users, roles, permissions
- Transactions, wallets, ledger
- Providers, fees, routing
- Bills, savings, cards
- Referrals, vouchers
- KYC, AML, fraud, compliance
- Support, reports, analytics
- Feature flags, system health, configuration

### Cron Jobs (11)
- Outbox publisher, queue worker
- Reconciliation, session cleanup
- Settlement worker, stuck transactions
- Webhook retry, notification retry
- Scheduled payments, disputes SLA
- BillSwift bulk processor

## Database Schema

### Core Financial
- `User`, `Session`, `Wallet`, `LedgerEntry`, `Transaction`
- `VirtualAccount`, `IdempotencyRecord`

### Platform
- `ProviderConfig`, `ProviderRoute`, `ProviderHealthCheck`
- `WebhookEndpoint`, `FeatureFlag`, `FeeConfig`, `FxConfig`
- `KycTierLimit`, `AmlPolicy`, `ServiceFlag`, `CronLock`

### Operations
- `NotificationLog`, `AuditLog`, `AsyncTask`, `OutboxEvent`
- `SettlementQueue`, `ReconciliationRun`, `ConfigVersion`

### User Features
- `Beneficiary`, `BillPayment`, `AirtimeDataPurchase`
- `SavingsProduct`, `SavingsTransaction`
- `VirtualCard`, `VirtualCardTransaction`, `VirtualCardControl`
- `Referral`, `Voucher`, `ScheduledPayment`, `PaymentTemplate`
- `InAppNotification`, `Dispute`, `SupportTicket`, `HelpArticle`

### Security
- `Device`, `SecurityEvent`, `SecurityQuestion`, `RecoveryToken`
- `LoginHistory`, `UsernameHistory`, `Passkey`

## Deployment

### Docker
- 3 app instances (load-balanced by Caddy)
- PostgreSQL 16
- Redis 7
- Caddy reverse proxy

### Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection (optional for dev)
- `TURBOPAY_PII_KEY` — AES-256-GCM key for PII encryption
- `WEBAUTHN_RP_ID` — WebAuthn relying party ID
- `WEBAUTHN_ORIGIN` — WebAuthn origin URL

### Health Checks
- Database connectivity
- Redis connectivity
- Memory usage
- Uptime monitoring

## Provider Decisions

### Regulatory Context (CBN)

Per the CBN's January 2024 guidelines:

- **Fintech companies CANNOT hold an IMTO license directly.** TurboPay must route inbound international receiving through a licensed IMTO partner.
- **IMTOs are restricted to INBOUND transfers only.** Outbound international transfers run through an Authorized Dealer bank under the CBN Foreign Exchange Manual — a structurally different regulatory path.
- These are separate contracts with different regulatory requirements, which is why the codebase treats `internationalTransfer` and `internationalReceiving` as distinct provider contracts.

### Provider Recommendations (when partnerships are in place)

| Contract | Recommended Provider | Rationale |
|----------|---------------------|-----------|
| Outbound international transfer | **Wise** (primary), Flutterwave (fallback) | Wise has competitive rates, strong API, and established NGN payout rails. Flutterwave provides African-market redundancy. |
| Inbound international receiving | **Wise via IMTO partner** | Wise operates as a licensed IMTO in Nigeria. TurboPay cannot hold the license directly — this is a business partnership, not a code gap. |
| FX rate sourcing | **CurrencyCloud** (Wise subsidiary, primary), Flutterwave (fallback) | CurrencyCloud provides institutional-grade rates with real-time feeds. Already integrated into Wise's pipeline. |
| Cross-border settlement | **Wise** | Settlement is tightly coupled to the transfer/receiving providers above. |

### Known Blockers

| Item | Status | Blocker |
|------|--------|---------|
| Remita adapter | Blocked | Requires external business registration with Remita before any adapter code can go live. |
| Quickteller adapter | Blocked | Same — requires Interswitch business registration. |
| Real card issuing (Stripe Issuing) | Blocked | Requires Stripe Issuing account approval + production keys. Virtual cards are feature-flagged behind `virtual_cards`. |
| International transfers (live) | Blocked | Requires IMTO partner agreement (inbound) and Authorized Dealer bank relationship (outbound). Sandbox adapters are functional for testing. |

### Deferred Until Real Users

The following are explicitly deferred — they are net-new product decisions, not production-readiness hardening:

- Enterprise CRM (campaign management, customer segmentation, WhatsApp/SMS/email integration)
- Certified Merchant tier (approval workflow, concurrent cron limits, pricing tiers)
- Multi-region deployment (Kafka, multi-country expansion)
- Full pricing management interface (dynamic rules, merchant pricing, country pricing)

These should be revisited once there are real users and revenue to size the effort against.
