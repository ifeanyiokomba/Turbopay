# TurboPay Strategic Fixes Plan

> **Date:** 2026-07-27  
> **Based on:** AUDIT_REPORT.md (commit 816c48a), codebase verification, and remaining recommendations  
> **Purpose:** Strategic plan for all remaining fixes with effort/impact calculations

---

## 1. Current State Summary

### 1.1 Codebase Consolidation Status

| Codebase | Path | Status | Action |
|----------|------|--------|--------|
| **SDK** | `src/` | ⚠️ DEPRECATED | Delete after Next.js test coverage is complete |
| **App** | `turbopay-complete-latest/` | ✅ Production | Single source of truth |
| **Dashboard** | `frontend/` | ❌ Abandoned | Delete |

### 1.2 Audit Fix Verification

The AUDIT_REPORT.md (Section 12) claims 12 P0 fixes were applied in commit `816c48a`.
**Verification results:**

| # | Fix | Status | Notes |
|---|-----|--------|-------|
| 1 | Remove committed admin user data | ✅ Verified | `data/` in `.gitignore` |
| 2 | Delete root-level duplicate files | ✅ Verified | Files no longer exist |
| 3 | Update Dockerfile | ✅ Verified | Builds Next.js app |
| 4 | Update render.yaml | ✅ Verified | `rootDir: turbopay-complete-latest` |
| 5 | Delete root jest.config.js | ✅ Verified | File no longer exists |
| 6 | Add auth to KYC route | ✅ **APPLIED (audit8)** | `src/api/routes.ts:224` has `auth: 'customer'` + `requiredBodyFields: ['bvn','nin']` + server-side `req.user?.id` |
| 7 | Fix rate limiting IP extraction | ✅ Verified | Uses last IP in X-Forwarded-For |
| 8 | Add security headers | ✅ Verified | All headers present in `src/server.ts` |
| 9 | Add request error handler | ✅ Verified | `req.on('error')` present |
| 10 | Add CORS preflight caching | ✅ Verified | `Access-Control-Max-Age: 86400` |
| 11 | Session invalidation on password change | ✅ Verified | `invalidateUserSessions()` in both auth services |
| 12 | Create .env.example for Next.js app | ✅ Verified | Comprehensive template created |

**Note (2026-08-14, audit8):** The earlier "NOT APPLIED" verdict for Fix #6 was STALE — the KYC route (`src/api/routes.ts:224`) has had `auth: 'customer'`, `requiredBodyFields: ['bvn', 'nin']`, and server-side `req.user?.id` since commit `816c48a`. Verified by fresh audit8.

### 1.3 Next.js App Fix Verification (from c.md audit)

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | Middleware not renamed | ✅ Verified | `src/proxy.ts` exists with CSRF, IP blocking |
| 2 | Investment liquidation build error | ✅ Verified | Uses `investments.liquidate(user.id, id)` |
| 3 | FX quote build error | ✅ Verified | Not present in current code |
| 4 | Card operations build error | ✅ Verified | Uses `enhancedCards` from correct module |
| 5 | Circuit breaker build error | ✅ Verified | `getState()` is public (line 68) |
| 6 | Cron secret fallback gap | ✅ Verified | Has proper production guard |
| 7 | Referral rewards tagged as FUNDING | ✅ Verified | Uses `"REFERRAL_REWARD"` (line 40) |

### 1.4 CI/CD Status

A `.github/workflows/ci.yml` file exists but is **configured for the wrong codebase**:
- Uses `npm ci` and `npx jest` (SDK tooling) instead of `bun install` and `vitest` (Next.js app)
- Runs `npx tsc --noEmit` and `npm run build` from root (builds SDK, not Next.js app)
- Does not run Prisma generate or the Next.js app's test suite

---

## 2. Remaining Fixes — Strategic Plan

### Priority Matrix

| Priority | Count | Focus |
|----------|-------|-------|
| **P0** | 1 | KYC route auth (was claimed done, actually missing) |
| **P1** | 4 | Security hardening, input validation, logging, idempotency |
| **P2** | 4 | Architecture, testing, SSRF, sanctions |
| **P3** | 4 | Cleanup, documentation, feature flags, breach checking |

---

### P0 — Immediate (1 fix)

#### P0.1: Add Authentication to KYC Route in `src/api/routes.ts` — ✅ DONE (verified audit8)

**Problem:** The KYC route (`POST /api/v1/auth/customer/kyc`) is accessible without authentication. An attacker can submit BVN/NIN for any user ID.

**Status (2026-08-14):** FIXED — `src/api/routes.ts` declares `auth: 'customer'` + `requiredBodyFields: ['bvn', 'nin']`, and the handler uses `req.user?.id` (never a client-supplied `user_id`). `src/server.ts` enforces the `auth` declaration by validating the Bearer token before the handler runs. This was verified in audit8.

