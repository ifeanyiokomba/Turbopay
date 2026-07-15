/**
 * Payment Webhook Handler
 * ========================
 *
 * POST /api/payment/webhook — Handle webhook events from providers
 *
 * Routes webhook events to the payment flow service for processing.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { paymentFlow } from "@/lib/turbocore/orchestration/payment-flow";

export async function POST(req: Request) {
  // Get provider from query params or headers
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") || req.headers.get("x-provider") || "unknown";

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }

  const eventType = body.event || body.type || "unknown";

  // Process webhook
  const result = await paymentFlow.processWebhook(provider, eventType, body);

  if (result.processed) {
    return json({ data: { processed: true } });
  } else {
    return errorJson(result.error ?? "Webhook processing failed", 500);
  }
}
