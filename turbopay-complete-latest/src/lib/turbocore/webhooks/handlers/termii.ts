/**
 * Termii webhook handler — normalises SMS delivery receipts (DLR).
 *
 * Termii sends delivery reports when an SMS is delivered (or fails). This
 * updates the NotificationLog with the final delivery status.
 *
 * Signature: HMAC-SHA256 over the raw body in the `x-termii-signature` header.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";

export const termiiWebhookHandler: WebhookHandler = {
  provider: "termii",
  verifySignature: hmacVerifierFromDb("termii", "x-termii-signature", "TERMII_API_KEY"),
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.messageId ?? p?.message_id ?? p?.data?.messageId ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const data = p?.data ?? p;
    const messageId = data?.messageId ?? data?.message_id;
    const status = (data?.status ?? p?.status ?? "").toString().toUpperCase();
    if (!messageId) return [];

    if (status === "DELIVERED" || status === "SENT") {
      return [{
        type: "SMS_DELIVERED",
        data: { providerRef: messageId, provider: "termii", status: "DELIVERED" },
      }];
    }
    if (status === "FAILED" || status === "REJECTED" || status === "EXPIRED") {
      return [{
        type: "SMS_FAILED",
        data: { providerRef: messageId, provider: "termii", status: "FAILED", reason: data?.error ?? status },
      }];
    }
    return [{ type: "TERMII_EVENT_IGNORED", data: { messageId, status } }];
  },
  maxAgeMs: 60 * 60 * 1000, // 1 hour (DLRs can be delayed)
};
