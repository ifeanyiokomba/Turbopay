/**
 * Paystack webhook handler — normalises Paystack's raw payload into internal
 * domain events for transfer status updates, card funding, subscriptions,
 * disputes, and settlements.
 *
 * Paystack sends events like:
 *   - transfer.success       → outbound transfer completed
 *   - transfer.failed        → outbound transfer failed
 *   - charge.success         → card payment successful
 *   - subscription.create    → subscription created
 *   - subscription.enable    → subscription re-enabled
 *   - subscription.disable   → subscription disabled
 *   - dispute.create         → dispute opened
 *   - dispute.resolve        → dispute resolved
 *   - refund.pending         → refund pending
 *   - refund.processed       → refund processed
 *   - settlement.success     → settlement completed
 *
 * Signature: HMAC-SHA256 over the raw body, sent in the `x-paystack-signature`
 * header.
 *
 * PURE FUNCTION — no side effects. The dispatcher handles business logic.
 */

import { hmacVerifierFromDb, type WebhookHandler } from "@/lib/turbocore/webhooks/registry";
import { nairaToKobo } from "@/lib/turbopay/money";

export const paystackWebhookHandler: WebhookHandler = {
  provider: "paystack",
  verifySignature: hmacVerifierFromDb("paystack", "x-paystack-signature", "PAYSTACK_SECRET_KEY"),
  extractProviderRef: (payload) => {
    const p = payload as any;
    return p?.data?.reference ?? p?.data?.id ?? p?.data?.transfer_reference ?? null;
  },
  normalize: (payload, _headers) => {
    const p = payload as any;
    const event = p?.event as string | undefined;
    const data = p?.data ?? {};
    const ref = data.reference ?? data.id ?? data.transfer_reference;
    if (!event || !ref) return [];

    // ─── Transfer Events ────────────────────────────────────────
    if (event === "transfer.success") {
      return [{
        type: "TRANSFER_COMPLETED",
        data: {
          providerRef: ref,
          provider: "paystack",
          status: "SUCCESS",
          amountMinor: nairaToKobo(parseFloat(data.amount ?? "0")),
        },
      }];
    }
    if (event === "transfer.failed" || event === "transfer.reversed") {
      return [{
        type: "TRANSFER_FAILED",
        data: {
          providerRef: ref,
          provider: "paystack",
          status: "FAILED",
          reason: data.fail_reason ?? data.gateway_response ?? "Transfer failed",
        },
      }];
    }

    // ─── Card Charge Events ─────────────────────────────────────
    if (event === "charge.success") {
      const amount = nairaToKobo(parseFloat(data.amount ?? "0"));
      const customerEmail = data.customer?.email;
      const authorization = data.authorization;
      return [{
        type: "CARD_FUNDING_SUCCESS",
        data: {
          providerRef: ref,
          provider: "paystack",
          amountMinor: amount,
          customerEmail,
          authorizationCode: authorization?.authorization_code,
        },
      }];
    }

    // ─── Subscription Events ────────────────────────────────────
    if (event === "subscription.create") {
      return [{
        type: "SUBSCRIPTION_CREATED",
        data: {
          providerRef: ref,
          provider: "paystack",
          subscriptionCode: data.subscription_code,
          customerCode: data.customer?.customer_code,
          planCode: data.plan?.plan_code,
          status: data.status,
        },
      }];
    }
    if (event === "subscription.enable") {
      return [{
        type: "SUBSCRIPTION_ENABLED",
        data: {
          providerRef: ref,
          provider: "paystack",
          subscriptionCode: data.subscription_code,
          status: "active",
        },
      }];
    }
    if (event === "subscription.disable") {
      return [{
        type: "SUBSCRIPTION_DISABLED",
        data: {
          providerRef: ref,
          provider: "paystack",
          subscriptionCode: data.subscription_code,
          status: "inactive",
        },
      }];
    }

    // ─── Dispute Events ─────────────────────────────────────────
    if (event === "dispute.create") {
      return [{
        type: "DISPUTE_OPENED",
        data: {
          providerRef: ref,
          provider: "paystack",
          disputeCode: data.dispute_code,
          transactionRef: data.transaction?.reference,
          category: data.category,
          amountMinor: nairaToKobo(parseFloat(data.amount ?? "0")),
          currency: data.currency ?? "NGN",
          comment: data.comment,
        },
      }];
    }
    if (event === "dispute.resolve") {
      return [{
        type: "DISPUTE_RESOLVED",
        data: {
          providerRef: ref,
          provider: "paystack",
          disputeCode: data.dispute_code,
          resolution: data.resolution,
          status: "resolved",
        },
      }];
    }

    // ─── Refund Events ──────────────────────────────────────────
    if (event === "refund.pending") {
      return [{
        type: "REFUND_PENDING",
        data: {
          providerRef: ref,
          provider: "paystack",
          amountMinor: nairaToKobo(parseFloat(data.amount ?? "0")),
          status: "pending",
        },
      }];
    }
    if (event === "refund.processed") {
      return [{
        type: "REFUND_COMPLETED",
        data: {
          providerRef: ref,
          provider: "paystack",
          amountMinor: nairaToKobo(parseFloat(data.amount ?? "0")),
          status: "completed",
        },
      }];
    }

    // ─── Settlement Events ──────────────────────────────────────
    if (event === "settlement.success") {
      return [{
        type: "SETTLEMENT_COMPLETED",
        data: {
          providerRef: ref,
          provider: "paystack",
          amountMinor: nairaToKobo(parseFloat(data.amount ?? "0")),
          status: "success",
          settledAt: data.settlement_date,
        },
      }];
    }

    // ─── Ignored Events ─────────────────────────────────────────
    return [{ type: "PAYSTACK_EVENT_IGNORED", data: { event, ref } }];
  },
  maxAgeMs: 10 * 60 * 1000, // 10 min replay window
};
