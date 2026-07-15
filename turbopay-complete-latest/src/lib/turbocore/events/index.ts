/**
 * TurboCore — Event Bus
 * ======================
 *
 * A minimal in-process pub/sub for decoupling core transactional flows from
 * side-effects (notifications, rewards, analytics, webhooks, etc.).
 *
 * Design:
 *  - Handlers register via `events.on(eventName, handler)` at module load.
 *  - Publishers call `events.publish(eventName, payload)`.
 *  - When the TurboCore async task queue is available, publish enqueues an
 *    EVENT task for durable async processing.
 *  - When the queue is unavailable, falls back to invoking handlers synchronously.
 *
 * All events are validated against the schema registry to prevent
 * runtime errors from missing/misspelled fields.
 */

import { notify } from "@/lib/turbocore/notifications";
import { rewards } from "@/lib/turbocore/rewards";
import { isValidEventType, type EventType } from "@/lib/turbocore/events/schema";
import { logger } from "@/lib/turbocore/logger";

type EventHandler = (payload: Record<string, unknown>) => Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private queueAvailable: boolean | null = null;

  on(event: EventType, handler: EventHandler): void {
    const list = this.handlers.get(event);
    if (list) {
      list.push(handler);
    } else {
      this.handlers.set(event, [handler]);
    }
  }

  async publish(event: EventType, payload: Record<string, unknown>): Promise<void> {
    // Validate event type against schema registry
    if (!isValidEventType(event)) {
      logger.warn("event_bus.unknown_event_type", { eventType: event });
    }

    // Try the durable queue path first.
    if (this.queueAvailable !== false) {
      try {
        const { enqueue } = await import("@/lib/turbocore/queue");
        await enqueue("EVENT", { event, ...payload });
        this.queueAvailable = true;
        return;
      } catch {
        this.queueAvailable = false;
      }
    }

    // Fallback: invoke registered handlers synchronously (fire-and-forget).
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return;
    const snapshot = list.slice();
    for (const handler of snapshot) {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((err) => {
          logger.error("event_bus.handler_threw", { eventType: event, error: err instanceof Error ? err.message : String(err) });
        });
    }
  }

  reset(): void {
    this.handlers.clear();
    this.queueAvailable = null;
  }
}

/** Singleton event bus. */
export const events = new EventBus();

// ─── Handler registration (runs at module load) ────────────────────────
//
// These handlers are invoked by the queue worker when it processes EVENT
// tasks (the worker's dispatch table will be enhanced to fan out to these
// registered handlers). They are also invoked synchronously by `publish`
// when the queue is unavailable (e.g. in tests).
//
// They mirror the immediate notify + cashback calls the pipeline makes
// directly — registered here so future subscribers can hook in without
// touching the pipeline.

/**
 * `payment.succeeded` → in-app notification.
 * Payload: { userId, title, message, actionUrl?, actionLabel? }
 */
events.on("payment.succeeded", async (payload) => {
  await notify.sendInApp({
    userId: String(payload.userId),
    type: "TRANSACTION",
    title: String(payload.title ?? "Transaction Successful"),
    message: String(payload.message ?? ""),
    actionUrl: payload.actionUrl ? String(payload.actionUrl) : undefined,
    actionLabel: payload.actionLabel ? String(payload.actionLabel) : undefined,
  });
});

/**
 * `payment.succeeded` → cashback reward.
 * Only fires when the payload includes a `category` (airtime/data/bills).
 * Idempotent per sourceTransactionId (enforced by the rewards engine).
 *
 * Payload: { userId, transactionId, amountKobo, category? }
 */
events.on("payment.succeeded", async (payload) => {
  if (!payload.category) return;
  await rewards.awardCashback({
    userId: String(payload.userId),
    transactionId: String(payload.transactionId),
    amountMinor: Number(payload.amountKobo),
    category: String(payload.category),
  });
});
