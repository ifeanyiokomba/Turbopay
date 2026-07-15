/**
 * Stripe Identity Verification adapter.
 * -------------------------------------
 * Implements `IKYCProvider.verifyIdentity()` for non-NG/GH users using
 * Stripe's Identity API.
 *
 * Stripe Identity flow:
 *   1. Create a VerificationSession (POST /v1/identity/verification_sessions)
 *   2. The session returns a client_secret for the frontend to upload documents
 *   3. Poll the session until status is "verified" or "requires_input"
 *   4. Read verified_output from the session
 *
 * For server-side verification (API-only, no frontend embed):
 *   We create the session and immediately poll for results. The document
 *   upload happens via Stripe's hosted UI (redirect or embedded component).
 *   For now, this adapter creates the session and returns the client_secret
 *   so the frontend can complete the flow.
 *
 * Auth: `Authorization: Bearer {apiKey}`
 * Endpoint: https://api.stripe.com/v1/identity/verification_sessions
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

export interface StripeIdentityCredentials {
  apiKey: string;
  baseUrl?: string;
}

interface StripeVerificationSession {
  id: string;
  object: string;
  status: string; // "requires_input" | "processing" | "verified" | "canceled"
  client_secret?: string;
  verified_output?: {
    id_number?: { value?: string; type?: string };
    name?: { first?: string; last?: string };
    dob?: { day?: number; month?: number; year?: number };
    address?: { line1?: string; city?: string; state?: string; postal_code?: string; country?: string };
  };
  last_error?: { code?: string; message?: string };
}

export class StripeIdentityProvider implements IKYCProvider {
  readonly name = "stripe-identity";
  private readonly baseUrl: string;

  constructor(private readonly creds: StripeIdentityCredentials) {
    this.baseUrl = creds.baseUrl ?? "https://api.stripe.com";
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async verifyNin(_nin: string): Promise<ProviderResult<KycVerificationResult>> {
    return {
      ok: false,
      error: { code: "UNSUPPORTED", message: "Stripe Identity does not support NIN verification. Use verifyIdentity with a supported document type." },
    };
  }

  async verifyBvn(_bvn: string, _phone: string): Promise<ProviderResult<KycVerificationResult & { phoneMatch: boolean }>> {
    return {
      ok: false,
      error: { code: "UNSUPPORTED", message: "Stripe Identity does not support BVN verification. Use verifyIdentity with a supported document type." },
    };
  }

  async verifyIdentity(
    input: IdentityVerificationInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<IdentityVerificationResult>> {
    try {
      // Map our document type to Stripe's expected type
      const typeMap: Record<string, string> = {
        passport: "passport",
        drivers_license: "driving_license",
        national_id: "id_number",
      };
      const stripeType = typeMap[input.documentType] ?? "id_number";

      // Create a VerificationSession
      const body = new URLSearchParams();
      body.append("type", "document");
      body.append("document[type]", stripeType);

      const sessionRes = await jsonRequest<StripeVerificationSession>({
        url: `${this.baseUrl}/v1/identity/verification_sessions`,
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
        body,
        idempotencyKey: ctx?.idempotencyKey,
      });

      const session = sessionRes.data;

      // If the session is already verified (e.g. cached/reused), return results
      if (session.status === "verified" && session.verified_output) {
        return this.mapVerifiedOutput(session, input);
      }

      // If the session requires input (document upload needed), return the
      // client_secret so the frontend can complete the flow via Stripe's UI.
      if (session.status === "requires_input" && session.client_secret) {
        return {
          ok: false,
          error: {
            code: "REQUIRES_DOCUMENT_UPLOAD",
            message: "Document upload required. Use the client_secret to complete verification via Stripe's UI.",
            raw: { clientSecret: session.client_secret, sessionId: session.id },
          },
        };
      }

      // If the session failed
      if (session.last_error) {
        return {
          ok: false,
          error: { code: session.last_error.code ?? "STRIPE_ERROR", message: session.last_error.message ?? "Verification failed" },
        };
      }

      return {
        ok: false,
        error: { code: "UNKNOWN_STATUS", message: `Unexpected session status: ${session.status}` },
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "STRIPE_IDENTITY_ERROR") };
    }
  }

  /** Poll a verification session until it reaches a terminal state. */
  async pollSession(sessionId: string): Promise<ProviderResult<IdentityVerificationResult>> {
    try {
      const res = await jsonRequest<StripeVerificationSession>({
        url: `${this.baseUrl}/v1/identity/verification_sessions/${sessionId}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      if (res.data.status === "verified" && res.data.verified_output) {
        return this.mapVerifiedOutput(res.data, { country: "", documentType: "", documentValue: "" });
      }

      if (res.data.status === "canceled" || res.data.last_error) {
        return {
          ok: false,
          error: { code: "VERIFICATION_FAILED", message: res.data.last_error?.message ?? "Verification was canceled or failed" },
        };
      }

      // Still processing
      return {
        ok: false,
        error: { code: "PENDING", message: `Session status: ${res.data.status}` },
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "STRIPE_POLL_ERROR") };
    }
  }

  private mapVerifiedOutput(
    session: StripeVerificationSession,
    input: IdentityVerificationInput
  ): ProviderResult<IdentityVerificationResult> {
    const vo = session.verified_output!;
    const name = vo.name ?? {};
    const dob = vo.dob ?? {};
    const dobStr = dob.year && dob.month && dob.day
      ? `${dob.year}-${String(dob.month).padStart(2, "0")}-${String(dob.day).padStart(2, "0")}`
      : "";

    const result: IdentityVerificationResult = {
      verified: true,
      firstName: name.first ?? "",
      lastName: name.last ?? "",
      dob: dobStr,
      providerRef: `stripe-${session.id}`,
      address: vo.address ? {
        line1: vo.address.line1,
        city: vo.address.city,
        state: vo.address.state,
        postalCode: vo.address.postal_code,
        country: vo.address.country,
      } : undefined,
    };

    return { ok: true, data: result, providerRef: result.providerRef, raw: session };
  }
}
