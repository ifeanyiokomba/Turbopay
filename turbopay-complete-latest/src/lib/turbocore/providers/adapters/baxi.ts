/**
 * Baxi production adapter.
 * -----------------------
 * Implements IBillPaymentProvider against the Baxi (Capricorn) bills API.
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: apiKey, baseUrl.
 *
 * Auth: Bearer token in the Authorization header on every request.
 *
 * Endpoint reference (Baxi partner API):
 *   GET  /api/services/billers              — list billers / products
 *   POST /api/services/bill/validate        — verify customer before payment
 *   POST /api/services/bill/payment         — pay a bill (idempotent on `reference`)
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

export interface BaxiCredentials {
  apiKey: string;
  baseUrl: string;
}

interface BaxiProduct {
  service_type?: string;
  product_name?: string;
  category?: string;
  billerSlug?: string;
  fields?: Array<{ name?: string }>;
}

interface BaxiBillerResponse {
  data?: { objects?: BaxiProduct[] } | BaxiProduct[];
}

interface BaxiValidateResponse {
  data?: {
    account_name?: string;
    account_status?: string;
    name?: string;
    status?: string;
    customer_name?: string;
  };
}

interface BaxiPaymentResponse {
  data?: {
    transactionReference?: string;
    reference?: string;
    status?: string;
    token?: string;
    receiptNo?: string;
    receipt_number?: string;
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function asStatus(s: string | undefined): BillPayResult["status"] {
  if (!s) return "PENDING";
  const u = s.toUpperCase();
  if (u === "SUCCESS" || u === "SUCCESSFUL" || u === "PAID") return "SUCCESS";
  if (u === "FAILED" || u === "ERROR") return "FAILED";
  return "PENDING";
}

export class BaxiBillPaymentProvider implements IBillPaymentProvider {
  readonly name = "baxi";

  constructor(private readonly creds: BaxiCredentials) {}

  async listProducts(_ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>> {
    try {
      const res = await jsonRequest<BaxiBillerResponse>({
        url: `${this.creds.baseUrl}/api/services/billers`,
        method: "GET",
        headers: authHeaders(this.creds.apiKey),
      });
      const list = Array.isArray(res.data.data)
        ? res.data.data
        : (res.data.data?.objects ?? []);
      const products: BillProductCatalog[] = list.map((p) => ({
        code: p.service_type ?? p.billerSlug ?? "unknown",
        name: p.product_name ?? p.service_type ?? "Baxi product",
        category: (p.category ?? "GENERAL").toUpperCase(),
        fields: (p.fields ?? []).map((f) => f.name ?? "field").filter((s): s is string => !!s),
        provider: "baxi",
      }));
      return { ok: true, data: products, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "BAXI_ERROR") };
    }
  }

  async validate(
    input: BillValidationInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BillValidationResult>> {
    try {
      const res = await jsonRequest<BaxiValidateResponse>({
        url: `${this.creds.baseUrl}/api/services/bill/validate`,
        method: "POST",
        headers: authHeaders(this.creds.apiKey),
        body: {
          service_type: input.productCode,
          customer: input.customer,
          ...(input.meterType ? { meter_type: input.meterType } : {}),
        },
        idempotencyKey: ctx?.idempotencyKey,
      });
      const d = res.data.data ?? {};
      const customerName = d.account_name ?? d.customer_name ?? d.name ?? "";
      const valid = !!customerName && (d.account_status ?? d.status ?? "ACTIVE").toUpperCase() !== "INACTIVE";
      return {
        ok: true,
        data: {
          valid,
          customerName,
          message: valid ? "Validated" : "Customer could not be validated",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "BAXI_ERROR") };
    }
  }

  async pay(
    input: BillPayInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BillPayResult>> {
    try {
      const res = await jsonRequest<BaxiPaymentResponse>({
        url: `${this.creds.baseUrl}/api/services/bill/payment`,
        method: "POST",
        headers: authHeaders(this.creds.apiKey),
        body: {
          service_type: input.productCode,
          customer: input.customer,
          amount: input.amountMinor / 100,
          currency: input.currency,
          // CRITICAL: forward the real Turbopay reference (NOT "PENDING") so
          // Baxi can deduplicate retries on the same logical transaction.
          reference: input.reference,
          customer_name: input.customerName,
          ...(input.meterType ? { meter_type: input.meterType } : {}),
        },
        idempotencyKey: ctx?.idempotencyKey ?? input.reference,
      });
      const d = res.data.data ?? {};
      const providerRef = d.transactionReference ?? d.reference ?? input.reference;
      const result: BillPayResult = {
        providerRef,
        status: asStatus(d.status),
        token: d.token,
        receiptNumber: d.receiptNo ?? d.receipt_number,
      };
      return { ok: true, data: result, providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "BAXI_ERROR") };
    }
  }
}
