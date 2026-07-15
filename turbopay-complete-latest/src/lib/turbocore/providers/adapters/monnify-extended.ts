/**
 * Monnify Extended Adapter — Transfers, Bill Payments, Refunds,
 * Settlements, Invoices, Split Payments, KYC, Wallet, Paycode
 * ----------------------------------------------------------------
 * Implements additional provider interfaces against the Monnify API.
 *
 * Auth: Bearer token (apiKey:secretKey -> POST /auth/login)
 * Base URL: https://api.monnify.com (production)
 *
 * Documentation: https://developers.monnify.com/
 */
import type { Currency } from "@/lib/turbocore/types";
import type {
  ProviderContext,
  ProviderResult,
  BulkTransferItem,
  BulkTransferResult,
  BillValidationInput,
  BillValidationResult,
  BillPayInput,
  BillPayResult,
  BillProductCatalog,
  SettlementDetails2,
  BalanceDetails,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";
import type { MonnifyCredentials } from "./monnify";

// ─── Response Types ──────────────────────────────────────────

interface MonnifyResponse<T = unknown> {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseBody?: T;
}

interface TransferData {
  reference?: string;
  amount?: number;
  status?: string;
  destinationBankCode?: string;
  destinationAccountNumber?: string;
}

interface RefundData {
  refundReference?: string;
  amount?: number;
  status?: string;
  transactionReference?: string;
}

interface SettlementData {
  settlementReference?: string;
  amount?: number;
  status?: string;
  settlementDate?: string;
  transactions?: Array<{ reference: string; amount: number }>;
}

interface InvoiceData {
  invoiceReference?: string;
  amount?: number;
  status?: string;
  dueDate?: string;
  accountNumber?: string;
}

interface WalletData {
  walletName?: string;
  walletReference?: string;
  balance?: number;
  currency?: string;
}

interface BvnData {
  bvn?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: string;
  phone?: string;
}

interface NinData {
  nin?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: string;
}

// ─── Transfer Provider ────────────────────────────────────────

export class MonnifyTransferProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async initiateTransfer(
    input: { amountMinor: number; bankCode: string; accountNumber: string; reference: string; narration?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<TransferData>>({
        url: `${this.baseUrl}/api/v1/transfer`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          amount: input.amountMinor / 100, // Monnify takes naira
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          reference: input.reference,
          narration: input.narration,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.reference ?? input.reference,
          status: data.status === "SUCCESS" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.reference,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async bulkTransfer(
    items: BulkTransferItem[],
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BulkTransferResult>> {
    try {
      const token = await this.getAccessToken();
      const batchId = `BULK-${Date.now()}`;

      const res = await jsonRequest<MonnifyResponse>({
        url: `${this.baseUrl}/api/v1/transfer/bulk`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          batchReference: batchId,
          title: `Bulk Transfer ${batchId}`,
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
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    // Reuse the token logic from the main Monnify adapter
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── Bill Payment Provider ────────────────────────────────────

export class MonnifyBillPaymentProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async listProducts(ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<Array<{ billerCode?: string; billerName?: string; category?: string; items?: Array<{ itemCode?: string; itemName?: string; amount?: number }> }>>>({
        url: `${this.baseUrl}/api/v2/billers`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const products = (res.data.responseBody ?? []).flatMap((b) =>
        (b.items ?? []).map((item) => ({
          code: item.itemCode ?? "",
          name: item.itemName ?? b.billerName ?? "",
          category: b.category ?? "",
          fields: ["meterNumber", "amount"],
          fixedAmountMinor: item.amount ? item.amount * 100 : undefined,
          provider: "monnify",
        }))
      );

      return { ok: true, data: products, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async validate(input: BillValidationInput, ctx?: ProviderContext): Promise<ProviderResult<BillValidationResult>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<{ valid?: boolean; customerName?: string; responseMessage?: string }>>({
        url: `${this.baseUrl}/api/v1/billers/validate`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          billerCode: input.productCode,
          customerReference: input.customer,
        },
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          valid: data.valid ?? false,
          customerName: data.customerName ?? "",
          message: data.responseMessage ?? "",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async pay(input: BillPayInput, ctx?: ProviderContext): Promise<ProviderResult<BillPayResult>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<{ reference?: string; status?: string; token?: string }>>({
        url: `${this.baseUrl}/api/v1/billers/pay`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          billerCode: input.productCode,
          customerReference: input.customer,
          amount: input.amountMinor / 100,
          customerName: input.customerName,
          paymentReference: input.reference,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.reference ?? input.reference,
          status: data.status === "SUCCESSFUL" ? "SUCCESS" : "PENDING",
          token: data.token,
        },
        providerRef: data.reference,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── Refund Provider ──────────────────────────────────────────

export class MonnifyRefundProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async initiateRefund(
    input: { transactionReference: string; amountMinor: number; reason?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ refundRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<RefundData>>({
        url: `${this.baseUrl}/api/v1/refund`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          transactionReference: input.transactionReference,
          refundAmount: input.amountMinor / 100,
          reason: input.reason,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          refundRef: data.refundReference ?? "",
          status: data.status === "SUCCESSFUL" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.refundReference,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async getRefundStatus(refundRef: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<RefundData>>({
        url: `${this.baseUrl}/api/v1/refund/${encodeURIComponent(refundRef)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "SUCCESSFUL" ? "SUCCESS" : data.status === "FAILED" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── Settlement Provider ──────────────────────────────────────

export class MonnifySettlementProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
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
      const res = await jsonRequest<MonnifyResponse<SettlementData[]>>({
        url,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const settlements = (res.data.responseBody ?? []).map((s) => ({
        settlementId: s.settlementReference ?? "",
        status: (s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "failed" : s.status === "PROCESSING" ? "processing" : "pending") as SettlementDetails2["status"],
        totalAmount: (s.amount ?? 0) * 100,
        netAmount: (s.amount ?? 0) * 100,
        fees: 0,
        currency: "NGN" as Currency,
        settledAt: s.settlementDate,
        transactionCount: s.transactions?.length ?? 0,
      }));

      return { ok: true, data: settlements, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async getSettlement(settlementId: string, ctx?: ProviderContext): Promise<ProviderResult<SettlementDetails2>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<SettlementData>>({
        url: `${this.baseUrl}/api/v1/settlements/${encodeURIComponent(settlementId)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const s = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          settlementId: s.settlementReference ?? settlementId,
          status: (s.status === "SUCCESS" ? "success" : s.status === "FAILED" ? "failed" : s.status === "PROCESSING" ? "processing" : "pending") as SettlementDetails2["status"],
          totalAmount: (s.amount ?? 0) * 100,
          netAmount: (s.amount ?? 0) * 100,
          fees: 0,
          currency: "NGN" as Currency,
          settledAt: s.settlementDate,
          transactionCount: s.transactions?.length ?? 0,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async getSettlementTransactions(
    settlementId: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<Array<{ transactionRef: string; amount: number; fee: number; currency: any }>>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<SettlementData>>({
        url: `${this.baseUrl}/api/v1/settlements/${encodeURIComponent(settlementId)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const txns = (res.data.responseBody?.transactions ?? []).map((t) => ({
        transactionRef: t.reference ?? "",
        amount: (t.amount ?? 0) * 100,
        fee: 0,
        currency: "NGN",
      }));

      return { ok: true, data: txns, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── Invoice Provider ─────────────────────────────────────────

export class MonnifyInvoiceProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async createInvoice(
    input: { amountMinor: number; customerName: string; customerEmail: string; dueDate?: string; description?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ invoiceRef: string; checkoutUrl?: string }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<InvoiceData>>({
        url: `${this.baseUrl}/api/v1/invoice/create`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          amount: input.amountMinor / 100,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          dueDate: input.dueDate,
          description: input.description,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          invoiceRef: data.invoiceReference ?? "",
          checkoutUrl: `https://monnify.com/invoice/${data.invoiceReference}`,
        },
        providerRef: data.invoiceReference,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async getInvoice(invoiceRef: string, ctx?: ProviderContext): Promise<ProviderResult<InvoiceData>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<InvoiceData>>({
        url: `${this.baseUrl}/api/v1/invoice/${encodeURIComponent(invoiceRef)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      return { ok: true, data: res.data.responseBody ?? {}, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── Split Payment Provider ───────────────────────────────────

export class MonnifySplitPaymentProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async createSubaccount(
    input: { accountName: string; bankCode: string; accountNumber: string; percentageCharge: number },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ subaccountCode: string; accountName: string }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<{ subaccountCode?: string; accountName?: string }>>({
        url: `${this.baseUrl}/api/v1/subaccount`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: {
          accountName: input.accountName,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          percentageCharge: input.percentageCharge,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          subaccountCode: data.subaccountCode ?? "",
          accountName: data.accountName ?? input.accountName,
        },
        providerRef: data.subaccountCode,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async listSubaccounts(ctx?: ProviderContext): Promise<ProviderResult<Array<{ subaccountCode: string; accountName: string }>>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<Array<{ subaccountCode?: string; accountName?: string }>>>({
        url: `${this.baseUrl}/api/v1/subaccount`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const accounts = (res.data.responseBody ?? []).map((a) => ({
        subaccountCode: a.subaccountCode ?? "",
        accountName: a.accountName ?? "",
      }));

      return { ok: true, data: accounts, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── KYC Provider ─────────────────────────────────────────────

export class MonnifyKycProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async verifyBvn(bvn: string, ctx?: ProviderContext): Promise<ProviderResult<{ verified: boolean; firstName: string; lastName: string; dob: string }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<BvnData>>({
        url: `${this.baseUrl}/api/v1/validation/bvn/${encodeURIComponent(bvn)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          verified: !!data.bvn,
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          dob: data.dateOfBirth ?? "",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async verifyNin(nin: string, ctx?: ProviderContext): Promise<ProviderResult<{ verified: boolean; firstName: string; lastName: string; dob: string }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<NinData>>({
        url: `${this.baseUrl}/api/v1/validation/nin/${encodeURIComponent(nin)}`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          verified: !!data.nin,
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          dob: data.dateOfBirth ?? "",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async resolveBankAccount(bankCode: string, accountNumber: string, ctx?: ProviderContext): Promise<ProviderResult<{ accountName: string; accountNumber: string; bankCode: string }>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<{ accountName?: string; accountNumber?: string; bankCode?: string }>>({
        url: `${this.baseUrl}/api/v1/account/resolve`,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: { bankCode, accountNumber },
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          accountName: data.accountName ?? "",
          accountNumber: data.accountNumber ?? accountNumber,
          bankCode: data.bankCode ?? bankCode,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}

// ─── Wallet / Balance Provider ────────────────────────────────

export class MonnifyWalletProvider {
  readonly name = "monnify";

  constructor(private readonly creds: MonnifyCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  async getBalance(currency: string = "NGN", ctx?: ProviderContext): Promise<ProviderResult<BalanceDetails>> {
    try {
      const token = await this.getAccessToken();
      const res = await jsonRequest<MonnifyResponse<{ balance?: number; currency?: string }>>({
        url: `${this.baseUrl}/api/v1/wallet/balance`,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = res.data.responseBody ?? {};
      return {
        ok: true,
        data: {
          currency: (data.currency ?? currency) as any,
          available: (data.balance ?? 0) * 100,
          pending: 0,
          ledger: (data.balance ?? 0) * 100,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async getAllBalances(ctx?: ProviderContext): Promise<ProviderResult<BalanceDetails[]>> {
    try {
      const balanceResult = await this.getBalance("NGN", ctx);
      if (!balanceResult.ok || !balanceResult.data) {
        return { ok: false, error: balanceResult.error };
      }
      return { ok: true, data: [balanceResult.data] };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  async getWalletStatement(from?: string, to?: string, ctx?: ProviderContext): Promise<ProviderResult<Array<{ date: string; description: string; amount: number; balance: number }>>> {
    try {
      const token = await this.getAccessToken();
      const params = new URLSearchParams();
      if (from) params.append("startDate", from);
      if (to) params.append("endDate", to);

      const url = `${this.baseUrl}/api/v1/wallet/statement${params.toString() ? "?" + params.toString() : ""}`;
      const res = await jsonRequest<MonnifyResponse<Array<{ transactionDate?: string; narration?: string; amount?: number; balanceAfter?: number }>>>({
        url,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const statements = (res.data.responseBody ?? []).map((s) => ({
        date: s.transactionDate ?? "",
        description: s.narration ?? "",
        amount: (s.amount ?? 0) * 100,
        balance: (s.balanceAfter ?? 0) * 100,
      }));

      return { ok: true, data: statements, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "MONNIFY_ERROR") };
    }
  }

  private async getAccessToken(): Promise<string> {
    const basic = Buffer.from(`${this.creds.apiKey}:${this.creds.secretKey}`).toString("base64");
    const res = await jsonRequest<MonnifyResponse<{ accessToken?: string; expiresIn?: number }>>({
      url: `${this.creds.baseUrl}/api/v1/auth/login`,
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const token = res.data.responseBody?.accessToken;
    if (!token) throw new Error("Monnify login failed");
    return token;
  }
}
