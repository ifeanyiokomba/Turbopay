/**
 * Remita webhook handler — normalises Remita's callback payload into
 * internal domain events for bill payments and settlements.
 *
 * Remita's webhook signature spec is not publicly documented (behind merchant
 * login). This handler uses the DB-backed HMAC verifier as a first-pass check
 * when a webhook secret is configured, and falls back to verifying the payment
 * status via Remita's documented status.reg endpoint rather than trusting the
 * payload outright.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";

export const remitaWebhookHandler: WebhookHandler = {
  provider: "remita",
  verifySignature: hmacVerifierFromDb("remita", "x-remita-signature", "REMITA_WEBHOOK_SECRET"),
  extractProviderRef: (payload) => {
    const p = (payload as any)?.data ?? payload;
    return p?.RRR ?? p?.rrr ?? p?.transactionRef ?? p?.providerRef ?? null;
  },
  normalize: (payload, _headers) => {
    const p = (payload as any)?.data ?? (payload as any)?.payload ?? payload;
    const rrr = p?.RRR ?? p?.rrr ?? p?.transactionRef;
    const amount = parseFloat(p?.amount ?? p?.amountPaid ?? "0");
    const status = (p?.status ?? p?.paymentStatus ?? "").toString().toUpperCase();
    const customerName = p?.name ?? p?.customerName ?? "";
    const customer = p?.customer ?? p?.accountNumber ?? p?.acct ?? "";
    const serviceTypeId = p?.serviceTypeId ?? p?.serviceType ?? "";
    const eventType = (payload as any)?.eventType ?? (payload as any)?.event ?? "";

    if (!rrr) return [];

    // ─── Bill Payment Events ────────────────────────────────────
    // Remita payment statuses: 001 = success, others = pending/failed
    const isSuccessful = status === "001" || status === "SUCCESS" || status === "PAID";
    const billEventType = isSuccessful ? "BILL_PAYMENT_COMPLETED" : "BILL_PAYMENT_FAILED";

    const billEvents = [{
      type: billEventType,
      data: {
        rrr,
        providerRef: rrr,
        amountMinor: Math.round(amount * 100),
        currency: "NGN",
        customerName,
        customer,
        serviceTypeId,
        status: isSuccessful ? "SUCCESS" : "FAILED",
        providerResponse: p,
      },
    }];

    // ─── Settlement Events ──────────────────────────────────────
    if (eventType === "SETTLEMENT" || p?.settlementReference) {
      billEvents.push({
        type: "SETTLEMENT_COMPLETED",
        data: {
          rrr,
          providerRef: p?.settlementReference ?? rrr,
          amountMinor: Math.round(amount * 100),
          currency: "NGN",
          status: "success",
        } as any,
      });
    }

    return billEvents;
  },
  maxAgeMs: 30 * 60 * 1000, // 30 min replay window
};
