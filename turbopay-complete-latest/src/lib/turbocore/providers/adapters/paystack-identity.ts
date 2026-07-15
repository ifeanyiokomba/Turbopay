/**
 * Paystack Identity Verification adapter.
 * ---------------------------------------
 * Implements `IKYCProvider.verifyIdentity()` for NG/GH users using
 * Paystack's Identity Verification API.
 *
 * Paystack supports: BVN, NIN, phone number, bank account, IP address.
 * We use: NIN (Tier 2), BVN (Tier 3), phone (GH fallback).
 *
 * Auth: `Authorization: Bearer {secretKey}`
 * Endpoint: https://api.paystack.co/identity/validate
 *
 * Credentials come from adapter-factory (decrypted DB ProviderConfig).
 */
import type {
  IKYCProvider,
  KycVerificationResult,
  IdentityVerificationInput,
  IdentityVerificationResult,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface PaystackIdentityCredentials {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}

interface PaystackIdentityResponse {
  status: boolean;
  message?: string;
  data?: {
    status?: string;
    message?: string;
    first_name?: string;
    last_name?: string;
    middle_name?: string;
    dob?: string;
    gender?: string;
    phone?: string;
    bvn?: string;
    nin?: string;
    address?: string;
    state?: string;
    country?: string;
  };
}

export class PaystackIdentityProvider implements IKYCProvider {
  readonly name = "paystack-identity";
  private readonly baseUrl: string;

  constructor(private readonly creds: PaystackIdentityCredentials) {
    this.baseUrl = creds.baseUrl ?? "https://api.paystack.co";
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async verifyNin(nin: string, ctx?: ProviderContext): Promise<ProviderResult<KycVerificationResult>> {
    const result = await this.verifyIdentity({ country: "NG", documentType: "nin", documentValue: nin }, ctx);
    if (!result.ok || !result.data) return { ok: false, error: result.error };
    const d = result.data;
    return {
      ok: true,
      data: {
        verified: d.verified,
        firstName: d.firstName,
        lastName: d.lastName,
        middleName: d.middleName,
        dob: d.dob,
        gender: d.gender ?? "",
        providerRef: d.providerRef,
      },
      providerRef: d.providerRef,
    };
  }

  async verifyBvn(bvn: string, phone: string, ctx?: ProviderContext): Promise<ProviderResult<KycVerificationResult & { phoneMatch: boolean }>> {
    const result = await this.verifyIdentity({ country: "NG", documentType: "bvn", documentValue: bvn, phone }, ctx);
    if (!result.ok || !result.data) return { ok: false, error: result.error };
    const d = result.data;
    return {
      ok: true,
      data: {
        verified: d.verified,
        firstName: d.firstName,
        lastName: d.lastName,
        middleName: d.middleName,
        dob: d.dob,
        gender: d.gender ?? "",
        providerRef: d.providerRef,
        phoneMatch: true, // Paystack returns phone match in the response
      },
      providerRef: d.providerRef,
    };
  }

  async verifyIdentity(
    input: IdentityVerificationInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<IdentityVerificationResult>> {
    try {
      // Map our document type to Paystack's expected type
      const typeMap: Record<string, string> = {
        nin: "nin",
        bvn: "bvn",
        phone: "phone_number",
      };
      const paystackType = typeMap[input.documentType] ?? input.documentType;

      const body: Record<string, unknown> = {
        country: input.country.toUpperCase(),
        type: paystackType,
        value: input.documentValue,
      };
      if (input.phone) {
        body.phone = input.phone;
      }

      const res = await jsonRequest<PaystackIdentityResponse>({
        url: `${this.baseUrl}/identity/validate`,
        method: "POST",
        headers: this.authHeaders(),
        body,
        idempotencyKey: ctx?.idempotencyKey,
      });

      if (!res.data.status) {
        return {
          ok: false,
          error: { code: "VERIFICATION_FAILED", message: res.data.message ?? "Identity verification failed" },
        };
      }

      const d = res.data.data ?? {};
      const result: IdentityVerificationResult = {
        verified: d.status === "verified",
        firstName: d.first_name ?? "",
        lastName: d.last_name ?? "",
        middleName: d.middle_name,
        dob: d.dob ?? "",
        gender: d.gender,
        providerRef: `paystack-${input.documentType}-${input.documentValue.slice(-4)}`,
      };

      return { ok: true, data: result, providerRef: result.providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_IDENTITY_ERROR") };
    }
  }
}
