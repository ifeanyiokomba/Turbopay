/**
 * Stripe production adapter.
 * -------------------------
 * Implements IWalletFundingProvider against the Stripe API.
 *
 * Supports:
 *   - Payment Intents (wallet funding via card/bank)
 *   - Webhook verification (signature validation)
 *   - Customer creation & management
 *   - Refunds
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 */
import type {
  IWalletFundingProvider,
  ProviderContext,
  ProviderResult,
  SimulatedFundingEvent,
  WalletFundingInit,
  WalletFundingResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface StripeCredentials {
  secretKey: string;
  publishableKey?: string;
  webhookSecret?: string;
  restrictedKey?: string;
  baseUrl?: string;
}

interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  created: number;
}

interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret: string | null;
  metadata: Record<string, string>;
  payment_method: string | null;
  created: number;
}

interface StripeRefund {
  id: string;
  amount: number;
  status: string;
  payment_intent: string;
  created: number;
}

export class StripePaymentProvider implements IWalletFundingProvider {
  readonly name = "stripe";
  private baseUrl: string;

  constructor(private readonly creds: StripeCredentials) {
    this.baseUrl = creds.baseUrl ?? "https://api.stripe.com";
  }

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  }

  /**
   * Create a Stripe Customer for a TurboPay user.
   */
  async createCustomer(
    email: string,
    name: string,
    metadata?: Record<string, string>,
  ): Promise<ProviderResult<StripeCustomer>> {
    try {
      const params = new URLSearchParams({
        email,
        name,
        "metadata[product]": "turbopay",
      });
      if (metadata) {
        for (const [k, v] of Object.entries(metadata)) {
          params.set(`metadata[${k}]`, v);
        }
      }

      const res = await jsonRequest<StripeCustomer>({
        url: `${this.baseUrl}/v1/customers`,
        method: "POST",
        headers: this.authHeaders,
        body: params.toString(),
      });

      return { ok: true, data: res.data };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * Create a Payment Intent for wallet funding.
   */
  async createPaymentIntent(
    amountMinor: number,
    currency: string,
    customerId?: string,
    metadata?: Record<string, string>,
  ): Promise<ProviderResult<{ paymentIntentId: string; clientSecret: string; amount: number; currency: string }>> {
    try {
      const params = new URLSearchParams({
        amount: String(amountMinor),
        currency: currency.toLowerCase(),
        "metadata[product]": "turbopay",
        "metadata[purpose]": "wallet_funding",
        "automatic_payment_methods[enabled]": "true",
      });
      if (customerId) {
        params.set("customer", customerId);
        // Save the card used for this payment for future use.
        params.set("setup_future_usage", "off_session");
      }
      if (metadata) {
        for (const [k, v] of Object.entries(metadata)) {
          params.set(`metadata[${k}]`, v);
        }
      }

      const res = await jsonRequest<StripePaymentIntent>({
        url: `${this.baseUrl}/v1/payment_intents`,
        method: "POST",
        headers: this.authHeaders,
        body: params.toString(),
      });

      const pi = res.data;
      if (!pi.client_secret) {
        return { ok: false, error: { code: "NO_CLIENT_SECRET", message: "Payment Intent created but no client_secret returned" } };
      }

      return {
        ok: true,
        data: {
          paymentIntentId: pi.id,
          clientSecret: pi.client_secret,
          amount: pi.amount,
          currency: pi.currency,
        },
        providerRef: pi.id,
      };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * Retrieve a Payment Intent by ID.
   */
  async getPaymentIntent(paymentIntentId: string): Promise<ProviderResult<StripePaymentIntent>> {
    try {
      const res = await jsonRequest<StripePaymentIntent>({
        url: `${this.baseUrl}/v1/payment_intents/${paymentIntentId}`,
        method: "GET",
        headers: this.authHeaders,
      });
      return { ok: true, data: res.data };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * Create a refund for a Payment Intent.
   */
  async createRefund(
    paymentIntentId: string,
    amountMinor?: number,
    reason?: string,
  ): Promise<ProviderResult<StripeRefund>> {
    try {
      const params = new URLSearchParams({ payment_intent: paymentIntentId });
      if (amountMinor) params.set("amount", String(amountMinor));
      if (reason) params.set("reason", reason);

      const res = await jsonRequest<StripeRefund>({
        url: `${this.baseUrl}/v1/refunds`,
        method: "POST",
        headers: this.authHeaders,
        body: params.toString(),
      });

      return { ok: true, data: res.data, providerRef: res.data.id };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * Verify a Stripe webhook signature.
   */
  verifyWebhook(rawBody: string, signatureHeader: string): Record<string, unknown> | null {
    if (!this.creds.webhookSecret) return null;

    try {
      const crypto = require("crypto");
      const parts = signatureHeader.split(",").reduce(
        (acc: { timestamp: string; signatures: string[] }, part: string) => {
          const [key, value] = part.split("=");
          if (key === "t") acc.timestamp = value;
          if (key === "v1") acc.signatures.push(value);
          return acc;
        },
        { timestamp: "", signatures: [] as string[] },
      );

      const timestamp = parseInt(parts.timestamp, 10);
      if (Math.abs(Date.now() / 1000 - timestamp) > 300) return null;

      const payload = `${parts.timestamp}.${rawBody}`;
      const expectedSignature = crypto
        .createHmac("sha256", this.creds.webhookSecret)
        .update(payload)
        .digest("hex");

      const signatureMatch = parts.signatures.some(
        (sig: string) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature)),
      );

      if (!signatureMatch) return null;
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ─── Checkout Sessions ────────────────────────────────────────

  /**
   * Create a Stripe Checkout Session for one-time payment.
   */
  async createCheckoutSession(params: {
    amountMinor: number;
    currency: string;
    customerId?: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<ProviderResult<{ sessionId: string; url: string }>> {
    try {
      const formParams = new URLSearchParams({
        mode: "payment",
        "line_items[0][price_data][currency]": params.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(params.amountMinor),
        "line_items[0][price_data][product_data][name]": "Turbopay Wallet Funding",
        "line_items[0][quantity]": "1",
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        "metadata[product]": "turbopay",
        "metadata[purpose]": "wallet_funding",
        // Flag the payment_intent so handlePaymentIntentSucceeded can skip it
        // (checkout.session.completed handles the wallet credit instead).
        "payment_intent_data[metadata][from_checkout]": "true",
        // Save the card used in this checkout for future payments.
        "payment_intent_data[setup_future_usage]": "off_session",
      });
      if (params.customerId) formParams.set("customer", params.customerId);
      if (params.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          formParams.set(`metadata[${k}]`, v);
          // Also propagate to the payment_intent created by this checkout session.
          formParams.set(`payment_intent_data[metadata][${k}]`, v);
        }
      }

      const res = await jsonRequest<{ id: string; url: string }>({
        url: `${this.baseUrl}/v1/checkout/sessions`,
        method: "POST",
        headers: this.authHeaders,
        body: formParams.toString(),
      });

      return { ok: true, data: { sessionId: res.data.id, url: res.data.url }, providerRef: res.data.id };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  // ─── Setup Intents (Saved Payment Methods) ────────────────────

  /**
   * Create a Setup Intent for saving a payment method for future use.
   */
  async createSetupIntent(
    customerId: string,
    metadata?: Record<string, string>,
  ): Promise<ProviderResult<{ setupIntentId: string; clientSecret: string }>> {
    try {
      const params = new URLSearchParams({
        customer: customerId,
        "automatic_payment_methods[enabled]": "true",
      });
      if (metadata) {
        for (const [k, v] of Object.entries(metadata)) {
          params.set(`metadata[${k}]`, v);
        }
      }

      const res = await jsonRequest<{ id: string; client_secret: string }>({
        url: `${this.baseUrl}/v1/setup_intents`,
        method: "POST",
        headers: this.authHeaders,
        body: params.toString(),
      });

      return { ok: true, data: { setupIntentId: res.data.id, clientSecret: res.data.client_secret } };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * List Payment Methods for a customer.
   */
  async listPaymentMethods(
    customerId: string,
    type: string = "card",
  ): Promise<ProviderResult<Array<{ id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } }>>> {
    try {
      const res = await jsonRequest<{ data: Array<{ id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } }> }>({
        url: `${this.baseUrl}/v1/payment_methods?customer=${customerId}&type=${type}&limit=10`,
        method: "GET",
        headers: this.authHeaders,
      });
      return { ok: true, data: res.data.data };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  /**
   * Detach (delete) a Payment Method from a customer.
   */
  async detachPaymentMethod(
    paymentMethodId: string,
  ): Promise<ProviderResult<{ id: string }>> {
    try {
      const res = await jsonRequest<{ id: string }>({
        url: `${this.baseUrl}/v1/payment_methods/${paymentMethodId}/detach`,
        method: "POST",
        headers: this.authHeaders,
      });
      return { ok: true, data: { id: res.data.id } };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  // ─── IWalletFundingProvider implementation ──────────────────

  async initiateFunding(
    input: WalletFundingInit,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<WalletFundingResult>> {
    try {
      const result = await this.createPaymentIntent(
        input.amountMinor,
        input.currency,
        undefined,
        {
          reference: input.reference,
          accountNumber: input.accountNumber,
          country: ctx?.country ?? "",
        },
      );

      if (!result.ok || !result.data) {
        return { ok: false, error: result.error };
      }

      return {
        ok: true,
        data: {
          providerRef: result.data.paymentIntentId,
          status: "PENDING",
          settledAmountMinor: input.amountMinor,
          settledCurrency: input.currency,
        },
        providerRef: result.data.paymentIntentId,
      };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }

  async simulateFunding(
    accountNumber: string,
    amountMinor: number,
  ): Promise<SimulatedFundingEvent> {
    return {
      event: "payment_intent.succeeded",
      payload: {
        transactionReference: `pi_sim_${Date.now()}`,
        paymentReference: `ch_sim_${Date.now()}`,
        accountReference: accountNumber,
        paidAt: new Date().toISOString(),
        amount: amountMinor,
        amountPaid: amountMinor,
        paymentMethod: "card",
        paymentStatus: "succeeded",
        currency: "NGN",
        settlementAmount: amountMinor,
      },
    };
  }
}
