# TurboCore Audit — July 5, 2026

Scope: `github.com/ifeanyiokomba/Turbocore` @ `main` (Next.js 16.1.1, Prisma/PostgreSQL, ioredis). Read-only clone, manual review + `tsc --noEmit`.

**Bottom line:** the financial core (ledger, hold-confirm-reverse, crypto, webhooks) is genuinely well-built. The problems below are all in the edges — one is live and critical, four are why your build is very likely failing right now, the rest are real but lower-stakes.

---

## Critical

### 1. `middleware.ts` never renamed for Next.js 16 — edge security is not running

`src/middleware.ts` still exists under the old filename. Next.js 16 looks for `proxy.ts` with an exported `proxy` function; `middleware.ts` is not picked up at all. Confirmed dead right now:

- **CSRF** — `validateOrigin()` (`src/lib/turbopay/csrf.ts`) is called *only* from this file. No other route checks origin. Any state-changing endpoint is currently unprotected against cross-site forgery.
- **IP allow/block list** (`BLOCKED_IPS`/`ALLOWED_IPS`) — referenced only here. Fully inert.
- **Maintenance mode** (`MAINTENANCE_MODE`) — referenced only here. Setting the env var does nothing.
- **Admin edge rate limit** (100 req/min) — inert. (Per-route Redis rate limits still work independently — see "What's solid.")

Route-level auth (`requireUser`/`requirePermission`) is enforced independently in all 209 API routes I checked, so this isn't an open-authentication situation — but CSRF, IP blocking, and maintenance mode have no other layer.

**Fix:**
```bash
git mv src/middleware.ts src/proxy.ts
```
Then in the file, rename `export async function middleware(...)` → `export async function proxy(...)`. No other logic changes needed. Verify post-deploy: `curl -X POST` from a disallowed origin should get rejected again.

---

## High

### 2. Production build is very likely broken

`next.config.ts` sets `typescript: { ignoreBuildErrors: false }` — good discipline, but it means every error below currently blocks `next build` / your Vercel deploy. These four are confirmed independent of the sandbox's Prisma-client issue (see Methodology note):

**a) Investment liquidation is completely broken**
`src/app/api/investments/[id]/liquidate/route.ts` imports a function that doesn't exist:
```ts
import { liquidate } from "@/lib/turbocore/investments"; // no such export
const result = await liquidate(user.id, id);
```
`liquidate` is a method on the exported singleton, not a standalone function.
```ts
// fix
import { investments } from "@/lib/turbocore/investments";
const result = await investments.liquidate(user.id, id);
```

**b) `/api/v1/intl/quote` silently drops a field from its "stable" response**
```ts
sourceAmountMinor: quote.sourceAmountMinor, // doesn't exist on FxQuoteResult — always undefined, dropped from JSON
```
`FxQuoteResult` only has `destinationAmountMinor`. You already have the requested amount from input validation:
```ts
// fix — use the parsed request value
sourceAmountMinor: parsed.data.amountMinor,
```

**c) Card freeze/unfreeze/terminate/create don't compile**
`src/lib/turbopay/services/card.service.ts` imports a `virtualCards` object from `@/lib/turbocore/virtual-cards` — that directory has no `index.ts`, only `enhanced.ts`. Looks like a leftover from consolidating into the enhanced service: `enhancedCards` (already imported in the same file, already used for `fund`) has identical methods with matching signatures — `createCard`, `freezeCard`, `unfreezeCard`, `terminateCard`.
```ts
// remove this line:
import { virtualCards } from "@/lib/turbocore/virtual-cards";

// replace all four call sites:
virtualCards.createCard(...)    → enhancedCards.createCard(...)
virtualCards.freezeCard(...)    → enhancedCards.freezeCard(...)
virtualCards.unfreezeCard(...)  → enhancedCards.unfreezeCard(...)
virtualCards.terminateCard(...) → enhancedCards.terminateCard(...)
```

**d) Admin circuit-breaker diagnostics don't compile**
`src/lib/turbocore/providers/circuit-breaker.ts`, `listCircuitBreakers()` calls `breaker.getState()`, which is `private`:
```ts
private async getState(): Promise<BreakerState> { ... }
```
It needs the full state (`failureCount`, `successCount`), not just the enum `getStateValue()` returns. Simplest correct fix — drop the modifier:
```ts
async getState(): Promise<BreakerState> { ... } // was: private async getState()
```

