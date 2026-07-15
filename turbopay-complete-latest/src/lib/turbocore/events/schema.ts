/**
 * TurboCore — Event Schema Registry
 * ====================================
 *
 * Typed event definitions with versioning. Every event published through
 * the event bus must conform to a registered schema. This prevents:
 *   - Runtime errors from missing/misspelled fields
 *   - Breaking changes when event shapes evolve
 *   - Missing fields in event consumers
 *
 * Each event type has:
 *   - A unique `type` string (e.g., "wallet.credited")
 *   - A `version` number for schema evolution
 *   - A typed `payload` interface
 *   - Standard `metadata` with timestamp and correlationId
 *
 * Adding a new event:
 *   1. Define the payload interface
 *   2. Add the event type to the EventType union
 *   3. Register the schema in EVENT_SCHEMAS
 */

// ─── Event Payload Interfaces ─────────────────────────────────

export interface WalletCreditedPayload {
  walletId: string;
  amountKobo: number;
  currency: string;
  refType: string;
  refId?: string;
  description?: string;
}

export interface WalletDebitedPayload {
  walletId: string;
  amountKobo: number;
  currency: string;
  refType: string;
  refId?: string;
  description?: string;
}

export interface TransferInitiatedPayload {
  transactionId: string;
  reference: string;
  userId: string;
  amountKobo: number;
  provider: string;
  type: string; // INTERNAL | EXTERNAL | INTERNATIONAL
}

export interface TransferCompletedPayload {
  transactionId: string;
  reference: string;
  userId: string;
  amountKobo: number;
  providerRef?: string;
}

export interface TransferFailedPayload {
  transactionId: string;
  reference: string;
  userId: string;
  amountKobo: number;
  reason: string;
}

export interface ProviderHealthChangedPayload {
  providerName: string;
  previousStatus: string;
  newStatus: string;
  latencyMs?: number;
}

export interface SettlementCompletedPayload {
  settlementId: string;
  providerRef: string;
  amountMinor: number;
  currency: string;
}

export interface WebhookReceivedPayload {
  provider: string;
  providerRef: string;
  eventType: string;
}

export interface LedgerPostedPayload {
  ledgerEntryId: string;
  walletId: string;
  entryType: string;
  amountKobo: number;
  refType: string;
}

export interface MerchantCreatedPayload {
  merchantId: string;
  name: string;
  category: string;
}

export interface PaymentSucceededPayload {
  userId: string;
  transactionId: string;
  amountKobo: number;
  category?: string;
  title?: string;
  message?: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  referralCode?: string;
}

export interface KycVerifiedPayload {
  userId: string;
  tier: number;
  provider: string;
}

// ─── Event Type Union ─────────────────────────────────────────

export type EventType =
  | "wallet.credited"
  | "wallet.debited"
  | "transfer.initiated"
  | "transfer.completed"
  | "transfer.failed"
  | "provider.health.changed"
  | "settlement.completed"
  | "webhook.received"
  | "ledger.posted"
  | "merchant.created"
  | "payment.succeeded"
  | "user.registered"
  | "kyc.verified";

// ─── Event Schema Registry ────────────────────────────────────

export interface EventSchema {
  type: EventType;
  version: number;
  description: string;
}

export const EVENT_SCHEMAS: Record<EventType, EventSchema> = {
  "wallet.credited": {
    type: "wallet.credited",
    version: 1,
    description: "Fired when a wallet receives a credit (funding, transfer-in, reversal)",
  },
  "wallet.debited": {
    type: "wallet.debited",
    version: 1,
    description: "Fired when a wallet is debited (transfer-out, bill payment, fee)",
  },
  "transfer.initiated": {
    type: "transfer.initiated",
    version: 1,
    description: "Fired when a transfer is initiated (hold posted, provider called)",
  },
  "transfer.completed": {
    type: "transfer.completed",
    version: 1,
    description: "Fired when a transfer completes successfully",
  },
  "transfer.failed": {
    type: "transfer.failed",
    version: 1,
    description: "Fired when a transfer fails and is reversed",
  },
  "provider.health.changed": {
    type: "provider.health.changed",
    version: 1,
    description: "Fired when a provider's health status changes (up/down/degraded)",
  },
  "settlement.completed": {
    type: "settlement.completed",
    version: 1,
    description: "Fired when an international settlement is completed",
  },
  "webhook.received": {
    type: "webhook.received",
    version: 1,
    description: "Fired when a webhook is received from an external provider",
  },
  "ledger.posted": {
    type: "ledger.posted",
    version: 1,
    description: "Fired when a ledger entry is posted (credit or debit)",
  },
  "merchant.created": {
    type: "merchant.created",
    version: 1,
    description: "Fired when a new merchant is registered",
  },
  "payment.succeeded": {
    type: "payment.succeeded",
    version: 1,
    description: "Fired when a payment (airtime, data, bills) succeeds",
  },
  "user.registered": {
    type: "user.registered",
    version: 1,
    description: "Fired when a new user registers",
  },
  "kyc.verified": {
    type: "kyc.verified",
    version: 1,
    description: "Fired when a user's KYC verification is completed",
  },
};

// ─── Typed Event Interface ────────────────────────────────────

export interface TypedEvent<T = unknown> {
  type: EventType;
  version: number;
  payload: T;
  metadata: {
    timestamp: string;
    correlationId?: string;
    source?: string;
  };
}

// ─── Schema Validation ────────────────────────────────────────

/**
 * Validate that an event type is registered in the schema.
 * Returns true if valid, false if unknown.
 */
export function isValidEventType(type: string): type is EventType {
  return type in EVENT_SCHEMAS;
}

/**
 * Get the schema for an event type.
 * Returns null if the event type is not registered.
 */
export function getEventSchema(type: string): EventSchema | null {
  return EVENT_SCHEMAS[type as EventType] ?? null;
}

/**
 * List all registered event types.
 */
export function listEventTypes(): EventSchema[] {
  return Object.values(EVENT_SCHEMAS);
}
