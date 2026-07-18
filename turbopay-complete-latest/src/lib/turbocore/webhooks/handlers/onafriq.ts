/**
 * Onafriq webhook handler — normalises Onafriq's callback payload into
 * internal domain events for collections, transfers, mobile money,
 * card transactions, and settlements.
 *
 * Onafriq sends events like:
 *   - collection.successful    → payment received
 *   - collection.failed        → payment failed
 *   - payment.successful       → transfer/payout completed
 *   - payment.failed           → transfer/payout failed
 *   - momo.collection.successful → mobile money collection
 *   - momo.disbursement.successful → mobile money payout
 *   - card.transaction.successful → card transaction
 *   - settlement.completed     → settlement completed
 *
 * Signature: API key-based authentication (header verification).
 *
 * PURE FUNCTION — no side effects.
 */

import { type WebhookHandler } from "@/lib/turbocore/webhooks/registry";

export const onafriqWebhookHandler: WebhookHandler = {
  provider: "onafriq",
  // Onafriq uses API key authentication; webhook verification is key-based
  verifySignature: async () => true, // Placeholder - implement actual verification
  extractProviderRef: (payload) => {
    const p = (payload as any)?.data ?? payload;
    return p?.id ?? p?.reference ?? p?.transactionRef ?? null;
  },
  normalize: (payload, _headers) => {
    const eventType = (payload as any)?.eventType ?? (payload as any)?.event ?? "";
    const p = (payload as any)?.data ?? (payload as any)?.payload ?? payload;
    const ref = p?.id ?? p?.reference ?? p?.transactionRef;
    const amount = parseFloat(p?.amount ?? "0");
    const status = (p?.status ?? "").toString().toLowerCase();

    if (!ref) return [];

    // ─── Mobile Money Events (checked BEFORE general collection) ──
    if (eventType.includes("momo") && eventType.includes("collection") && status === "completed") {
      return [{
        type: "MOMO_COLLECTION_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          currency: p?.currency ?? "NGN",
          network: p?.network,
          mobileMoneyNumber: p?.mobileMoneyNumber,
          status: "SUCCESS",
        },
      }];
    }
    if (eventType.includes("momo") && eventType.includes("disbursement") && status === "completed") {
      return [{
        type: "MOMO_DISBURSEMENT_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          currency: p?.currency ?? "NGN",
          network: p?.network,
          status: "SUCCESS",
        },
      }];
    }

    // ─── Collection Events ──────────────────────────────────────
    if (eventType === "collection.successful" || (eventType.includes("collection") && status === "completed")) {
      return [{
        type: "COLLECTION_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          currency: p?.currency ?? "NGN",
          status: "SUCCESS",
        },
      }];
    }
    if (eventType === "collection.failed" || (eventType.includes("collection") && status === "failed")) {
      return [{
        type: "COLLECTION_FAILED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          status: "FAILED",
          reason: p?.reason ?? "Collection failed",
        },
      }];
    }

    // ─── Payment (Transfer) Events ──────────────────────────────
    if (eventType === "payment.successful" || (eventType.includes("payment") && status === "completed")) {
      return [{
        type: "TRANSFER_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          currency: p?.currency ?? "NGN",
          status: "SUCCESS",
        },
      }];
    }
    if (eventType === "payment.failed" || (eventType.includes("payment") && status === "failed")) {
      return [{
        type: "TRANSFER_FAILED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          status: "FAILED",
          reason: p?.reason ?? "Payment failed",
        },
      }];
    }

    // ─── Card Events ────────────────────────────────────────────
    if (eventType.includes("card") && eventType.includes("transaction") && status === "completed") {
      return [{
        type: "CARD_TRANSACTION_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          currency: p?.currency ?? "NGN",
          cardLast4: p?.cardLast4,
          status: "SUCCESS",
        },
      }];
    }

    // ─── Settlement Events ──────────────────────────────────────
    if (eventType === "settlement.completed" || (eventType.includes("settlement") && status === "completed")) {
      return [{
        type: "SETTLEMENT_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          currency: p?.currency ?? "USD",
          status: "success",
          settledAt: p?.settledAt,
        },
      }];
    }

    // ─── PAPSS Events ───────────────────────────────────────────
    if (eventType.includes("papss") && status === "completed") {
      return [{
        type: "PAPSS_PAYMENT_COMPLETED",
        data: {
          providerRef: ref,
          provider: "onafriq",
          amountMinor: Math.round(amount * 100),
          sourceCurrency: p?.sourceCurrency,
          destinationCurrency: p?.destinationCurrency,
          exchangeRate: p?.exchangeRate,
          status: "SUCCESS",
        },
      }];
    }

    // ─── Ignored Events ─────────────────────────────────────────
    return [{ type: "ONAFRIQ_EVENT_IGNORED", data: { event: eventType, ref } }];
  },
  maxAgeMs: 10 * 60 * 1000,
};
