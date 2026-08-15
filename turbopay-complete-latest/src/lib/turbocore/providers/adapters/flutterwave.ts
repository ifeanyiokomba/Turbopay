/**
 * Flutterwave production adapter — collections, transfers, virtual accounts, refunds.
 * ---------------------------------------------------------------------------------
 * Implements IWalletFundingProvider, ILocalTransferProvider, IBillPaymentProvider,
 * IExchangeRateProvider against the Flutterwave v4 API.
 *
 * Flutterwave API v4 (verified against https://developer.flutterwave.com/docs):
 *   - Base URL: https://api.flutterwave.com/v3
 *   - Auth: OAuth 2.0 (client_id + client_secret → access_token)
 *     Token endpoint: https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token
 *     Token expires in 10 minutes (600 seconds)
 *   - Amounts in decimal (not lowest currency unit)
 *   - Webhooks: Verified via signature
 *
 * Credentials come ENTIRELY from the adapter-factory (decrypted from the
 * DB ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: `clientId`, `clientSecret`, `baseUrl`.
 */

import { validateOutboundUrl } from "@/lib/turbopay/ssrf";
import type {
  IWalletFundingProvider,
  WalletFundingInit,
  WalletFundingResult,
  SimulatedFundingEvent,
  ILocalTransferProvider,
  LocalTransferInput,
  IExchangeRateProvider,
  FxQuote,
  IBillPaymentProvider,
  BillValidationInput,
  BillValidationResult,
  BillPayInput,
  BillPayResult,
  BillProductCatalog,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import type { Currency } from "@/lib/turbocore/types";

export interface FlutterwaveCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

// ─── OAuth 2.0 Token Manager ──────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(creds: FlutterwaveCredentials): Promise<string> {
  // Check if cached token is still valid (with 60s buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const tokenUrl = "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
  await validateOutboundUrl(tokenUrl);
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(`Flutterwave OAuth failed: ${error?.error ?? res.status}`);
  }

  const data = await res.json();
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 600) * 1000,
  };

  return tokenCache.accessToken;
}

// ─── HTTP Helper ──────────────────────────────────────────────

async function fwRequest<T>(
  creds: FlutterwaveCredentials,
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const accessToken = await getAccessToken(creds);
  const url = `${creds.baseUrl}${path}`;
  await validateOutboundUrl(url);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: json?.message ?? json?.error?.message ?? `HTTP ${res.status}`,
    };
  }

  return { ok: true, status: res.status, data: json as T };
}

// ─── Wallet Funding Provider ──────────────────────────────────

export class FlutterwaveWalletFundingProvider implements IWalletFundingProvider {
  readonly name = "flutterwave";
  private creds: FlutterwaveCredentials;

  constructor(creds: FlutterwaveCredentials) {
    this.creds = creds;
  }

  async initiateFunding(
    input: WalletFundingInit,
    ctx?: ProviderContext
  ): Promise<ProviderResult<WalletFundingResult>> {
    // Flutterwave v4: Create a charge for the funding
    // POST /charges with bank_transfer payment method
    const result = await fwRequest<FlutterwaveChargeResponse>(
      this.creds,
      "/charges",
      "POST",
      {
        amount: input.amountMinor / 100, // Flutterwave v4 takes decimal amounts
        currency: input.currency,
        reference: input.reference,
        customer: { customer_id: input.accountNumber },
        payment_method: { type: "bank_transfer" },
      },
      ctx?.idempotencyKey ? { "X-Idempotency-Key": ctx.idempotencyKey } : undefined
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_CHARGE_FAILED", message: result.error ?? "Charge failed" } };
    }

    const status = result.data.data?.status;
    return {
      ok: true,
      data: {
        providerRef: result.data.data?.id ?? input.reference,
        status: status === "succeeded" ? "SUCCESS" : status === "pending" ? "PENDING" : "FAILED",
        settledAmountMinor: input.amountMinor,
        settledCurrency: input.currency,
      },
      providerRef: result.data.data?.id,
    };
  }

  async simulateFunding(
    accountNumber: string,
    amountMinor: number,
    ctx?: ProviderContext
  ): Promise<SimulatedFundingEvent> {
    return {
      event: "charge.completed",
      payload: {
        transactionReference: `FLW_SIM_${Date.now()}`,
        paymentReference: `FLW_PAY_${Date.now()}`,
        accountReference: accountNumber,
        paidAt: new Date().toISOString(),
        amount: amountMinor / 100,
        amountPaid: amountMinor / 100,
        paymentMethod: "bank_transfer",
        paymentStatus: "successful",
        currency: "NGN",
        settlementAmount: amountMinor / 100,
      },
    };
  }
}

// ─── Local Transfer Provider ──────────────────────────────────

