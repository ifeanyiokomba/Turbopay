/**
 * Turbopay — Structured Domain Error Framework
 * =============================================
 *
 * A typed error hierarchy for the Turbopay domain. Every business-level
 * failure extends `DomainError` and carries:
 *   - `statusCode`  → the HTTP status the API route should return
 *   - `code`        → a stable, machine-readable error code (e.g. "INSUFFICIENT_FUNDS")
 *   - `details`     → optional structured context (field, provider, retryAfterSec, …)
 *
 * Routes can `throw new InsufficientFundsError()` instead of
 * `return errorJson("Insufficient funds", 400, "INSUFFICIENT_FUNDS")`. The
 * `handleError` helper in `@/lib/turbopay/api` converts a thrown `DomainError`
 * into the matching JSON response. This:
 *   - enforces the error type at compile time (TypeScript knows the code/status)
 *   - keeps the call site clean (one throw vs a return + status + code)
 *   - makes error metadata structured (no ad-hoc `details` objects)
 *   - lets service-layer code throw domain errors that bubble up to the route
 *
 * The existing `ServiceError` / `AuthError` / `LedgerError` classes predate
 * this framework and remain for backward compatibility. `handleError` knows
 * about all three so a route can blindly `try { ... } catch (e) { return handleError(e) }`
 * without caring which class was thrown.
 *
 * ── Coexistence with the legacy `AmlBlockedError` in `payments.ts` ──
 * The legacy class is thrown by `executeProviderDebit` when the in-tx AML
 * check blocks the debit. It carries AML-specific metadata (frozeWallet,
 * flags) that doesn't fit the generic `DomainError` shape, so it stays as-is.
 * The new `AmlBlockedError` (below) is for new code paths that want the
 * structured-error contract. The two classes live in different modules
 * (`@/lib/turbopay/payments` vs `@/lib/turbopay/errors`) so imports don't
 * collide — callers explicitly pick the shape they want.
 */

/**
 * Abstract base for every domain error. Subclasses set `statusCode` and call
 * `super(message, code, details)`.
 *
 * `Object.setPrototypeOf(this, new.target.prototype)` restores the prototype
 * chain — required for `instanceof` to work on classes that extend a built-in
 * like `Error` (a long-standing TypeScript / ES2015 gotcha).
 */
export abstract class DomainError extends Error {
  abstract readonly statusCode: number;
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Wallet / ledger errors ─────────────────────────────────────────────

/** The wallet balance is below the debit amount (HTTP 400). */
export class InsufficientFundsError extends DomainError {
  readonly statusCode = 400;
  constructor(details?: Record<string, unknown>) {
    super("Insufficient funds", "INSUFFICIENT_FUNDS", details);
  }
}

/** The wallet is frozen and cannot move funds (HTTP 403). */
export class WalletFrozenError extends DomainError {
  readonly statusCode = 403;
  constructor() {
    super("Wallet is frozen", "WALLET_FROZEN");
  }
}

// ─── Auth / security errors ─────────────────────────────────────────────

/** Transaction PIN locked after too many failed attempts (HTTP 423 Locked). */
export class PinLockedError extends DomainError {
  readonly statusCode = 423;
  constructor(retryAfterSec: number) {
    super(
      "Transaction PIN locked due to too many failed attempts",
      "PIN_LOCKED",
      { retryAfterSec },
    );
  }
}

/** KYC verification required before this action (HTTP 403). */
export class KycRequiredError extends DomainError {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message, "KYC_REQUIRED");
  }
}

// ─── Compliance errors ──────────────────────────────────────────────────

/** AML / risk monitoring blocked the transaction (HTTP 400). */
export class AmlBlockedError extends DomainError {
  readonly statusCode = 400;
  constructor(reason: string) {
    super(reason, "AML_BLOCKED", { reason });
  }
}

// ─── Provider errors ────────────────────────────────────────────────────

/** A downstream provider call failed (HTTP 502 Bad Gateway). */
export class ProviderError extends DomainError {
  readonly statusCode = 502;
  constructor(message: string, provider: string) {
    super(message, "PROVIDER_ERROR", { provider });
  }
}

/**
 * The requested feature/capability is not supported by this provider (HTTP 501 Not Implemented).
 * Thrown when a provider adapter receives a call for a method it doesn't support.
 * The routing engine should catch this and try the next provider in the chain.
 */
export class ProviderFeatureUnavailable extends DomainError {
  readonly statusCode = 501;
  constructor(provider: string, feature: string) {
    super(
      `Provider ${provider} does not support ${feature}`,
      "PROVIDER_FEATURE_UNAVAILABLE",
      { provider, feature },
    );
  }
}

/**
 * Virtual account error — covers provisioning failures, not-found,
 * and provider-unavailable scenarios (HTTP 503 Service Unavailable).
 */
export class VirtualAccountError extends DomainError {
  readonly statusCode = 503;
  constructor(
    code: "PROVISIONING" | "NOT_FOUND" | "PROVIDER_UNAVAILABLE",
    message: string,
  ) {
    super(message, `VIRTUAL_ACCOUNT_${code}`);
  }
}

/**
 * Thrown by the circuit-breaker wrapper when a provider's breaker is OPEN.
 * Routes can either surface this directly (HTTP 503) or catch it and retry
 * with the next provider tier (failover).
 */
export class CircuitBreakerOpenError extends DomainError {
  readonly statusCode = 503;
  constructor(provider: string) {
    super(
      `Provider ${provider} is temporarily unavailable (circuit breaker open)`,
      "CIRCUIT_BREAKER_OPEN",
      { provider },
    );
  }
}

// ─── Concurrency / validation errors ────────────────────────────────────

/** An idempotency-key collision was detected (HTTP 409 Conflict). */
export class IdempotencyConflictError extends DomainError {
  readonly statusCode = 409;
  constructor(key: string) {
    super("Duplicate request", "IDEMPOTENCY_CONFLICT", { key });
  }
}

/** A request field failed validation (HTTP 422 Unprocessable Entity). */
export class ValidationError extends DomainError {
  readonly statusCode = 422;
  constructor(field: string, message: string) {
    super(message, "VALIDATION_ERROR", { field });
  }
}

// ─── Large Transaction Shield ───────────────────────────────────────────

/**
 * Thrown by the debit pipeline when a transaction triggers the Large
 * Transaction Shield — the user has opted in to step-up verification and the
 * amount (kobo) is at or above their configured threshold.
 *
 * Routes convert this into a 403 response with code `STEP_UP_REQUIRED` and
 * details `{ userId, amountKobo }`. The client then prompts for an OTP
 * (initiated via `/api/security/large-tx-step-up`) and retries the original
 * request after successful verification.
 *
 * HTTP 403 (not 401) is intentional: the user IS authenticated — they just
 * need to perform an additional step-up challenge before the high-value
 * debit is allowed to proceed.
 */
export class StepUpRequiredError extends DomainError {
  readonly statusCode = 403;
  constructor(message: string, public readonly userId: string, public readonly amountKobo: number) {
    super(message, "STEP_UP_REQUIRED", { userId, amountKobo });
  }
}
