/**
 * Turbopay Service Layer — StripeService.
 * ========================================
 *
 * Stripe payment integration for wallet funding. Wraps all Stripe adapter
 * calls and provider config lookups. Extracted from:
 *   - src/app/api/stripe/create-payment-intent/route.ts
 *   - src/app/api/stripe/create-checkout-session/route.ts
 *   - src/app/api/stripe/setup-intent/route.ts
 *   - src/app/api/stripe/payment-methods/route.ts
 *   - src/app/api/stripe/payment-methods/[id]/route.ts
 */

import { db } from "@/lib/db";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { StripePaymentProvider } from "@/lib/turbocore/providers/adapters/stripe";
import { providerConfig } from "@/lib/turbocore/config/provider-config";
import { ServiceError } from "./types";

class StripeService {
  /**
   * Get the Stripe adapter, or throw if not configured.
   */
  private async getAdapter(): Promise<StripePaymentProvider> {
    const config = await db.providerConfig.findFirst({
      where: { providerName: "stripe", enabled: true, contract: "walletFunding" },
    });
    if (!config) throw new ServiceError("PROVIDER_NOT_CONFIGURED", "Stripe is not configured. Please contact support.", 400);

    const adapter = await adapterFactory.create("walletFunding", config.id);
    if (!adapter || !(adapter instanceof StripePaymentProvider)) {
      throw new ServiceError("PROVIDER_UNAVAILABLE", "Stripe provider unavailable. Please try again later.", 503);
    }

    return adapter;
  }

  /**
   * Create a Stripe Payment Intent for wallet funding.
   */
  async createPaymentIntent(userId: string, amountNaira: number) {
    const adapter = await this.getAdapter();
    const amountKobo = Math.round(amountNaira * 100);

    const va = await db.virtualAccount.findFirst({ where: { userId, status: "ACTIVE" } });

    const result = await adapter.createPaymentIntent(
      amountKobo,
      "NGN",
      undefined,
      {
        reference: `tp_${userId}_${Date.now()}`,
        accountNumber: va?.accountNumber ?? "",
        userId,
      },
    );

    if (!result.ok || !result.data) {
      throw new ServiceError("STRIPE_ERROR", result.error?.message ?? "Failed to create payment intent", 502);
    }

    // Resolve publishable key from decrypted credentials.
    let publishableKey = "";
    try {
      const config = await db.providerConfig.findFirst({
        where: { providerName: "stripe", enabled: true, contract: "walletFunding" },
      });
      if (config) {
        const creds = await providerConfig.getDecryptedCredentials(config.id);
        publishableKey = creds?.publishableKey ?? "";
      }
    } catch { /* ignore */ }

    return {
      clientSecret: result.data.clientSecret,
      paymentIntentId: result.data.paymentIntentId,
      amount: amountKobo,
      currency: "NGN",
      publishableKey,
    };
  }

  /**
   * Create a Stripe Checkout Session for wallet funding.
   */
  async createCheckoutSession(userId: string, amountNaira: number) {
    const adapter = await this.getAdapter();
    const va = await db.virtualAccount.findFirst({ where: { userId, status: "ACTIVE" } });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const amountKobo = Math.round(amountNaira * 100);

    const result = await adapter.createCheckoutSession({
      amountMinor: amountKobo,
      currency: "NGN",
      successUrl: `${appUrl}/wallet?payment=success`,
      cancelUrl: `${appUrl}/wallet?payment=cancelled`,
      metadata: {
        userId,
        accountNumber: va?.accountNumber ?? "",
        reference: `tp_${userId}_${Date.now()}`,
      },
    });

    if (!result.ok || !result.data) {
      throw new ServiceError("STRIPE_ERROR", result.error?.message ?? "Failed to create checkout session", 502);
    }

    return { sessionId: result.data.sessionId, url: result.data.url };
  }

  /**
   * Create a Stripe Setup Intent for saving a payment method.
   */
  async createSetupIntent(userId: string, userEmail: string | null, userFullName: string) {
    const adapter = await this.getAdapter();

    // Find or create Stripe customer
    let stripeCustomerId: string | undefined;
    const existing = await db.stripeCustomer.findUnique({ where: { userId } });
    if (existing?.stripeCustomerId) {
      stripeCustomerId = existing.stripeCustomerId;
    }

    if (!stripeCustomerId) {
      const cust = await adapter.createCustomer(userEmail ?? `${userId}@turbopay.com`, userFullName, { userId });
      if (cust.ok && cust.data) {
        stripeCustomerId = cust.data.id;
        await db.stripeCustomer.create({ data: { userId, stripeCustomerId: cust.data.id } });
      }
    }

    if (!stripeCustomerId) throw new ServiceError("STRIPE_ERROR", "Could not create Stripe customer", 502);

    const result = await adapter.createSetupIntent(stripeCustomerId, { userId });
    if (!result.ok || !result.data) {
      throw new ServiceError("STRIPE_ERROR", result.error?.message ?? "Failed to create setup intent", 502);
    }

    return { setupIntentId: result.data.setupIntentId, clientSecret: result.data.clientSecret };
  }

  /**
   * List saved payment methods (cards) for the user.
   */
  async listPaymentMethods(userId: string) {
    let adapter: StripePaymentProvider;
    try {
      adapter = await this.getAdapter();
    } catch {
      return []; // If Stripe isn't configured, return empty list
    }

    const sc = await db.stripeCustomer.findUnique({ where: { userId } });
    if (!sc) return [];

    const result = await adapter.listPaymentMethods(sc.stripeCustomerId, "card");
    if (!result.ok) {
      throw new ServiceError("STRIPE_ERROR", result.error?.message ?? "Failed to list payment methods", 502);
    }

    return result.data ?? [];
  }

  /**
   * Detach (remove) a saved payment method.
   */
  async detachPaymentMethod(userId: string, paymentMethodId: string) {
    if (!paymentMethodId || !paymentMethodId.startsWith("pm_")) {
      throw new ServiceError("VALIDATION", "Invalid payment method ID", 400);
    }

    const adapter = await this.getAdapter();

    const sc = await db.stripeCustomer.findUnique({ where: { userId } });
    if (!sc) throw new ServiceError("NO_CUSTOMER", "No Stripe customer found.", 400);

    // Verify ownership
    const listResult = await adapter.listPaymentMethods(sc.stripeCustomerId, "card");
    if (!listResult.ok) {
      throw new ServiceError("STRIPE_ERROR", "Failed to verify payment method ownership.", 502);
    }

    const owned = (listResult.data ?? []).some((pm) => pm.id === paymentMethodId);
    if (!owned) {
      throw new ServiceError("NOT_FOUND", "Payment method not found or not owned by this user.", 404);
    }

    const result = await adapter.detachPaymentMethod(paymentMethodId);
    if (!result.ok) {
      throw new ServiceError("STRIPE_ERROR", result.error?.message ?? "Failed to remove payment method", 502);
    }

    return { id: paymentMethodId, removed: true };
  }
}

export const stripeService = new StripeService();