**Effort:** S (1 day)  
**Impact:** Critical — prevents unauthorized KYC submission

**Actions:**
1. Locate the KYC route handler in `src/api/routes.ts` (search for `kyc` or `verifyKYC`)
2. Add `auth: 'customer'` to the route declaration
3. Add `requiredBodyFields: ['bvn', 'nin']` to enforce input validation
4. Verify the route handler uses `request.user` for the user ID (not a client-supplied `user_id`)
5. Test: unauthenticated request returns 401; authenticated request without BVN/NIN returns 400

**Risk:** If the KYC route doesn't exist in routes.ts, it may need to be created. The route may also need to be moved to the Next.js app's API structure.

---

### P1 — Short-term (4 fixes)

#### P1.1: Add Input Validation Middleware (Zod) to All POST Routes

**Problem:** `src/server.ts` accepts any JSON body without sanitization. Routes validate required fields but don't validate field formats (email, phone, amount ranges).

**Effort:** M (3-4 days)  
**Impact:** High — prevents malformed/malicious input

**Actions:**
1. Install `zod` in the SDK package
2. Create validation schemas for each POST route's body:
   - Auth: email format, password strength
   - Payments: amount > 0, valid currency code, valid provider
   - Transfers: amount > 0, valid account number format
   - KYC: BVN (11 digits), NIN (11 digits)
3. Add validation middleware that runs before route handlers
4. Return 400 with specific error messages for invalid input
5. Add tests for validation failures

**Dependencies:** None

---

#### P1.2: Add Structured Logging Throughout the Server

**Problem:** `src/server.ts` uses `console.log` for all logging. `src/utils/logger.ts` provides a structured logger but is not used.

**Effort:** M (2-3 days)  
**Impact:** Medium — improves observability and debugging

**Actions:**
1. Import `Logger` from `src/utils/logger.ts` in `src/server.ts`
2. Replace all `console.log`/`console.error` calls with structured logger calls
3. Include request ID in all log entries
4. Add log levels (info, warn, error, debug)
5. Configure JSON output format for production
6. Add request/response logging middleware

**Dependencies:** None

---

#### P1.3: Add Graceful Shutdown for In-Flight Requests

**Problem:** `src/server.ts` handles `SIGINT`/`SIGTERM` by calling `server.close()`, but this doesn't wait for in-flight requests to complete.

**Effort:** S (1 day)  
**Impact:** Medium — prevents data loss during deployments

**Actions:**
1. Track in-flight request count in `src/server.ts`
2. On `SIGINT`/`SIGTERM`, stop accepting new connections
3. Wait for in-flight requests to complete (with timeout)
4. Force exit after timeout (e.g., 30 seconds)
5. Log shutdown progress

**Dependencies:** None

---

#### P1.4: Add Idempotency to Webhook Processing

**Problem:** The webhook handler doesn't check for duplicate events. If a provider sends the same webhook twice, the event may be processed twice (e.g., double crediting a wallet).

**Effort:** M (3-4 days)  
**Impact:** Medium — prevents duplicate financial operations

**Actions:**
1. Create an idempotency store (in-memory Map for SDK, Redis for Next.js app)
2. Generate idempotency key from `[provider, providerRef]` composite
3. Before processing a webhook, check if the key exists
4. If duplicate, return 200 with "already processed" response
5. If new, process and store the key with a TTL (e.g., 7 days)
6. Add tests for duplicate webhook handling

**Dependencies:** None

---

### P2 — Medium-term (4 fixes)

#### P2.1: Split `src/api/routes.ts` into Domain-Specific Files

**Problem:** `src/api/routes.ts` is 2,131 lines containing all API routes. Extremely difficult to maintain.

**Effort:** L (1-2 weeks)  
**Impact:** High — improves maintainability and testability

**Actions:**
1. Analyze route groupings:
   - Auth: `/api/v1/auth/*`
   - Payments: `/api/v1/payments/*`
   - Transfers: `/api/v1/transfers/*`
   - Bill payments: `/api/v1/bills/*`
   - Virtual accounts: `/api/v1/virtual-accounts/*`
   - Virtual cards: `/api/v1/cards/*`
   - Admin: `/api/v1/admin/*`
   - Health: `/health`
2. Create `src/api/routes/` directory with domain-specific files
3. Move route definitions to appropriate files
4. Create a route registry that combines all routes
5. Update `src/main.ts` to use the new registry
6. Add tests for each route group

**Dependencies:** P1.1 (input validation) — validation schemas should be created alongside route files

---

#### P2.2: Write Integration Tests for the Payment Flow

**Problem:** No integration tests for the full payment flow: Initialize payment → Provider call → Webhook → Ledger update → Wallet credit.

