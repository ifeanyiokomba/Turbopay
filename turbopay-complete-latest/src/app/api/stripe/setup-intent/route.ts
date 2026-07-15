import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { StripePaymentProvider } from "@/lib/turbocore/providers/adapters/stripe";

/**
 * POST /api/stripe/setup-intent
 *
 * Creates a Stripe Setup Intent for saving a payment method (card)
 * for future use. Returns the client_secret for the frontend to
 * confirm the setup intent.
 */
export async function POST(req: Request) {
  const limited = await rateLimit(req, { key: "stripe-setup", limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const config = await db.providerConfig.findFirst({
    where: { providerName: "stripe", enabled: true, contract: "walletFunding" },
  });
  if (!config) return errorJson("Stripe is not configured. Please contact support.", 400, "PROVIDER_NOT_CONFIGURED");

  const adapter = await adapterFactory.create("walletFunding", config.id);
  if (!adapter || !(adapter instanceof StripePaymentProvider)) {
    return errorJson("Stripe provider unavailable. Please try again later.", 503, "PROVIDER_UNAVAILABLE");
  }

  // Find or create Stripe customer
  let stripeCustomerId: string | undefined;
  const existing = await db.stripeCustomer.findUnique({ where: { userId: user.id } });
  if (existing?.stripeCustomerId) {
    stripeCustomerId = existing.stripeCustomerId;
  }

  if (!stripeCustomerId) {
    const cust = await adapter.createCustomer(user.email ?? `${user.id}@turbopay.com`, user.fullName, { userId: user.id });
    if (cust.ok && cust.data) {
      stripeCustomerId = cust.data.id;
      await db.stripeCustomer.create({ data: { userId: user.id, stripeCustomerId: cust.data.id } });
    }
  }

  if (!stripeCustomerId) return errorJson("Could not create Stripe customer", 502, "STRIPE_ERROR");

  const result = await adapter.createSetupIntent(stripeCustomerId, { userId: user.id });
  if (!result.ok || !result.data) {
    return errorJson(result.error?.message ?? "Failed to create setup intent", 502, "STRIPE_ERROR");
  }

  return json({ data: { setupIntentId: result.data.setupIntentId, clientSecret: result.data.clientSecret } });
}
