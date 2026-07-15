/**
 * Payment Transfer API
 * =====================
 *
 * POST /api/payment/transfer — Initiate a bank transfer
 *
 * Routes to the best provider via the routing engine,
 * executes the transfer, and returns the result.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { paymentFlow } from "@/lib/turbocore/orchestration/payment-flow";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";

export async function POST(req: Request) {
  // Auth
  const user = await requireUser();

  // Rate limit
  const limited = await rateLimit(req, { key: "transfer", limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }

  const { amountKobo, currency, reference, accountNumber, bankCode, recipientName, narration, country } = body;

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
  if (!accountNumber || typeof accountNumber !== "string") {
    return errorJson("accountNumber is required", 400);
  }
  if (!bankCode || typeof bankCode !== "string") {
    return errorJson("bankCode is required", 400);
  }

  // Process transfer
  const result = await paymentFlow.processTransfer({
    userId: user.id,
    amountKobo,
    currency: currency as any,
    reference,
    accountNumber,
    bankCode,
    recipientName,
    narration,
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
      result.error?.message ?? "Transfer failed",
      502,
      result.error?.code ?? "TRANSFER_FAILED"
    );
  }
}
