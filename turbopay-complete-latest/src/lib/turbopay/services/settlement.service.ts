/**
 * Turbopay Service Layer — Settlement Queue.
 * ===========================================
 *
 * When an external bank transfer fails transiently (5xx, timeout, network
 * error) or the orchestrator crashes after the provider returned a reference
 * but before the confirm step committed, the transaction is enqueued here for
 * the settlement worker to reconcile.
 *
 * The queue is an ADDITIONAL safety net layered on top of the existing
 * stuck-transaction sweeper (`/api/cron/stuck-transactions`):
 *
 *   ── Stuck-transaction sweeper ─────────────────────────────────────────
 *      Runs every 5 minutes. Catches PENDING transactions older than the
 *      2-minute SLA. If no providerRef → mark TIMEOUT + reverse the hold.
 *      If providerRef exists → it now ENQUEUES the transaction into this
 *      queue (instead of just auditing CRITICAL) so the settlement worker
 *      can run the provider status check on the next tick.
 *
 *   ── Settlement worker (this service) ──────────────────────────────────
 *      Runs every 5 minutes (offset from the sweeper). Picks up PENDING /
 *      RETRYING rows whose `nextRetryAt` has elapsed. For each row:
 *        • If a `providerRef` exists → query the provider for the transfer
 *          status (ILocalTransferProvider.getTransferStatus).
 *            - SUCCESS → confirm the Transaction (status SUCCESS) + mark
 *              SETTLED.
 *            - FAILED  → reverse the ledger entry + mark FAILED.
 *            - PENDING → increment attempts, set nextRetryAt with exponential
 *              backoff (1min · 2^attempts, capped at 30 min).
 *        • If no `providerRef` → increment attempts + backoff. After
 *          `maxAttempts`, mark FAILED. The actual ledger reversal for the
 *          no-providerRef case is handled by the stuck-transaction sweeper
 *          (it is the authoritative path for that scenario — re-executing a
 *          transfer without a providerRef is unsafe: a concurrent retry by
 *          the original caller could double-charge the wallet).
 *
 * The two workers are complementary: the sweeper handles hard crashes (no
 * providerRef → safe to reverse), the settlement worker handles soft
 * failures (providerRef exists → must query the provider before reversing).
 *
 * Exponential backoff: 2^attempts minutes, capped at 30 minutes.
 *   attempt 1 → next retry in 2 min
 *   attempt 2 → next retry in 4 min
 *   attempt 3 → next retry in 8 min
 *   attempt 4 → next retry in 16 min
 *   attempt 5 → next retry in 30 min (capped)
 *   attempt 6 → mark FAILED
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { reverseEntry } from "@/lib/turbopay/ledger";
import { transitionState, markTimeout } from "@/lib/turbopay/tx-state";
import { providers } from "@/lib/turbocore/providers/registry";
import { logger } from "@/lib/turbocore/logger";

/** Settlement row states. */
export type SettlementStatus =
  | "PENDING"
  | "PROCESSING"
  | "SETTLED"
  | "FAILED"
  | "RETRYING";

