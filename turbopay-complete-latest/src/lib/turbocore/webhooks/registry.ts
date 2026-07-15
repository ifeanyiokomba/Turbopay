/**
 * TurboCore — Generic Webhook Framework
 * =====================================
 *
 * Every provider registers its webhook handler through WebhookRegistry.
 * The framework provides:
 *  - Signature verification (HMAC-SHA256 by default, extensible)
 *  - Replay protection (timestamp window)
 *  - Idempotency (keyed on (provider, providerRef) via WebhookEvent table)
 *  - Duplicate detection
 *  - Dead-letter queue (failed events stored for replay)
 *  - Structured logging (every webhook event audited)
 *  - Adapter normalisation (raw payload → internal DomainEvent)
 *  - Clean event dispatcher (no monkey-patching)
 *
 * The business layer NEVER consumes raw provider payloads. The registry
 * normalises events and hands them to a dispatcher callback registered by
 * the application route handler.
 */

import * as crypto from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { decryptPii } from "@/lib/turbopay/crypto";

/**
 * Shared demo-mode guard. The `x-turbopay-demo: 1` header lets developers
 * test webhook flows without a real HMAC secret — but it MUST NEVER be
 * accepted in a production build, otherwise an attacker can forge webhook
 * deliveries by sending that header. Every handler that falls back to demo
 * mode must call this helper instead of checking the header directly.
 */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.TURBOPAY_DISABLE_WEBHOOK_DEMO !== "1";
}

/** Check if a request carries the demo-bypass header. Only valid in non-prod. */
export function isDemoRequest(input: { headers: Record<string, string> }): boolean {
  return isDemoMode() && input.headers["x-turbopay-demo"] === "1";
}

export interface WebhookHandlerInput {
  rawBody: string;
  headers: Record<string, string>;
  /** The provider-specific event payload (already JSON-parsed by the route). */
  parsedPayload: unknown;
}

export type WebhookEvent = { type: string; data: Record<string, unknown> };

export interface WebhookHandlerResult {
  /** Normalised internal event(s) to dispatch to the business layer. */
  events: WebhookEvent[];
  /** Whether the webhook was processed successfully. */
  processed: boolean;
  /** A short status message for the 200 response to the provider. */
  status: string;
}

export interface WebhookHandler {
  /** Provider name, e.g. "monnify", "intl-receiving". */
  provider: string;
  /**
   * Verify the webhook signature. Return true if valid. Default impl checks
   * HMAC-SHA256 over the raw body using the provider's shared secret.
   */
  verifySignature(input: WebhookHandlerInput): boolean | Promise<boolean>;
  /**
   * Extract the provider's unique reference for this event (used for
   * idempotency — duplicate events with the same ref are not re-processed).
   */
  extractProviderRef(payload: unknown): string | null;
  /**
   * Normalise the raw provider payload into internal domain events.
   * Pure function — no side effects. The dispatcher handles business logic.
   */
  normalize(payload: unknown, headers: Record<string, string>): WebhookEvent[];
  /** Optional: replay-protection — reject events older than this window (ms). */
  maxAgeMs?: number;
}

/** Dispatcher callback — receives normalised events for business-layer dispatch. */
export type WebhookDispatcher = (events: WebhookEvent[], provider: string) => Promise<void>;

/**
 * Extract an event timestamp from a provider webhook payload.
 *
 * Different providers put the timestamp in different shapes/keys:
 *   - Monnify:        `eventData.paidAt`  | `payload.paidAt`  | `paidAt`
 *   - intl-receiving: `eventData.paidAt`  | `payload.paidAt`  | `paidAt`
 *   - Generic:        `createdAt` | `timestamp` | `eventTime` (top-level OR nested)
 *
 * The helper walks `payload` + its common nested envelopes (`eventData`,
 * `payload`, `data`) and returns the FIRST parseable Date it finds. Strings
 * are parsed via `Date.parse` (handles ISO-8601 + most provider formats);
 * numbers are interpreted as ms-since-epoch if > 10^12 (anything smaller is
 * almost certainly seconds, so multiply). Returns `null` if no timestamp
 * could be extracted — callers MUST treat null as "no replay check possible"
 * and allow the event (the idempotency check remains the primary defense).
 */