**Effort:** L (1-2 weeks)  
**Impact:** High — ensures financial correctness

**Actions:**
1. Set up test infrastructure:
   - Test database (PostgreSQL via Docker or testcontainers)
   - Mock provider HTTP responses
2. Write tests for:
   - Payment initialization (success and failure)
   - Webhook processing (success, failure, duplicate)
   - Ledger entries (debit/credit pairing)
   - Wallet balance updates
   - Idempotency (duplicate requests)
3. Add tests for error scenarios:
   - Provider timeout
   - Invalid webhook signature
   - Insufficient funds
4. Run tests in CI pipeline

**Dependencies:** P2.1 (route splitting) — tests are easier with modular routes

---

#### P2.3: Implement SSRF DNS Resolution Hardening

**Problem:** `validateOutboundUrl()` and `assertSafeHealthCheckUrl()` block literal private IPs but don't resolve DNS before connecting, allowing DNS-rebinding bypasses.

**Effort:** M (2-3 days)  
**Impact:** Medium — prevents SSRF attacks

**Actions:**
1. Find `validateOutboundUrl()` and `assertSafeHealthCheckUrl()` in the Next.js app
2. Add DNS resolution before connecting to any URL
3. Check resolved IPs against private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
4. Reject requests to private IPs
5. Add DNS rebinding protection (cache DNS results with short TTL)
6. Add tests for SSRF bypass attempts

**Dependencies:** None

---

#### P2.4: Add Sanctions Screening Engine

**Problem:** No sanctions screening engine found in the codebase. Only case workflow management exists.

**Effort:** L (1-2 weeks)  
**Impact:** Medium — regulatory compliance

**Actions:**
1. Create `src/lib/turbopay/sanctions.ts` (or equivalent in Next.js app)
2. Implement sanctions list checking:
   - OFAC SDN list
   - UN sanctions list
   - EU sanctions list
3. Screen users during KYC (name, DOB, country)
4. Screen transactions (sender, receiver, amount, countries)
5. Flag matches for review
6. Integrate with compliance case management
7. Add tests for screening logic

**Dependencies:** None

---

### P3 — Long-term (4 fixes)

#### P3.1: Delete `src/` and `frontend/` (Deprecated/Abandoned)

**Problem:** `src/` (deprecated SDK) and `frontend/` (abandoned prototype) still exist in the repository.

**Effort:** M (3-5 days)  
**Impact:** Medium — eliminates confusion and maintenance overhead

**Actions:**
1. Verify no external consumers depend on `src/` (check imports, npm packages)
2. Verify `frontend/` is not referenced anywhere
3. Run existing `src/` tests as regression suite
4. Delete `src/` directory
5. Delete `frontend/` directory
6. Update `package.json` to remove SDK-specific scripts
7. Update `tsconfig.json` to remove SDK-specific config
8. Update README to reflect single codebase

**Dependencies:** P2.2 (integration tests) — ensure Next.js app test coverage is complete before deleting SDK

---

#### P3.2: Add API Documentation (OpenAPI/Swagger)

**Problem:** No OpenAPI/Swagger specification for the API.

**Effort:** M (3-4 days)  
**Impact:** Low — improves developer experience

**Actions:**
1. Choose documentation approach:
   - Option A: Generate from route definitions (swagger-jsdoc)
   - Option B: Manual OpenAPI spec
2. Document all API endpoints:
   - Request/response schemas
   - Authentication requirements
   - Error responses
   - Rate limits
3. Add interactive Swagger UI
4. Add to CI/CD pipeline (validate spec on changes)
5. Update README with API documentation link

**Dependencies:** P2.1 (route splitting) — easier to document modular routes

---

#### P3.3: Add Feature Flags

**Problem:** No feature flags system. All features require code changes + redeploy to toggle.

**Effort:** M (2-3 days)  
**Impact:** Low — improves release flexibility

**Actions:**
1. Create feature flag infrastructure:
   - DB-backed flags (Prisma model)
   - In-memory cache (Redis)
   - Fallback to defaults
2. Add flag evaluation API
3. Add admin UI for managing flags
4. Add flag checks to key features:
   - New provider routing
   - Beta features
   - A/B testing
5. Add tests for flag evaluation

**Dependencies:** None

---

#### P3.4: Add Breach Checking (HaveIBeenPwned)

**Problem:** No password breach checking. Users may use compromised passwords.

**Effort:** S (1-2 days)  
**Impact:** Low — improves security posture

**Actions:**
1. Create `src/lib/turbopay/breach-check.ts`
2. Implement HaveIBeenPwned API integration:
   - Use k-anonymity model (send only first 5 chars of SHA-1 hash)
   - Check if password appears in breach database
