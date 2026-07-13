# TurboPay Strategic Build Plan

> Based on deep research (69 findings across 7 angles) + TurboCore reference analysis
> Date: 2026-07-13

---

## Guiding Principles

1. **Consumer-first** — every decision answers "Would a normal customer need this?"
2. **Single codebase** — consolidate `src/` into `turbopay-complete-latest/`
3. **TurboCore-inspired, not cloned** — improve upon the reference
4. **Global from day one** — multi-country, multi-currency architecture
5. **Security as architecture** — embed security into product design (OPay pattern)

---

## Phase 1: Foundation (Week 1-2) — "Make it work"

### 1.1 Consolidate Codebases
- [ ] Deprecate `src/` SDK directory
- [ ] Move provider adapters from `src/adapters/` into `turbopay-complete-latest/src/lib/turbocore/providers/`
- [ ] Move ledger service into `turbopay-complete-latest/src/lib/turbopay/ledger.ts`
- [ ] Delete duplicate code, keep the Next.js app as single source of truth

### 1.2 Fix Test Infrastructure
- [ ] Delete root `jest.config.js` (conflicts with Vitest)
- [ ] Run `npx prisma generate` in `turbopay-complete-latest/`
- [ ] Set up Testcontainers for CI (Docker-based Postgres per test run)
- [ ] Fix all 28 failing test suites
- [ ] Target: 100% test pass rate

### 1.3 Environment Configuration
- [ ] Create comprehensive `.env.example` with all required vars
- [ ] Add `MASTER_ADMIN_EMAIL`, `MASTER_ADMIN_PASSWORD`, `JWT_SECRET` to template
- [ ] Set up `.env.test` with test database URL
- [ ] Document all environment variables

### 1.4 Security Credential Rotation
- [ ] Rotate Neon DB password (was exposed in `connection string.txt`)
- [ ] Rotate Supabase DB password (was exposed in `.env`)
- [ ] Rotate PII encryption key
- [ ] Rotate all provider API keys

---

## Phase 2: Core Engine (Week 3-4) — "Make it right"

### 2.1 Upgrade Provider Routing
- [ ] Implement TurboCore's multi-tier routing (PRIMARY → SECONDARY → FALLBACK)
- [ ] Add cost-optimal selection (cheapest healthy provider)
- [ ] Add canary routing (percentage-based traffic splitting)
- [ ] Add rule-based routing (amount, currency, country filters)
- [ ] Add manual override (admin escape hatch)

### 2.2 Implement Double-Entry Ledger
- [ ] Adopt TurboCore's Prisma schema for LedgerEntry (DEBIT/CREDIT pairs)
- [ ] Store money as integer kobo (1 NGN = 100 kobo)
- [ ] Ensure every financial movement posts two rows
- [ ] Add wallet balance cache with optimistic concurrency
- [ ] Add idempotency records for all payment operations

### 2.3 Implement Webhook Processing
- [ ] Return 2xx immediately, process async via task queue
- [ ] Deduplicate by [provider, providerRef] composite key
- [ ] Store raw payload for audit and replay
- [ ] Add retry logic with exponential backoff
- [ ] Add dead-letter queue for failed events

### 2.4 Implement Async Task Queue
- [ ] Database-backed task queue (TurboCore pattern)
- [ ] Types: NOTIFY, CASHBACK, EVENT
- [ ] Max 3 attempts with exponential backoff
- [ ] Cron worker processes every 1 minute
- [ ] Notifications, cashback, webhook fan-out as async tasks

---

## Phase 3: Consumer UX (Week 5-8) — "Make it beautiful"

### 3.1 Dashboard Redesign
- [ ] Clean, focused home screen (no clutter)
- [ ] Wallet balance with currency display
- [ ] Quick actions: Send, Receive, Bills, Airtime
- [ ] Recent transactions (last 5)
- [ ] Account switcher (multi-currency)
- [ ] Progressive disclosure — show advanced features on demand

### 3.2 Send Money Flow
- [ ] Auto-detect bank from account number (critical UX requirement)
- [ ] Transparent fee display upfront (Wise pattern)
- [ ] Transfer success rate indicator (OPay delighter)
- [ ] Beneficiary management (save frequent recipients)
- [ ] Step-up OTP for high-value transfers

### 3.3 Wallet & Multi-Currency
- [ ] Multi-currency wallets (NGN, USD, GBP, GHS, KES)
- [ ] Currency conversion with live rates
- [ ] FX fee transparency
- [ ] Balance display in user's preferred currency

### 3.4 Bills & Airtime
- [ ] Bill payment categories (Electricity, Cable TV, Internet, Water)
- [ ] Airtime and data purchase
- [ ] Recent billers for quick repeat
- [ ] Token/receipt display for electricity

### 3.5 Navigation
- [ ] Bottom tab bar (Home, Send, Wallet, Activity, Profile)
- [ ] Slide-out drawer for secondary features
- [ ] Search across transactions and beneficiaries
- [ ] Notifications bell with unread count

### 3.6 Onboarding
- [ ] Phone-first registration (minimal fields)
- [ ] Step-by-step KYC (Tier 1 → 2 → 3)
- [ ] Progressive feature unlock based on KYC tier
- [ ] Biometric auth setup prompt

### 3.7 Settings & Security
- [ ] Transaction PIN management
- [ ] MFA/TOTP setup
- [ ] Passkey registration (WebAuthn)
- [ ] Session management (view/revoke active sessions)
- [ ] Login history
- [ ] Large Transaction Shield toggle
- [ ] Location Guard toggle

