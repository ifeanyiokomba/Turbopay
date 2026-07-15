/**
 * Stripe Issuing webhook handler — normalises card authorization and
 * transaction events for Turbopay virtual cards.
 *
 * Stripe sends events like:
 *   - issuing_authorization.created  → card purchase attempted (approve/decline)
 *   - issuing_transaction.created     → card purchase posted (final settlement)
 *
 * Signature: Stripe uses a non-standard scheme: the header
 * `stripe-signature` contains `t=<timestamp>,v1=<hmac>` and the HMAC is
 * computed over `"<timestamp>.<raw_body>"` using the Stripe webhook signing
 * secret (whsec_...). This is different from a plain HMAC-SHA256.
 *
 * PURE FUNCTION — no side effects. The dispatcher approves/declines the
 * authorization and posts the transaction to the card's ledger.
 */

import { hmacVerifierFromDb, isDemoRequest, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import * as crypto from "node:crypto";
import { decryptPii } from "@/lib/turbopay/crypto";
import { db } from "@/lib/db";

/**
 * Stripe-specific signature verifier — handles the `t=,v1=` format.
 */
async function verifyStripeSignature(
  input: { rawBody: string; headers: Record<string, string> },
): Promise<boolean> {
  // 1. Look up the secret from the DB (admin-configured) or env fallback.
  let secret = process.env.STRIPE_ISSUING_WEBHOOK_SECRET;
  try {
    const endpoint = await db.webhookEndpoint.findFirst({
      where: { providerName: "stripe-issuing", enabled: true },
      select: { secretEnc: true },
    });
    if (endpoint?.secretEnc) {
      secret = decryptPii(endpoint.secretEnc);
    }
  } catch { /* fall through to env */ }

  if (!secret) {
    return isDemoRequest(input);
  }

  const sigHeader = input.headers["stripe-signature"] ?? input.headers["Stripe-Signature"] ?? "";
  if (!sigHeader) return false;

  // Parse t=<timestamp>,v1=<hmac> format.
  const parts = sigHeader.split(",").map((s) => s.trim());
  let timestamp = "";
  let v1 = "";
  for (const part of parts) {
    const [key, val] = part.split("=");
    if (key === "t") timestamp = val;
    if (key === "v1") v1 = val;
  }
  if (!timestamp || !v1) return false;

  // Reconstruct the signed payload: timestamp.rawBody
  const signedPayload = `${timestamp}.${input.rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export const stripeIssuingWebhookHandler: WebhookHandler = {
  provider: "stripe-issuing",
  verifySignature: verifyStripeSignature,
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.data?.object?.id ?? p?.id ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const event = p?.type as string | undefined;
    const obj = p?.data?.object ?? {};
    const ref = obj?.id;
    if (!event || !ref) return [];

    // Card authorization (purchase attempt — approve or decline).
    if (event === "issuing_authorization.created" || event === "issuing_authorization.request") {
      return [{
        type: "CARD_AUTHORIZATION",
        data: {
          providerRef: ref,
          cardId: obj?.card, // Stripe card ID
          amountMinor: obj?.amount ?? 0, // already in minor units
          currency: obj?.currency ?? "USD",
          merchant: obj?.merchant_data?.name ?? "Unknown",
          status: obj?.status ?? "pending",
        },
      }];
    }

    // Card transaction posted (final settlement).
    if (event === "issuing_transaction.created") {
      return [{
        type: "CARD_TRANSACTION_POSTED",
        data: {
          providerRef: ref,
          cardId: obj?.card,
          amountMinor: obj?.amount ?? 0,
          currency: obj?.currency ?? "USD",
          merchant: obj?.merchant_data?.name ?? "Unknown",
          type: obj?.type ?? "capture",
        },
      }];
    }

    return [{ type: "STRIPE_EVENT_IGNORED", data: { event, ref } }];
  },
  maxAgeMs: 10 * 60 * 1000,
};
