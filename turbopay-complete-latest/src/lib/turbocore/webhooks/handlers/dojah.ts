/**
 * Dojah webhook handler — normalises async KYC verification callbacks.
 *
 * Dojah sends callbacks when an async KYC verification (NIN/BVN) completes.
 * The result is used to upgrade the user's KYC tier.
 *
 * Signature: HMAC-SHA256 over the raw body in the `x-dojah-signature` header.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";

export const dojahWebhookHandler: WebhookHandler = {
  provider: "dojah",
  verifySignature: hmacVerifierFromDb("dojah", "x-dojah-signature", "DOJAH_PRIVATE_KEY"),
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.data?.reference ?? p?.reference ?? p?.data?.verification_id ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const data = p?.data ?? p;
    const ref = data?.reference ?? data?.verification_id;
    const status = (data?.status ?? p?.status ?? "").toString().toUpperCase();
    const type = data?.type ?? data?.verification_type ?? "KYC";
    if (!ref) return [];

    if (status === "SUCCESS" || status === "VERIFIED") {
      return [{
        type: "KYC_VERIFIED",
        data: {
          providerRef: ref,
          provider: "dojah",
          type,
          firstName: data?.first_name,
          lastName: data?.last_name,
          middleName: data?.middle_name,
          dob: data?.dob,
          gender: data?.gender,
          phoneMatch: data?.phone_match,
          stateOfOrigin: data?.state_of_origin,
          lga: data?.lga,
        },
      }];
    }
    if (status === "FAILED" || status === "UNVERIFIED") {
      return [{
        type: "KYC_FAILED",
        data: {
          providerRef: ref,
          provider: "dojah",
          type,
          reason: data?.error ?? data?.reason ?? "KYC verification failed",
        },
      }];
    }
    return [{ type: "DOJAH_EVENT_IGNORED", data: { ref, status } }];
  },
  maxAgeMs: 60 * 60 * 1000, // 1 hour replay window (KYC can be slow)
};
