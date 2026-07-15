/**
 * Quickteller (Interswitch) webhook handler — normalises Quickteller's callback
 * payload into internal domain events for bill payments, subscriptions,
 * refunds, and settlements.
 *
 * Interswitch sends events with categories:
 *   - TRANSACTION (CREATED/UPDATED/COMPLETED)
 *   - SUBSCRIPTION (CREATED/TRANSACTION_SUCCESSFUL/TRANSACTION_FAILURE/CANCELLED)
 *   - LINK (TRANSACTION_SUCCESSFUL/TRANSACTION_FAILURE)
 *   - INVOICE (TRANSACTION_SUCCESSFUL/TRANSACTION_FAILURE)
 *
 * Signature: HMAC-SHA512 over the raw body, hex-encoded, header
 * `X-Interswitch-Signature`.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";

export const quicktellerWebhookHandler: WebhookHandler = {
  provider: "quickteller",
  verifySignature: hmacVerifierFromDb(
    "quickteller",
    "x-interswitch-signature",
    "QUICKTELLER_WEBHOOK_SECRET",
    "sha512",
  ),
  extractProviderRef: (payload) => {
    const p = (payload as any)?.data ?? payload;
    return p?.transactionRef ?? p?.paymentRef ?? p?.referenceNumber ?? p?.providerRef ?? null;
  },
  normalize: (payload, _headers) => {
    const raw = payload as any;
    const p = raw?.data ?? raw?.payload ?? raw;
    const category = (p?.category ?? raw?.category ?? "").toString().toUpperCase();
    const action = (p?.action ?? raw?.action ?? "").toString().toUpperCase();
    const transactionRef = p?.transactionRef ?? p?.paymentRef ?? p?.referenceNumber;
    const amount = parseFloat(p?.amount ?? p?.amountPaid ?? "0");
    const responseCode = (p?.responseCode ?? p?.response_code ?? "").toString();
    const customerName = p?.name ?? p?.customerName ?? "";
    const customer = p?.customer ?? p?.accountNumber ?? "";
    const productCode = p?.productCode ?? p?.product_code ?? "";

    if (!transactionRef) return [];

    // Interswitch response code 00 = success
    const isSuccessful = responseCode === "00" || responseCode === "0" ||
      (p?.status ?? "").toString().toUpperCase() === "SUCCESS";

    // ─── Transaction Events ─────────────────────────────────────
    if (category === "TRANSACTION") {
      if (action === "COMPLETED" || isSuccessful) {
        return [{
          type: isSuccessful ? "BILL_PAYMENT_COMPLETED" : "BILL_PAYMENT_FAILED",
          data: {
            transactionRef,
            providerRef: transactionRef,
            amountMinor: Math.round(amount * 100),
            currency: "NGN",
            customerName,
            customer,
            productCode,
            status: isSuccessful ? "SUCCESS" : "FAILED",
            providerResponse: p,
          },
        }];
      }
      return [{
        type: "BILL_PAYMENT_PENDING",
        data: {
          transactionRef,
          providerRef: transactionRef,
          amountMinor: Math.round(amount * 100),
          currency: "NGN",
          status: "PENDING",
          action,
        },
      }];
    }

    // ─── Subscription Events ────────────────────────────────────
    if (category === "SUBSCRIPTION") {
      if (action === "CREATED") {
        return [{
          type: "SUBSCRIPTION_CREATED",
          data: {
            providerRef: transactionRef,
            provider: "quickteller",
            subscriptionId: p?.subscriptionId,
            status: "active",
          },
        }];
      }
      if (action === "TRANSACTION_SUCCESSFUL") {
        return [{
          type: "SUBSCRIPTION_PAYMENT_SUCCESS",
          data: {
            providerRef: transactionRef,
            provider: "quickteller",
            amountMinor: Math.round(amount * 100),
            status: "success",
          },
        }];
      }
      if (action === "TRANSACTION_FAILURE") {
        return [{
          type: "SUBSCRIPTION_PAYMENT_FAILED",
          data: {
            providerRef: transactionRef,
            provider: "quickteller",
            status: "failed",
            reason: p?.reason ?? "Subscription payment failed",
          },
        }];
      }
      if (action === "CANCELLED") {
        return [{
          type: "SUBSCRIPTION_CANCELLED",
          data: {
            providerRef: transactionRef,
            provider: "quickteller",
            status: "cancelled",
          },
        }];
      }
    }

    // ─── Refund Events ──────────────────────────────────────────
    if (p?.type === "REFUND" || p?.refundReference) {
      return [{
        type: isSuccessful ? "REFUND_COMPLETED" : "REFUND_FAILED",
        data: {
          providerRef: p?.refundReference ?? transactionRef,
          provider: "quickteller",
          amountMinor: Math.round(amount * 100),
          status: isSuccessful ? "completed" : "failed",
        },
      }];
    }

    // ─── Settlement Events ──────────────────────────────────────
    if (p?.settlementReference || p?.type === "SETTLEMENT") {
      return [{
        type: "SETTLEMENT_COMPLETED",
        data: {
          providerRef: p?.settlementReference ?? transactionRef,
          provider: "quickteller",
          amountMinor: Math.round(amount * 100),
          status: "success",
          settledAt: p?.settlementDate,
        },
      }];
    }

    // ─── Default: Bill Payment ──────────────────────────────────
    return [{
      type: isSuccessful ? "BILL_PAYMENT_COMPLETED" : "BILL_PAYMENT_FAILED",
      data: {
        transactionRef,
        providerRef: transactionRef,
        amountMinor: Math.round(amount * 100),
        currency: "NGN",
        customerName,
        customer,
        productCode,
        status: isSuccessful ? "SUCCESS" : "FAILED",
        providerResponse: p,
      },
    }];
  },
  maxAgeMs: 30 * 60 * 1000,
};
