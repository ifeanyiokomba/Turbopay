# TurboPay Improvement Plan

**Date:** 2026-07-13
**Based on:** sdk.txt, ui.txt, TurboCore reference, codebase audit, security fixes

---

## Understanding

TurboPay is a **consumer-facing fintech web application** (like OPay, PalmPay, Kuda, Wise, Revolut) — NOT an SDK or API platform. It uses TurboCore as a design/UX reference but must be an original, improved, global-first product.

### Current State

| Component | Status | Issues |
|-----------|--------|--------|
| `turbopay-complete-latest/` | Next.js 16 + React 19 + Prisma + PostgreSQL | Tests broken (28/28 failing), missing Prisma generation, env not configured |
| `src/` | Standalone payment orchestration SDK | Security fixes applied, no tests, in-memory storage |
| Integration | Two separate codebases | `src/` is not used by the Next.js app — duplicate logic |

---

## Phase 1: Fix Foundation (Immediate)

### 1.1 Fix Test Infrastructure
**Problem:** 28 test suites fail — root `jest.config.js` conflicts with `turbopay-complete-latest/` which uses Vitest.

**Actions:**
- [ ] Delete root `jest.config.js` (it was added for `src/` but conflicts with the Next.js app)
- [ ] Add test script to `turbopay-complete-latest/package.json` that runs `vitest`
- [ ] Generate Prisma client: `cd turbopay-complete-latest && npx prisma generate`
- [ ] Create `.env.test` with test database URL
- [ ] Run `npm test` in `turbopay-complete-latest/` and fix failing tests

### 1.2 Resolve Duplicate Codebases
**Problem:** `src/` (standalone SDK) and `turbopay-complete-latest/src/lib/` implement the same domain logic independently.

**Actions:**
- [ ] Audit overlap: compare `src/services/` with `turbopay-complete-latest/src/lib/turbopay/`
- [ ] Decision: Either (a) make `src/` a shared package consumed by the Next.js app, or (b) deprecate `src/` and consolidate into the Next.js lib layer
- [ ] Recommended: Option (b) — the Next.js app is the real product; `src/` was a prototype SDK

### 1.3 Environment Configuration
**Problem:** `.env` files contain real secrets, missing `.env.example` for `src/`.

**Actions:**
- [ ] Create comprehensive `.env.example` for `src/` with all required vars documented
- [ ] Ensure `turbopay-complete-latest/.env.example` is complete and up-to-date
- [ ] Add `MASTER_ADMIN_EMAIL` and `MASTER_ADMIN_PASSWORD` to env template
- [ ] Add `JWT_SECRET` as required var (already enforced by our fix)

---

## Phase 2: Security Hardening (High Priority)

### 2.1 Already Fixed (from previous audit)
- [x] C1: Hardcoded admin credentials removed
- [x] C2: `connection string.txt` deleted
- [x] C3: Live `.env` deleted
- [x] H1: SHA-256 → scrypt password hashing
- [x] H2: JWT_SECRET required (no fallback)
- [x] H3: CORS restricted to configured origins
- [x] H4: Rate limiting applied to all routes
- [x] H5: Webhook validation rejects when secret missing
- [x] M1: JSON file persistence for in-memory Maps
- [x] M2: TLS/HTTPS support
- [x] M3: Input validation on all POST routes

### 2.2 Remaining Security Work
- [ ] Rotate all exposed credentials (Neon DB, Supabase DB, PII key)
- [ ] Add CSRF protection to the Next.js app middleware
- [ ] Implement account lockout after failed login attempts
- [ ] Add request ID tracking for audit trail
- [ ] Implement session invalidation on password change
- [ ] Add IP-based suspicious activity detection

---

## Phase 3: Architecture Improvements (Medium Priority)

### 3.1 TurboCore Reference Study
Per ui.txt directive, study TurboCore's:

| Area | What to Learn | TurboPay Improvement |
|------|---------------|---------------------|
| **Architecture** | Domain-driven design (`turbocore/` vs `turbopay/` split) | Adopt same split in Next.js lib layer |
| **Navigation** | App shell, sidebar, mobile nav | Redesign for global-first (multi-country) |
| **Design System** | shadcn/ui components, Tailwind 4 | Extend with fintech-specific components |
| **Security** | Middleware, CSRF, rate limiting | Already improved; align patterns |
| **Auth** | Passkeys, MFA, session management | Add passkey support (already in deps) |
| **Financial** | Double-entry ledger, idempotency | Verify ledger correctness |
| **Provider** | Abstraction layer, capability registry | Consolidate with `src/` adapters |