export function extractEventTimestamp(payload: unknown): Date | null {
  if (!payload || typeof payload !== "object") return null;
  const envelopes: unknown[] = [payload];
  // Walk the common provider envelopes — eventData, payload, data.
  for (const key of ["eventData", "payload", "data"] as const) {
    const nested = (payload as Record<string, unknown>)[key];
    if (nested && typeof nested === "object") envelopes.push(nested);
  }
  // Fields most providers use, ordered by likelihood.
  const keys = ["paidAt", "createdAt", "timestamp", "eventTime", "eventTimestamp", "paidOn", "settlementDate"];
  for (const env of envelopes) {
    if (!env || typeof env !== "object") continue;
    const rec = env as Record<string, unknown>;
    for (const key of keys) {
      const raw = rec[key];
      if (raw === undefined || raw === null) continue;
      const d = parseTimestampValue(raw);
      if (d) return d;
    }
  }
  return null;
}

/** Parse a raw timestamp value (string | number | Date) into a Date. */
function parseTimestampValue(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Heuristic: ms-since-epoch is >= 10^12 (year 2001+). Smaller numbers
    // are almost certainly seconds — multiply.
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string" && raw.length > 0) {
    // Try ISO + common formats first (Date.parse handles ISO-8601 + RFC 2822).
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}

class WebhookRegistryImpl {
  private handlers = new Map<string, WebhookHandler>();
  private dispatcher?: WebhookDispatcher;

  register(handler: WebhookHandler) {
    this.handlers.set(handler.provider, handler);
  }

  /** Register the event dispatcher (called after an event is marked PROCESSED). */
  setDispatcher(fn: WebhookDispatcher) {
    this.dispatcher = fn;
  }

