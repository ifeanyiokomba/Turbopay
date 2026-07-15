/**
 * Turbopay Service Layer — Payment Intent Service.
 * =================================================
 *
 * The Turbopay reference document separates "intent to pay" from "execution
 * of payment". Turbopay historically combined them — the route handler
 * created the Transaction + debited the wallet + called the provider all in
 * one step.
 *
 * The PaymentIntent model adds value WITHOUT breaking the existing flow:
 * the `debitPipeline` creates a PaymentIntent at the START (PENDING), marks
 * it PROCESSING before the hold, SUCCEEDED on success, or FAILED on failure.
 * The existing financial Transaction record is unchanged — the intent is
 * just an additional record that tracks the lifecycle.
 *
 * This enables:
 *   - Status polling — `GET /api/payment-intent/[id]` lets the client check
 *     whether a payment is still processing without re-running it.
 *   - Intent cancellation — `PATCH /api/payment-intent/[id]` lets the user
 *     cancel a PENDING intent before execution starts. (The pipeline only
 *     cancels intents it has not yet picked up — once status flips to
 *     PROCESSING, cancellation is no longer possible.)
 *   - Analytics — the intent → execution → success/failure funnel is now
 *     observable independently of the financial ledger.
 *
 * Idempotency:
 *   An optional `idempotencyKey` is stored on the intent. The pipeline
 *   passes the same key it uses for the financial transaction, so retries
 *   with the same Idempotency-Key header collapse onto a single intent row
 *   (in addition to collapsing onto a single IdempotencyRecord).
 */

import { db } from "@/lib/db";
import type { PaymentIntent } from "@prisma/client";
import { ServiceError } from "./types";

/** Allowed intent type values — mirrors the pipeline's `type` field. */
export type PaymentIntentType =
  | "AIRTIME"
  | "DATA"
  | "BILL_ELECTRICITY"
  | "BILL_UTILITY"
  | "TRANSFER"
  | "CARD_FUND";

/** Allowed intent status values — stored as String in SQLite. */
export type PaymentIntentStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface CreateIntentOptions {
  userId: string;
  type: string;
  amountKobo: number;
  recipient?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

class IntentService {
  /**
   * Create a payment intent (validates + records the intent before execution).
   *
   * The intent is created in PENDING status. The pipeline will flip it to
   * PROCESSING once it picks the intent up, then SUCCEEDED or FAILED based
   * on the outcome.
   *
   * Validation:
   *   - amountKobo must be a positive integer
   *   - type must be a non-empty string (the pipeline constrains the actual
   *     allowed values; the service is intentionally permissive so future
   *     intent types don't require a service-layer change)
   */
  async create(opts: CreateIntentOptions): Promise<PaymentIntent> {
    if (!Number.isInteger(opts.amountKobo) || opts.amountKobo <= 0) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        "amountKobo must be a positive integer",
        422,
      );
    }
    if (!opts.type || typeof opts.type !== "string") {
      throw new ServiceError("VALIDATION_ERROR", "type is required", 422);
    }

    return db.paymentIntent.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        amountKobo: opts.amountKobo,
        currency: "NGN",
        status: "PENDING",
        recipient: opts.recipient ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        idempotencyKey: opts.idempotencyKey ?? null,
      },
    });
  }

  /**
   * Mark an intent as PROCESSING — called by the pipeline just before the
   * hold + provider call begins. Once an intent is PROCESSING, cancellation
   * is no longer allowed (the financial transaction is in flight).
   *
   * No-op if the intent is already in a terminal state (SUCCEEDED / FAILED /
   * CANCELLED) — defensive guard against duplicate pipeline invocations
   * (e.g. an idempotency-key retry that races with the original response).
   */
  async markProcessing(id: string): Promise<void> {
    await db.paymentIntent.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
  }

  /**
   * Mark an intent as SUCCEEDED and link it to the financial Transaction
   * that fulfilled it. The `transactionId` is stored in the intent's
   * metadata so the client can navigate intent → transaction when polling.
   */
  async markSucceeded(id: string, transactionId: string): Promise<void> {
    const existing = await db.paymentIntent.findUnique({
      where: { id },
      select: { metadata: true },
    });
    const meta: Record<string, unknown> = existing?.metadata
      ? (JSON.parse(existing.metadata) as Record<string, unknown>)
      : {};
    meta.transactionId = transactionId;
    meta.succeededAt = new Date().toISOString();

    await db.paymentIntent.update({
      where: { id },
      data: { status: "SUCCEEDED", metadata: JSON.stringify(meta) },
    });
  }

  /**
   * Mark an intent as FAILED. The `reason` is stored in the metadata so the
   * client can surface a human-readable error message when polling.
   */
  async markFailed(id: string, reason: string): Promise<void> {
    const existing = await db.paymentIntent.findUnique({
      where: { id },
      select: { metadata: true },
    });
    const meta: Record<string, unknown> = existing?.metadata
      ? (JSON.parse(existing.metadata) as Record<string, unknown>)
      : {};
    meta.failureReason = reason;
    meta.failedAt = new Date().toISOString();

    await db.paymentIntent.update({
      where: { id },
      data: { status: "FAILED", metadata: JSON.stringify(meta) },
    });
  }

  /**
   * Cancel a PENDING intent — only succeeds if the intent has not yet been
   * picked up by the pipeline (i.e. still PENDING). Once PROCESSING, the
   * financial transaction is in flight and cancellation is no longer safe.
   *
   * Throws `ServiceError(INTENT_NOT_CANCELLABLE, 409)` if the intent is in
   * a non-PENDING state, or `ServiceError(INTENT_NOT_FOUND, 404)` if the
   * intent doesn't exist or doesn't belong to the requesting user.
   */
  async cancel(id: string, userId: string): Promise<void> {
    const intent = await db.paymentIntent.findUnique({ where: { id } });
    if (!intent || intent.userId !== userId) {
      throw new ServiceError("INTENT_NOT_FOUND", "Payment intent not found", 404);
    }
    if (intent.status !== "PENDING") {
      throw new ServiceError(
        "INTENT_NOT_CANCELLABLE",
        `Cannot cancel an intent that is ${intent.status}`,
        409,
      );
    }
    await db.paymentIntent.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  }

  /**
   * Get an intent by ID — used by the polling endpoint. Returns null if the
   * intent doesn't exist OR doesn't belong to the requesting user (so an
   * attacker can't probe other users' intent IDs).
   */
  async get(id: string, userId: string): Promise<PaymentIntent | null> {
    const intent = await db.paymentIntent.findUnique({ where: { id } });
    if (!intent || intent.userId !== userId) return null;
    return intent;
  }
}

export const intentService = new IntentService();
