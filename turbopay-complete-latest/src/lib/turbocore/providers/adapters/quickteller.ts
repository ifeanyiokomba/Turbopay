/**
 * Quickteller (Interswitch) production adapter.
 * ----------------------------------------------
 * Implements IBillPaymentProvider against the Quickteller bills API.
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: apiKey, clientSecret, merchantCode, baseUrl.
 *
 * Auth: OAuth2 client_credentials token from Interswitch auth server.
 * The adapter obtains a token before requests and caches it until expiry.
 *
 * Endpoint reference (Quickteller API):
 *   POST /quickteller/billers                     — list billers/products
 *   POST /quickteller/billpayment/validate        — validate customer
 *   POST /quickteller/billpayment                 — pay a bill
 *   GET  /quickteller/billpayment/{paymentId}     — check status
 */

import type {
  BillPayInput,
  BillPayResult,
  BillProductCatalog,
  BillValidationInput,
  BillValidationResult,
  IBillPaymentProvider,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface QuicktellerCredentials {
  apiKey: string;
  clientSecret: string;
  merchantCode: string;
  baseUrl: string;
  authBaseUrl?: string;
}

interface QuicktellerTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface QuicktellerProduct {
  billerCode?: string;
  billerName?: string;
  category?: string;
  paymentItems?: Array<{ name?: string; code?: string }>;
}

interface QuicktellerValidateResponse {
  customerName?: string;
  name?: string;
  customerReference?: string;
  responseCode?: string;
  responseMessage?: string;
  amount?: number;
  status?: string;
}

interface QuicktellerPayResponse {
  paymentId?: string;
  transactionRef?: string;
  reference?: string;
  responseCode?: string;
  responseMessage?: string;
  status?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function asStatus(s: string | undefined): BillPayResult["status"] {
  if (!s) return "PENDING";
  const u = s.toUpperCase();
  if (u === "00" || u === "0" || u === "SUCCESS" || u === "PAID" || u === "COMPLETED") return "SUCCESS";
  if (u === "FAILED" || u === "ERROR" || u === "001") return "FAILED";
  return "PENDING";
}

export class QuicktellerBillPaymentProvider implements IBillPaymentProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private async getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.token;
    }

    const authUrl = this.creds.authBaseUrl ?? "https://qa.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<QuicktellerTokenResponse>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!res.data.access_token) throw new Error("No access token from Quickteller auth");
    cachedToken = {
      token: res.data.access_token,
      expiresAt: Date.now() + (res.data.expires_in ?? 3600) * 1000,
    };
    return cachedToken.token;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  async listProducts(_ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>> {
    try {
      const headers = await this.authHeaders();
      const res = await jsonRequest<{ billers?: QuicktellerProduct[] }>({
        url: `${this.creds.baseUrl}/quickteller/billers`,
        method: "GET",
        headers,
      });
      const list = res.data.billers ?? [];
      const products: BillProductCatalog[] = list.map((p) => ({
        code: p.billerCode ?? "unknown",
        name: p.billerName ?? "Quickteller product",
        category: (p.category ?? "GENERAL").toUpperCase(),
        fields: (p.paymentItems ?? []).map((f) => f.name ?? f.code ?? "field").filter((s): s is string => !!s),
        provider: "quickteller",
      }));
      return { ok: true, data: products, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async validate(
    input: BillValidationInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BillValidationResult>> {
    try {
      const headers = await this.authHeaders();
      const res = await jsonRequest<QuicktellerValidateResponse>({
        url: `${this.creds.baseUrl}/quickteller/billpayment/validate`,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: {
          billerCode: input.productCode,
          customerReference: input.customer,
          merchantCode: this.creds.merchantCode,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const d = res.data;
      const customerName = d.customerName ?? d.name ?? "";
      const valid = !!customerName && d.responseCode === "00";

      return {
        ok: true,
        data: {
          valid,
          customerName,
          message: valid ? "Validated" : d.responseMessage ?? "Could not validate reference",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async pay(
    input: BillPayInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BillPayResult>> {
    try {
      const headers = await this.authHeaders();
      const res = await jsonRequest<QuicktellerPayResponse>({
        url: `${this.creds.baseUrl}/quickteller/billpayment`,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: {
          billerCode: input.productCode,
          customerReference: input.customer,
          amount: input.amountMinor / 100,
          customerName: input.customerName,
          merchantCode: this.creds.merchantCode,
          paymentReference: input.reference,
        },
        idempotencyKey: ctx?.idempotencyKey ?? input.reference,
      });

      const d = res.data;
      const providerRef = d.paymentId ?? d.transactionRef ?? d.reference ?? input.reference;
      const result: BillPayResult = {
        providerRef,
        status: asStatus(d.responseCode ?? d.status),
      };
      return { ok: true, data: result, providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}
