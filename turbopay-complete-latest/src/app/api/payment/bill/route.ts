/**
 * Payment Bill API
 * ================
 *
 * POST /api/payment/bill — Initiate a bill payment
 *
 * Routes to the best provider via the routing engine,
 * executes the bill payment, and returns the result.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { paymentFlow } from "@/lib/turbocore/orchestration/payment-flow";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";

export async function POST(req: Request) {
  // Auth
  const user = await requireUser();

  // Rate limit
  const limited = await rateLimit(req, { key: "bill-payment", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }

  const { amountKobo, currency, reference, productCode, customer, customerName, category, country } = body;

  // Validate required fields
  if (!amountKobo || typeof amountKobo !== "number" || amountKobo <= 0) {
    return errorJson("amountKobo must be a positive number", 400);
  }
  if (!currency || typeof currency !== "string") {
    return errorJson("currency is required", 400);
  }
  if (!reference || typeof reference !== "string") {
    return errorJson("reference is required", 400);
  }
  if (!productCode || typeof productCode !== "string") {
    return errorJson("productCode is required", 400);
  }
  if (!customer || typeof customer !== "string") {
    return errorJson("customer is required", 400);
  }
  if (!customerName || typeof customerName !== "string") {
    return errorJson("customerName is required", 400);
  }

  // Process bill payment
  const result = await paymentFlow.processBillPayment({
    userId: user.id,
    amountKobo,
    currency: currency as any,
    reference,
    productCode,
    customer,
    customerName,
    category: category || "bill_payment",
    country: country || user.country || "NG",
    description: body.description,
    metadata: body.metadata,
  });

  if (result.success) {
    return json({
      data: {
        reference: result.reference,
        providerRef: result.providerRef,
        status: result.status,
        amountKobo: result.amountKobo,
        currency: result.currency,
        provider: result.providerName,
      },
    });
  } else {
    return errorJson(
      result.error?.message ?? "Bill payment failed",
      502,
      result.error?.code ?? "BILL_PAYMENT_FAILED"
    );
  }
}
