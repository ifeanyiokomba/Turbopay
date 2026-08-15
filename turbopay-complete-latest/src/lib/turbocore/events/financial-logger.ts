/**
 * TurboCore — Financial Event Logger
 * =====================================
 *
 * Structured logging for all important financial operations. Each event
 * includes correlation IDs, transaction IDs, provider references, and
 * timing information for end-to-end tracing.
 *
 * Event categories:
 *   - transaction.* — lifecycle events (created, processing, pending, success, failed, reversed)
 *   - wallet.* — debit, credit, reversal
 *   - ledger.* — entry created, entry reversed
 *   - provider.* — selected, request started/succeeded/failed, timeout, fallback
 *   - webhook.* — received, verified, rejected, duplicate
 *   - reconciliation.* — started, completed, mismatch
 *
 * Usage:
 *   import { financialEvents } from "@/lib/turbocore/events/financial-logger";
 *
 *   await financialEvents.transactionCreated({
 *     transactionId: "txn_abc123",
 *     reference: "TP-XXXXXXXX",
 *     userId: "user_123",
 *     provider: "paystack",
 *     operation: "funding",
 *     amountKobo: 500000,
 *     currency: "NGN",
 *     correlationId: "...",
 *   });
 */

import { logger } from "@/lib/turbocore/logger";
import { eventBus } from "@/lib/turbocore/events/bus";
import { generateCorrelationId } from "@/lib/turbocore/correlation";

// ─── Base Event Context ─────────────────────────────────────

export interface EventContext {
  correlationId?: string;
  requestId?: string;
  transactionId?: string;
  provider?: string;
  operation?: string;
  userId?: string;
  timestamp?: Date;
}

function ctx(overrides?: Record<string, unknown>) {
  return {
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Transaction Events ─────────────────────────────────────

export interface TransactionEventBase {
  transactionId: string;
  reference: string;
  userId?: string;
  provider?: string;
  operation?: string;
  amountKobo?: number;
  currency?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export async function transactionCreated(e: TransactionEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  const logCtx = ctx({ correlationId, transactionId: e.transactionId, provider: e.provider, operation: e.operation, userId: e.userId });

  logger.info("transaction.created", { ...logCtx, reference: e.reference, amountKobo: e.amountKobo, currency: e.currency, ...e.metadata });

  await eventBus.publish("transfer.created", {
    userId: e.userId ?? "",
    reference: e.reference,
    amountKobo: e.amountKobo ?? 0,
    type: e.operation ?? "unknown",
  }, { correlationId });
}

export async function transactionProcessing(e: TransactionEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("transaction.processing", ctx({ correlationId, transactionId: e.transactionId, provider: e.provider, operation: e.operation }));
}

export async function transactionPending(e: TransactionEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("transaction.pending", ctx({ correlationId, transactionId: e.transactionId, provider: e.provider, operation: e.operation }));
}

export async function transactionSuccess(e: TransactionEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  const logCtx = ctx({ correlationId, transactionId: e.transactionId, provider: e.provider, operation: e.operation, userId: e.userId });

  logger.info("transaction.success", { ...logCtx, reference: e.reference, amountKobo: e.amountKobo, currency: e.currency });

  await eventBus.publish("transfer.completed", {
    userId: e.userId ?? "",
    reference: e.reference,
    amountKobo: e.amountKobo ?? 0,
  }, { correlationId });
}

export async function transactionFailed(e: TransactionEventBase & { error?: string }) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  const logCtx = ctx({ correlationId, transactionId: e.transactionId, provider: e.provider, operation: e.operation, userId: e.userId });

  logger.warn("transaction.failed", { ...logCtx, reference: e.reference, amountKobo: e.amountKobo ?? 0, error: e.error });

  await eventBus.publish("transfer.failed", {
    userId: e.userId ?? "",
    reference: e.reference,
    error: e.error ?? "unknown",
  }, { correlationId });
}

export async function transactionReversed(e: TransactionEventBase & { reason?: string }) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("transaction.reversed", ctx({ correlationId, transactionId: e.transactionId, provider: e.provider, operation: e.operation, reason: e.reason }));
}

// ─── Wallet Events ──────────────────────────────────────────

export interface WalletEventBase {
  walletId: string;
  userId?: string;
  amountKobo: number;
  reference?: string;
  correlationId?: string;
}

export async function walletDebit(e: WalletEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("wallet.debit", ctx({ correlationId, walletId: e.walletId, userId: e.userId, amountKobo: e.amountKobo, reference: e.reference }) as Record<string, unknown>);

  await eventBus.publish("wallet.debited", {
    userId: e.userId ?? "",
    walletId: e.walletId,
    amountKobo: e.amountKobo,
    reference: e.reference ?? "",
  }, { correlationId });
}

export async function walletCredit(e: WalletEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("wallet.credit", ctx({ correlationId, walletId: e.walletId, userId: e.userId, amountKobo: e.amountKobo, reference: e.reference }) as Record<string, unknown>);

  await eventBus.publish("wallet.credited", {
    userId: e.userId ?? "",
    walletId: e.walletId,
    amountKobo: e.amountKobo,
    reference: e.reference ?? "",
  }, { correlationId });
}

export async function walletReversal(e: WalletEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("wallet.reversal", ctx({ correlationId, walletId: e.walletId, userId: e.userId, amountKobo: e.amountKobo, reference: e.reference }) as Record<string, unknown>);
}

// ─── Ledger Events ──────────────────────────────────────────

export interface LedgerEventBase {
  ledgerEntryId: string;
  walletId: string;
  entryType: string;
  amountKobo: number;
  refType?: string;
  correlationId?: string;
}

export async function ledgerEntryCreated(e: LedgerEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("ledger.entry.created", ctx({ correlationId, ledgerEntryId: e.ledgerEntryId, walletId: e.walletId, entryType: e.entryType, amountKobo: e.amountKobo }) as Record<string, unknown>);

  // Note: ledger.posted event is published via the event bus for downstream consumers.
}

export async function ledgerEntryReversed(e: LedgerEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("ledger.entry.reversed", ctx({ correlationId, ledgerEntryId: e.ledgerEntryId, walletId: e.walletId, entryType: e.entryType, amountKobo: e.amountKobo }) as Record<string, unknown>);
}

// ─── Provider Events ────────────────────────────────────────

export interface ProviderEventBase {
  provider: string;
  contract?: string;
  correlationId?: string;
  latencyMs?: number;
  error?: string;
  selectionReason?: string;
}

export async function providerSelected(e: ProviderEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("provider.selected", ctx({ correlationId, provider: e.provider, operation: e.contract, selectionReason: e.selectionReason }) as Record<string, unknown>);
}

export async function providerRequestStarted(e: ProviderEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("provider.request.started", ctx({ correlationId, provider: e.provider, operation: e.contract }));
}

export async function providerRequestSucceeded(e: ProviderEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("provider.request.succeeded", { ...ctx({ correlationId, provider: e.provider, operation: e.contract }), latencyMs: e.latencyMs });
}

export async function providerRequestFailed(e: ProviderEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("provider.request.failed", { ...ctx({ correlationId, provider: e.provider, operation: e.contract }), error: e.error, latencyMs: e.latencyMs });
}

export async function providerTimeout(e: ProviderEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("provider.timeout", { ...ctx({ correlationId, provider: e.provider, operation: e.contract }), latencyMs: e.latencyMs });
}

export async function providerFallback(e: ProviderEventBase & { fromProvider?: string; toProvider?: string }) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("provider.fallback", { ...ctx({ correlationId, provider: e.provider, operation: e.contract }), fromProvider: e.fromProvider, toProvider: e.toProvider });
}

