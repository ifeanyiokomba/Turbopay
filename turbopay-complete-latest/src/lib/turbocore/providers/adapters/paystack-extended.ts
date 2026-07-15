/**
 * Paystack Extended Adapter — Subscriptions, Disputes, Settlements,
 * Payment Pages, Payment Requests, Splits, Customers, Terminals
 * ----------------------------------------------------------------
 * Implements additional provider interfaces against the Paystack API.
 *
 * Auth: Bearer token (secretKey) on every request.
 * Base URL: https://api.paystack.co (production)
 *
 * Documentation: https://paystack.com/docs/api/
 */
import type { Currency } from "@/lib/turbocore/types";
import type {
  ProviderContext,
  ProviderResult,
  SubscriptionPlan,
  SubscriptionDetails,
  DisputeDetails,
  SettlementDetails2,
  PaymentPageDetails,
  SplitConfig,
  SplitDetails,
} from "../interfaces";
import { jsonRequest, toProviderError } from "./_http";
import type { PaystackCredentials } from "./paystack";

// ─── Response Types ──────────────────────────────────────────

interface PaystackResponse<T = unknown> {
  status: boolean;
  message?: string;
  data?: T;
  meta?: { total?: number; page?: number; perPage?: number };
}

interface PlanData {
  id?: number;
  plan_code?: string;
  name?: string;
  description?: string;
  amount?: number;
  interval?: string;
  currency?: string;
}

interface SubscriptionData {
  id?: number;
  subscription_code?: string;
  customer?: { customer_code?: string };
  plan?: { plan_code?: string };
  status?: string;
  next_payment_date?: string;
  payments_count?: number;
  amount?: number;
  currency?: string;
}

