/**
 * Resend webhook handler — normalises email delivery events.
 *
 * Resend sends events when an email is sent, delivered, bounced, or marked
 * as spam/complaint. This updates the NotificationLog with the final status.
 *
 * Signature: Resend uses Svix (similar to Stripe): the header
 * `svix-signature` contains `v1=<hmac>` and `svix-timestamp` contains the
 * timestamp. The HMAC is computed over `"<timestamp>.<raw_body>"` using the
 * Resend webhook signing secret.
 *
 * PURE FUNCTION — no side effects.
 */

import { hmacVerifierFromDb, isDemoRequest, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import * as crypto from "node:crypto";
import { decryptPii } from "@/lib/turbopay/crypto";
import { db } from "@/lib/db";

/**
 * Resend/Svix-specific signature verifier.
 */
async function verifyResendSignature(
  input: { rawBody: string; headers: Record<string, string> },
): Promise<boolean> {
  // 1. Look up the secret from the DB or env.
  let secret = process.env.RESEND_WEBHOOK_SECRET;
  try {
    const endpoint = await db.webhookEndpoint.findFirst({
      where: { providerName: "resend", enabled: true },
      select: { secretEnc: true },
    });
    if (endpoint?.secretEnc) {
      secret = decryptPii(endpoint.secretEnc);
    }
  } catch { /* fall through to env */ }

  if (!secret) {
    return isDemoRequest(input);
  }

  const sigHeader = input.headers["svix-signature"] ?? input.headers["Svix-Signature"] ?? "";
  const timestamp = input.headers["svix-timestamp"] ?? input.headers["Svix-Timestamp"] ?? "";
  if (!sigHeader || !timestamp) return false;

  // Parse v1=<hmac> from the signature header.
  const v1 = sigHeader.split(",").map((s) => s.trim())
    .find((s) => s.startsWith("v1="))?.slice(3);
  if (!v1) return false;

  // Reconstruct: timestamp.rawBody
  const signedPayload = `${timestamp}.${input.rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export const resendWebhookHandler: WebhookHandler = {
  provider: "resend",
  verifySignature: verifyResendSignature,
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.data?.email_id ?? p?.data?.messageId ?? p?.data?.id ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const event = p?.type ?? p?.event_type as string | undefined;
    const data = p?.data ?? {};
    const messageId = data?.email_id ?? data?.messageId ?? data?.id;
    if (!event || !messageId) return [];

    if (event === "email.delivered") {
      return [{ type: "EMAIL_DELIVERED", data: { providerRef: messageId, provider: "resend", status: "DELIVERED" } }];
    }
    if (event === "email.bounced" || event === "email.failed") {
      return [{ type: "EMAIL_FAILED", data: { providerRef: messageId, provider: "resend", status: "BOUNCED", reason: data?.error ?? event } }];
    }
    if (event === "email.complained") {
      return [{ type: "EMAIL_COMPLAINED", data: { providerRef: messageId, provider: "resend", status: "COMPLAINED" } }];
    }
    // email.sent, email.opened, email.clicked — informational only.
    return [{ type: "RESEND_EVENT_IGNORED", data: { messageId, event } }];
  },
  maxAgeMs: 60 * 60 * 1000, // 1 hour
};
