/**
 * Quickteller Extended Adapter — Collections, Transfers, Refunds,
 * Subscriptions, Card Payments, Payouts, Settlements
 * ----------------------------------------------------------------
 * Implements additional provider interfaces against the Quickteller API.
 *
 * Auth: OAuth 2.0 (client_credentials)
 * Base URL: https://orion.interswitchng.com (production)
 *
 * Documentation: https://docs.interswitchgroup.com
 */
import type { Currency } from "@/lib/turbocore/types";
import type {
  ProviderContext,
  ProviderResult,
  BulkTransferItem,
  BulkTransferResult,
  SettlementDetails2,
  SubscriptionPlan,
  SubscriptionDetails,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";
import type { QuicktellerCredentials } from "./quickteller";

// ─── Response Types ──────────────────────────────────────────

interface ISWResponse<T = unknown> {
  responseCode?: string;
  responseMessage?: string;
  response?: T;
}

interface TransactionData {
  paymentId?: string;
  transactionRef?: string;
  amount?: number;
  status?: string;
  responseCode?: string;
  responseMessage?: string;
}

interface TransferData {
  transactionRef?: string;
  amount?: number;
  status?: string;
  responseCode?: string;
  responseMessage?: string;
}

interface RefundData {
  refundRef?: string;
  amount?: number;
  status?: string;
}

interface WalletData {
  walletId?: string;
  balance?: number;
  currency?: string;
}

// ─── Collection Provider ──────────────────────────────────────

export class QuicktellerCollectionProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private async getAccessToken(): Promise<string> {
    const authUrl = this.creds.authBaseUrl ?? "https://passport-sandbox.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<{ access_token?: string; expires_in?: number }>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    const token = res.data.access_token;
    if (!token) throw new Error("Quickteller auth failed");
    return token;
  }

  async initializePayment(
    input: { billerCode: string; amount: number; customerReference: string; paymentMethod?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED"; paymentLink?: string }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<TransactionData>>({
        url: `${this.baseUrl}/api/v3/purchases`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: {
          paymentCode: input.billerCode,
          amount: input.amount,
          customerRef: input.customerReference,
          paymentMethod: input.paymentMethod ?? "card",
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.paymentId ?? data.transactionRef ?? "",
          status: data.status === "00" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.paymentId,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async getTransactionStatus(
    providerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<TransactionData>>({
        url: `${this.baseUrl}/quickteller/service/v5/Transactions?requestRef=${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "00" ? "SUCCESS" : data.status === "001" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}

// ─── Transfer Provider ────────────────────────────────────────

export class QuicktellerTransferProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private async getAccessToken(): Promise<string> {
    const authUrl = this.creds.authBaseUrl ?? "https://passport-sandbox.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<{ access_token?: string; expires_in?: number }>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    const token = res.data.access_token;
    if (!token) throw new Error("Quickteller auth failed");
    return token;
  }

  async singleTransfer(
    input: { amountMinor: number; bankCode: string; accountNumber: string; reference: string; narration?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<TransferData>>({
        url: `${this.baseUrl}/quickteller/service/v5/transactions/TransferFunds`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: {
          amount: input.amountMinor / 100,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          reference: input.reference,
          narration: input.narration,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.transactionRef ?? input.reference,
          status: data.status === "00" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.transactionRef,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async bulkTransfer(
    items: BulkTransferItem[],
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BulkTransferResult>> {
    try {
      const token = await this.getAccessToken();
      const batchId = `BULK-${Date.now()}`;

      const res = await jsonRequest<ISWResponse>({
        url: `${this.baseUrl}/generic-wallet/api/v1/transaction/transfer/bulk`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: {
          batchReference: batchId,
          transactions: items.map((item) => ({
            amount: item.amountMinor / 100,
            bankCode: item.bankCode,
            accountNumber: item.accountNumber,
            reference: item.reference,
            narration: item.narration,
          })),
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      return {
        ok: true,
        data: {
          batchId,
          totalItems: items.length,
          totalAmount: items.reduce((sum, i) => sum + i.amountMinor, 0),
          queuedCount: items.length,
          failedCount: 0,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async getTransferStatus(
    providerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<TransferData>>({
        url: `${this.baseUrl}/quickteller/service/v5/transactions/TransferFunds/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "00" ? "SUCCESS" : data.status === "001" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}

// ─── Refund Provider ──────────────────────────────────────────

export class QuicktellerRefundProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private async getAccessToken(): Promise<string> {
    const authUrl = this.creds.authBaseUrl ?? "https://passport-sandbox.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<{ access_token?: string; expires_in?: number }>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    const token = res.data.access_token;
    if (!token) throw new Error("Quickteller auth failed");
    return token;
  }

  async initiateRefund(
    input: { transactionRef: string; amountMinor: number; reason?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ refundRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<RefundData>>({
        url: `${this.baseUrl}/api/v1/refunds`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: {
          transactionRef: input.transactionRef,
          amount: input.amountMinor / 100,
          reason: input.reason,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          refundRef: data.refundRef ?? "",
          status: data.status === "COMPLETE" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.refundRef,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async getRefundStatus(refundRef: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<RefundData>>({
        url: `${this.baseUrl}/api/v1/refunds/${encodeURIComponent(refundRef)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "COMPLETE" ? "SUCCESS" : data.status === "FAILED" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}

// ─── Subscription Provider ────────────────────────────────────

export class QuicktellerSubscriptionProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private async getAccessToken(): Promise<string> {
    const authUrl = this.creds.authBaseUrl ?? "https://passport-sandbox.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<{ access_token?: string; expires_in?: number }>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    const token = res.data.access_token;
    if (!token) throw new Error("Quickteller auth failed");
    return token;
  }

  async createSubscription(
    input: { billerCode: string; amount: number; frequency: string; startDate: string; endDate?: string; customerReference: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ subscriptionId: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<{ subscriptionId?: string; status?: string }>>({
        url: `${this.baseUrl}/api/v2/purchases/recurrents`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: {
          paymentCode: input.billerCode,
          amount: input.amount,
          frequency: input.frequency,
          startDate: input.startDate,
          endDate: input.endDate,
          customerRef: input.customerReference,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          subscriptionId: data.subscriptionId ?? "",
          status: data.status === "00" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.subscriptionId,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async cancelSubscription(subscriptionId: string, ctx?: ProviderContext): Promise<ProviderResult<{ cancelled: boolean }>> {
    try {
      const token = await this.getAccessToken();
      await jsonRequest({
        url: `${this.baseUrl}/api/v2/purchases/recurrents/${encodeURIComponent(subscriptionId)}`,
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: true, data: { cancelled: true } };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}

// ─── Payout Provider ──────────────────────────────────────────

export class QuicktellerPayoutProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private async getAccessToken(): Promise<string> {
    const authUrl = this.creds.authBaseUrl ?? "https://passport-sandbox.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<{ access_token?: string; expires_in?: number }>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    const token = res.data.access_token;
    if (!token) throw new Error("Quickteller auth failed");
    return token;
  }

  async initiatePayout(
    input: { amountMinor: number; bankCode: string; accountNumber: string; reference: string; recipientName?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<TransactionData>>({
        url: `${this.baseUrl}/api/v1/payouts`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: {
          amount: input.amountMinor / 100,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          reference: input.reference,
          recipientName: input.recipientName,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.paymentId ?? input.reference,
          status: data.status === "00" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.paymentId,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async getPayoutStatus(providerRef: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<TransactionData>>({
        url: `${this.baseUrl}/api/v1/payouts/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.response ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "00" ? "SUCCESS" : data.status === "001" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}

// ─── Settlement Provider ──────────────────────────────────────

export class QuicktellerSettlementProvider {
  readonly name = "quickteller";

  constructor(private readonly creds: QuicktellerCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private async getAccessToken(): Promise<string> {
    const authUrl = this.creds.authBaseUrl ?? "https://passport-sandbox.interswitchng.com/passport/oauth/token";
    const res = await jsonRequest<{ access_token?: string; expires_in?: number }>({
      url: authUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.creds.apiKey}:${this.creds.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    const token = res.data.access_token;
    if (!token) throw new Error("Quickteller auth failed");
    return token;
  }

  async listSettlements(
    filters?: { from?: string; to?: string; status?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<SettlementDetails2[]>> {
    try {
      const token = await this.getAccessToken();
      const params = new URLSearchParams();
      if (filters?.from) params.append("startDate", filters.from);
      if (filters?.to) params.append("endDate", filters.to);

      const url = `${this.baseUrl}/api/v1/settlements${params.toString() ? "?" + params.toString() : ""}`;
      const res = await jsonRequest<ISWResponse<Array<{ settlementRef?: string; amount?: number; status?: string; settlementDate?: string; transactionCount?: number }>>>({
        url,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const settlements = (res.data.response ?? []).map((s) => ({
        settlementId: s.settlementRef ?? "",
        status: (s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "failed" : s.status === "PROCESSING" ? "processing" : "pending") as SettlementDetails2["status"],
        totalAmount: (s.amount ?? 0) * 100,
        netAmount: (s.amount ?? 0) * 100,
        fees: 0,
        currency: "NGN" as Currency,
        settledAt: s.settlementDate,
        transactionCount: s.transactionCount ?? 0,
      }));

      return { ok: true, data: settlements, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async getSettlement(settlementId: string, ctx?: ProviderContext): Promise<ProviderResult<SettlementDetails2>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<{ settlementRef?: string; amount?: number; status?: string; settlementDate?: string; transactionCount?: number }>>({
        url: `${this.baseUrl}/api/v1/settlements/${encodeURIComponent(settlementId)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const s = res.data.response ?? {};
      return {
        ok: true,
        data: {
          settlementId: s.settlementRef ?? settlementId,
          status: (s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "failed" : s.status === "PROCESSING" ? "processing" : "pending") as SettlementDetails2["status"],
          totalAmount: (s.amount ?? 0) * 100,
          netAmount: (s.amount ?? 0) * 100,
          fees: 0,
          currency: "NGN" as Currency,
          settledAt: s.settlementDate,
          transactionCount: s.transactionCount ?? 0,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }

  async getSettlementTransactions(
    settlementId: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<Array<{ transactionRef: string; amount: number; fee: number; currency: any }>>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<ISWResponse<Array<{ reference?: string; amount?: number; fee?: number }>>>({
        url: `${this.baseUrl}/api/v1/settlements/${encodeURIComponent(settlementId)}/transactions`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const txns = (res.data.response ?? []).map((t) => ({
        transactionRef: t.reference ?? "",
        amount: (t.amount ?? 0) * 100,
        fee: (t.fee ?? 0) * 100,
        currency: "NGN",
      }));

      return { ok: true, data: txns, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "QUICKTELLER_ERROR") };
    }
  }
}
