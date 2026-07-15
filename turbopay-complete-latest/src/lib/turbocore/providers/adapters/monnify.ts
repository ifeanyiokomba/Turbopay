/**
 * Monnify production adapter.
 * --------------------------
 * Implements IVirtualAccountProvider + IWalletFundingProvider against the
 * Monnify REST API (https://sandbox.monnify.com or prod base url).
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here. Expected
 * credential keys: apiKey, secretKey, contractCode, baseUrl.
 *
 * Auth: Monnify uses a Bearer access token obtained by POSTing to
 * /api/v1/auth/login with HTTP Basic auth (apiKey:secretKey). Tokens live
 * ~30 minutes. We cache the token in a module-level variable with an
 * expiry timestamp and refresh lazily when within 30s of expiry.
 *
 * Production funding is webhook-driven (POST /api/webhook/monnify), so
 * `initiateFunding` returns PENDING. `simulateFunding` synthesises the
 * same webhook payload shape the demo/sandbox flow uses so the existing
 * idempotent `processFunding` path is exercised end-to-end.
 */
import * as crypto from "node:crypto";
import type { Currency } from "@/lib/turbocore/types";
import type {
  IVirtualAccountProvider,
  IWalletFundingProvider,
  ProviderContext,
  ProviderResult,
  SimulatedFundingEvent,
  VirtualAccountDetails,
  WalletFundingInit,
  WalletFundingResult,
} from "../interfaces";
import { jsonRequest, ProviderHttpError, toProviderError } from "./_http";

export interface MonnifyCredentials {
  apiKey: string;
  secretKey: string;
  contractCode: string;
  baseUrl: string;
}

interface MonnifyToken {
  value: string;
  expiresAt: number; // epoch ms
}

interface MonnifyLoginResponse {
  responseBody?: { accessToken?: string; expiresIn?: number };
}

interface MonnifyReservedAccountResponse {
  responseBody?: {
    accountReference?: string;
    accountNumber?: string;
    accountName?: string;
    bankName?: string;
    bankCode?: string;
    currency?: string;
  };
}

const TOKEN_REFRESH_LEEWAY_MS = 30_000;

export class MonnifyProvider implements IVirtualAccountProvider, IWalletFundingProvider {
  readonly name = "monnify";
  private token: MonnifyToken | null = null;

  constructor(private readonly creds: MonnifyCredentials) {}

  /** Obtain (or return cached) Bearer access token. */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - now > TOKEN_REFRESH_LEEWAY_MS) {
      return this.token.value;
    }
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyLoginResponse>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const accessToken = res.data.responseBody?.accessToken;
    if (!accessToken) {
      throw new ProviderHttpError(0, "AUTH_FAILED", "Monnify login returned no access token");
    }
    const expiresInSec = res.data.responseBody?.expiresIn ?? 1800;
    this.token = { value: accessToken, expiresAt: now + expiresInSec * 1000 };
    return accessToken;
  }

  async createReservedAccount(
    accountName: string,
    customerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<VirtualAccountDetails>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyReservedAccountResponse>({
        url: `${this.creds.baseUrl}/api/v1/bank-transfer/reserved-accounts`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          accountReference: customerRef,
          accountName,
          currencyCode: "NGN",
          contractCode: this.creds.contractCode,
          // Monnify requires a customer email — derive a stable one from the ref.
          customerEmail: `${customerRef}@turbopay.ng`,
          customerName: accountName,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });
      const body = res.data.responseBody ?? {};
      const details: VirtualAccountDetails = {
        accountNumber: body.accountNumber ?? "",
        accountName: body.accountName ?? accountName,
        bankName: body.bankName ?? "Monnify MFB",
        bankCode: body.bankCode ?? "50515",
        providerRef: body.accountReference ?? customerRef,
        currency: (body.currency ?? "NGN") as Currency,
      };
      return { ok: true, data: details, providerRef: details.providerRef, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async closeAccount(
    providerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ closed: boolean }>> {
    try {
      const token = await this.getAccessToken();
      await jsonRequest<unknown>({
        url: `${this.creds.baseUrl}/api/v1/bank-transfer/reserved-accounts/${encodeURIComponent(providerRef)}`,
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        idempotencyKey: ctx?.idempotencyKey,
      });
      return { ok: true, data: { closed: true } };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  /**
   * Initiate a funding request. Monnify funding is webhook-driven — the
   * customer pays into the reserved account and Monnify fires a webhook.
   * So this returns PENDING; the actual settlement happens via
   * `processFunding` when the webhook arrives.
   */
  async initiateFunding(
    input: WalletFundingInit,
    _ctx?: ProviderContext,
  ): Promise<ProviderResult<WalletFundingResult>> {
    return {
      ok: true,
      data: {
        providerRef: input.reference,
        status: "PENDING",
        settledAmountMinor: 0,
        settledCurrency: input.currency,
      },
    };
  }

  /**
   * Synthesise the Monnify webhook payload shape — used by the demo/sandbox
   * funding flow at /api/wallet/fund so the same idempotent processFunding
   * path runs without a live bank transfer.
   */
  async simulateFunding(
    accountNumber: string,
    amountMinor: number,
    _ctx?: ProviderContext,
  ): Promise<SimulatedFundingEvent> {
    const txRef = `MNF-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const payRef = `TP-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const amount = amountMinor / 100;
    return {
      event: "SUCCESSFUL_TRANSACTION",
      payload: {
        transactionReference: txRef,
        paymentReference: payRef,
        accountReference: accountNumber,
        paidAt: new Date().toISOString(),
        amount,
        amountPaid: amount,
        paymentMethod: "ACCOUNT_TRANSFER",
        paymentStatus: "PAID",
        currency: "NGN",
        settlementAmount: amount,
      },
    };
  }
}
