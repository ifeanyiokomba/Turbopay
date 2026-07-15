/**
 * Dojah production adapter.
 * ------------------------
 * Implements IKYCProvider against the Dojah KYC API.
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: appId, publicKey, privateKey, baseUrl.
 *
 * Auth: Dojah uses three headers — `AppId`, `Authorization` (the public key,
 * sometimes prefixed with the SDK bearer pattern), and the private key is
 * typically passed as the Authorization bearer. We follow Dojah's standard
 * convention: `Authorization: Bearer <privateKey>` + `AppId: <appId>`.
 *
 * Endpoints:
 *   GET /api/v1/kyc/nin?nin={nin}    — verify NIN
 *   GET /api/v1/kyc/bvn?bvn={bvn}    — verify BVN (returns phone for matching)
 */
import type {
  IKYCProvider,
  KycVerificationResult,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface DojahCredentials {
  appId: string;
  publicKey: string;
  privateKey: string;
  baseUrl: string;
}

interface DojahNinEntity {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  birth_date?: string;
  gender?: string;
  nin?: string;
  state_of_origin?: string;
  lga_of_origin?: string;
  residential_address?: string;
}

interface DojahBvnEntity {
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  gender?: string;
  phone1?: string;
  phone2?: string;
  state_of_origin?: string;
  lga_of_origin?: string;
}

interface DojahNinResponse {
  entity?: DojahNinEntity | DojahNinEntity[];
}

interface DojahBvnResponse {
  entity?: DojahBvnEntity | DojahBvnEntity[];
}

function firstEntity<T>(e: T | T[] | undefined): T | undefined {
  if (Array.isArray(e)) return e[0];
  return e;
}

function normalisePhone(p: string | undefined): string {
  if (!p) return "";
  // Normalise +234 / 234 / 0 prefixes to a comparable form.
  let s = p.trim();
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("234")) s = s.slice(3);
  if (s.startsWith("0")) s = s.slice(1);
  return s;
}

function authHeaders(c: DojahCredentials): Record<string, string> {
  return {
    AppId: c.appId,
    Authorization: `Bearer ${c.privateKey}`,
  };
}

export class DojahKYCProvider implements IKYCProvider {
  readonly name = "dojah";

  constructor(private readonly creds: DojahCredentials) {}

  async verifyNin(nin: string, ctx?: ProviderContext): Promise<ProviderResult<KycVerificationResult>> {
    try {
      const res = await jsonRequest<DojahNinResponse>({
        url: `${this.creds.baseUrl}/api/v1/kyc/nin?nin=${encodeURIComponent(nin)}`,
        method: "GET",
        headers: authHeaders(this.creds),
        idempotencyKey: ctx?.idempotencyKey,
      });
      const entity = firstEntity(res.data.entity);
      if (!entity) {
        return {
          ok: true,
          data: {
            verified: false,
            firstName: "",
            lastName: "",
            dob: "",
            gender: "",
            providerRef: `DOJAH-NIN-${nin.slice(-4)}`,
          },
          raw: res.data,
        };
      }
      const result: KycVerificationResult = {
        verified: !!entity.nin || !!entity.first_name,
        firstName: entity.first_name ?? "",
        lastName: entity.last_name ?? "",
        middleName: entity.middle_name,
        dob: entity.birth_date ?? "",
        gender: entity.gender ?? "",
        providerRef: `DOJAH-NIN-${nin.slice(-4)}`,
        stateOfOrigin: entity.state_of_origin,
        lga: entity.lga_of_origin,
      };
      return { ok: true, data: result, providerRef: result.providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "DOJAH_ERROR") };
    }
  }

  async verifyBvn(
    bvn: string,
    phone: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<KycVerificationResult & { phoneMatch: boolean }>> {
    try {
      const res = await jsonRequest<DojahBvnResponse>({
        url: `${this.creds.baseUrl}/api/v1/kyc/bvn?bvn=${encodeURIComponent(bvn)}`,
        method: "GET",
        headers: authHeaders(this.creds),
        idempotencyKey: ctx?.idempotencyKey,
      });
      const entity = firstEntity(res.data.entity);
      if (!entity) {
        return {
          ok: true,
          data: {
            verified: false,
            firstName: "",
            lastName: "",
            dob: "",
            gender: "",
            providerRef: `DOJAH-BVN-${bvn.slice(-4)}`,
            phoneMatch: false,
          },
          raw: res.data,
        };
      }
      const bvnPhones = [entity.phone1, entity.phone2].filter((p): p is string => !!p);
      const phoneMatch = bvnPhones.some((p) => normalisePhone(p) === normalisePhone(phone));
      const result: KycVerificationResult & { phoneMatch: boolean } = {
        verified: !!entity.first_name,
        firstName: entity.first_name ?? "",
        lastName: entity.last_name ?? "",
        middleName: entity.middle_name,
        dob: entity.date_of_birth ?? "",
        gender: entity.gender ?? "",
        providerRef: `DOJAH-BVN-${bvn.slice(-4)}`,
        phoneMatch,
        stateOfOrigin: entity.state_of_origin,
        lga: entity.lga_of_origin,
      };
      return { ok: true, data: result, providerRef: result.providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "DOJAH_ERROR") };
    }
  }

  async verifyIdentity(input: import("@/lib/turbocore/providers/interfaces").IdentityVerificationInput, ctx?: ProviderContext) {
    if (input.documentType === "nin") {
      const result = await this.verifyNin(input.documentValue, ctx);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, data: result.data, providerRef: result.providerRef, raw: result.raw };
    }
    if (input.documentType === "bvn") {
      const result = await this.verifyBvn(input.documentValue, input.phone ?? "", ctx);
      if (!result.ok || !result.data) return { ok: false, error: result.error };
      const { phoneMatch, ...rest } = result.data;
      return { ok: true, data: rest, providerRef: result.providerRef, raw: result.raw };
    }
    return { ok: false, error: { code: "UNSUPPORTED_DOCUMENT", message: `Dojah does not support document type: ${input.documentType}` } };
  }
}
