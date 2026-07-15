/**
 * Flutterwave webhook handler — normalises Flutterwave's transfer, card
 * funding, chargeback, and settlement callbacks into internal domain events.
 *
 * Flutterwave v4 sends events like:
 *   - charge.completed     → payment received (card, MoMo, bank transfer)
 *   - charge.failed        → payment failed
 *   - transfer.disburse    → outbound transfer completed
 *   - transfer.failed      → outbound transfer failed
 *   - refund.completed     → refund processed
 *   - chargeback.created   → customer dispute opened
 *   - chargeback.updated   → dispute status changed
 *
 * Signature: HMAC-SHA256 over the raw body, sent in the `flutterwave-signature`
 * header.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import { nairaToKobo } from "@/lib/turbopay/money";

export const flutterwaveWebhookHandler: WebhookHandler = {
  provider: "flutterwave",
  verifySignature: hmacVerifierFromDb("flutterwave", "flutterwave-signature", "FLW_SECRET_KEY"),
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.data?.id?.toString() ?? p?.data?.reference ?? p?.data?.tx_ref ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const event = p?.event as string | undefined;
    const data = p?.data ?? {};
    const ref = data?.id?.toString() ?? data?.reference ?? data?.tx_ref;
    const status = (data?.status ?? "").toString().toUpperCase();
    if (!event || !ref) return [];

    // ─── Transfer Events ────────────────────────────────────────
    if (event === "transfer.disburse") {
      if (status === "SUCCESSFUL" || status === "SUCCESS") {
        return [{
          type: "TRANSFER_COMPLETED",
          data: {
            providerRef: ref,
            provider: "flutterwave",
            status: "SUCCESS",
            amountMinor: nairaToKobo(parseFloat(data?.amount ?? "0")),
          },
        }];
      }
      return [{
        type: "TRANSFER_FAILED",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          status: "FAILED",
          reason: data?.complete_message ?? "Transfer failed",
        },
      }];
    }
    if (event === "transfer.failed") {
      return [{
        type: "TRANSFER_FAILED",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          status: "FAILED",
          reason: data?.complete_message ?? "Transfer failed",
        },
      }];
    }

    // ─── Charge (Payment) Events ────────────────────────────────
    if (event === "charge.completed") {
      const amount = nairaToKobo(parseFloat(data?.amount ?? "0"));
      return [{
        type: "CARD_FUNDING_SUCCESS",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          amountMinor: amount,
          customerEmail: data?.customer?.email,
          paymentType: data?.payment_type,
        },
      }];
    }
    if (event === "charge.failed") {
      return [{
        type: "PAYMENT_FAILED",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          status: "FAILED",
          reason: data?.complete_message ?? "Payment failed",
        },
      }];
    }

    // ─── Refund Events ──────────────────────────────────────────
    if (event === "refund.completed") {
      return [{
        type: "REFUND_COMPLETED",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          amountMinor: nairaToKobo(parseFloat(data?.amount ?? "0")),
          status: "completed",
        },
      }];
    }

    // ─── Chargeback (Dispute) Events ────────────────────────────
    if (event === "chargeback.created") {
      return [{
        type: "DISPUTE_OPENED",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          disputeId: data?.id,
          transactionRef: data?.transaction_id,
          amountMinor: nairaToKobo(parseFloat(data?.amount ?? "0")),
          currency: data?.currency ?? "NGN",
          comment: data?.comment,
          status: "pending",
        },
      }];
    }
    if (event === "chargeback.updated") {
      return [{
        type: "DISPUTE_RESOLVED",
        data: {
          providerRef: ref,
          provider: "flutterwave",
          disputeId: data?.id,
          status: data?.status ?? "resolved",
          resolution: data?.resolution,
        },
      }];
    }

    // ─── Ignored Events ─────────────────────────────────────────
    return [{ type: "FLW_EVENT_IGNORED", data: { event, ref } }];
  },
  maxAgeMs: 10 * 60 * 1000,
};