---

## Phase 4: Compliance & Security (Week 6-8, parallel with Phase 3)

### 4.1 KYC Implementation
- [ ] Tiered KYC (Tier 1: phone, Tier 2: BVN, Tier 3: NIN)
- [ ] BVN verification via provider (Dojah/VerifyMe)
- [ ] NIN verification
- [ ] KYC tier limits (transaction amount, daily limit, balance)
- [ ] Document upload for enhanced verification

### 4.2 AML/CFT
- [ ] Transaction velocity monitoring
- [ ] Large transaction flagging
- [ ] Sanctions screening (OFAC SDN, UN, EU)
- [ ] Suspicious activity reporting
- [ ] Compliance case management

### 4.3 Data Protection
- [ ] NDPA compliance — register with NDPC
- [ ] Privacy policy acceptance tracking
- [ ] Marketing consent management
- [ ] Data subject rights (access, rectification, deletion)
- [ ] Data encryption at rest (AES-256-GCM for PII)

### 4.4 Audit Trail
- [ ] Every financial action logged with actor, action, metadata
- [ ] Immutable audit log (append-only)
- [ ] Admin audit log viewer
- [ ] Config versioning for provider changes

---

## Phase 5: Production Readiness (Week 9-10)

### 5.1 Deployment
- [ ] Docker multi-stage build (~130MB image)
- [ ] Docker Compose for local development
- [ ] Vercel deployment for frontend
- [ ] Self-hosted Docker for API (PCI DSS compliance)
- [ ] nginx reverse proxy configuration

### 5.2 Monitoring
- [ ] Sentry error tracking (already configured)
- [ ] Structured logging (JSON format)
- [ ] Health check endpoints
- [ ] Provider health dashboard
- [ ] Transaction success rate monitoring
- [ ] Alerting for critical errors

### 5.3 Performance
- [ ] Redis for session management and caching
- [ ] Connection pooling (PgBouncer)
- [ ] CDN for static assets
- [ ] Image optimization (AVIF/WebP)
- [ ] Lazy loading for non-critical views

### 5.4 CI/CD
- [ ] GitHub Actions pipeline
- [ ] Automated tests on PR
- [ ] Type checking on PR
- [ ] Linting on PR
- [ ] Staging deployment on merge to main
- [ ] Production deployment on release tag

---

## Phase 6: Global Expansion (Week 11+)

### 6.1 Internationalization
- [ ] Configure next-intl properly
- [ ] English (default), French, Swahili, Portuguese
- [ ] RTL support preparation
- [ ] Currency localization

### 6.2 Multi-Country Launch
- [ ] Ghana (GHS) — MTN Mobile Money, GhIPSS
- [ ] Kenya (KES) — M-Pesa, PesaLink
- [ ] South Africa (ZAR) — EFT, SnapScan
- [ ] UK (GBP) — Faster Payments, Open Banking

### 6.3 International Transfers
- [ ] Corridor: NGN → USD (first)
- [ ] Corridor: NGN → GBP
- [ ] Corridor: NGN → GHS
- [ ] FX rate aggregation from multiple providers
- [ ] Compliance for cross-border regulations

---

## Technology Stack (Final)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend** | Next.js 16, React 19, Tailwind 4, shadcn/ui | Modern, performant, component library |
| **Backend** | Next.js API routes + server actions | Full-stack, type-safe |
| **Database** | PostgreSQL 16 + Prisma | Financial-grade, type-safe ORM |
| **Cache** | Redis | Sessions, rate limiting, Next.js cache |
| **Auth** | Custom + Passkeys (WebAuthn) + MFA | Security-first |
| **State** | Zustand | Lightweight, already in deps |
| **Testing** | Vitest + Testcontainers + Playwright | TypeScript-native, real DB |
| **Monitoring** | Sentry + structured logging | Error tracking, observability |
| **Deployment** | Vercel (frontend) + Docker (API) | Scalable, PCI-compliant |
| **I18n** | next-intl | Multi-language support |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test pass rate | 100% | `vitest run` |
| Type errors | 0 | `tsc --noEmit` |
| ESLint warnings | <50 | `eslint .` |
| Lighthouse score | >90 | Performance audit |
| Time to first byte | <200ms | Vercel analytics |
| Transaction success rate | >99% | Provider monitoring |
| P95 API latency | <500ms | Sentry performance |
| Security vulnerabilities | 0 critical/high | OWASP scan |

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| CBN licensing delay | Cannot launch payments | Start with sandbox, apply early |
| Provider downtime | Failed transactions | Multi-provider failover (already built) |
| Data breach | Regulatory + trust | Encryption, audit, pen testing |
| Scalability | Performance degradation | Redis, connection pooling, CDN |
| Scope creep | Delayed launch | Strict MVP definition per phase |

---

## MVP Definition (Launch Checklist)

**Minimum viable product for Nigeria launch:**

1. User registration + phone verification
2. Tier 1 KYC (phone only)
3. Single currency wallet (NGN)
4. Send money (to bank account)
5. Receive money (virtual account)
6. Airtime purchase
7. Bill payment (electricity)
8. Transaction history
9. Profile management
10. Basic security (PIN, password)

**Post-launch additions:**
- Multi-currency
- International transfers
- Virtual cards
- Savings products
- Investments
- Referral system
- Business accounts
