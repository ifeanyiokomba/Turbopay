/**
 * TurboCore — Transactional Outbox
 * =================================
 *
 * Solves the dual-write problem: "Database state updates and downstream event
 * publishing occur as a single atomic transaction, eliminating data loss
 * during network splits."
 *
 * Pattern:
 *   1. Inside a Prisma `$transaction`, the service writes its domain state
 *      (ledger entry, transaction row, wallet update, …) AND calls
 *      `outbox.writeInTransaction(tx, event)` to insert an `OutboxEvent`
 *      row with `status = "PENDING"`.
 *   2. The transaction commits atomically — either both the domain state AND
 *      the outbox row are persisted, or neither is. There is no window where
 *      the state changed but the event was lost (or vice-versa).
 *   3. A cron worker (`/api/cron/outbox-publisher`) periodically calls
 *      `outbox.processPending(N)`, which drains PENDING rows, publishes each
 *      via the TurboCore event bus, and marks the row PUBLISHED (or FAILED
 *      after the publish throws).
 *
 * At-least-once delivery: a row is only marked PUBLISHED after `events.publish`
 * resolves. If the process crashes between publish + the row update, the next
 * tick will re-publish. Subscribers MUST therefore be idempotent — the event
 * bus already enforces this for `notify.sendInApp` (dedupes by enqueue) and
 * `rewards.awardCashback` (idempotent per sourceTransactionId).
 *
 * ── Why not just use the in-process event bus directly? ────────────────
 * The pipeline already calls `events.publish("payment.succeeded", ...)` after
 * `confirmHold` commits. The problem: if the process crashes between commit
 * and `events.publish`, the event is lost forever. The outbox row is written
 * INSIDE the commit, so on the next process restart the worker picks it up.
 *
 * The pipeline continues to call `events.publish` directly for the IMMEDIATE
 * side-effect (notification + cashback fire within the same request). The
 * outbox provides the DURABLE guarantee — if the direct publish is lost, the
 * outbox worker re-publishes; the subscribers' idempotency keys dedupe.
 */

import { db } from "@/lib/db";
import { events } from "@/lib/turbocore/events";
import type { EventType } from "@/lib/turbocore/events/schema";
import { audit } from "@/lib/turbopay/audit";
import { logger } from "@/lib/turbocore/logger";

/** Prisma transaction client type (matches the type used in payments.ts). */
type PrismaTx = Parameters<Parameters<typeof db["$transaction"]>[0]>[0];

/** Shape of an outbox event passed to `writeInTransaction`. */
export interface OutboxEventInput {
  /** Coarse aggregate type — "transaction" | "wallet" | "kyc" | "card" | … */
  aggregateType: string;
  /** The entity ID the event refers to. */
  aggregateId: string;
  /** Dotted event type — "payment.succeeded" | "wallet.funded" | … */
  eventType: string;
  /** Structured payload — JSON-stringified before persistence. */
  payload: Record<string, unknown>;
}

/** Result of a `processPending` run. */
export interface ProcessPendingResult {
  /** Total rows picked up by this run (published + failed). */
  processed: number;
  /** Rows successfully published to the event bus. */
  published: number;
  /** Rows where publishing threw — left PENDING for retry, or FAILED if
   *  the payload was unparseable (dead-lettered). */
  failed: number;
}