Run `npx tsc --noEmit` after these four — it should be clean (module aside, see Methodology).

### 3. Cron secret fallback has a copy-paste gap

All 12 cron routes share this pattern to fail closed in production:
```ts
const EFFECTIVE_SECRET = CRON_SECRET ?? (process.env.NODE_ENV === "production" ? null : "dev-cron-secret");
```
`src/app/api/cron/data-retention/route.ts` is the one exception:
```ts
const cronSecret = process.env.CRON_SECRET ?? "dev-cron-secret"; // no production guard
```
If `CRON_SECRET` is ever unset in production, this route accepts the literal string `"dev-cron-secret"` — which is now public in this repo — as a valid credential to trigger data retention (deletion of stale accounts/audit logs/notification logs). Match the pattern used everywhere else:
```ts
const cronSecret = process.env.CRON_SECRET ?? (process.env.NODE_ENV === "production" ? null : "dev-cron-secret");
if (!cronSecret) return errorJson("CRON_NOT_CONFIGURED", 500);
```

### 4. Referral rewards are tagged as real funding

`src/lib/turbocore/referrals/*.ts`:
```ts
await creditWallet(wallet.id, referral.rewardKobo, "FUNDING", { description: "Referral reward", refId: referral.id });
```
`Transaction.type` is a free-text field (`FUNDING | TRANSFER_IN | TRANSFER_OUT | AIRTIME | DATA | BILL_ELECTRICITY | BILL_UTILITY | REVERSAL | FEE` per the schema comment — `REFERRAL` isn't in that list). Tagging a platform-funded incentive as `"FUNDING"` means it's indistinguishable from genuine external deposits in AML source-of-funds logic and in the reconciliation/settlement-worker jobs, which have no provider settlement record to match it against. This is a no-migration fix (the column is a plain string, not an enum):
```ts
await creditWallet(wallet.id, referral.rewardKobo, "REFERRAL_REWARD", { description: "Referral reward", refId: referral.id });
```
Worth a quick grep afterward for any report/reconciliation query filtering on `type: "FUNDING"` — those should *want* to exclude referral rewards, so this change is a correction for them, not a break.

---

## Medium

### 5. SSRF guard checks hostnames, not resolved IPs

Both `validateOutboundUrl()` (`src/lib/turbopay/ssrf.ts`) and `assertSafeHealthCheckUrl()` (`src/lib/turbocore/config/provider-config.ts`) block literal private IPs and a hostname blocklist, but neither resolves DNS before connecting. A hostname that resolves to `169.254.169.254` (cloud metadata) or an internal address sails through the string check and only becomes dangerous at actual `fetch()` time — classic DNS-rebinding bypass.

Blast radius is admin-gated today (provider `baseUrl` and health-check URLs are only settable via `ADMIN_MANAGE_PROVIDER_CREDENTIALS`/health-check admin routes), so this needs a compromised or malicious admin account to matter — real, but not externally reachable as-is. Proper fix: resolve the hostname with `dns.lookup()`, validate the resolved IP(s) against the private-range list, and ideally pin the connection to the validated IP (custom `lookup` function passed to the fetch agent) to close the TOCTOU gap between check and connect. Also worth consolidating the two near-duplicate implementations into one shared function so a future fix doesn't need to land twice.

### 6. No sanctions/watchlist screening found

I searched broadly (sanctions, watchlist, OFAC, PEP, related field names) and found nothing beyond `compliance/cases.ts`, which is case *workflow* (for handling flags raised elsewhere), not a screening engine itself. It's possible this is delegated entirely to Dojah's KYC response during onboarding in a way that doesn't surface under a name I searched for — worth confirming directly rather than assuming either way, given this is usually an explicit regulatory expectation (CBN/NFIU) for a Nigerian fintech.

### 7. Routing engine weights are hardcoded

`src/lib/turbocore/config/routing-engine.ts` has real multi-factor scoring (settlement speed, capacity, success rate) — the engine itself is solid. But `DEFAULT_WEIGHTS`/`FX_WEIGHTS` are in-code constants, so changing routing priorities today needs a code change + redeploy. Not a bug, but worth knowing before advertising "routing changes without redeployment" anywhere.

---

## Low / code quality

- **`src/app/api/intl/send/route.ts`** — `pinResult.error` is typed `string | undefined`, `errorJson()` wants `string`. Build-blocking, no runtime risk (`verifyTransactionPin` always sets `error` when `ok: false`); fix with `pinResult.error ?? "Invalid PIN"` or tighten `PinVerifyResult` into a discriminated union.
- **`src/lib/turbocore/international/send.ts:220`** — `providerResult.data` flagged as possibly undefined. It's guarded above (`if (!providerResult.ok || !providerResult.data) throw ...`), but the guard is outside the `db.$transaction(async (tx) => {...})` closure, so TS narrowing doesn't carry in. No runtime risk; fix by capturing `const data = providerResult.data;` right after the guard and using `data` inside the closure.
- **`src/lib/turbopay/providers.ts`** — the only file with `Math.random()` outside test code. Confirmed dead: it's explicitly a mock/simulated provider layer, and `adapter-factory.ts` never calls into it in the real routing path (real adapters — Monnify, Baxi, Dojah, Paystack, Termii, Resend — are wired separately with `crypto.randomInt`/`randomBytes` for OTPs, references, and account numbers). Not a live risk, but worth deleting or clearly marking `@deprecated` so it doesn't get accidentally wired in later.

---

## What's solid (confirmed by direct read, not assumed)

- **Ledger** (`ledger.ts`) — atomic conditional balance updates, per-user Postgres advisory locks, correct double-entry pairing on transfers, reversal blocks double-reversal.
- **Payment orchestrator** (`payments.ts`) — hold → provider call → confirm/auto-reverse, transactional outbox for reliable event delivery, a `stuck-transactions` cron sweeper with sane logic (only auto-reverses when there's no `providerRef`; otherwise defers to settlement-worker rather than risking a double-refund).
- **Webhook verification** (`turbocore/webhooks/registry.ts`) — DB-backed HMAC secrets, `crypto.timingSafeEqual`, demo-bypass hard-gated to non-production.
- **Crypto** (`crypto.ts`) — scrypt password/PIN hashing with random salts, timing-safe compare, a dummy-hash path specifically to prevent user-enumeration timing attacks, AES-256-GCM for PII with fail-closed behavior if the key is unset in production.
- **PIN lockout** (`pin.ts`) — 5 fails → 15-minute lockout, checked before hashing, audit-logged.
- **Rate limiting** (`rate-limit.ts`) — Redis sorted-set sliding window, safe in-memory fallback with an explicit "not safe for multi-instance" warning.
- **KYC/AML** (`aml.ts`) — limits are DB-driven with hardcoded fallback (not hardcoded-only), velocity/large-amount/rapid-transfer flags, auto-freeze + compliance case opened on HIGH severity.
- **Feature flags** (`features/index.ts`) — DB-backed, deterministic percentage rollout via a uniform hash (verified it isn't a naive `Math.random() < pct`, which would drift on re-evaluation).
- **RBAC** — every one of the 81 admin routes independently enforces `requireAdmin`/`requirePermission`/`requireRole`; none rely solely on the dead middleware.

## Methodology note

`prisma generate` can't complete in this sandbox — the engine binary download to `binaries.prisma.sh` is blocked by network egress rules here, not by anything in your project. That produced a wave of `tsc` noise (`Property 'x' does not exist on type 'never'`, etc.) across `ledger.ts`, `payments.ts`, `aml.ts`, `advisory-lock.ts`, `outbox/index.ts`, `scheduled-payments/index.ts`, `billing.service.ts`, and a test file. I cross-checked every affected model/property against `schema.prisma` directly — all exist there, confirming these are generation artifacts, not real bugs. They should disappear once `prisma generate` runs somewhere with normal network access (your machine, CI, or Vercel's build). The four build-blocking issues under "High" were verified independently of this and will remain after `prisma generate` succeeds.

## Suggested order

1. `proxy.ts` rename — 5 minutes, restores three dead security features.
2. The four build-blockers in §2 — this is why deploys are likely failing.
3. Cron secret fix (§3) and referral type fix (§4) — small, independent, no migration.
4. Confirm sanctions screening one way or the other (§6) — either point to where it lives or scope adding it.
5. SSRF DNS-resolution hardening (§5) and routing-weight externalization (§7) — lower urgency, fold into the config-platform phase you're already planning.