  get(provider: string): WebhookHandler | undefined {
    return this.handlers.get(provider);
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Re-process a FAILED webhook event for retry. Re-normalises the stored
   * payload and dispatches the events to the business layer. Skips signature
   * verification (the event was already verified when first received).
   *
   * Called by the /api/cron/webhook-retry worker and the manual retry API.
   * Returns the normalised events (empty array if the handler is gone or
   * normalisation throws).
   */
  async reprocess(
    provider: string,
    parsedPayload: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ events: WebhookEvent[]; error?: string }> {
    const handler = this.get(provider);
    if (!handler) {
      return { events: [], error: "Handler no longer registered" };
    }
    try {
      const events = handler.normalize(parsedPayload, headers);
      if (this.dispatcher && events.length > 0) {
        await this.dispatcher(events, provider);
      }
      return { events };
    } catch (err: any) {
      return { events: [], error: err?.message ?? "NORMALIZE_FAILED" };
    }
  }

  /**
   * Process an inbound webhook: verify → dedup → normalize → persist → dispatch.
   * Returns a 200-shaped result for the provider. Failed events land in the
   * dead-letter queue (WebhookEvent with status=FAILED) for replay.
   *
   * The normalised events are returned in the result body so the caller can
   * dispatch them to the business layer via the registered dispatcher.
   */
  async process(provider: string, input: WebhookHandlerInput): Promise<{ status: number; body: { status: string; processed: boolean; reason?: string; events?: WebhookEvent[] } }> {
    const handler = this.get(provider);
    if (!handler) {
      await audit({ action: "WEBHOOK_UNKNOWN_PROVIDER", category: "WEBHOOK", severity: "WARN", metadata: { provider } });
      return { status: 404, body: { status: "unknown_provider", processed: false } };
    }

    // 1. Signature verification
    if (!(await handler.verifySignature(input))) {
      await audit({ action: "WEBHOOK_SIGNATURE_INVALID", category: "WEBHOOK", severity: "CRITICAL", metadata: { provider } });
      return { status: 401, body: { status: "invalid_signature", processed: false } };
    }

    // 1b. Replay protection — if the handler declares a maxAgeMs window,
    //     reject events whose timestamp is older than the window. This runs
    //     AFTER signature verification (so only authentic events are surfaced
    //     as stale) but BEFORE the idempotency check (so a stale event is
    //     rejected even on its first delivery, not just on replays).
    //
    //     If no timestamp can be extracted from the payload we ALLOW the
    //     event — the idempotency check remains the primary defense and we
    //     must not break existing flows whose providers don't include a
    //     parseable timestamp.
    if (handler.maxAgeMs && handler.maxAgeMs > 0) {
      const eventTime = extractEventTimestamp(input.parsedPayload);
      if (eventTime) {
        const ageMs = Date.now() - eventTime.getTime();
        if (ageMs > handler.maxAgeMs) {
          await audit({
            action: "WEBHOOK_STALE",
            category: "WEBHOOK",
            severity: "WARN",
            metadata: { provider, ageMs, maxAgeMs: handler.maxAgeMs, eventTime: eventTime.toISOString() },
          });
          return { status: 401, body: { status: "stale_webhook", processed: false, reason: `STALE_WEBHOOK: event is ${Math.floor(ageMs / 1000)}s old (max ${Math.floor(handler.maxAgeMs / 1000)}s)` } };
        }
      }
    }

    const providerRef = handler.extractProviderRef(input.parsedPayload);
    if (!providerRef) {
      await audit({ action: "WEBHOOK_NO_REF", category: "WEBHOOK", severity: "WARN", metadata: { provider } });
      return { status: 200, body: { status: "ignored_no_ref", processed: false } };
    }

    // 2. Idempotency — has this exact event been processed before?
    const existing = await db.webhookEvent.findFirst({
      where: { provider, providerRef, status: "PROCESSED" },
    });
    if (existing) {
      return { status: 200, body: { status: "duplicate", processed: true } };
    }

    // 3. Persist the event (PENDING). Extract the signature generically —
    //    find any header whose name contains "signature" (case-insensitive).
    const signatureHeader =
      Object.entries(input.headers).find(([k]) => k.toLowerCase().includes("signature"))?.[1] ?? null;

    const event = await db.webhookEvent.create({
      data: {
        provider,
        providerRef,
        payload: input.rawBody.slice(0, 16384), // cap storage
        signature: signatureHeader,
        status: "PENDING",
        receivedAt: new Date(),
      },
    }).catch(() => null); // tolerate a missing table in older DBs

    try {
      // 4. Normalise into domain events (pure function — no side effects)
      const events = handler.normalize(input.parsedPayload, input.headers);
      // 5. Mark processed
      if (event) {
        await db.webhookEvent.updateMany({ where: { id: event.id }, data: { status: "PROCESSED", processedAt: new Date() } });
      }
      await audit({
        action: "WEBHOOK_PROCESSED",
        category: "WEBHOOK",
        severity: "INFO",
        metadata: { provider, providerRef, eventCount: events.length },
      });
      // 6. Dispatch events to the business layer (fire-and-forget with try/catch).
      //    The dispatcher is registered by the route handler. If it throws,
      //    the event is still marked PROCESSED (the normalisation succeeded);
      //    the dispatcher itself should handle retries for business failures.
      if (this.dispatcher && events.length > 0) {
        try {
          await this.dispatcher(events, provider);
        } catch (dispatchErr: any) {
          await audit({
            action: "WEBHOOK_DISPATCH_FAILED",
            category: "WEBHOOK",
            severity: "WARN",
            metadata: { provider, providerRef, error: dispatchErr?.message },
          });
        }
      }
      return { status: 200, body: { status: "ok", processed: true, events } };
    } catch (err: any) {
      // 7. Dead-letter — store the failure for replay
      if (event) {
        await db.webhookEvent.updateMany({
          where: { id: event.id },
          data: { status: "FAILED", error: (err?.message ?? "UNKNOWN").slice(0, 1000) },
        });
      }
      await audit({
        action: "WEBHOOK_PROCESSING_FAILED",
        category: "WEBHOOK",
        severity: "ERROR",
        metadata: { provider, providerRef, error: err?.message },
      });
      return { status: 200, body: { status: "processing_failed", processed: false, reason: err?.message } };
    }
  }
}

export const webhookRegistry = new WebhookRegistryImpl();

// ─── Default HMAC-SHA256 verifier factory ─────────────────────

export function hmacVerifier(secretEnv: string, headerName: string): (input: WebhookHandlerInput) => boolean {
  return (input) => {
    const secret = process.env[secretEnv];
    // In demo/dev without a secret, accept the X-Turbopay-Demo header only.
    // Never accepted in production (isDemoRequest checks NODE_ENV).
    if (!secret) {
      return isDemoRequest(input);
    }
    const provided = input.headers[headerName] ?? input.headers[headerName.toLowerCase()] ?? "";
    if (!provided) return false;
    const expected = crypto.createHmac("sha256", secret).update(input.rawBody).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  };
}

/**
 * DB-aware HMAC verifier — checks the WebhookEndpoint table for a stored
 * (encrypted) secret first, then falls back to the env var. This lets admins
 * paste a webhook secret into the admin UI and have it take effect immediately
 * without a restart or SSH access.
 *
 * @param algorithm — HMAC algorithm (default "sha256"). Use "sha512" for
 *   providers like Interswitch/Quickteller that sign with HMAC-SHA512.
 */
export function hmacVerifierFromDb(
  providerName: string,
  headerName: string,
  envFallback: string,
  algorithm: string = "sha256",
): (input: WebhookHandlerInput) => Promise<boolean> {
  return async (input) => {
    // 1. Try DB-stored secret first.
    try {
      const endpoint = await db.webhookEndpoint.findFirst({
        where: { providerName, enabled: true },
        select: { secretEnc: true },
      });
      if (endpoint?.secretEnc) {
        const secret = decryptPii(endpoint.secretEnc);
        const sig = input.headers[headerName] ?? input.headers[headerName.toLowerCase()] ?? "";
        if (!sig) return false;
        const expected = crypto.createHmac(algorithm, secret).update(input.rawBody).digest("hex");
        try {
          return crypto.timingSafeEqual(Buffer.from(sig.replace(/^sha\d+=/, "")), Buffer.from(expected));
        } catch {
          return false;
        }
      }
    } catch {
      /* fall through to env var */
    }
    // 2. Fall back to env var (backward compat).
    const secret = process.env[envFallback];
    if (!secret) {
      // Dev demo mode: accept X-Turbopay-Demo header (never in production).
      return isDemoRequest(input);
    }
    const sig = input.headers[headerName] ?? input.headers[headerName.toLowerCase()] ?? "";
    if (!sig) return false;
    const expected = crypto.createHmac(algorithm, secret).update(input.rawBody).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(sig.replace(/^sha\d+=/, "")), Buffer.from(expected));
    } catch {
      return false;
    }
  };
}

