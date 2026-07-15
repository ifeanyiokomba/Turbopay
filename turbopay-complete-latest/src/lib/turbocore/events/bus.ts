/**
 * TurboCore — Event Bus
 * =====================
 *
 * In-process event bus for domain events. Decouples business services
 * from each other via asynchronous event-driven communication.
 *
 * Architecture (from Enterprise Transformation spec):
 *   Instead of Service A calling Service B directly, Service A publishes
 *   an event and Service B subscribes to it. This reduces coupling and
 *   enables future migration to a real message broker (Kafka, NATS, etc.)
 *   without changing business logic.
 *
 * Current implementation: in-process pub/sub (synchronous, within the
 * same Node.js process). This is the right starting point — a modular
 * monolith. When horizontal scaling requires cross-process events, swap
 * the transport layer behind the same Event Bus interface.
 *
 * Usage:
 *   // Publishing
 *   eventBus.publish("wallet.credited", { userId, amountKobo, reference });
 *
 *   // Subscribing
 *   eventBus.subscribe("wallet.credited", async (event) => {
 *     await notificationService.sendBalanceUpdate(event.userId);
 *   });
 *
 *   // Subscribing to multiple events
 *   eventBus.subscribe(["transfer.completed", "transfer.failed"], handler);
 */

// ─── Event Types ──────────────────────────────────────────────

/**
 * Canonical domain events. Each event type has a typed payload.
 * Extend this map as new domains are added.
 */
export interface DomainEventMap {
  // Wallet events
  "wallet.created": { userId: string; walletId: string };
  "wallet.credited": { userId: string; walletId: string; amountKobo: number; reference: string };
  "wallet.debited": { userId: string; walletId: string; amountKobo: number; reference: string };
  "wallet.frozen": { userId: string; walletId: string; reason: string };
  "wallet.unfrozen": { userId: string; walletId: string };

  // Transfer events
  "transfer.created": { userId: string; reference: string; amountKobo: number; type: string };
  "transfer.completed": { userId: string; reference: string; amountKobo: number };
  "transfer.failed": { userId: string; reference: string; error: string };
  "transfer.reversed": { userId: string; reference: string; reason: string };

  // Bill payment events
  "bill.payment_initiated": { userId: string; reference: string; category: string; amountKobo: number };
  "bill.payment_completed": { userId: string; reference: string; token?: string };
  "bill.payment_failed": { userId: string; reference: string; error: string };

  // International transfer events
  "intl.transfer_created": { userId: string; reference: string; sourceCurrency: string; amountMinor: number };
  "intl.transfer_completed": { userId: string; reference: string };
  "intl.transfer_failed": { userId: string; reference: string; error: string };
  "intl.receiving_completed": { userId: string; reference: string; sourceCurrency: string; amountMinor: number };

  // KYC events
  "kyc.submitted": { userId: string; tier: number };
  "kyc.verified": { userId: string; tier: number };
  "kyc.rejected": { userId: string; reason: string };

  // AML events
  "aml.flag_created": { userId: string; rule: string; severity: string };
  "aml.wallet_frozen": { userId: string; flagId: string };

  // Provider events
  "provider.unavailable": { providerId: string; operation: string; error: string };
  "provider.recovered": { providerId: string };

  // Webhook events
  "webhook.received": { provider: string; providerRef: string };
  "webhook.processed": { provider: string; providerRef: string; success: boolean };

  // Auth events
  "auth.login": { userId: string; ip?: string; method: string };
  "auth.logout": { userId: string };
  "auth.password_changed": { userId: string };

  // Settlement events
  "settlement.initiated": { providerRef: string; amountMinor: number };
  "settlement.completed": { providerRef: string };

  // Support events
  "support.ticket_created": { ticketId: string; userId?: string; category: string };
  "support.ticket_escalated": { ticketId: string; priority: string };
}

export type EventType = keyof DomainEventMap;

export interface DomainEvent<T extends EventType = EventType> {
  type: T;
  payload: DomainEventMap[T];
  timestamp: Date;
  correlationId?: string;
}

export type EventHandler<T extends EventType = EventType> = (
  event: DomainEvent<T>
) => Promise<void> | void;

import { logger } from "@/lib/turbocore/logger";

// ─── Event Bus Implementation ─────────────────────────────────

class EventBusImpl {
  private handlers = new Map<string, Set<EventHandler>>();
  private eventCount = new Map<string, number>();

  /**
   * Subscribe to one or more event types.
   */
  subscribe<T extends EventType>(
    eventTypes: T | T[],
    handler: EventHandler<T>
  ): () => void {
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const typeSet = new Set<string>(types);

    for (const type of typeSet) {
      if (!this.handlers.has(type)) {
        this.handlers.set(type, new Set());
      }
      this.handlers.get(type)!.add(handler as EventHandler);
    }

    // Return unsubscribe function.
    return () => {
      for (const type of typeSet) {
        this.handlers.get(type)?.delete(handler as EventHandler);
      }
    };
  }

  /**
   * Publish an event. All matching handlers are called sequentially.
   * Errors in handlers are logged but do NOT prevent other handlers
   * from running (fault isolation).
   */
  async publish<T extends EventType>(
    type: T,
    payload: DomainEventMap[T],
    options?: { correlationId?: string }
  ): Promise<void> {
    const event: DomainEvent<T> = {
      type,
      payload,
      timestamp: new Date(),
      correlationId: options?.correlationId,
    };

    // Track event count for metrics.
    this.eventCount.set(type, (this.eventCount.get(type) ?? 0) + 1);

    const handlers = this.handlers.get(type);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        // Log but don't throw — fault isolation between handlers.
        logger.error("event_bus.handler_error", { eventType: type, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * Get event count for a specific type (for metrics/debugging).
   */
  getCount(type: EventType): number {
    return this.eventCount.get(type) ?? 0;
  }

  /**
   * Get all registered event types and their handler counts.
   */
  stats(): Array<{ type: string; handlerCount: number; publishCount: number }> {
    const allTypes = new Set([...this.handlers.keys(), ...this.eventCount.keys()]);
    return Array.from(allTypes).map((type) => ({
      type,
      handlerCount: this.handlers.get(type)?.size ?? 0,
      publishCount: this.eventCount.get(type) ?? 0,
    }));
  }
}

/** Singleton event bus. */
export const eventBus = new EventBusImpl();