class OutboxService {
  /**
   * Write an outbox event INSIDE a database transaction.
   *
   * MUST be called from within a `db.$transaction(async (tx) => { ... })`
   * block — the `tx` argument is the transactional Prisma client. This
   * ensures the event row commits atomically with the caller's domain state
   * change (ledger post, transaction status flip, etc.).
   *
   * If the tx commits → the event WILL be published (the cron worker picks
   * it up on the next tick).
   * If the tx rolls back → no event row exists (no phantom events).
   */
  async writeInTransaction(
    tx: PrismaTx,
    event: OutboxEventInput,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: JSON.stringify(event.payload ?? {}),
        status: "PENDING",
      },
    });
  }

  /**
   * Process pending outbox events — called by the cron worker.
   *
   * Picks up to `maxBatch` PENDING rows (oldest first), publishes each via
   * the TurboCore event bus, and marks the row PUBLISHED or FAILED.
   *
   * Concurrency: the cron worker is single-instance (one tick per minute),
   * so there is no need for an atomic claim step. If two workers ever run
   * concurrently, the worst case is a duplicate publish — which the event
   * bus subscribers handle via idempotency keys.
   *
   * Failure handling: a row whose `events.publish` throws is left PENDING
   * (the next tick will retry). A row with an unparseable payload is marked
   * FAILED (dead-lettered) — it cannot ever be published, so retrying is
   * pointless. An audit row is written for each FAILED dead-letter.
   */
  async processPending(
    maxBatch: number = 50,
  ): Promise<ProcessPendingResult> {
    const pending = await db.outboxEvent.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: maxBatch,
      select: { id: true, aggregateType: true, aggregateId: true, eventType: true, payload: true },
    });

    let published = 0;
    let failed = 0;

    for (const row of pending) {
      // Parse the payload. A corrupt payload dead-letters the row.
      let payload: Record<string, unknown>;
      try {
        payload = row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {};
      } catch {
        await db.outboxEvent.update({
          where: { id: row.id },
          data: { status: "FAILED" },
        });
        failed++;
        void audit({
          action: "OUTBOX_DEAD_LETTER",
          category: "WALLET",
          severity: "ERROR",
          metadata: {
            outboxEventId: row.id,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            eventType: row.eventType,
            reason: "PAYLOAD_PARSE_ERROR",
          },
        });
        continue;
      }

      // Publish via the event bus. `events.publish` enqueues an EVENT task
      // on the durable AsyncTask queue (or invokes handlers synchronously
      // if the queue is unavailable) — it never throws synchronously.
      try {
        await events.publish(row.eventType as EventType, {
          ...payload,
          // Stamp the event with the outbox row IDs so subscribers can
          // dedupe + trace back to the outbox row.
          outboxEventId: row.id,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
        });
        await db.outboxEvent.update({
          where: { id: row.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
        published++;
      } catch (err) {
        // publish threw — leave PENDING for the next tick to retry.
        // (events.publish is supposed to never throw, but defensive
        // programming: if the queue table is corrupt + the sync fallback
        // also throws, we still want to mark the row for retry rather than
        // crash the worker.)
        const message = err instanceof Error ? err.message : String(err);
        logger.error("outbox.publish.failed", {
          outboxEventId: row.id,
          eventType: row.eventType,
          error: message,
        });
        failed++;
        // Don't mark FAILED — the next tick may succeed. Only persistent
        // failures (corrupt payload, unknown event type) dead-letter.
      }
    }

    return { processed: pending.length, published, failed };
  }

  /**
   * Count of PENDING outbox events — surfaced in admin System Health so
   * operators can detect a backlog (e.g. the cron worker is down, or
   * `events.publish` is consistently failing).
   */
  async pendingCount(): Promise<number> {
    return db.outboxEvent.count({ where: { status: "PENDING" } });
  }

  /**
   * Count of FAILED outbox events — surfaced in admin System Health as a
   * dead-letter queue indicator. A non-zero count means an operator needs
   * to inspect + manually re-publish or discard.
   */
  async failedCount(): Promise<number> {
    return db.outboxEvent.count({ where: { status: "FAILED" } });
  }

  /**
   * Manually re-queue a FAILED outbox event for retry. Used by admin
   * operators after inspecting + fixing the underlying issue.
   */
  async requeue(outboxEventId: string): Promise<void> {
    await db.outboxEvent.update({
      where: { id: outboxEventId },
      data: { status: "PENDING" },
    });
    void audit({
      action: "OUTBOX_REQUEUE",
      category: "ADMIN",
      severity: "INFO",
      metadata: { outboxEventId },
    });
  }
}

/** Singleton outbox service. */
export const outbox = new OutboxService();
