/**
 * TurboCore — Transaction Event Recorder
 * ========================================
 *
 * Records every lifecycle event for a transaction into the TransactionEvent
 * table. Used by the investigation timeline to reconstruct the full history.
 *
 * Events are recorded asynchronously (fire-and-forget) so they never block
 * the financial operation. If the event recording fails, the transaction
 * still succeeds — observability must never block business logic.
 *
 * Usage:
 *   import { recordTransactionEvent } from "@/lib/turbocore/observability/transaction-events";
 *
 *   await recordTransactionEvent({
 *     transactionId: "txn_abc123",
 *     eventType: "transaction.created",
 *     eventSource: "api",
 *     provider: "paystack",
 *     amountKobo: 500000,
 *     correlationId: "...",
 *     metadata: { description: "Wallet funding initiated" },
 *   });
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";

// ─── Types ────────────────────────────────────────────────────

export interface TransactionEventInput {
  transactionId: string;
  eventType: string;
  eventSource?: string;
  actorId?: string;
  provider?: string;
  providerRef?: string;
  amountKobo?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

// ─── Event Recorder ───────────────────────────────────────────

/**
 * Record a transaction lifecycle event. Fire-and-forget — never blocks
 * the caller. Errors are logged but not thrown.
 */
export async function recordTransactionEvent(input: TransactionEventInput): Promise<void> {
  try {
    await db.transactionEvent.create({
      data: {
        transactionId: input.transactionId,
        eventType: input.eventType,
        eventSource: input.eventSource ?? "system",
        actorId: input.actorId ?? null,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        amountKobo: input.amountKobo ?? null,
        correlationId: input.correlationId ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (error) {
    // Never fail the transaction for observability
    logger.warn("transaction_event.record_failed", {
      transactionId: input.transactionId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record multiple events in a batch. Fire-and-forget.
 */
export async function recordTransactionEvents(events: TransactionEventInput[]): Promise<void> {
  try {
    await db.transactionEvent.createMany({
      data: events.map((e) => ({
        transactionId: e.transactionId,
        eventType: e.eventType,
        eventSource: e.eventSource ?? "system",
        actorId: e.actorId ?? null,
        provider: e.provider ?? null,
        providerRef: e.providerRef ?? null,
        amountKobo: e.amountKobo ?? null,
        correlationId: e.correlationId ?? null,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
      })),
    });
  } catch (error) {
    logger.warn("transaction_events.batch_record_failed", {
      count: events.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─── Convenience Wrappers ─────────────────────────────────────

export async function recordTransactionCreated(opts: {
  transactionId: string;
  reference: string;
  userId: string;
  type: string;
  amountKobo: number;
  provider?: string;
  correlationId?: string;
}): Promise<void> {
  await recordTransactionEvent({
    transactionId: opts.transactionId,
    eventType: "transaction.created",
    eventSource: "api",
    actorId: opts.userId,
    provider: opts.provider,
    amountKobo: opts.amountKobo,
    correlationId: opts.correlationId,
    metadata: {
      description: `${opts.type} created`,
      reference: opts.reference,
    },
  });
}

export async function recordTransactionStateChange(opts: {
  transactionId: string;
  fromState: string;
  toState: string;
  userId?: string;
  provider?: string;
  providerRef?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordTransactionEvent({
    transactionId: opts.transactionId,
    eventType: `state.${opts.toState.toLowerCase()}`,
    eventSource: "system",
    actorId: opts.userId,
    provider: opts.provider,
    providerRef: opts.providerRef,
    correlationId: opts.correlationId,
    metadata: {
      description: `State changed: ${opts.fromState} → ${opts.toState}`,
      fromState: opts.fromState,
      toState: opts.toState,
      ...opts.metadata,
    },
  });
}

export async function recordProviderRequest(opts: {
  transactionId: string;
  provider: string;
  providerRef?: string;
  contract: string;
  correlationId?: string;
  success: boolean;
  latencyMs: number;
  error?: string;
}): Promise<void> {
  await recordTransactionEvent({
    transactionId: opts.transactionId,
    eventType: opts.success ? "provider.succeeded" : "provider.failed",
    eventSource: "provider",
    provider: opts.provider,
    providerRef: opts.providerRef,
    correlationId: opts.correlationId,
    metadata: {
      description: opts.success
        ? `Provider ${opts.provider} request succeeded (${opts.latencyMs}ms)`
        : `Provider ${opts.provider} request failed: ${opts.error ?? "unknown"}`,
      contract: opts.contract,
      latencyMs: opts.latencyMs,
      error: opts.error,
    },
  });
}

export async function recordWebhookEvent(opts: {
  transactionId: string;
  provider: string;
  providerRef: string;
  eventType: string;
  success: boolean;
  correlationId?: string;
}): Promise<void> {
  await recordTransactionEvent({
    transactionId: opts.transactionId,
    eventType: opts.success ? "webhook.processed" : "webhook.failed",
    eventSource: "webhook",
    provider: opts.provider,
    providerRef: opts.providerRef,
    correlationId: opts.correlationId,
    metadata: {
      description: `Webhook ${opts.success ? "processed" : "failed"}: ${opts.eventType}`,
      webhookEventType: opts.eventType,
    },
  });
}

export async function recordLedgerEvent(opts: {
  transactionId: string;
  entryType: "DEBIT" | "CREDIT";
  amountKobo: number;
  walletId: string;
  correlationId?: string;
}): Promise<void> {
  await recordTransactionEvent({
    transactionId: opts.transactionId,
    eventType: opts.entryType === "CREDIT" ? "ledger.credited" : "ledger.debited",
    eventSource: "ledger",
    amountKobo: opts.amountKobo,
    correlationId: opts.correlationId,
    metadata: {
      description: `Ledger ${opts.entryType.toLowerCase()}: ${(opts.amountKobo / 100).toFixed(2)} NGN`,
      walletId: opts.walletId,
      entryType: opts.entryType,
    },
  });
}
