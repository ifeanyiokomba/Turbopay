import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { DomainError } from "@/lib/turbopay/errors";
import { AuthError } from "@/lib/turbopay/auth";
import { ServiceError } from "@/lib/turbopay/services/types";
import { LedgerError } from "@/lib/turbopay/ledger";
import { logger } from "@/lib/turbocore/logger";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function errorJson(
  message: string,
  status = 400,
  code?: string,
  details?: unknown,
  headers?: Record<string, string>
) {
  return NextResponse.json({ error: message, code, details }, { status, headers });
}

/** Read the Idempotency-Key header (case-insensitive). */
export function idempotencyKey(headers: Headers): string | null {
  return headers.get("idempotency-key") || headers.get("Idempotency-Key") || null;
}

/**
 * Convert a thrown error into a JSON `Response`.
 *
 * Recognised error types (in priority order):
 *   1. `DomainError`           — the new structured framework (`@/lib/turbopay/errors`).
 *                                Carries `statusCode` + `code` + optional `details`.
 *   2. `ServiceError`          — service-layer business error (legacy, mirrors AuthError).
 *                                Carries `status` + `code`.
 *   3. `AuthError`             — auth / session error. Carries `status` + `code`.
 *   4. `LedgerError`           — ledger double-entry error. Carries `code`; HTTP
 *                                status is mapped from the code (INSUFFICIENT_FUNDS → 400,
 *                                WALLET_FROZEN → 403, default 400).
 *   5. Anything else           — surfaced as a generic 500 with the error message
 *                                (or "Internal server error" if not an Error).
 *
 * Usage in a route handler:
 *   ```ts
 *   try {
 *     const result = await billingService.buyAirtime(...);
 *     return json({ data: result });
 *   } catch (e) {
 *     return handleError(e);
 *   }
 *   ```
 *
 * The helper is non-destructive: existing routes that catch `ServiceError` /
 * `AuthError` / `LedgerError` explicitly and call `errorJson(...)` themselves
 * keep working unchanged. New code can adopt `throw new InsufficientFundsError()`
 * + `handleError(e)` for a cleaner shape.
 */
export function handleError(e: unknown): Response {
  if (e instanceof DomainError) {
    return errorJson(e.message, e.statusCode, e.code, e.details);
  }
  if (e instanceof ServiceError) {
    return errorJson(e.message, e.status, e.code);
  }
  if (e instanceof AuthError) {
    return errorJson(e.message, e.status, e.code);
  }
  if (e instanceof LedgerError) {
    const status =
      e.code === "INSUFFICIENT_FUNDS" ? 400 :
      e.code === "WALLET_FROZEN" ? 403 :
      e.code === "WALLET_NOT_FOUND" ? 404 :
      400;
    return errorJson(e.message, status, e.code);
  }
  // Unhandled errors: log details server-side, report to Sentry, return generic message to client.
  // This prevents internal details (DB errors, provider responses, stack traces)
  // from leaking to the client in production.
  logger.error("api.unhandled_error", { error: e instanceof Error ? e.message : String(e) });
  if (e instanceof Error) Sentry.captureException(e);
  return errorJson("Internal server error", 500, "INTERNAL_ERROR");
}
