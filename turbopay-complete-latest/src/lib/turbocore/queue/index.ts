/**
 * TurboCore — Async Task Queue
 * ==============================
 *
 * Durable fire-and-forget side-effects. Financial routes (transfer, airtime,
 * bills, …) enqueue NOTIFY / CASHBACK / EVENT tasks here instead of calling
 * `notify.sendInApp` / `rewards.awardCashback` inline — so a slow notification
 * provider or a rewards-service hiccup can NEVER block or fail a payment.
 *
 * The queue is polled by the `/api/cron/queue-worker` route (every 1 minute),
 * which calls `processBatch(20)`. Tasks are stored in the `AsyncTask` table
 * with `status` ∈ {PENDING, PROCESSING, COMPLETED, FAILED} + an `attempts`
 * counter for bounded retries (`maxAttempts`, default 3).
 *
 * ── At-least-once delivery ────────────────────────────────────────────
 *   `processNext` claims a task with a conditional `updateMany` (PENDING →
 *   PROCESSING), so two concurrent workers cannot both pick the same row.
 *   Handlers MUST therefore be idempotent — `notify.sendInApp` is naturally
 *   idempotent (creates a new notification each call, but the user-facing
 *   effect of "notify once" is enforced by the caller deduping the enqueue);
 *   `rewards.awardCashback` is idempotent per sourceTransactionId.
 *
 *   On handler failure:
 *     • attempts < maxAttempts → status back to PENDING (will retry next tick)
 *     • attempts >= maxAttempts → status = FAILED (dead-letter, surfaced in admin)
 *
 * ── Type dispatch ─────────────────────────────────────────────────────
 *   • NOTIFY   → notify.sendInApp        (payload = InAppNotification fields)
 *   • CASHBACK → rewards.awardCashback   (payload = AwardCashbackInput)
 *   • EVENT    → no-op placeholder       (future webhook fan-out / analytics)
 */

import { db } from "@/lib/db";
import { notify } from "@/lib/turbocore/notifications";
import { rewards } from "@/lib/turbocore/rewards";
import { audit } from "@/lib/turbopay/audit";
import { logger } from "@/lib/turbocore/logger";

/** AsyncTask.type values this queue knows how to dispatch. */
export type AsyncTaskType = "NOTIFY" | "CASHBACK" | "EVENT";

/** Shape of an InAppNotification payload for a NOTIFY task. */
interface NotifyPayload {
  userId: string;
  type: "TRANSACTION" | "SECURITY" | "KYC" | "SUPPORT" | "PROMOTIONAL" | "SYSTEM" | "DISPUTE" | "REFERRAL";
  title: string;
  message: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  actionUrl?: string;
  actionLabel?: string;
  metadata?: Record<string, unknown>;
}

/** Shape of an AwardCashbackInput payload for a CASHBACK task. */
interface CashbackPayload {
  userId: string;
  transactionId: string;
  amountMinor: number;
  category: string;
  ruleId?: string;
}

/**
 * Enqueue a fire-and-forget task. NEVER throws — the financial transaction
 * that calls this MUST be allowed to succeed even if the queue table is on
 * fire. On failure the error is logged + audited, and the caller proceeds
 * without the side-effect (an operator can re-enqueue manually if needed).
 */
export async function enqueue(type: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await db.asyncTask.create({
      data: {
        type,
        payload: JSON.stringify(payload ?? {}),
        status: "PENDING",
      },
    });
  } catch (err) {
    // Log + audit, never throw. The caller (a financial route) MUST not be
    // blocked by a queue-table hiccup.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("queue.enqueue.failed", { type, error: message });
    void audit({
      action: "QUEUE_ENQUEUE_FAILED",
      category: "WALLET",
      severity: "WARN",
      metadata: { type, error: message, payloadKeys: Object.keys(payload ?? {}) },
    });
  }
}

/**
 * Claim + process the oldest PENDING task of `type`. Returns true if a task
 * was processed (regardless of success/failure outcome), false if the queue
 * was empty for that type.
 *
 * Claim step uses a conditional `updateMany` (PENDING → PROCESSING WHERE
 * id = ? AND status = PENDING) so two workers cannot grab the same row.
 */