interface CustomerData {
  id?: number;
  customer_code?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

interface DisputeData {
  id?: number;
  dispute_code?: string;
  transaction?: { reference?: string };
  category?: string;
  status?: string;
  amount?: number;
  currency?: string;
  comment?: string;
  resolution?: string;
  created_at?: string;
}

interface SettlementData {
  id?: number;
  settlement_code?: string;
  status?: string;
  total_amount?: number;
  total_fees?: number;
  total_records?: number;
  currency?: string;
  settlement_date?: string;
}

interface PageData {
  id?: number;
  page_code?: string;
  name?: string;
  description?: string;
  amount?: number;
  currency?: string;
  collect_custom_amount?: boolean;
  active?: boolean;
  url?: string;
  slug?: string;
}

interface PaymentRequestData {
  id?: number;
  payment_request_code?: string;
  amount?: number;
  currency?: string;
  description?: string;
  status?: string;
  payment_link?: string;
  created_at?: string;
}

interface SplitData {
  id?: number;
  split_code?: string;
  name?: string;
  currency?: string;
  subaccounts?: Array<{
    subaccount_code?: string;
    share?: number;
  }>;
}

// ─── Subscription Provider ────────────────────────────────────

export class PaystackSubscriptionProvider {
  readonly name = "paystack";

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async createPlan(
    input: Omit<SubscriptionPlan, "planId">,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<SubscriptionPlan>> {
    try {
      const res = await jsonRequest<PaystackResponse<PlanData>>({
        url: `${this.baseUrl}/plan`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          name: input.name,
          description: input.description,
          amount: input.amountMinor / 100, // Paystack takes naira
          interval: input.interval,
          currency: input.currency,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          planId: data.plan_code ?? "",
          name: data.name ?? input.name,
          amountMinor: (data.amount ?? 0) * 100,
          currency: (data.currency ?? input.currency) as any,
          interval: data.interval ?? input.interval,
          description: data.description,
        },
        providerRef: data.plan_code,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async listPlans(ctx?: ProviderContext): Promise<ProviderResult<SubscriptionPlan[]>> {
    try {
      const res = await jsonRequest<PaystackResponse<PlanData[]>>({
        url: `${this.baseUrl}/plan`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const plans = (res.data.data ?? []).map((p) => ({
        planId: p.plan_code ?? "",
        name: p.name ?? "",
        amountMinor: (p.amount ?? 0) * 100,
        currency: (p.currency ?? "NGN") as any,
        interval: p.interval ?? "",
        description: p.description,
      }));

      return { ok: true, data: plans, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getPlan(planId: string, ctx?: ProviderContext): Promise<ProviderResult<SubscriptionPlan>> {
    try {
      const res = await jsonRequest<PaystackResponse<PlanData>>({
        url: `${this.baseUrl}/plan/${encodeURIComponent(planId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          planId: data.plan_code ?? planId,
          name: data.name ?? "",
          amountMinor: (data.amount ?? 0) * 100,
          currency: (data.currency ?? "NGN") as any,
          interval: data.interval ?? "",
          description: data.description,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async createSubscription(
    input: { customerCode: string; planId: string; authorization?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<SubscriptionDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<SubscriptionData>>({
        url: `${this.baseUrl}/subscription`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          customer: input.customerCode,
          plan: input.planId,
          authorization: input.authorization,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          subscriptionId: data.subscription_code ?? "",
          customerCode: data.customer?.customer_code ?? input.customerCode,
          planId: data.plan?.plan_code ?? input.planId,
          status: data.status === "active" ? "active" : "pending",
          nextPaymentDate: data.next_payment_date,
          paymentsCount: data.payments_count ?? 0,
          amountMinor: (data.amount ?? 0) * 100,
        },
        providerRef: data.subscription_code,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async listSubscriptions(ctx?: ProviderContext): Promise<ProviderResult<SubscriptionDetails[]>> {
    try {
      const res = await jsonRequest<PaystackResponse<SubscriptionData[]>>({
        url: `${this.baseUrl}/subscription`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const subs = (res.data.data ?? []).map((s) => ({
        subscriptionId: s.subscription_code ?? "",
        customerCode: s.customer?.customer_code ?? "",
        planId: s.plan?.plan_code ?? "",
        status: s.status === "active" ? "active" as const : "pending" as const,
        nextPaymentDate: s.next_payment_date,
        paymentsCount: s.payments_count ?? 0,
        amountMinor: (s.amount ?? 0) * 100,
      }));

      return { ok: true, data: subs, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getSubscription(subscriptionId: string, ctx?: ProviderContext): Promise<ProviderResult<SubscriptionDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<SubscriptionData>>({
        url: `${this.baseUrl}/subscription/${encodeURIComponent(subscriptionId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          subscriptionId: data.subscription_code ?? subscriptionId,
          customerCode: data.customer?.customer_code ?? "",
          planId: data.plan?.plan_code ?? "",
          status: data.status === "active" ? "active" : "pending",
          nextPaymentDate: data.next_payment_date,
          paymentsCount: data.payments_count ?? 0,
          amountMinor: (data.amount ?? 0) * 100,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async enableSubscription(subscriptionId: string, ctx?: ProviderContext): Promise<ProviderResult<{ enabled: boolean }>> {
    try {
      const res = await jsonRequest<PaystackResponse>({
        url: `${this.baseUrl}/subscription/enable`,
        method: "POST",
        headers: this.authHeaders(),
        body: { code: subscriptionId, token: subscriptionId },
      });
      return { ok: true, data: { enabled: true }, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async disableSubscription(subscriptionId: string, ctx?: ProviderContext): Promise<ProviderResult<{ disabled: boolean }>> {
    try {
      const res = await jsonRequest<PaystackResponse>({
        url: `${this.baseUrl}/subscription/disable`,
        method: "POST",
        headers: this.authHeaders(),
        body: { code: subscriptionId, token: subscriptionId },
      });
      return { ok: true, data: { disabled: true }, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}

// ─── Dispute Provider ─────────────────────────────────────────

export class PaystackDisputeProvider {
  readonly name = "paystack";

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async listDisputes(ctx?: ProviderContext): Promise<ProviderResult<DisputeDetails[]>> {
    try {
      const res = await jsonRequest<PaystackResponse<DisputeData[]>>({
        url: `${this.baseUrl}/dispute`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const disputes = (res.data.data ?? []).map((d) => ({
        disputeId: d.dispute_code ?? String(d.id ?? ""),
        transactionRef: d.transaction?.reference ?? "",
        category: d.category ?? "",
        status: (d.status === "resolved" ? "resolved" : d.status === "escalated" ? "escalated" : d.status === "closed" ? "closed" : "pending") as DisputeDetails["status"],
        amountMinor: (d.amount ?? 0) * 100,
        currency: (d.currency ?? "NGN") as Currency,
        comment: d.comment,
        resolution: d.resolution,
        createdAt: d.created_at ?? "",
      }));

      return { ok: true, data: disputes, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getDispute(disputeId: string, ctx?: ProviderContext): Promise<ProviderResult<DisputeDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<DisputeData>>({
        url: `${this.baseUrl}/dispute/${encodeURIComponent(disputeId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const d = res.data.data ?? {};
      return {
        ok: true,
        data: {
          disputeId: d.dispute_code ?? disputeId,
          transactionRef: d.transaction?.reference ?? "",
          category: d.category ?? "",
          status: d.status === "resolved" ? "resolved" : "pending",
          amountMinor: (d.amount ?? 0) * 100,
          currency: (d.currency ?? "NGN") as any,
          comment: d.comment,
          resolution: d.resolution,
          createdAt: d.created_at ?? "",
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async resolveDispute(
    disputeId: string,
    resolution: "accept" | "reject",
    comment?: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ resolved: boolean }>> {
    try {
      const res = await jsonRequest<PaystackResponse>({
        url: `${this.baseUrl}/dispute/${encodeURIComponent(disputeId)}`,
        method: "PUT",
        headers: this.authHeaders(),
        body: { resolution, comment },
      });
      return { ok: true, data: { resolved: true }, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}

// ─── Settlement Provider ──────────────────────────────────────

export class PaystackSettlementProvider {
  readonly name = "paystack";

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async listSettlements(
    filters?: { from?: string; to?: string; status?: string },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<SettlementDetails2[]>> {
    try {
      const params = new URLSearchParams();
      if (filters?.from) params.append("from", filters.from);
      if (filters?.to) params.append("to", filters.to);
      if (filters?.status) params.append("status", filters.status);

      const url = `${this.baseUrl}/settlement${params.toString() ? "?" + params.toString() : ""}`;
      const res = await jsonRequest<PaystackResponse<SettlementData[]>>({
        url,
        method: "GET",
        headers: this.authHeaders(),
      });

      const settlements = (res.data.data ?? []).map((s) => ({
        settlementId: s.settlement_code ?? String(s.id ?? ""),
        status: (s.status === "success" ? "success" : s.status === "failed" ? "failed" : s.status === "processing" ? "processing" : "pending") as SettlementDetails2["status"],
        totalAmount: (s.total_amount ?? 0) * 100,
        netAmount: ((s.total_amount ?? 0) - (s.total_fees ?? 0)) * 100,
        fees: (s.total_fees ?? 0) * 100,
        currency: (s.currency ?? "NGN") as Currency,
        settledAt: s.settlement_date,
        transactionCount: s.total_records ?? 0,
      }));

      return { ok: true, data: settlements, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getSettlement(settlementId: string, ctx?: ProviderContext): Promise<ProviderResult<SettlementDetails2>> {
    try {
      const res = await jsonRequest<PaystackResponse<SettlementData>>({
        url: `${this.baseUrl}/settlement/${encodeURIComponent(settlementId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const s = res.data.data ?? {};
      return {
        ok: true,
        data: {
          settlementId: s.settlement_code ?? settlementId,
          status: (s.status === "success" ? "success" : s.status === "failed" ? "failed" : s.status === "processing" ? "processing" : "pending") as SettlementDetails2["status"],
          totalAmount: (s.total_amount ?? 0) * 100,
          netAmount: ((s.total_amount ?? 0) - (s.total_fees ?? 0)) * 100,
          fees: (s.total_fees ?? 0) * 100,
          currency: (s.currency ?? "NGN") as Currency,
          settledAt: s.settlement_date,
          transactionCount: s.total_records ?? 0,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getSettlementTransactions(
    settlementId: string,
    ctx?: ProviderContext,
  ): Promise<ProviderResult<Array<{ transactionRef: string; amount: number; fee: number; currency: any }>>> {
    try {
      const res = await jsonRequest<PaystackResponse<any[]>>({
        url: `${this.baseUrl}/settlement/${encodeURIComponent(settlementId)}/transactions`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const txns = (res.data.data ?? []).map((t: any) => ({
        transactionRef: t.reference ?? "",
        amount: (t.amount ?? 0) * 100,
        fee: (t.fee ?? 0) * 100,
        currency: t.currency ?? "NGN",
      }));

      return { ok: true, data: txns, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}

// ─── Payment Page Provider ────────────────────────────────────

export class PaystackPaymentPageProvider {
  readonly name = "paystack";

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async createPage(
    input: { name: string; description?: string; amountMinor?: number; currency?: string; collectCustomAmount?: boolean },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<PaymentPageDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<PageData>>({
        url: `${this.baseUrl}/page`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          name: input.name,
          description: input.description,
          amount: input.amountMinor ? input.amountMinor / 100 : undefined,
          currency: input.currency,
          collect_custom_amount: input.collectCustomAmount ?? false,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          pageId: data.page_code ?? String(data.id ?? ""),
          slug: data.slug,
          name: data.name ?? input.name,
          description: data.description,
          amountMinor: data.amount ? data.amount * 100 : undefined,
          currency: data.currency as any,
          collectCustomAmount: data.collect_custom_amount ?? false,
          status: data.active ? "active" : "inactive",
          url: data.url,
        },
        providerRef: data.page_code,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async listPages(ctx?: ProviderContext): Promise<ProviderResult<PaymentPageDetails[]>> {
    try {
      const res = await jsonRequest<PaystackResponse<PageData[]>>({
        url: `${this.baseUrl}/page`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const pages = (res.data.data ?? []).map((p) => ({
        pageId: p.page_code ?? String(p.id ?? ""),
        slug: p.slug,
        name: p.name ?? "",
        description: p.description,
        amountMinor: p.amount ? p.amount * 100 : undefined,
        currency: p.currency as Currency,
        collectCustomAmount: p.collect_custom_amount ?? false,
        status: (p.active ? "active" : "inactive") as PaymentPageDetails["status"],
        url: p.url,
      }));

      return { ok: true, data: pages, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getPage(pageId: string, ctx?: ProviderContext): Promise<ProviderResult<PaymentPageDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<PageData>>({
        url: `${this.baseUrl}/page/${encodeURIComponent(pageId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const p = res.data.data ?? {};
      return {
        ok: true,
        data: {
          pageId: p.page_code ?? pageId,
          slug: p.slug,
          name: p.name ?? "",
          description: p.description,
          amountMinor: p.amount ? p.amount * 100 : undefined,
          currency: p.currency as Currency,
          collectCustomAmount: p.collect_custom_amount ?? false,
          status: (p.active ? "active" : "inactive") as PaymentPageDetails["status"],
          url: p.url,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async updatePage(
    pageId: string,
    input: { name?: string; description?: string; amountMinor?: number; status?: "active" | "inactive" },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<PaymentPageDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<PageData>>({
        url: `${this.baseUrl}/page/${encodeURIComponent(pageId)}`,
        method: "PUT",
        headers: this.authHeaders(),
        body: {
          name: input.name,
          description: input.description,
          amount: input.amountMinor ? input.amountMinor / 100 : undefined,
          active: input.status === "active",
        },
      });

      const p = res.data.data ?? {};
      return {
        ok: true,
        data: {
          pageId: p.page_code ?? pageId,
          slug: p.slug,
          name: p.name ?? input.name ?? "",
          description: p.description,
          amountMinor: p.amount ? p.amount * 100 : undefined,
          currency: p.currency as Currency,
          collectCustomAmount: p.collect_custom_amount ?? false,
          status: (p.active ? "active" : "inactive") as PaymentPageDetails["status"],
          url: p.url,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}

// ─── Split Payment Provider ───────────────────────────────────

export class PaystackSplitPaymentProvider {
  readonly name = "paystack";

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async createSplit(
    input: { name: string; currency: string; splits: SplitConfig[] },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<SplitDetails>> {
    try {
      const subaccounts = input.splits.map((s) => ({
        subaccount: s.subaccountCode,
        share: s.shareType === "percentage" ? s.shareValue : s.shareValue,
        type: s.shareType,
      }));

      const res = await jsonRequest<PaystackResponse<SplitData>>({
        url: `${this.baseUrl}/split`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          name: input.name,
          currency: input.currency,
          subaccounts,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          splitId: data.split_code ?? "",
          name: data.name ?? input.name,
          splits: (data.subaccounts ?? []).map((sa) => ({
            subaccountCode: sa.subaccount_code ?? "",
            shareType: "percentage" as const,
            shareValue: sa.share ?? 0,
          })),
          currency: (data.currency ?? input.currency) as any,
        },
        providerRef: data.split_code,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async listSplits(ctx?: ProviderContext): Promise<ProviderResult<SplitDetails[]>> {
    try {
      const res = await jsonRequest<PaystackResponse<SplitData[]>>({
        url: `${this.baseUrl}/split`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const splits = (res.data.data ?? []).map((s) => ({
        splitId: s.split_code ?? "",
        name: s.name ?? "",
        splits: (s.subaccounts ?? []).map((sa) => ({
          subaccountCode: sa.subaccount_code ?? "",
          shareType: "percentage" as const,
          shareValue: sa.share ?? 0,
        })),
        currency: (s.currency ?? "NGN") as any,
      }));

      return { ok: true, data: splits, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getSplit(splitId: string, ctx?: ProviderContext): Promise<ProviderResult<SplitDetails>> {
    try {
      const res = await jsonRequest<PaystackResponse<SplitData>>({
        url: `${this.baseUrl}/split/${encodeURIComponent(splitId)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const s = res.data.data ?? {};
      return {
        ok: true,
        data: {
          splitId: s.split_code ?? splitId,
          name: s.name ?? "",
          splits: (s.subaccounts ?? []).map((sa) => ({
            subaccountCode: sa.subaccount_code ?? "",
            shareType: "percentage" as const,
            shareValue: sa.share ?? 0,
          })),
          currency: (s.currency ?? "NGN") as any,
        },
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}

// ─── Customer Provider ────────────────────────────────────────

export class PaystackCustomerProvider {
  readonly name = "paystack";

  constructor(private readonly creds: PaystackCredentials) {}

  private get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.creds.secretKey}` };
  }

  async createCustomer(
    input: { email: string; firstName?: string; lastName?: string; phone?: string; metadata?: Record<string, unknown> },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ customerCode: string; email: string }>> {
    try {
      const res = await jsonRequest<PaystackResponse<CustomerData>>({
        url: `${this.baseUrl}/customer`,
        method: "POST",
        headers: this.authHeaders(),
        body: {
          email: input.email,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          metadata: input.metadata,
        },
        idempotencyKey: ctx?.idempotencyKey,
      });

      const data = res.data.data ?? {};
      return {
        ok: true,
        data: {
          customerCode: data.customer_code ?? "",
          email: data.email ?? input.email,
        },
        providerRef: data.customer_code,
        raw: res.data,
      };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async listCustomers(ctx?: ProviderContext): Promise<ProviderResult<Array<{ customerCode: string; email: string; firstName?: string; lastName?: string }>>> {
    try {
      const res = await jsonRequest<PaystackResponse<CustomerData[]>>({
        url: `${this.baseUrl}/customer`,
        method: "GET",
        headers: this.authHeaders(),
      });

      const customers = (res.data.data ?? []).map((c) => ({
        customerCode: c.customer_code ?? "",
        email: c.email ?? "",
        firstName: c.first_name,
        lastName: c.last_name,
      }));

      return { ok: true, data: customers, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async getCustomer(customerCode: string, ctx?: ProviderContext): Promise<ProviderResult<CustomerData>> {
    try {
      const res = await jsonRequest<PaystackResponse<CustomerData>>({
        url: `${this.baseUrl}/customer/${encodeURIComponent(customerCode)}`,
        method: "GET",
        headers: this.authHeaders(),
      });

      return { ok: true, data: res.data.data ?? {}, raw: res.data };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }

  async updateCustomer(
    customerCode: string,
    input: { email?: string; firstName?: string; lastName?: string; phone?: string; metadata?: Record<string, unknown> },
    ctx?: ProviderContext,
  ): Promise<ProviderResult<{ updated: boolean }>> {
    try {
      await jsonRequest({
        url: `${this.baseUrl}/customer/${encodeURIComponent(customerCode)}`,
        method: "PUT",
        headers: this.authHeaders(),
        body: {
          email: input.email,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          metadata: input.metadata,
        },
      });
      return { ok: true, data: { updated: true } };
    } catch (err) {
      return { ok: false, error: toProviderError(err, "PAYSTACK_ERROR") };
    }
  }
}