export class FlutterwaveLocalTransferProvider implements ILocalTransferProvider {
  readonly name = "flutterwave";
  private creds: FlutterwaveCredentials;

  constructor(creds: FlutterwaveCredentials) {
    this.creds = creds;
  }

  async transfer(
    input: LocalTransferInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    // Flutterwave v4: Direct transfer via /direct-transfers
    // No need to create recipient first — v4 accepts bank details directly
    const result = await fwRequest<FlutterwaveTransferResponse>(
      this.creds,
      "/direct-transfers",
      "POST",
      {
        action: "instant",
        type: "bank",
        callback_url: "https://turbopay.okomba.com/api/webhooks/flutterwave",
        narration: input.narration ?? "Transfer from Turbopay",
        reference: input.reference,
        payment_instruction: {
          amount: {
            value: input.amountMinor / 100,
            applies_to: "destination_currency",
          },
          source_currency: input.currency,
          destination_currency: input.currency,
          recipient: {
            bank: {
              code: input.toBankCode,
              account_number: input.toAccount,
            },
          },
        },
      },
      {
        ...(ctx?.idempotencyKey ? { "X-Idempotency-Key": ctx.idempotencyKey } : {}),
        ...(ctx?.correlationId ? { "X-Trace-Id": ctx.correlationId } : {}),
      }
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_TRANSFER_FAILED", message: result.error ?? "Transfer failed" } };
    }

    // v4 returns status "NEW" for successfully initiated transfers
    const status = result.data.data?.status;
    return {
      ok: true,
      data: {
        providerRef: result.data.data?.id ?? input.reference,
        status: status === "SUCCESSFUL" ? "SUCCESS" : status === "NEW" ? "PENDING" : "FAILED",
      },
      providerRef: result.data.data?.id,
    };
  }

  async getTransferStatus(
    providerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    // Flutterwave v4: GET /transfers/{id}
    const result = await fwRequest<FlutterwaveTransferResponse>(
      this.creds,
      `/transfers/${providerRef}`,
      "GET"
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_STATUS_FAILED", message: result.error ?? "Status check failed" } };
    }

    const status = result.data.data?.status;
    return {
      ok: true,
      data: {
        status: status === "SUCCESSFUL" ? "SUCCESS" : status === "NEW" ? "PENDING" : "FAILED",
      },
    };
  }
}

// ─── Bill Payment Provider ────────────────────────────────────

export class FlutterwaveBillPaymentProvider implements IBillPaymentProvider {
  readonly name = "flutterwave";
  private creds: FlutterwaveCredentials;

  constructor(creds: FlutterwaveCredentials) {
    this.creds = creds;
  }

