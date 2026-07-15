/**
 * Paystack production adapter — local (NIP) bank transfers.
 * ---------------------------------------------------------
 * Implements `ILocalTransferProvider` against the Paystack transfer API.
 *
 * Paystack two-step flow:
 *   1. Create a transfer recipient (POST /transferrecipient) — returns a
 *      `recipient_code` that is reused for every transfer to that NUBAN.
 *      We cache the code per `bankCode:accountNumber` in-process so retries
 *      don't recreate the recipient.
 *   2. Initiate the transfer (POST /transfer) with `source: "balance"` —
 *      funds leave the Paystack wallet balance, not a customer account.
 *
 * Amounts: Paystack's API takes NAIRA (not kobo). `LocalTransferInput.
 * amountMinor` is in minor units (kobo), so we divide by 100 before
 * sending — matching the convention used by the Baxi + Monnify adapters.
 *
 * Credentials come ENTIRELY from the adapter-factory (decrypted from the
 * DB ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: `secretKey`, `publicKey`, `baseUrl`.
 *
 * Auth: `Authorization: Bearer {secretKey}` on every request.
 *
 * The shared `_http` helper enforces a 10s timeout, forwards the
 * `Idempotency-Key` header, and normalises non-2xx + network failures into
 * `ProviderHttpError` — so this adapter only needs to map results.
 */
import type {
  ILocalTransferProvider,
  LocalTransferInput,
  ProviderContext,
  ProviderResult,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface PaystackCredentials {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
}

interface PaystackRecipientResponse {
  status: boolean;
  message?: string;
  data?: { recipient_code?: string };
}

interface PaystackTransferResponse {
  status: boolean;
  message?: string;
  data?: {
    reference?: string;
    transfer_code?: string;
    status?: string;
  };
}

interface PaystackTransferStatusResponse {
  status: boolean;
  message?: string;
  data?: { reference?: string; transfer_code?: string; status?: string };
}

/** Map Paystack's free-form status string to our domain union. */
function mapStatus(s: string | undefined): "PENDING" | "SUCCESS" | "FAILED" {
  const u = (s ?? "pending").toUpperCase();
  if (u === "SUCCESS") return "SUCCESS";
  if (u === "FAILED" || u === "REVERSED") return "FAILED";
  // pending / queued / processing / otp / awaiting-otp — all PENDING.
  return "PENDING";
}

export class PaystackLocalTransferProvider implements ILocalTransferProvider {
  readonly name = "paystack";

  /** In-process cache of recipient_code by `bankCode:accountNumber`. */
  private readonly recipientCache = new Map<string, string>();

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  /** Create (or return cached) Paystack transfer-recipient code for a NUBAN. */
  private async ensureRecipient(
    accountNumber: string,
    bankCode: string,
    name: string,
    ctx?: ProviderContext,
  ): Promise<string> {
    const cacheKey = `${bankCode}:${accountNumber}`;
    const cached = this.recipientCache.get(cacheKey);
    if (cached) return cached;

    const res = await jsonRequest<PaystackRecipientResponse>({
      url: `${this.baseUrl}/transferrecipient`,
      method: "POST",
      headers: this.authHeaders(),
      body: {
        type: "nuban",
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
      },
      idempotencyKey: ctx?.idempotencyKey ? `${ctx.idempotencyKey}-rcp` : undefined,
    });
    const code = res.data.data?.recipient_code;
    if (!code) {
      throw new Error("Paystack returned no recipient_code");
    }
    this.recipientCache.set(cacheKey, code);
    return code;
  }

  async transfer(
    input: LocalTransferInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      // Paystack requires a recipient `name` — our LocalTransferInput does
      // not carry one (the route layer stores the real name on the
      // Transaction row's counterpartyName). Use the narration if present,
      // otherwise a deterministic placeholder so the field is never empty.
      const recipientName = input.narration?.trim() || `Turbopay Recipient ${input.toAccount.slice(-4)}`;
      const recipientCode = await this.ensureRecipient(
        input.toAccount,
        input.toBankCode,
        recipientName,
        ctx,
      );

      const res = await jsonRequest<PaystackTransferResponse>({
        url: `${this.baseUrl}/transfer`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          source: "balance",
          amount: input.amountMinor / 100, // Paystack takes naira, not kobo.
          recipient: recipientCode,
          reference: input.reference,
          reason: input.narration ?? undefined,
        },
        idempotencyKey: ctx?.idempotencyKey ?? input.reference,
      });

      const data = res.data.data ?? {};
      const providerRef = data.transfer_code ?? data.reference ?? input.reference;
      const status = mapStatus(data.status);
      return {
        ok: true,
        data: { providerRef, status },
        providerRef,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getTransferStatus(
    providerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<PaystackTransferStatusResponse>({
        url: `${this.baseUrl}/transfer/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: this.authHeaders(),
        idempotencyKey: ctx?.idempotencyKey,
      });
      const status = mapStatus(res.data.data?.status);
      return { ok: true, data: { status }, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}