export async function processNext(
  type: string,
  handler: (payload: Record<string, unknown>) => Promise<void>,
): Promise<boolean> {
  // Pick the oldest PENDING task of this type.
  const next = await db.asyncTask.findFirst({
    where: { type, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, payload: true, attempts: true, maxAttempts: true },
  });
  if (!next) return false;

  // Claim it: only flip if still PENDING (optimistic concurrency). If a
  // concurrent worker got there first, count=0 and we bail.
  const claimed = await db.asyncTask.updateMany({
    where: { id: next.id, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) return false;

  let payload: Record<string, unknown> = {};
  try {
    payload = next.payload ? (JSON.parse(next.payload) as Record<string, unknown>) : {};
  } catch {
    // Corrupt payload — dead-letter immediately so the queue isn't poisoned.
    await db.asyncTask.update({
      where: { id: next.id },
      data: { status: "FAILED", error: "PAYLOAD_PARSE_ERROR", attempts: { increment: 1 } },
    });
    void audit({
      action: "QUEUE_TASK_CORRUPT",
      category: "WALLET",
      severity: "ERROR",
      metadata: { taskId: next.id, type },
    });
    return true;
  }

  try {
    await handler(payload);
    await db.asyncTask.update({
      where: { id: next.id },
      data: { status: "COMPLETED", error: null },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newAttempts = next.attempts + 1;
    const exhausted = newAttempts >= next.maxAttempts;

    await db.asyncTask.update({
      where: { id: next.id },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        attempts: newAttempts,
        error: message.slice(0, 1000),
      },
    });

    void audit({
      action: exhausted ? "QUEUE_TASK_DEAD_LETTER" : "QUEUE_TASK_RETRY",
      category: "WALLET",
      severity: exhausted ? "ERROR" : "WARN",
      metadata: { taskId: next.id, type, attempts: newAttempts, maxAttempts: next.maxAttempts, error: message },
    });
    return true;
  }
}

/**
 * Internal dispatch table — maps a task `type` to its handler. Adding a new
 * task type is a one-liner here. EVENT is a deliberate no-op placeholder
 * (the queue records it for audit without invoking any side-effect — future
 * webhook fan-out / analytics hooks can hang off it).
 */
async function dispatch(type: string, payload: Record<string, unknown>): Promise<void> {
  switch (type) {
    case "NOTIFY":
      await notify.sendInApp(payload as unknown as NotifyPayload);
      return;
    case "CASHBACK": {
      const p = payload as unknown as CashbackPayload;
      await rewards.awardCashback({
        userId: p.userId,
        transactionId: p.transactionId,
        amountMinor: p.amountMinor,
        category: p.category,
        ruleId: p.ruleId,
      });
      return;
    }
    case "EVENT":
      // No-op placeholder. Recorded for audit; future webhook fan-out /
      // analytics hooks can hang off this branch.
      return;
    default:
      // Unknown type — log + audit but don't throw (would mark FAILED on a
      // row that no handler can ever satisfy, which is the right outcome).
      logger.warn("queue.dispatch.unknown_type", { type });
      throw new Error(`UNKNOWN_TASK_TYPE:${type}`);
  }
}

/**
 * Process up to `maxPerType` tasks of each known type (NOTIFY + CASHBACK).
 * Called by the `/api/cron/queue-worker` route. Returns the total number of
 * tasks processed (success OR failure — both count as "the worker did work").
 */
export async function processBatch(maxPerType = 10): Promise<{ processed: number }> {
  let processed = 0;

  // NOTIFY first — user-facing, latency-sensitive.
  for (let i = 0; i < maxPerType; i++) {
    const did = await processNext("NOTIFY", (p) => dispatch("NOTIFY", p));
    if (!did) break;
    processed++;
  }

  // CASHBACK second — money movement, but lower user-facing urgency.
  for (let i = 0; i < maxPerType; i++) {
    const did = await processNext("CASHBACK", (p) => dispatch("CASHBACK", p));
    if (!did) break;
    processed++;
  }

  return { processed };
}
