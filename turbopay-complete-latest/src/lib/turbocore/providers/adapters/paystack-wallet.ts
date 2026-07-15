/**
 * Paystack Wallet Funding Provider — card + bank transfer funding.
 * ---------------------------------------------------------------
 * Implements `IWalletFundingProvider` against the Paystack transaction API.
 *
 * Flow (server-initiated, per Paystack docs recommendation):
 *   1. Backend initializes a transaction via POST /initialize
 *   2. Returns the authorization_url for user redirect
 *   3. User completes payment on Paystack's hosted checkout
 *   4. Paystack fires charge.success webhook → dispatcher → processFunding()
 *
 * Amounts: Paystack API takes NAIRA (not kobo). We divide by 100.
 *
 * Credentials come from adapter-factory (decrypted DB ProviderConfig).
 * Expected keys: secretKey, publicKey, baseUrl.
 */
import type {
  IWalletFundingProvider,
  WalletFundingInit,
  WalletFundingResult,
  SimulatedFundingEvent,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

interface PaystackInitResponse {
  status: boolean;
  message?: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message?: string;
  data?: {
    id: number;
    reference: string;
    amount: number;
    status: string;
    channel: string;
    currency: string;
    gateway_response: string;
    paid_at: string;
    customer: { email: string };
    authorization?: {
      authorization_code: string;
      card_type: string;
      last4: string;
      brand: string;
    };
  };
}

export class PaystackWalletFundingProvider implements IWalletFundingProvider {
  readonly name = "paystack";
  constructor(
    private readonly secretKey: string,
    private readonly publicKey: string,
    private readonly baseUrl: string = "https://api.paystack.co",
  ) {}

  async initiateFunding(
    input: WalletFundingInit,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<WalletFundingResult>> {
    try {
      // Paystack takes amounts in kobo (lowest currency unit) for NGN.
      // Our WalletFundingInit.amountMinor is already in kobo.
      const res = await jsonRequest<PaystackInitResponse>({
        url: `${this.baseUrl}/transaction/initialize`,
        method: "POST",
        headers: { Authorization: `Bearer ${this.secretKey}` },
        body: {
          amount: input.amountMinor, // kobo — Paystack accepts kobo for NGN
          email: `${input.accountNumber}@turbopay.com`, // Virtual account number as email identifier
          reference: input.reference,
          currency: input.currency,
          callback_url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/wallet?payment=success&provider=paystack`,
          metadata: {
            accountNumber: input.accountNumber,
            country: ctx?.country ?? "",
            integration: "turbopay",
          },
        },
        idempotencyKey: input.reference,
      });

      if (!res.data?.data?.authorization_url || !res.data?.data?.reference) {
        return { ok: false, error: { code: "INIT_FAILED", message: "Missing authorization URL in response" } };
      }

      const initData = res.data.data;
      return {
        ok: true,
        data: {
          providerRef: initData.reference,
          status: "PENDING",
          settledAmountMinor: input.amountMinor,
          settledCurrency: input.currency,
          authorizationUrl: initData.authorization_url,
        },
        providerRef: initData.reference,
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
      event: "charge.success",
      payload: {
        transactionReference: `ps_sim_${Date.now()}`,
        paymentReference: `ps_ref_${Date.now()}`,
        accountReference: accountNumber,
        paidAt: new Date().toISOString(),
        amount: amountMinor,
        amountPaid: amountMinor,
        paymentMethod: "card",
        paymentStatus: "success",
        currency: "NGN",
        settlementAmount: amountMinor,
      },
    };
  }

  /**
   * Verify a Paystack transaction by reference.
   * Used post-redirect to confirm payment before relying on webhook.
   */
  async verifyTransaction(
    reference: string,
  ): Promise<ProviderResult<{ status: string; amount: number; channel: string }>> {
    try {
      const res = await jsonRequest<PaystackVerifyResponse>({
        url: `${this.baseUrl}/transaction/verify/${reference}`,
        method: "GET",
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });

      if (!res.data?.data) {
        return { ok: false, error: { code: "VERIFY_FAILED", message: "No data in verification response" } };
      }

      const txData = res.data.data;
      return {
        ok: true,
        data: {
          status: txData.status,
          amount: txData.amount,
          channel: txData.channel,
        },
      };
    } catch (e) {
      return { ok: false, error: toProviderError(e) };
    }
  }
}
