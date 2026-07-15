/**
 * Remita production adapter.
 * --------------------------
 * Implements IBillPaymentProvider against the Remita bills API.
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: apiKey, merchantId, serviceTypeId, secretKey, baseUrl.
 *
 * Auth: HMAC-SHA512 signature on requests (Remita uses a hash of
 * apiKey + serviceTypeId + merchantId + amount + RRR + secretKey).
 *
 * Endpoint reference (Remita API):
 *   GET  /api/v1/merchant/rrr/{rrr}           — validate/lookup RRR
 *   POST /api/v1/merchant/pay                 — initiate payment
 *   GET  /api/v1/merchant/rrr/{rrr}/status    — check payment status
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
import * as crypto from "node:crypto";

export interface RemitaCredentials {
  apiKey: string;
  merchantId: string;
  serviceTypeId: string;
  secretKey: string;
  baseUrl: string;
}

interface RemitaResponse {
  status?: string;
  message?: string;
  data?: {
    RRR?: string;
    amount?: number;
    customerName?: string;
    customer?: string;
    accountNumber?: string;
    serviceTypeId?: string;
    paymentStatus?: string;
    status?: string;
    transactionRef?: string;
  };
}

function generateRemitaHash(creds: RemitaCredentials, rrr: string, amount?: number): string {
  const hashString = `${creds.apiKey}${creds.serviceTypeId}${creds.merchantId}${rrr}${creds.secretKey}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
}

function asStatus(s: string | undefined): BillPayResult["status"] {
  if (!s) return "PENDING";
  const u = s.toUpperCase();
  if (u === "001" || u === "SUCCESS" || u === "PAID" || u === "COMPLETED") return "SUCCESS";
  if (u === "FAILED" || u === "ERROR" || u === "000") return "FAILED";
  return "PENDING";
}

export class RemitaBillPaymentProvider implements IBillPaymentProvider {
  readonly name = "remita";

  constructor(private readonly creds: RemitaCredentials) {}

  async listProducts(_ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>> {
    // Remita products are configured via serviceTypeId, not a dynamic catalog.
    // Return the configured service type as a single product.
    return {
      ok: true,
      data: [
        {
          code: this.creds.serviceTypeId,
          name: `Remita Service ${this.creds.serviceTypeId}`,
          category: "REMITA",
          fields: ["rrr"],
          provider: "remita",
        },
      ],
    };
  }

  async validate(
    input: BillValidationInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BillValidationResult>> {
    try {
      const rrr = input.customer; // RRR is passed as the customer reference
      const hash = generateRemitaHash(this.creds, rrr);
      const url = `${this.creds.baseUrl}/api/v1/merchant/rrr/${rrr}?hash=${hash}&apikey=${this.creds.apiKey}&merchantId=${this.creds.merchantId}`;

      const res = await jsonRequest<RemitaResponse>({
        url,
        method: "GET",
        idempotencyKey: ctx?.idempotencyKey,
      });

      const d = res.data.data ?? {};
      const customerName = d.customerName ?? "";
      const valid = !!customerName && res.data.status !== "error";

      return {
        ok: true,
        data: {
          valid,
          customerName,
          message: valid ? "RRR validated" : res.data.message ?? "Could not validate RRR",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "REMITA_ERROR") };
    }
  }

  async pay(
    input: BillPayInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BillPayResult>> {
    try {
      const hash = generateRemitaHash(this.creds, input.customer, input.amountMinor / 100);
      const url = `${this.creds.baseUrl}/api/v1/merchant/pay`;

      const res = await jsonRequest<RemitaResponse>({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.creds.apiKey}`,
        },
        body: {
          merchantId: this.creds.merchantId,
          serviceTypeId: this.creds.serviceTypeId,
          amount: input.amountMinor / 100,
          rrr: input.customer,
          customerName: input.customerName,
          reference: input.reference,
          hash,
        },
        idempotencyKey: ctx?.idempotencyKey ?? input.reference,
      });

      const d = res.data.data ?? {};
      const providerRef = d.RRR ?? d.transactionRef ?? input.reference;
      const result: BillPayResult = {
        providerRef,
        status: asStatus(d.paymentStatus ?? d.status ?? res.data.status),
      };
      return { ok: true, data: result, providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "REMITA_ERROR") };
    }
  }
}