/** Maximum backoff between retries (30 minutes). */
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/** Base backoff unit (1 minute; effective retry is 2^attempts × this). */
const BASE_BACKOFF_MS = 60 * 1000;
/** Default max attempts. */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Compute the next-retry timestamp for a given attempt count (exponential backoff). */
function computeNextRetry(attempts: number): Date {
  const exp = Math.pow(2, attempts); // 2, 4, 8, 16, 32, …
  const delay = Math.min(exp * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
  return new Date(Date.now() + delay);
}

class SettlementService {
  /**
   * Enqueue a failed external transfer for retry.
   *
   * Idempotent: if a settlement row already exists for this transaction,
   * the call is a no-op (returns without writing). This lets the
   * stuck-transaction sweeper call `enqueue` on every tick without
   * creating duplicates.
   */
  async enqueue(
    transactionId: string,
    providerRef?: string | null,
    error?: string,
  ): Promise<void> {
    try {
      // Idempotency: skip if a row already exists for this transaction.
      const existing = await db.settlementQueue.findUnique({
        where: { transactionId },
        select: { id: true, status: true },
      });
      if (existing) {
        // If the existing row is already terminal, do nothing. Otherwise
        // update the providerRef / lastError (the sweeper may have a more
        // accurate providerRef now than when the row was first enqueued).
        if (existing.status === "SETTLED" || existing.status === "FAILED") {
          return;
        }
        await db.settlementQueue.update({
          where: { id: existing.id },
          data: {
            providerRef: providerRef ?? undefined,
            lastError: error ?? undefined,
          },
        });
        return;
      }

      await db.settlementQueue.create({
        data: {
          transactionId,
          providerRef: providerRef ?? null,
          status: "PENDING",
          attempts: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          // First retry is immediate — the worker picks it up on the next tick.
          nextRetryAt: new Date(),
          lastError: error ?? null,
        },
      });

      await audit({
        userId: undefined,
        action: "SETTLEMENT_ENQUEUED",
        category: "WALLET",
        severity: "WARN",
        metadata: { transactionId, providerRef: providerRef ?? null, error: error ?? null },
      }).catch(() => null);
    } catch (e) {
      // Enqueue must never block the caller (the sweeper).
      logger.error("settlement.enqueue.failed", {
        transactionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Process the next pending settlement. Called by the cron worker.
   *
   * Returns `{ processed: false }` if no eligible row was found.
   * Returns `{ processed: true, result }` after handling one row — the
   * `result` is one of "SETTLED" | "FAILED" | "RETRYING" | "SKIPPED".
   */
  async processNext(): Promise<{ processed: boolean; result?: string }> {
    // 1. Atomically claim the oldest eligible row. The conditional
    //    updateMany (status ∈ {PENDING, RETRYING} AND nextRetryAt <= now)
    //    acts as a distributed lock — two concurrent workers cannot pick
    //    up the same row.
    const now = new Date();
    const claim = await db.settlementQueue.findFirst({
      where: {
        status: { in: ["PENDING", "RETRYING"] as SettlementStatus[] },
        nextRetryAt: { lte: now },
      },
      orderBy: { nextRetryAt: "asc" },
      take: 1,
    });
    if (!claim) {
      return { processed: false };
    }

    // Mark PROCESSING. The `updateMany` with `WHERE id = ? AND status IN (...)`
    // is the conditional claim — if another worker beat us, this returns 0.
    const claimed = await db.settlementQueue.updateMany({
      where: { id: claim.id, status: { in: ["PENDING", "RETRYING"] as SettlementStatus[] } },
      data: { status: "PROCESSING" as SettlementStatus },
    });
    if (claimed.count === 0) {
      // Lost the race — another worker is handling this row.
      return { processed: false };
    }

    // 2. Load the linked Transaction.
    const tx = await db.transaction.findUnique({
      where: { id: claim.transactionId },
      select: {
        id: true,
        reference: true,
        userId: true,
        walletId: true,
        type: true,
        status: true,
        state: true,
        provider: true,
        providerRef: true,
        amountKobo: true,
        metadata: true,
      },
    });

    if (!tx) {
      // Transaction was deleted (shouldn't happen — FK is ON DELETE CASCADE,
      // which would have deleted the settlement row too). Mark FAILED + bail.
      await db.settlementQueue.update({
        where: { id: claim.id },
        data: { status: "FAILED" as SettlementStatus, lastError: "TRANSACTION_NOT_FOUND" },
      });
      return { processed: true, result: "FAILED" };
    }

    // If the Transaction is already terminal (SUCCESS / FAILED / REVERSED),
    // the original orchestrator (or another worker) finished it — mark the
    // settlement SETTLED or FAILED to match and bail.
    if (tx.status === "SUCCESS") {
      await db.settlementQueue.update({
        where: { id: claim.id },
        data: { status: "SETTLED" as SettlementStatus, lastError: "ALREADY_SUCCESS" },
      });
      transitionState(tx.id, "SETTLED").catch(() => null);
      return { processed: true, result: "SETTLED" };
    }
    if (tx.status === "FAILED" || tx.status === "REVERSED") {
      await db.settlementQueue.update({
        where: { id: claim.id },
        data: { status: "FAILED" as SettlementStatus, lastError: `ALREADY_${tx.status}` },
      });
      return { processed: true, result: "FAILED" };
    }

    // 3. Resolve the providerRef to use: prefer the row's providerRef, fall
    //    back to the Transaction's. (The sweeper may enqueue with the
    //    Transaction's providerRef if the row didn't carry one.)
    const providerRef = claim.providerRef ?? tx.providerRef ?? null;

    // 4. If a providerRef exists → query the provider for the transfer status.
    if (providerRef) {
      const result = await this.checkProviderStatus(tx, providerRef);
      if (result === "SUCCESS") {
        await this.confirmSettlement(claim.id, tx.id, providerRef);
        return { processed: true, result: "SETTLED" };
      }
      if (result === "FAILED") {
        await this.failSettlement(claim.id, tx, "PROVIDER_REPORTED_FAILED");
        return { processed: true, result: "FAILED" };
      }
      // PENDING (or unknown) → retry with backoff.
      return await this.retrySettlement(claim.id, claim.attempts, claim.maxAttempts, "PROVIDER_STILL_PENDING");
    }

    // 5. No providerRef — the provider call never returned a reference.
    //    Re-executing the transfer is unsafe (the original caller may
    //    concurrently retry and double-charge). Increment attempts + backoff.
    //    After maxAttempts, mark FAILED. The stuck-transaction sweeper
    //    handles the actual ledger reversal for the no-providerRef case.
    return await this.retrySettlement(claim.id, claim.attempts, claim.maxAttempts, "NO_PROVIDER_REF");
  }

  /**
   * Process up to N pending settlements. Returns aggregate counts.
   */
  async processBatch(
    max: number = 10,
  ): Promise<{ processed: number; settled: number; failed: number; retrying: number }> {
    let processed = 0;
    let settled = 0;
    let failed = 0;
    let retrying = 0;

    for (let i = 0; i < max; i++) {
      try {
        const next = await this.processNext();
        if (!next.processed) break;
        processed++;
        if (next.result === "SETTLED") settled++;
        else if (next.result === "FAILED") failed++;
        else if (next.result === "RETRYING") retrying++;
      } catch (e) {
        // A single failure must not poison the batch.
        logger.error("settlement.processBatch.item.failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        break;
      }
    }

    return { processed, settled, failed, retrying };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Query the provider for the transfer status. Only TRANSFER_OUT rows are
   * supported (the local-transfer provider exposes `getTransferStatus`).
   * Returns "SUCCESS" | "FAILED" | "PENDING" — defaults to "PENDING" on
   * provider errors (we'd rather over-retry than wrongly reverse).
   */
  private async checkProviderStatus(
    tx: {
      id: string;
      type: string;
      provider: string | null;
    },
    providerRef: string,
  ): Promise<"SUCCESS" | "FAILED" | "PENDING"> {
    // Only TRANSFER_OUT rows are eligible for status checking via the
    // local-transfer provider contract. Other transaction types (airtime,
    // data, bills) don't have a status-check API on their providers —
    // leave them PENDING and let the backoff retry path eventually mark
    // them FAILED (an operator can then investigate manually).
    if (tx.type !== "TRANSFER_OUT") {
      return "PENDING";
    }

    try {
      const lt = await providers.localTransfer({ product: "turbopay" });
      const r = await lt.getTransferStatus(providerRef, { product: "turbopay" });
      if (!r.ok || !r.data) {
        // Provider call failed — treat as PENDING (retry on next tick).
        return "PENDING";
      }
      return r.data.status; // "PENDING" | "SUCCESS" | "FAILED"
    } catch (e) {
      logger.error("settlement.checkProviderStatus.failed", {
        transactionId: tx.id,
        providerRef,
        error: e instanceof Error ? e.message : String(e),
      });
      return "PENDING";
    }
  }

  /**
   * Confirm a settlement: flip the Transaction to SUCCESS, advance the
   * state machine to SETTLED, mark the settlement row SETTLED, audit.
   */
  private async confirmSettlement(
    settlementId: string,
    transactionId: string,
    providerRef: string,
  ): Promise<void> {
    await db.transaction.update({
      where: { id: transactionId },
      data: {
        status: "SUCCESS",
        providerRef,
        metadata: JSON.stringify({
          ...(await this.readMetadata(transactionId)),
          settledAt: new Date().toISOString(),
          settlementQueueId: settlementId,
        }),
      },
    });
    await db.settlementQueue.update({
      where: { id: settlementId },
      data: { status: "SETTLED" as SettlementStatus, lastError: null },
    });
    await transitionState(transactionId, "SETTLED").catch(() => null);
    await audit({
      action: "SETTLEMENT_CONFIRMED",
      category: "WALLET",
      severity: "INFO",
      metadata: { transactionId, settlementId, providerRef },
    }).catch(() => null);
  }

  /**
   * Fail a settlement: reverse the ledger entry (credit the wallet back),
   * mark the Transaction FAILED, advance the state machine to TIMEOUT/
   * REVERSED, mark the settlement row FAILED, audit.
   */
  private async failSettlement(
    settlementId: string,
    tx: {
      id: string;
      reference: string;
      userId: string;
      amountKobo: number;
      metadata: string | null;
    },
    reason: string,
  ): Promise<void> {
    // Try to extract the original hold's ledgerEntryId from metadata so we
    // can post the opposing reversal leg.
    let ledgerEntryId: string | null = null;
    try {
      const meta = tx.metadata ? (JSON.parse(tx.metadata) as Record<string, unknown>) : {};
      if (typeof meta.ledgerEntryId === "string") ledgerEntryId = meta.ledgerEntryId;
    } catch {
      // corrupt metadata — leave ledgerEntryId null
    }

    // Force-flip state + status to TIMEOUT/FAILED. If a concurrent writer
    // already flipped it, markTimeout returns false and we skip the ledger
    // reversal (the wallet has already been adjusted).
    const flipped = await markTimeout(tx.id).catch(() => false);
    if (flipped && ledgerEntryId) {
      try {
        await reverseEntry(ledgerEntryId, {
          description: `Settlement failure: ${tx.reference} (${reason})`,
          refId: tx.id,
        });
      } catch (e) {
        logger.error("settlement.failSettlement.reverse.failed", {
          transactionId: tx.id,
          ledgerEntryId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await db.transaction.update({
      where: { id: tx.id },
      data: {
        status: "FAILED",
        metadata: JSON.stringify({
          ...(await this.readMetadata(tx.id)),
          settlementFailedAt: new Date().toISOString(),
          settlementReason: reason,
        }),
      },
    }).catch(() => null);

    await db.settlementQueue.update({
      where: { id: settlementId },
      data: { status: "FAILED" as SettlementStatus, lastError: reason },
    });

    await audit({
      userId: tx.userId,
      action: "SETTLEMENT_FAILED",
      category: "WALLET",
      severity: "ERROR",
      metadata: {
        transactionId: tx.id,
        reference: tx.reference,
        settlementId,
        reason,
        ledgerEntryId,
        amountKobo: tx.amountKobo,
      },
    }).catch(() => null);
  }

  /**
   * Retry a settlement: increment attempts, set nextRetryAt with exponential
   * backoff. If attempts >= maxAttempts → mark FAILED (and reverse if
   * possible). Otherwise mark RETRYING.
   */
  private async retrySettlement(
    settlementId: string,
    attempts: number,
    maxAttempts: number,
    reason: string,
  ): Promise<{ processed: boolean; result?: string }> {
    const nextAttempts = attempts + 1;

    // Load the transaction (needed if we hit maxAttempts → fail + reverse).
    const settlement = await db.settlementQueue.findUnique({
      where: { id: settlementId },
      select: { transactionId: true },
    });
    const tx = settlement
      ? await db.transaction.findUnique({
          where: { id: settlement.transactionId },
          select: {
            id: true,
            reference: true,
            userId: true,
            amountKobo: true,
            metadata: true,
          },
        })
      : null;

    if (nextAttempts >= maxAttempts) {
      if (tx) {
        await this.failSettlement(settlementId, tx, `MAX_ATTEMPTS_REACHED:${reason}`);
      } else {
        await db.settlementQueue.update({
          where: { id: settlementId },
          data: { status: "FAILED" as SettlementStatus, attempts: nextAttempts, lastError: `MAX_ATTEMPTS_REACHED:${reason}` },
        });
      }
      return { processed: true, result: "FAILED" };
    }

    await db.settlementQueue.update({
      where: { id: settlementId },
      data: {
        status: "RETRYING" as SettlementStatus,
        attempts: nextAttempts,
        nextRetryAt: computeNextRetry(nextAttempts),
        lastError: reason,
      },
    });

    return { processed: true, result: "RETRYING" };
  }

  /** Read + parse the Transaction's metadata (defensive against corrupt JSON). */
  private async readMetadata(transactionId: string): Promise<Record<string, unknown>> {
    try {
      const t = await db.transaction.findUnique({
        where: { id: transactionId },
        select: { metadata: true },
      });
      return t?.metadata ? (JSON.parse(t.metadata) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}

export const settlementService = new SettlementService();
