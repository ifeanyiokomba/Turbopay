/**
 * Baxi webhook handler — normalises Baxi's bill payment callback into internal
 * domain events.
 *
 * Baxi sends callbacks when a bill payment completes (especially async
 * payments like prepaid electricity tokens which require token generation).
 *
 * Events:
 *   - BILL_PAYMENT_SUCCESS → bill paid, token/receipt delivered
 *   - BILL_PAYMENT_FAILED  → bill payment failed → refund wallet
 *
 * Signature: HMAC-SHA256 over the raw body in the `x-baxi-signature` header.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import { nairaToKobo } from "@/lib/turbopay/money";

export const baxiWebhookHandler: WebhookHandler = {
  provider: "baxi",
  verifySignature: hmacVerifierFromDb("baxi", "x-baxi-signature", "BAXI_API_KEY"),
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.transactionReference ?? p?.ref ?? p?.data?.reference ?? p?.reference ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const data = p?.data ?? p;
    const ref = data?.transactionReference ?? data?.ref ?? data?.reference;
    const status = (data?.status ?? p?.status ?? "").toString().toUpperCase();
    const product = data?.product ?? data?.category ?? "BILL";
    const amount = nairaToKobo(parseFloat(data?.amount ?? "0"));
    const token = data?.token ?? data?.meterToken;
    const receiptNumber = data?.receiptNumber ?? data?.receipt_no;
    if (!ref) return [];

    if (status === "SUCCESS" || status === "SUCCESSFUL") {
      return [{
        type: "BILL_PAYMENT_SUCCESS",
        data: {
          providerRef: ref,
          provider: "baxi",
          product,
          amountMinor: amount,
          token,
          receiptNumber,
        },
      }];
    }
    if (status === "FAILED" || status === "DECLINED") {
      return [{
        type: "BILL_PAYMENT_FAILED",
        data: {
          providerRef: ref,
          provider: "baxi",
          product,
          reason: data?.errorMessage ?? data?.error ?? "Bill payment failed",
        },
      }];
    }
    return [{ type: "BAXI_EVENT_IGNORED", data: { ref, status } }];
  },
  maxAgeMs: 15 * 60 * 1000, // 15 min replay window (bills can be slow)
};
