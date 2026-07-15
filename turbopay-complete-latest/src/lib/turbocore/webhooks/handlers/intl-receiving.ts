/**
 * International receiving webhook handler — normalises an inbound cross-border
 * payment event from a licensed partner into the internal
 * INTL_TRANSFER_RECEIVED domain event.
 *
 * PURE FUNCTION — no side effects. The WebhookRegistry's dispatcher handles
 * the business logic (calling settleIntlReceiving) after the event is marked
 * PROCESSED.
 *
 * INACTIVE until a licensed partner is configured
 * (TURBOCORE_PROVIDER_INTERNATIONAL_RECEIVING != mock).
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";

export const intlReceivingWebhookHandler: WebhookHandler = {
  provider: "intl-receiving",
  verifySignature: hmacVerifierFromDb("intl-receiving", "x-intl-signature", "TURBOCORE_INTL_WEBHOOK_SECRET"),
  extractProviderRef: (payload) => {
    const p = (payload as any)?.eventData ?? (payload as any)?.payload ?? payload;
    return p?.providerRef ?? p?.transactionReference ?? null;
  },
  normalize: (payload, _headers) => {
    const p = (payload as any)?.eventData ?? (payload as any)?.payload ?? payload;
    const providerRef = p?.providerRef ?? p?.transactionReference;
    if (!providerRef) return [];
    return [
      {
        type: "INTL_TRANSFER_RECEIVED",
        data: {
          providerRef,
          raw: p,
        },
      },
    ];
  },
  maxAgeMs: 30 * 60 * 1000, // 30 min replay window (cross-border)
};