  async listProducts(ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>> {
    // Flutterwave v4: GET /billers
    const result = await fwRequest<{ data: Array<{ id: string; name: string; category: string; biller_code: string }> }>(
      this.creds,
      "/billers",
      "GET"
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_BILLERS_FAILED", message: result.error ?? "Failed to list billers" } };
    }

    const products: BillProductCatalog[] = (result.data.data ?? []).map((b) => ({
      code: b.biller_code,
      name: b.name,
      category: b.category,
      fields: [],
      provider: "flutterwave",
    }));

    return { ok: true, data: products };
  }

  async validate(
    input: BillValidationInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<BillValidationResult>> {
    // Flutterwave v4: POST /billers/{biller_code}/validate
    const result = await fwRequest<{ data: { customers?: Array<{ name: string; customer_id: string }> } }>(
      this.creds,
      `/billers/${input.productCode}/validate`,
      "POST",
      { customer: input.customer }
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_VALIDATE_FAILED", message: result.error ?? "Validation failed" } };
    }

    const customer = result.data.data?.customers?.[0];
    return {
      ok: true,
      data: {
        valid: !!customer,
        customerName: customer?.name ?? "",
        message: customer ? "Customer validated" : "Customer not found",
      },
    };
  }

  async pay(
    input: BillPayInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<BillPayResult>> {
    // Flutterwave v4: POST /bills
    const result = await fwRequest<{ data: { reference?: string; status?: string; token?: string } }>(
      this.creds,
      "/bills",
      "POST",
      {
        biller_code: input.productCode,
        customer: input.customer,
        amount: input.amountMinor / 100,
        currency: input.currency,
        reference: input.reference,
      },
      ctx?.idempotencyKey ? { "X-Idempotency-Key": ctx.idempotencyKey } : undefined
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_BILL_PAY_FAILED", message: result.error ?? "Bill payment failed" } };
    }

    return {
      ok: true,
      data: {
        providerRef: result.data.data?.reference ?? input.reference,
        status: result.data.data?.status === "delivered" ? "SUCCESS" : "PENDING",
        token: result.data.data?.token,
      },
    };
  }
}

// ─── Exchange Rate Provider ───────────────────────────────────

export class FlutterwaveFxProvider implements IExchangeRateProvider {
  readonly name = "flutterwave";
  private creds: FlutterwaveCredentials;

  constructor(creds: FlutterwaveCredentials) {
    this.creds = creds;
  }

  async getQuote(
    from: Currency,
    to: Currency,
    amountMinor: number,
    ctx?: ProviderContext
  ): Promise<ProviderResult<FxQuote>> {
    if (from === to) {
      return {
        ok: true,
        data: {
          from,
          to,
          rate: 1,
          providerFeeMinor: 0,
          platformFeeMinor: 0,
        },
      };
    }

    // Flutterwave v4: POST /transfers/rates (to get converted rate)
    const result = await fwRequest<{ data: { rate?: number; destination_amount?: number } }>(
      this.creds,
      "/transfers/rates",
      "POST",
      {
        destination_currency: to,
        source_currency: from,
        amount: amountMinor / 100,
      }
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_FX_FAILED", message: result.error ?? "FX quote failed" } };
    }

    const rate = result.data.data?.rate ?? 1;
    return {
      ok: true,
      data: {
        from,
        to,
        rate,
        providerFeeMinor: 0,
        platformFeeMinor: 0,
      },
    };
  }
}

// ─── Refund Provider ──────────────────────────────────────────

export class FlutterwaveRefundProvider {
  readonly name = "flutterwave";
  private creds: FlutterwaveCredentials;

  constructor(creds: FlutterwaveCredentials) {
    this.creds = creds;
  }

  /**
   * Create a refund for a completed charge.
   * Flutterwave v4: POST /refunds
   */
  async refund(
    chargeId: string,
    amountMinor: number,
    reason?: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ refundId: string; status: string }>> {
    const result = await fwRequest<{ data: { id?: string; status?: string } }>(
      this.creds,
      "/refunds",
      "POST",
      {
        charge_id: chargeId,
        amount: amountMinor / 100,
        reason: reason ?? "Customer request",
      },
      ctx?.idempotencyKey ? { "X-Idempotency-Key": ctx.idempotencyKey } : undefined
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_REFUND_FAILED", message: result.error ?? "Refund failed" } };
    }

    return {
      ok: true,
      data: {
        refundId: result.data.data?.id ?? "",
        status: result.data.data?.status ?? "pending",
      },
    };
  }
}

// ─── Virtual Account Provider ─────────────────────────────────

export class FlutterwaveVirtualAccountProvider {
  readonly name = "flutterwave";
  private creds: FlutterwaveCredentials;

  constructor(creds: FlutterwaveCredentials) {
    this.creds = creds;
  }

  /**
   * Create a virtual account for collections.
   * Flutterwave v4: POST /virtual-accounts
   */
  async createVirtualAccount(
    accountName: string,
    customerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ accountNumber: string; accountName: string; bankName: string; bankCode: string; providerRef: string; currency: string }>> {
    const result = await fwRequest<{ data: { id?: string; account_number?: string; account_name?: string; bank_name?: string; bank_code?: string; currency?: string } }>(
      this.creds,
      "/virtual-accounts",
      "POST",
      {
        account_name: accountName,
        customer_ref: customerRef,
        currency: "NGN",
      },
      ctx?.idempotencyKey ? { "X-Idempotency-Key": ctx.idempotencyKey } : undefined
    );

    if (!result.ok || !result.data) {
      return { ok: false, error: { code: "FLW_VA_FAILED", message: result.error ?? "Virtual account creation failed" } };
    }

    const data = result.data.data;
    return {
      ok: true,
      data: {
        accountNumber: data?.account_number ?? "",
        accountName: data?.account_name ?? accountName,
        bankName: data?.bank_name ?? "Flutterwave",
        bankCode: data?.bank_code ?? "",
        providerRef: data?.id ?? "",
        currency: data?.currency ?? "NGN",
      },
    };
  }
}

// ─── Type Definitions ─────────────────────────────────────────

interface FlutterwaveChargeResponse {
  status: string;
  message: string;
  data?: {
    id?: string;
    status?: string;
    amount?: number;
    currency?: string;
  };
}

interface FlutterwaveTransferResponse {
  status: string;
  message: string;
  data?: {
    id?: string;
    status?: string;
    type?: string;
    reference?: string;
    narration?: string;
    amount?: {
      value?: number;
      applies_to?: string;
    };
    source_currency?: string;
    destination_currency?: string;
    recipient?: {
      id?: string;
      type?: string;
      bank?: {
        code?: string;
        name?: string;
        account_number?: string;
      };
    };
  };
}
