/**
 * Onafriq (formerly MFS Africa) production adapter.
 * ---------------------------------------------------
 * Implements multiple provider interfaces against the Onafriq API.
 *
 * Onafriq is Africa's largest mobile money aggregator, connecting
 * 1 billion+ mobile wallets across 43 African countries.
 *
 * Credentials come from the adapter-factory (decrypted from the DB
 * ProviderConfig.credentialsEnc) — NEVER read from env vars here.
 * Expected credential keys: apiKey, baseUrl.
 *
 * Auth: API Key in Authorization header (Bearer token).
 *
 * Documentation: https://apidocs.beyonic.com
 *
 * @status STUB — Full API endpoints need verification against actual
 * Onafriq documentation. The developer portal is a SPA that cannot
 * be scraped. Use this adapter as a template and verify endpoints
 * during integration testing.
 */
import type { Currency } from "@/lib/turbocore/types";
import type {
  ProviderContext,
  ProviderResult,
  BulkTransferItem,
  BulkTransferResult,
  FxQuote,
  InternationalTransferInput,
  InternationalTransferResult,
  BillValidationInput,
  BillValidationResult,
  BillPayInput,
  BillPayResult,
  BillProductCatalog,
  SettlementDetails2,
  BalanceDetails,
  PapssPaymentInput,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";

export interface OnafriqCredentials {
  apiKey: string;
  baseUrl: string;
}

// ─── Response Types ──────────────────────────────────────────

interface OnafriqResponse<T = unknown> {
  status?: string;
  message?: string;
  data?: T;
}

interface CollectionData {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  transactionRef?: string;
}

interface TransferData {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  reference?: string;
}

interface MobileMoneyData {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  mobileMoneyRef?: string;
}

interface FxRateData {
  fromCurrency?: string;
  toCurrency?: string;
  rate?: number;
  quoteId?: string;
  expiresAt?: string;
}

interface CardData {
  cardId?: string;
  pan?: string;
  cvv?: string;
  expiryMonth?: number;
  expiryYear?: number;
  status?: string;
}

interface SettlementData {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  settledAt?: string;
}

interface WalletData {
  balance?: number;
  currency?: string;
}

// ─── Collection Provider ──────────────────────────────────────

export class OnafriqCollectionProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async initializeCollection(
    input: { amountMinor: number; currency: string; reference: string; customerPhone?: string; customerEmail?: string; description?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED"; checkoutUrl?: string }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<CollectionData>>({
        url: `${this.baseUrl}/collections`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          amount: input.amountMinor / 100,
          currency: input.currency,
          reference: input.reference,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          description: input.description,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.id ?? data.transactionRef ?? input.reference,
          status: data.status === "completed" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.id,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getCollectionStatus(providerRef: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<CollectionData>>({
        url: `${this.baseUrl}/collections/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "completed" ? "SUCCESS" : data.status === "failed" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Transfer Provider ────────────────────────────────────────

export class OnafriqTransferProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async singleTransfer(
    input: { amountMinor: number; currency: string; accountNumber: string; bankCode: string; reference: string; recipientName?: string; country?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<TransferData>>({
        url: `${this.baseUrl}/payments`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          amount: input.amountMinor / 100,
          currency: input.currency,
          accountNumber: input.accountNumber,
          bankCode: input.bankCode,
          reference: input.reference,
          recipientName: input.recipientName,
          country: input.country,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.id ?? input.reference,
          status: data.status === "completed" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.id,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async bulkTransfer(
    items: BulkTransferItem[],
    ctx?: ProviderContext,
  ): Promise<ProviderResult<BulkTransferResult>> {
    try {
      const batchId = `BULK-${Date.now()}`;

      const res = await jsonRequest<OnafriqResponse>({
        url: `${this.baseUrl}/payments/bulk`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          batchReference: batchId,
          transactions: items.map((item) => ({
            amount: item.amountMinor / 100,
            currency: item.currency,
            accountNumber: item.accountNumber,
            bankCode: item.bankCode,
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
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getTransferStatus(providerRef: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<TransferData>>({
        url: `${this.baseUrl}/payments/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "completed" ? "SUCCESS" : data.status === "failed" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Mobile Money Provider ────────────────────────────────────

export class OnafriqMobileMoneyProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async collect(
    input: { amountMinor: number; currency: string; mobileMoneyNumber: string; network: string; reference: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<MobileMoneyData>>({
        url: `${this.baseUrl}/momo/collections`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          amount: input.amountMinor / 100,
          currency: input.currency,
          mobileMoneyNumber: input.mobileMoneyNumber,
          network: input.network,
          reference: input.reference,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.id ?? data.mobileMoneyRef ?? input.reference,
          status: data.status === "completed" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.id,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async disburse(
    input: { amountMinor: number; currency: string; mobileMoneyNumber: string; network: string; reference: string; recipientName?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<MobileMoneyData>>({
        url: `${this.baseUrl}/momo/disbursements`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          amount: input.amountMinor / 100,
          currency: input.currency,
          mobileMoneyNumber: input.mobileMoneyNumber,
          network: input.network,
          reference: input.reference,
          recipientName: input.recipientName,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.id ?? data.mobileMoneyRef ?? input.reference,
          status: data.status === "completed" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.id,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getStatus(providerRef: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<MobileMoneyData>>({
        url: `${this.baseUrl}/momo/transactions/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "completed" ? "SUCCESS" : data.status === "failed" ? "FAILED" : "PENDING",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── FX Provider ──────────────────────────────────────────────

export class OnafriqFxProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async getQuote(
    from: string,
    to: string,
    amountMinor: number,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<FxQuote>> {
    try {
      const res = await jsonRequest<OnafriqResponse<FxRateData>>({
        url: `${this.baseUrl}/fx/rates`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          fromCurrency: from,
          toCurrency: to,
          amount: amountMinor / 100,
        },
      });

      const data = res.data.data ?? {};
      const rate = data.rate ?? 1;
      const destinationAmount = Math.floor((amountMinor / 100) * rate * 100);

      return {
        ok: true,
        data: {
          from: from as any,
          to: to as any,
          rate,
          rateId: data.quoteId,
          expiresAt: data.expiresAt,
          providerFeeMinor: 0,
          platformFeeMinor: 0,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── PAPSS Provider ───────────────────────────────────────────

export class OnafriqPapssProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async initiatePayment(
    input: PapssPaymentInput,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "pending" | "processing" | "completed" | "failed"; exchangeRate?: number }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<{ id?: string; status?: string; exchangeRate?: number }>>({
        url: `${this.baseUrl}/papss/payments`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          sourceCurrency: input.sourceCurrency,
          destinationCurrency: input.destinationCurrency,
          amount: input.amountMinor / 100,
          sender: input.sender,
          receiver: input.receiver,
          reference: input.reference,
          description: input.description,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.id ?? input.reference,
          status: data.status as any ?? "pending",
          exchangeRate: data.exchangeRate,
        },
        providerRef: data.id,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getStatus(
    providerRef: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ status: "pending" | "processing" | "completed" | "failed"; settlementStatus?: string }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<{ id?: string; status?: string; settlementStatus?: string }>>({
        url: `${this.baseUrl}/papss/payments/${encodeURIComponent(providerRef)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          status: data.status as any ?? "pending",
          settlementStatus: data.settlementStatus,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Settlement Provider ──────────────────────────────────────

export class OnafriqSettlementProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async listSettlements(
    filters?: { from?: string; to?: string; status?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<SettlementDetails2[]>> {
    try {
      const params = new URLSearchParams();
      if (filters?.from) params.append("startDate", filters.from);
      if (filters?.to) params.append("endDate", filters.to);
      if (filters?.status) params.append("status", filters.status);

      const url = `${this.baseUrl}/settlements${params.toString() ? "?" + params.toString() : ""}`;
      const res = await jsonRequest<OnafriqResponse<SettlementData[]>>({
        url,
        method: "GET",
        headers: this.authHeaders(),
      });

      const settlements = (res.data.data ?? []).map((s) => ({
        settlementId: s.id ?? "",
        status: (s.status === "completed" ? "success" : s.status === "failed" ? "failed" : s.status === "processing" ? "processing" : "pending") as SettlementDetails2["status"],
        totalAmount: (s.amount ?? 0) * 100,
        netAmount: (s.amount ?? 0) * 100,
        fees: 0,
        currency: (s.currency ?? "USD") as Currency,
        settledAt: s.settledAt,
        transactionCount: 0,
      }));

      return { ok: true, data: settlements, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getSettlement(settlementId: string, ctx?: ProviderContext): Promise<ProviderResult<SettlementDetails2>> {
    try {
      const res = await jsonRequest<OnafriqResponse<SettlementData>>({
        url: `${this.baseUrl}/settlements/${encodeURIComponent(settlementId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const s = res.data.data ?? {};
      return {
        ok: true,
        data: {
          settlementId: s.id ?? settlementId,
          status: (s.status === "completed" ? "success" : s.status === "failed" ? "failed" : s.status === "processing" ? "processing" : "pending") as SettlementDetails2["status"],
          totalAmount: (s.amount ?? 0) * 100,
          netAmount: (s.amount ?? 0) * 100,
          fees: 0,
          currency: (s.currency ?? "USD") as Currency,
          settledAt: s.settledAt,
          transactionCount: 0,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getSettlementTransactions(
    settlementId: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<Array<{ transactionRef: string; amount: number; fee: number; currency: any }>>> {
    try {
      const res = await jsonRequest<OnafriqResponse<Array<{ reference?: string; amount?: number; fee?: number; currency?: string }>>>({
        url: `${this.baseUrl}/settlements/${encodeURIComponent(settlementId)}/transactions`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const txns = (res.data.data ?? []).map((t) => ({
        transactionRef: t.reference ?? "",
        amount: (t.amount ?? 0) * 100,
        fee: (t.fee ?? 0) * 100,
        currency: t.currency ?? "USD",
      }));

      return { ok: true, data: txns, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Balance Provider ─────────────────────────────────────────

export class OnafriqBalanceProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async getBalance(currency: string = "USD", ctx?: ProviderContext): Promise<ProviderResult<BalanceDetails>> {
    try {
      const res = await jsonRequest<OnafriqResponse<WalletData>>({
        url: `${this.baseUrl}/wallets/${encodeURIComponent(currency)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          currency: currency as any,
          available: (data.balance ?? 0) * 100,
          pending: 0,
          ledger: (data.balance ?? 0) * 100,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getAllBalances(ctx?: ProviderContext): Promise<ProviderResult<BalanceDetails[]>> {
    try {
      const res = await jsonRequest<OnafriqResponse<Array<{ currency?: string; balance?: number }>>>({
        url: `${this.baseUrl}/wallets/balances`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const balances = (res.data.data ?? []).map((w) => ({
        currency: (w.currency ?? "USD") as any,
        available: (w.balance ?? 0) * 100,
        pending: 0,
        ledger: (w.balance ?? 0) * 100,
      }));

      return { ok: true, data: balances, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Card Issuance Provider ───────────────────────────────────

export class OnafriqCardProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async issueCard(
    input: { cardholderName: string; type: "VIRTUAL" | "PHYSICAL"; brand: "VISA" | "MASTERCARD"; currency: string; spendingLimitMinor?: number },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerCardId: string; last4: string; brand: string; expiryMonth: number; expiryYear: number }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<CardData>>({
        url: `${this.baseUrl}/cards`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          cardholderName: input.cardholderName,
          type: input.type,
          brand: input.brand,
          currency: input.currency,
          spendingLimit: input.spendingLimitMinor ? input.spendingLimitMinor / 100 : undefined,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerCardId: data.cardId ?? "",
          last4: data.pan?.slice(-4) ?? "",
          brand: input.brand,
          expiryMonth: data.expiryMonth ?? 1,
          expiryYear: data.expiryYear ?? 2030,
        },
        providerRef: data.cardId,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async getCardStatus(cardId: string, ctx?: ProviderContext): Promise<ProviderResult<{ status: "ACTIVE" | "FROZEN" | "TERMINATED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<CardData>>({
        url: `${this.baseUrl}/cards/${encodeURIComponent(cardId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          status: data.status === "active" ? "ACTIVE" : data.status === "frozen" ? "FROZEN" : "TERMINATED",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async setCardStatus(
    cardId: string,
    status: "ACTIVE" | "FROZEN" | "TERMINATED",
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ updated: boolean }>> {
    try {
      await jsonRequest({
        url: `${this.baseUrl}/cards/${encodeURIComponent(cardId)}`,
        method: "PUT",
        headers: this.authHeaders(),
        body: { status: status.toLowerCase() },
      });
      return { ok: true, data: { updated: true } };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Bill Payment Provider ────────────────────────────────────
// Note: Onafriq bill payments are via Baxi agent banking network.
// This adapter provides the interface but actual implementation
// may require Baxi-specific API credentials.

export class OnafriqBillPaymentProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async listProducts(ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>> {
    try {
      const res = await jsonRequest<OnafriqResponse<Array<{ code?: string; name?: string; category?: string; fields?: string[] }>>>({
        url: `${this.baseUrl}/billers`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const products = (res.data.data ?? []).map((b) => ({
        code: b.code ?? "",
        name: b.name ?? "",
        category: b.category ?? "",
        fields: b.fields ?? ["reference", "amount"],
        provider: "onafriq",
      }));

      return { ok: true, data: products, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async validate(input: BillValidationInput, ctx?: ProviderContext): Promise<ProviderResult<BillValidationResult>> {
    try {
      const res = await jsonRequest<OnafriqResponse<{ valid?: boolean; customerName?: string; message?: string }>>({
        url: `${this.baseUrl}/billers/validate`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          billerCode: input.productCode,
          customerReference: input.customer,
        },
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          valid: data.valid ?? false,
          customerName: data.customerName ?? "",
          message: data.message ?? "",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async pay(input: BillPayInput, ctx?: ProviderContext): Promise<ProviderResult<BillPayResult>> {
    try {
      const res = await jsonRequest<OnafriqResponse<{ reference?: string; status?: string; token?: string }>>({
        url: `${this.baseUrl}/billers/pay`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          billerCode: input.productCode,
          customerReference: input.customer,
          amount: input.amountMinor / 100,
          customerName: input.customerName,
          paymentReference: input.reference,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.reference ?? input.reference,
          status: data.status === "completed" ? "SUCCESS" : "PENDING",
          token: data.token,
        },
        providerRef: data.reference,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }
}

// ─── Wallet Funding Provider ──────────────────────────────────

export class OnafriqWalletFundingProvider {
  readonly name = "onafriq";

  constructor(private readonly creds: OnafriqCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.apiKey}` };
  }

  async initiateFunding(
    input: { accountNumber: string; amountMinor: number; currency: string; reference: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>> {
    try {
      const res = await jsonRequest<OnafriqResponse<{ id?: string; status?: string }>>({
        url: `${this.baseUrl}/wallets/fund`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          accountNumber: input.accountNumber,
          amount: input.amountMinor / 100,
          currency: input.currency,
          reference: input.reference,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          providerRef: data.id ?? input.reference,
          status: data.status === "completed" ? "SUCCESS" : "PENDING",
        },
        providerRef: data.id,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "ONAFRIQ_ERROR") };
    }
  }

  async simulateFunding(
    accountNumber: string,
    amountMinor: number,
    ctx?: ProviderContext,
  ): Promise<{ event: string; payload: Record<string, unknown> }> {
    return {
      event: "wallet.funded",
      payload: {
        accountNumber,
        amount: amountMinor / 100,
        currency: "NGN",
        reference: `SIM-${Date.now()}`,
        status: "completed",
      },
    };
  }
}