3. Integrate into:
   - Registration (reject breached passwords)
   - Password reset (warn about breached passwords)
4. Add tests for breach checking logic
5. Add rate limiting for HIBP API calls

**Dependencies:** None

---

## 3. Effort Summary

### By Priority

| Priority | Fixes | Effort | Total Days |
|----------|-------|--------|------------|
| P0 | 1 | S | 1 |
| P1 | 4 | 1×S + 3×M | 11-15 |
| P2 | 4 | 2×L + 2×M | 16-26 |
| P3 | 4 | 3×M + 1×S | 9-14 |
| **Total** | **13** | | **37-56 days** |

### By Effort Size

| Size | Count | Days |
|------|-------|------|
| S (1-2 days) | 3 | 3-6 |
| M (3-5 days) | 7 | 21-35 |
| L (1-2 weeks) | 3 | 15-30 |

### By Impact

| Impact | Count |
|--------|-------|
| Critical | 1 |
| High | 3 |
| Medium | 7 |
| Low | 2 |

---

## 4. Implementation Sequence

### Sprint 1 (Week 1) — P0 + P1 Foundation
1. **P0.1:** Add auth to KYC route (1 day)
2. **P1.1:** Add input validation middleware (3-4 days)
3. **P1.2:** Add structured logging (2-3 days)

### Sprint 2 (Week 2) — P1 Completion
4. **P1.3:** Add graceful shutdown (1 day)
5. **P1.4:** Add webhook idempotency (3-4 days)
6. **P2.3:** Implement SSRF DNS hardening (2-3 days)

### Sprint 3 (Week 3-4) — P2 Core
7. **P2.1:** Split routes.ts into domain files (1-2 weeks)
8. **P2.4:** Add sanctions screening (1-2 weeks)

### Sprint 4 (Week 5-6) — P2 Testing
9. **P2.2:** Write integration tests for payment flow (1-2 weeks)

### Sprint 5 (Week 7) — P3 Cleanup
10. **P3.1:** Delete src/ and frontend/ (3-5 days)
11. **P3.2:** Add API documentation (3-4 days)
12. **P3.3:** Add feature flags (2-3 days)
13. **P3.4:** Add breach checking (1-2 days)

### Sprint 6 (Week 8) — CI/CD Fix + Finalization
14. Fix CI/CD pipeline to use Vitest/Bun for Next.js app
15. Final verification and documentation update

---

## 5. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| KYC route not found in routes.ts | High | Search entire src/ for KYC handler; may need to create route |
| Route splitting breaks existing functionality | High | Write tests before splitting; use feature flags |
| Sanctions screening false positives | Medium | Use fuzzy matching; allow manual review |
| Deleting src/ breaks external consumers | High | Verify no external imports; announce deprecation |
| CI/CD pipeline fix breaks builds | Medium | Test in feature branch first |
| Integration tests require real database | Medium | Use testcontainers for CI, Docker for local |

---

## 6. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| KYC route auth | 100% | Unauthenticated requests return 401 |
| Input validation | 100% | All POST routes validate input |
| Structured logging | 100% | All server logs are JSON-formatted |
| Graceful shutdown | 100% | No in-flight requests lost during shutdown |
| Webhook idempotency | 100% | Duplicate webhooks return 200 without reprocessing |
| Route file size | <200 lines/file | `wc -l src/api/routes/*.ts` |
| Integration test coverage | >80% | `vitest run --coverage` |
| SSRF protection | 100% | Private IPs rejected after DNS resolution |
| Sanctions screening | 100% | All users/transactions screened |
| Codebase consolidation | 100% | `src/` and `frontend/` deleted |
| API documentation | 100% | All endpoints documented in OpenAPI spec |
| Feature flags | 100% | All new features behind flags |
| Breach checking | 100% | Breached passwords rejected at registration |

---

## 7. Dependencies

```
P0.1 (KYC auth)
  └── No dependencies

P1.1 (Input validation)
  └── No dependencies

P1.2 (Structured logging)
  └── No dependencies

P1.3 (Graceful shutdown)
  └── No dependencies

P1.4 (Webhook idempotency)
  └── No dependencies

P2.1 (Split routes)
  └── P1.1 (validation schemas should be created alongside)

P2.2 (Integration tests)
  └── P2.1 (modular routes are easier to test)

P2.3 (SSRF hardening)
  └── No dependencies

P2.4 (Sanctions screening)
  └── No dependencies

P3.1 (Delete src/)
  └── P2.2 (ensure Next.js test coverage is complete)

P3.2 (API documentation)
  └── P2.1 (modular routes are easier to document)

P3.3 (Feature flags)
  └── No dependencies

P3.4 (Breach checking)
  └── No dependencies
```

---

*Plan generated from comprehensive codebase analysis and audit report verification.*
