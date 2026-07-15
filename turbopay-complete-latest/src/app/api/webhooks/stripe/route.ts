import { handleStripeWebhook, verifyStripeWebhook } from "@/lib/turbocore/webhooks/handlers/stripe";
import { audit } from "@/lib/turbopay/audit";
import { rateLimit } from "@/lib/turbopay/rate-limit";

/**
 * POST /api/webhooks/stripe
 *
 * Receives Stripe webhook events.
 * Verifies the webhook signature, processes the event, and returns 200.
 *
 * Stripe retries failed webhooks up to 3 days with exponential backoff.
 * We must return 200 quickly (within 30s) or Stripe will retry.
 */
export async function POST(req: Request) {
  // Rate limit: 100 requests/minute (Stripe can send bursts during retries).
  const limited = await rateLimit(req, { key: "stripe-webhook", limit: 100, windowMs: 60_000 });
  if (limited) return limited;

  // Read raw body for signature verification.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("stripe-signature") ?? "";

  if (!signatureHeader) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Verify webhook signature and parse event.
  const rawEvent = await verifyStripeWebhook(rawBody, signatureHeader);
  if (!rawEvent) {
    await audit({
      action: "STRIPE_WEBHOOK_SIGNATURE_FAILED",
      category: "WEBHOOK",
      severity: "WARN",
      metadata: { ip: req.headers.get("x-forwarded-for") ?? "unknown" },
    });
    return new Response("Invalid signature", { status: 400 });
  }

  const event = rawEvent as { id: string; type: string; data: { object: Record<string, unknown> }; created: number };

  // Process the event.
  try {
    const result = await handleStripeWebhook(event);

    await audit({
      action: "STRIPE_WEBHOOK_RECEIVED",
      category: "WEBHOOK",
      severity: "INFO",
      metadata: {
        eventId: event.id,
        eventType: event.type,
        processed: result.processed,
        reason: result.reason,
      },
    });

    return new Response(JSON.stringify({ received: true, processed: result.processed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await audit({
      action: "STRIPE_WEBHOOK_ERROR",
      category: "WEBHOOK",
      severity: "ERROR",
      metadata: {
        eventId: event.id,
        eventType: event.type,
        error: e instanceof Error ? e.message : String(e),
      },
    });

    // Return 200 to prevent Stripe retries for processing errors
    // (the event was valid, just failed to process).
    return new Response(JSON.stringify({ received: true, processed: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
