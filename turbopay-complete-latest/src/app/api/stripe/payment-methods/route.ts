import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { StripePaymentProvider } from "@/lib/turbocore/providers/adapters/stripe";

/**
 * GET /api/stripe/payment-methods
 *
 * Lists saved payment methods (cards) for the authenticated user.
 * Requires a Stripe customer record (created via /api/stripe/setup-intent).
 */
export async function GET(req: Request) {
  const limited = await rateLimit(req, { key: "stripe-pm-list", limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const config = await db.providerConfig.findFirst({
    where: { providerName: "stripe", enabled: true, contract: "walletFunding" },
  });
  // If Stripe isn't configured, return empty list (not an error — the UI just won't show saved cards).
  if (!config) return json({ data: [] });

  const adapter = await adapterFactory.create("walletFunding", config.id);
  if (!adapter || !(adapter instanceof StripePaymentProvider)) {
    return json({ data: [] });
  }

  const sc = await db.stripeCustomer.findUnique({ where: { userId: user.id } });
  if (!sc) return json({ data: [] });

  const result = await adapter.listPaymentMethods(sc.stripeCustomerId, "card");
  if (!result.ok) {
    return errorJson(result.error?.message ?? "Failed to list payment methods", 502, "STRIPE_ERROR");
  }

  return json({ data: result.data ?? [] });
}