// ─── Register the built-in handlers (pure — no side effects) ──

import { monnifyWebhookHandler } from "@/lib/turbocore/webhooks/handlers/monnify";
import { intlReceivingWebhookHandler } from "@/lib/turbocore/webhooks/handlers/intl-receiving";
import { paystackWebhookHandler } from "@/lib/turbocore/webhooks/handlers/paystack";
import { baxiWebhookHandler } from "@/lib/turbocore/webhooks/handlers/baxi";
import { flutterwaveWebhookHandler } from "@/lib/turbocore/webhooks/handlers/flutterwave";
import { wiseWebhookHandler } from "@/lib/turbocore/webhooks/handlers/wise";
import { stripeIssuingWebhookHandler } from "@/lib/turbocore/webhooks/handlers/stripe-issuing";
import { dojahWebhookHandler } from "@/lib/turbocore/webhooks/handlers/dojah";
import { termiiWebhookHandler } from "@/lib/turbocore/webhooks/handlers/termii";
import { resendWebhookHandler } from "@/lib/turbocore/webhooks/handlers/resend";
import { remitaWebhookHandler } from "@/lib/turbocore/webhooks/handlers/remita";
import { quicktellerWebhookHandler } from "@/lib/turbocore/webhooks/handlers/quickteller";
import { onafriqWebhookHandler } from "@/lib/turbocore/webhooks/handlers/onafriq";

webhookRegistry.register(monnifyWebhookHandler);
webhookRegistry.register(intlReceivingWebhookHandler);
webhookRegistry.register(paystackWebhookHandler);
webhookRegistry.register(baxiWebhookHandler);
webhookRegistry.register(flutterwaveWebhookHandler);
webhookRegistry.register(wiseWebhookHandler);
webhookRegistry.register(stripeIssuingWebhookHandler);
webhookRegistry.register(dojahWebhookHandler);
webhookRegistry.register(termiiWebhookHandler);
webhookRegistry.register(resendWebhookHandler);
webhookRegistry.register(remitaWebhookHandler);
webhookRegistry.register(quicktellerWebhookHandler);
webhookRegistry.register(onafriqWebhookHandler);

export {
  monnifyWebhookHandler,
  intlReceivingWebhookHandler,
  paystackWebhookHandler,
  baxiWebhookHandler,
  flutterwaveWebhookHandler,
  wiseWebhookHandler,
  stripeIssuingWebhookHandler,
  dojahWebhookHandler,
  termiiWebhookHandler,
  resendWebhookHandler,
  remitaWebhookHandler,
  quicktellerWebhookHandler,
  onafriqWebhookHandler,
};
