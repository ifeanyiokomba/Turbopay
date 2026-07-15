/**
 * Payment FX Quote API
 * =====================
 *
 * POST /api/payment/fx — Get an FX quote
 *
 * Routes to the best provider via the routing engine,
 * gets the FX quote, and returns the result.
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { paymentFlow } from "@/lib/turbocore/orchestration/payment-flow";
import { requireUser } from "@/lib/turbopay/auth";
import { rateLimit } from "@/lib/turbopay/rate-limit";

export async function POST(req: Request) {
  // Auth
  const user = await requireUser();

  // Rate limit
  const limited = await rateLimit(req, { key: "fx-quote", limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request body", 400);
  }

  const { fromCurrency, toCurrency, amountKobo, country } = body;

  // Validate required fields
  if (!fromCurrency || typeof fromCurrency !== "string") {
    return errorJson("fromCurrency is required", 400);
  }
  if (!toCurrency || typeof toCurrency !== "string") {
    return errorJson("toCurrency is required", 400);
  }
  if (!amountKobo || typeof amountKobo !== "number" || amountKobo <= 0) {
    return errorJson("amountKobo must be a positive number", 400);
  }

  // Get FX quote
  const result = await paymentFlow.getFxQuote({
    fromCurrency: fromCurrency as any,
    toCurrency: toCurrency as any,
    amountKobo,
    userId: user.id,
    country: country || user.country || "NG",
  });

  if (result.success) {
    return json({
      data: {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: result.rate,
        amountKobo: result.amountKobo,
        convertedAmountKobo: result.convertedAmountKobo,
        providerFeeKobo: result.providerFeeKobo,
        platformFeeKobo: result.platformFeeKobo,
        provider: result.providerName,
      },
    });
  } else {
    return errorJson(
      result.error?.message ?? "FX quote failed",
      502,
      result.error?.code ?? "FX_QUOTE_FAILED"
    );
  }
}
