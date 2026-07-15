/**
 * Monnify webhook handler — normalises Monnify's raw payload into internal
 * domain events for wallet funding, bill payments, refunds, settlements,
 * and transfer status updates.
 *
 * Monnify sends events like:
 *   - SUCCESSFUL_COLLECTION    → payment received
 *   - SUCCESSFUL_DISBURSEMENT  → transfer completed
 *   - FAILED_DISBURSEMENT      → transfer failed
 *   - REVERSED_DISBURSEMENT    → transfer reversed
 *   - SUCCESSFUL_REFUND        → refund processed
 *   - FAILED_REFUND            → refund failed
 *   - SETTLEMENT_COMPLETION    → settlement completed
 *   - MANDATE_STATUS_CHANGE    → direct debit mandate changed
 *
 * Signature: HMAC-SHA512 over the raw body, sent in the `monnify-signature`
 * header.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import { nairaToKobo } from "@/lib/turbopay/money";

export const monnifyWebhookHandler: WebhookHandler = {
  provider: "monnify",
  verifySignature: hmacVerifierFromDb("monnify", "monnify-signature", "TURBOPAY_MONNIFY_WEBHOOK_SECRET"),
  extractProviderRef: (payload) => {
    const p = (payload as any)?.eventData ?? (payload as any)?.payload ?? payload;
    return p?.transactionReference ?? p?.providerRef ?? p?.reference ?? null;
  },
  normalize: (payload, _headers) => {
    const eventType = (payload as any)?.eventType ?? (payload as any)?.event ?? "";
    const p = (payload as any)?.eventData ?? (payload as any)?.payload ?? payload;

    // ─── Collection (Payment) Events ────────────────────────────
    if (eventType === "SUCCESSFUL_COLLECTION") {
      const accountNumber = p?.accountReference ?? p?.accountNumber;
      const amount = parseFloat(p?.amountPaid ?? p?.amount ?? "0");
      const providerRef = p?.transactionReference ?? p?.providerRef;
      const paymentReference = p?.paymentReference ?? providerRef;
      if (!accountNumber || !amount || !providerRef) return [];
      return [{
        type: "WALLET_FUNDED",
        data: {
          accountNumber,
          amountMinor: nairaToKobo(amount),
          currency: "NGN",
          providerRef,
          paymentReference,
        },
      }];
    }

    // ─── Transfer (Disbursement) Events ─────────────────────────
    if (eventType === "SUCCESSFUL_DISBURSEMENT") {
      const amount = parseFloat(p?.amount ?? "0");
      const providerRef = p?.reference ?? p?.transactionReference;
      return [{
        type: "TRANSFER_COMPLETED",
        data: {
          providerRef,
          provider: "monnify",
          status: "SUCCESS",
          amountMinor: nairaToKobo(amount),
        },
      }];
    }
    if (eventType === "FAILED_DISBURSEMENT") {
      const providerRef = p?.reference ?? p?.transactionReference;
      return [{
        type: "TRANSFER_FAILED",
        data: {
          providerRef,
          provider: "monnify",
          status: "FAILED",
          reason: p?.reason ?? "Transfer failed",
        },
      }];
    }
    if (eventType === "REVERSED_DISBURSEMENT") {
      const providerRef = p?.reference ?? p?.transactionReference;
      return [{
        type: "TRANSFER_REVERSED",
        data: {
          providerRef,
          provider: "monnify",
          status: "REVERSED",
          reason: p?.reason ?? "Transfer reversed",
        },
      }];
    }

    // ─── Refund Events ──────────────────────────────────────────
    if (eventType === "SUCCESSFUL_REFUND") {
      const providerRef = p?.refundReference ?? p?.transactionReference;
      const amount = parseFloat(p?.amount ?? "0");
      return [{
        type: "REFUND_COMPLETED",
        data: {
          providerRef,
          provider: "monnify",
          amountMinor: nairaToKobo(amount),
          status: "completed",
        },
      }];
    }
    if (eventType === "FAILED_REFUND") {
      const providerRef = p?.refundReference ?? p?.transactionReference;
      return [{
        type: "REFUND_FAILED",
        data: {
          providerRef,
          provider: "monnify",
          status: "failed",
          reason: p?.reason ?? "Refund failed",
        },
      }];
    }

    // ─── Settlement Events ──────────────────────────────────────
    if (eventType === "SETTLEMENT_COMPLETION") {
      const providerRef = p?.settlementReference ?? p?.reference;
      const amount = parseFloat(p?.amount ?? "0");
      return [{
        type: "SETTLEMENT_COMPLETED",
        data: {
          providerRef,
          provider: "monnify",
          amountMinor: nairaToKobo(amount),
          status: "success",
          settledAt: p?.settlementDate,
        },
      }];
    }

    // ─── Mandate (Direct Debit) Events ──────────────────────────
    if (eventType === "MANDATE_STATUS_CHANGE") {
      const providerRef = p?.mandateId ?? p?.reference;
      return [{
        type: "MANDATE_STATUS_CHANGED",
        data: {
          providerRef,
          provider: "monnify",
          status: p?.status,
          mandateId: p?.mandateId,
        },
      }];
    }

    // ─── Ignored Events ─────────────────────────────────────────
    return [{ type: "MONNIFY_EVENT_IGNORED", data: { event: eventType, ref: p?.reference } }];
  },
  maxAgeMs: 10 * 60 * 1000,
};
