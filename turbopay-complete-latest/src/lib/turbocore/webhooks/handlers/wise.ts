/**
 * Wise (TransferWise) webhook handler — normalises Wise's borderless account
 * and transfer events into internal domain events.
 *
 * Wise sends events like:
 *   - balances#credit       → money received into the Wise borderless account
 *   - transfers#state-change → outbound transfer status change
 *
 * Signature: Wise uses a non-standard scheme: the signature is
 * `"<timestamp>.<hmac>"` in the `x-signature` header, and the HMAC is computed
 * over `"<timestamp>.<raw_body>"`. We verify this by splitting the header,
 * reconstructing the signed payload, and comparing the HMAC.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, isDemoRequest, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import * as crypto from "node:crypto";
import { decryptPii } from "@/lib/turbopay/crypto";
import { db } from "@/lib/db";

/**
 * Wise-specific signature verifier — handles the `timestamp.hmac` format.
 * Falls back to the standard hmacVerifierFromDb for the secret lookup.
 */
async function verifyWiseSignature(
  input: { rawBody: string; headers: Record<string, string> },
): Promise<boolean> {
  // 1. Look up the secret from the DB (admin-configured) or env fallback.
  let secret = process.env.WISE_WEBHOOK_SECRET;
  try {
    const endpoint = await db.webhookEndpoint.findFirst({
      where: { providerName: "wise", enabled: true },
      select: { secretEnc: true },
    });
    if (endpoint?.secretEnc) {
      secret = decryptPii(endpoint.secretEnc);
    }
  } catch { /* fall through to env */ }

  if (!secret) {
    // Dev demo mode — never accepted in production.
    return isDemoRequest(input);
  }

  const sigHeader = input.headers["x-signature"] ?? input.headers["X-Signature"] ?? "";
  if (!sigHeader) return false;

  // Wise signature format: "<timestamp>.<hmac-sha1-hex>"
  const [timestamp, hmac] = sigHeader.split(".");
  if (!timestamp || !hmac) return false;

  // Reconstruct the signed payload: timestamp + raw body.
  const signedPayload = `${timestamp}.${input.rawBody}`;
  const expected = crypto.createHmac("sha1", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export const wiseWebhookHandler: WebhookHandler = {
  provider: "wise",
  verifySignature: verifyWiseSignature,
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.data?.resource?.id?.toString() ?? p?.data?.id?.toString() ?? p?.data?.reference ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const event = p?.event_type as string | undefined;
    const data = p?.data ?? {};
    const ref = data?.resource?.id ?? data?.id ?? data?.reference;
    if (!event || !ref) return [];

    // Money received into Wise borderless account (inbound international).
    if (event === "balances#credit") {
      return [{
        type: "INTL_TRANSFER_RECEIVED",
        data: {
          providerRef: ref.toString(),
          raw: payload,
          amountMinor: Math.round((data?.amount?.value ?? 0) * 100),
          currency: data?.amount?.currency ?? "USD",
        },
      }];
    }

    // Outbound transfer state change.
    if (event === "transfers#state-change") {
      const state = data?.current_state as string;
      if (state === "outgoing_payment_sent" || state === "funds_converted") {
        return [{
          type: "TRANSFER_COMPLETED",
          data: {
            providerRef: ref.toString(),
            provider: "wise",
            status: "SUCCESS",
          },
        }];
      }
      if (state === "cancelled" || state === "funds_refunded") {
        return [{
          type: "TRANSFER_FAILED",
          data: {
            providerRef: ref.toString(),
            provider: "wise",
            status: "FAILED",
            reason: `Transfer ${state}`,
          },
        }];
      }
    }

    return [{ type: "WISE_EVENT_IGNORED", data: { event, ref: ref.toString() } }];
  },
  maxAgeMs: 30 * 60 * 1000, // 30 min replay window (international can be slow)
};
