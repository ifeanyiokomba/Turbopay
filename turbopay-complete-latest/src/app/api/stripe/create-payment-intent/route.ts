import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { StripePaymentProvider } from "@/lib/turbocore/providers/adapters/stripe";
import { z } from "zod";

const schema = z.object({
  amountNaira: z.number().min(100, "Minimum amount is ₦100").max(500000, "Maximum amount is ₦500,000"),
});

/**
 * POST /api/stripe/create-payment-intent
 *
 * Creates a Stripe Payment Intent for wallet funding.
 * Returns the client_secret for the frontend to confirm the payment.
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "stripe-pi", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  let body: unknown;
  try { body = await req.json(); } catch { return errorJson("Invalid request body", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.issues[0]?.message ?? "Invalid amount", 422, "VALIDATION");

  // Find the Stripe provider config.
  const config = await db.providerConfig.findFirst({
    where: { providerName: "stripe", enabled: true, contract: "walletFunding" },
  });

  if (!config) {
    return errorJson("Stripe is not configured. Please contact support.", 400, "PROVIDER_NOT_CONFIGURED");
  }

  // Create the adapter from DB credentials.
  const adapter = await adapterFactory.create("walletFunding", config.id);
  if (!adapter || !(adapter instanceof StripePaymentProvider)) {
    return errorJson("Stripe provider unavailable. Please try again later.", 503, "PROVIDER_UNAVAILABLE");
  }

  const amountKobo = Math.round(parsed.data.amountNaira * 100);

  // Resolve virtual account for the webhook handler to credit the correct wallet.
  const va = await db.virtualAccount.findFirst({ where: { userId: user.id, status: "ACTIVE" } });

  const result = await adapter.createPaymentIntent(
    amountKobo,
    "NGN",
    undefined,
    {
      reference: `tp_${user.id}_${Date.now()}`,
      accountNumber: va?.accountNumber ?? "",
      userId: user.id,
    },
  );

  if (!result.ok || !result.data) {
    return errorJson(result.error?.message ?? "Failed to create payment intent", 502, "STRIPE_ERROR");
  }

  // Resolve publishable key from decrypted credentials.
  let publishableKey = "";
  try {
    const creds = await providerConfig.getDecryptedCredentials(config.id);
    publishableKey = creds?.publishableKey ?? "";
  } catch { /* ignore */ }

  return json({
    data: {
      clientSecret: result.data.clientSecret,
      paymentIntentId: result.data.paymentIntentId,
      amount: amountKobo,
      currency: "NGN",
      publishableKey,
    },
  });
}
