import { requireUser } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { rateLimit } from "@/lib/turbopay/rate-limit";
import { db } from "@/lib/db";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { StripePaymentProvider } from "@/lib/turbocore/providers/adapters/stripe";

/**
 * DELETE /api/stripe/payment-methods/[id]
 *
 * Detaches (removes) a saved payment method from the user's Stripe customer.
 * The payment method is deleted from the user's saved cards on Stripe.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, { key: "stripe-pm-delete", limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  let user;
  try { user = await requireUser(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  const { id: paymentMethodId } = await params;
  if (!paymentMethodId || !paymentMethodId.startsWith("pm_")) {
    return errorJson("Invalid payment method ID", 400, "VALIDATION");
  }

  const config = await db.providerConfig.findFirst({
    where: { providerName: "stripe", enabled: true, contract: "walletFunding" },
  });
  if (!config) return errorJson("Stripe is not configured.", 400, "PROVIDER_NOT_CONFIGURED");

  const adapter = await adapterFactory.create("walletFunding", config.id);
  if (!adapter || !(adapter instanceof StripePaymentProvider)) {
    return errorJson("Stripe provider unavailable.", 503, "PROVIDER_UNAVAILABLE");
  }

  // Verify the user owns this payment method by checking their Stripe customer.
  const sc = await db.stripeCustomer.findUnique({ where: { userId: user.id } });
  if (!sc) return errorJson("No Stripe customer found.", 400, "NO_CUSTOMER");

  // List the user's payment methods to verify ownership.
  const listResult = await adapter.listPaymentMethods(sc.stripeCustomerId, "card");
  if (!listResult.ok) {
    return errorJson("Failed to verify payment method ownership.", 502, "STRIPE_ERROR");
  }

  const owned = (listResult.data ?? []).some((pm) => pm.id === paymentMethodId);
  if (!owned) {
    return errorJson("Payment method not found or not owned by this user.", 404, "NOT_FOUND");
  }

  const result = await adapter.detachPaymentMethod(paymentMethodId);
  if (!result.ok) {
    return errorJson(result.error?.message ?? "Failed to remove payment method", 502, "STRIPE_ERROR");
  }

  return json({ data: { id: paymentMethodId, removed: true } });
}