### 3.2 Global-First Architecture
Per ui.txt: "Nigeria is an important market, but NOT the only market."

**Actions:**
- [ ] Audit Prisma schema for country/currency flexibility
- [ ] Verify `next-intl` is properly configured for i18n
- [ ] Add country-specific onboarding flows
- [ ] Ensure all monetary displays support multiple currencies
- [ ] Add RTL support for Middle Eastern markets
- [ ] Verify provider routing works across countries

### 3.3 Consumer-Facing UX
Per sdk.txt: "Users should never need to understand the underlying payment providers."

**Actions:**
- [ ] Audit all user-facing strings for technical jargon
- [ ] Ensure no provider names leak to the UI
- [ ] Verify error messages are user-friendly (not technical)
- [ ] Add loading states, skeleton screens, optimistic updates
- [ ] Ensure mobile responsiveness across all views
- [ ] Add dark mode support (already has `next-themes`)

---

## Phase 4: Code Quality (Medium Priority)

### 4.1 Fix `src/` Codebase Issues
- [ ] Remove `sha256Hash` import from `crypto.ts` (unused after scrypt change)
- [ ] Clean up unused imports across all modified files
- [ ] Add JSDoc comments to public interfaces
- [ ] Split `routes.ts` (779 lines) into domain-specific route files

### 4.2 Fix `turbopay-complete-latest/` Issues
- [ ] Fix 641 ESLint warnings (mostly `any` types)
- [ ] Fix 49 mixed tabs/spaces in `tailwind.config.ts`
- [ ] Fix `Math.random()` in render (`sidebar.tsx:611`)
- [ ] Add missing hook dependencies (5 warnings)

### 4.3 Add Tests
- [ ] Write unit tests for `src/utils/crypto.ts` (scrypt hashing)
- [ ] Write unit tests for `src/utils/persistence.ts`
- [ ] Write integration tests for `src/admin/auth/auth.service.ts`
- [ ] Write integration tests for `src/auth/customer-auth.service.ts`
- [ ] Fix existing 28 test suites in `turbopay-complete-latest/`

---

## Phase 5: Production Readiness (Lower Priority)

### 5.1 Deployment
- [ ] Verify Dockerfile builds correctly
- [ ] Test docker-compose.yml locally
- [ ] Verify Vercel deployment configuration
- [ ] Set up CI/CD pipeline (GitHub Actions)
- [ ] Configure Sentry error tracking

### 5.2 Monitoring
- [ ] Set up health check endpoints
- [ ] Configure structured logging
- [ ] Add performance monitoring
- [ ] Set up alerting for critical errors

### 5.3 Documentation
- [ ] Update ARCHITECTURE.md with current state
- [ ] Document environment variables
- [ ] Create runbook for common operations
- [ ] Document API endpoints for internal use

---

## Priority Matrix

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| **P0** | 1.1 Fix tests | Low | High — unblocks all development |
| **P0** | 1.2 Resolve duplicates | Medium | High — eliminates confusion |
| **P0** | 2.2 Rotate credentials | Low | Critical — security |
| **P1** | 3.2 Global-first | Medium | High — product requirement |
| **P1** | 3.3 Consumer UX | Medium | High — product requirement |
| **P1** | 4.2 Fix lint warnings | Low | Medium — code quality |
| **P2** | 4.3 Add tests | Medium | Medium — reliability |
| **P2** | 5.1 Deployment | Medium | Medium — production |
| **P3** | 5.2 Monitoring | Low | Medium — observability |
| **P3** | 5.3 Documentation | Low | Low — developer experience |

---

## Decision Points

1. **`src/` vs `turbopay-complete-latest/`:** Should we consolidate or keep both? Recommendation: consolidate into the Next.js app.

2. **Test framework:** The Next.js app uses Vitest; `src/` was configured for Jest. Recommendation: standardize on Vitest.

3. **Database:** Tests need a real PostgreSQL database. Options: (a) local Docker, (b) testcontainers, (c) remote test DB. Recommendation: Docker for local, testcontainers for CI.

4. **i18n:** `next-intl` is already a dependency. Is it configured? Need to verify and set up translation files.