// ─── Webhook Events ─────────────────────────────────────────

export interface WebhookEventBase {
  provider: string;
  providerRef?: string;
  eventType?: string;
  correlationId?: string;
}

export async function webhookReceived(e: WebhookEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("webhook.received", ctx({ correlationId, provider: e.provider, providerRef: e.providerRef, operation: e.eventType }) as Record<string, unknown>);

  // Webhook received event published via event bus.
}

export async function webhookVerified(e: WebhookEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("webhook.verified", ctx({ correlationId, provider: e.provider, providerRef: e.providerRef }) as Record<string, unknown>);
}

export async function webhookRejected(e: WebhookEventBase & { reason?: string }) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("webhook.rejected", { ...ctx({ correlationId, provider: e.provider, providerRef: e.providerRef }) as Record<string, unknown>, reason: e.reason });
}

export async function webhookDuplicate(e: WebhookEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("webhook.duplicate", ctx({ correlationId, provider: e.provider, providerRef: e.providerRef }) as Record<string, unknown>);
}

// ─── Reconciliation Events ──────────────────────────────────

export interface ReconciliationEventBase {
  reconciliationRunId: string;
  transactionId?: string;
  correlationId?: string;
  mismatchType?: string;
  details?: Record<string, unknown>;
}

export async function reconciliationStarted(e: ReconciliationEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("reconciliation.started", ctx({ correlationId, reconciliationRunId: e.reconciliationRunId }) as Record<string, unknown>);
}

export async function reconciliationCompleted(e: ReconciliationEventBase & { matched?: number; mismatched?: number }) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.info("reconciliation.completed", { ...ctx({ correlationId, reconciliationRunId: e.reconciliationRunId }) as Record<string, unknown>, matched: e.matched, mismatched: e.mismatched });
}

export async function reconciliationMismatch(e: ReconciliationEventBase) {
  const correlationId = e.correlationId ?? generateCorrelationId();
  logger.warn("reconciliation.mismatch", { ...ctx({ correlationId, reconciliationRunId: e.reconciliationRunId, transactionId: e.transactionId }) as Record<string, unknown>, mismatchType: e.mismatchType, ...e.details });
}

// ─── Export as namespace ─────────────────────────────────────

export const financialEvents = {
  // Transaction
  transactionCreated,
  transactionProcessing,
  transactionPending,
  transactionSuccess,
  transactionFailed,
  transactionReversed,

  // Wallet
  walletDebit,
  walletCredit,
  walletReversal,

  // Ledger
  ledgerEntryCreated,
  ledgerEntryReversed,

  // Provider
  providerSelected,
  providerRequestStarted,
  providerRequestSucceeded,
  providerRequestFailed,
  providerTimeout,
  providerFallback,

  // Webhook
  webhookReceived,
  webhookVerified,
  webhookRejected,
  webhookDuplicate,

  // Reconciliation
  reconciliationStarted,
  reconciliationCompleted,
  reconciliationMismatch,
};
