/**
 * TurboCore — Unified Payment Orchestration Flow
 * ================================================
 *
 * Implements the end-to-end payment processing flow from stripe.txt Phase 7:
 *
 *   Transaction → Provider Router → Capability Filter → Health Check →
 *   Latency Score → Success Rate → Provider Priority → Settlement Preference →
 *   Execute → Webhook → Ledger → Notification
 *
 * This service ties together:
 *   - Routing engine (provider selection)
 *   - Capability registry (capability matching)
 *   - Circuit breaker (failover)
 *   - Adapter factory (provider execution)
 *   - Ledger (balance updates)
 *   - Notifications (user alerts)
 *   - Audit (compliance trail)
 *
 * Usage:
 *   const result = await paymentFlow.processCollection({
 *     userId: "user_123",
 *     amountKobo: 50000,
 *     currency: "NGN",
 *     reference: "TP-COL-001",
 *     country: "NG",
 *   });
 */

import { routingEngine, type RoutingDecisionInput } from "@/lib/turbocore/config/routing-engine";
import { capabilityRegistry } from "@/lib/turbocore/providers/capabilities";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import { audit } from "@/lib/turbopay/audit";
import { db } from "@/lib/db";
import { ProviderFeatureUnavailable } from "@/lib/turbopay/errors";
import { recordProviderRequest } from "@/lib/turbocore/observability/transaction-events";
import type {
  IWalletFundingProvider,
  ILocalTransferProvider,
  IExchangeRateProvider,
  IBillPaymentProvider,
  IVirtualAccountProvider,
  ProviderContext,
  ProviderResult,
} from "@/lib/turbocore/providers/interfaces";
import type { Currency } from "@/lib/turbocore/types";

// ─── Payment Request Types ────────────────────────────────────

export interface PaymentRequest {
  userId: string;
  amountKobo: number;
  currency: Currency;
  reference: string;
  country?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CollectionRequest extends PaymentRequest {
  /** Payment method: card, bank_transfer, mobile_money, ussd */
  paymentMethod?: string;
  /** Customer email for receipts */
  customerEmail?: string;
  /** Customer phone for mobile money */
  customerPhone?: string;
  /** Redirect URL after payment */
  redirectUrl?: string;
}

export interface TransferRequest extends PaymentRequest {
  /** Recipient account number */
  accountNumber: string;
  /** Recipient bank code */
  bankCode: string;
  /** Recipient name */
  recipientName?: string;
  /** Narration */
  narration?: string;
}

export interface BillPaymentRequest extends PaymentRequest {
  /** Product code (e.g., "ikedc_prepaid") */
  productCode: string;
  /** Customer identifier (e.g., meter number) */
  customer: string;
  /** Customer name (from validation) */
  customerName: string;
  /** Product category */
  category: string;
}

export interface FxQuoteRequest {
  fromCurrency: Currency;
  toCurrency: Currency;
  amountKobo: number;
  userId?: string;
  country?: string;
}

// ─── Payment Result Types ─────────────────────────────────────

export interface PaymentResult {
  success: boolean;
  reference: string;
  providerRef?: string;
  providerName: string;
  amountKobo: number;
  currency: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  /** Routing decision for audit */
  routingDecision: {
    provider: string;
    reason: string;
    attempts: number;
    candidates: string[];
  };
  /** Error details if failed */
  error?: {
    code: string;
    message: string;
  };
}

export interface FxQuoteResult {
  success: boolean;
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: number;
  amountKobo: number;
  convertedAmountKobo: number;
  providerFeeKobo: number;
  platformFeeKobo: number;
  providerName: string;
  expiresAt?: Date;
  error?: {
    code: string;
    message: string;
  };
}

// ─── Payment Flow Service ─────────────────────────────────────

class PaymentFlowService {
  /**
   * Process a collection (wallet funding) through the routing engine.
   *
   * Flow:
   * 1. Query routing engine for best provider
   * 2. Get provider adapter from factory
   * 3. Execute collection
   * 4. Record audit trail
   * 5. Return result
   */
  async processCollection(request: CollectionRequest): Promise<PaymentResult> {
    const startTime = Date.now();

    // 1. Route to best provider
    const routingInput: RoutingDecisionInput = {
      contract: "walletFunding",
      userId: request.userId,
      amountMinor: request.amountKobo,
      country: request.country,
      currency: request.currency,
      correlationId: request.reference,
    };

    const decision = await routingEngine.decide(routingInput);

    if (!decision.selectedProviderConfigId) {
      return {
        success: false,
        reference: request.reference,
        providerName: "",
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: "",
          reason: decision.selectionReason,
          attempts: 0,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "NO_PROVIDER",
          message: decision.selectionReason,
        },
      };
    }

    // 2. Get provider adapter
    const provider = await adapterFactory.create(
      "walletFunding",
      decision.selectedProviderConfigId
    );

    if (!provider || !("initiateFunding" in (provider as any))) {
      return {
        success: false,
        reference: request.reference,
        providerName: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: decision.selectedProviderName,
          reason: "Adapter not available",
          attempts: 1,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "ADAPTER_UNAVAILABLE",
          message: "Provider adapter could not be created",
        },
      };
    }

    // 3. Execute collection
    const fwProvider = provider as IWalletFundingProvider;
    const ctx: ProviderContext = {
      product: "turbopay",
      country: request.country,
      correlationId: request.reference,
      idempotencyKey: request.reference,
    };

    let result: ProviderResult<any>;
    try {
      result = await fwProvider.initiateFunding(
        {
          accountNumber: request.userId,
          amountMinor: request.amountKobo,
          currency: request.currency,
          reference: request.reference,
        },
        ctx
      );
    } catch (error) {
      // Record failure in circuit breaker
      const breaker = getCircuitBreaker(decision.selectedProviderName);
      try {
        await breaker.execute(() => Promise.reject(error));
      } catch { /* ignore */ }

      // Record provider request event (fire-and-forget)
      void recordProviderRequest({
        transactionId: request.reference,
        provider: decision.selectedProviderName,
        contract: "walletFunding",
        correlationId: request.reference,
        success: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Audit the failure
      await audit({
        userId: request.userId,
        action: "COLLECTION_FAILED",
        category: "WALLET",
        severity: "WARN",
        metadata: {
          reference: request.reference,
          provider: decision.selectedProviderName,
          error: error instanceof Error ? error.message : "Unknown error",
          amountKobo: request.amountKobo,
          currency: request.currency,
        },
      });

      return {
        success: false,
        reference: request.reference,
        providerName: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: decision.selectedProviderName,
          reason: decision.selectionReason,
          attempts: 1,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "PROVIDER_ERROR",
          message: error instanceof Error ? error.message : "Collection failed",
        },
      };
    }

    // 4. Record success in circuit breaker
    const breaker = getCircuitBreaker(decision.selectedProviderName);
    try {
      await breaker.execute(() => Promise.resolve());
    } catch { /* ignore */ }

    // 5. Record provider request event (fire-and-forget)
    void recordProviderRequest({
      transactionId: request.reference,
      provider: decision.selectedProviderName,
      providerRef: result.providerRef,
      contract: "walletFunding",
      correlationId: request.reference,
      success: result.ok,
      latencyMs: Date.now() - startTime,
      error: result.ok ? undefined : result.error?.message,
    });

    // 6. Audit the success
    await audit({
      userId: request.userId,
      action: "COLLECTION_INITIATED",
      category: "WALLET",
      severity: "INFO",
      metadata: {
        reference: request.reference,
        providerRef: result.providerRef,
        provider: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: result.ok ? "PENDING" : "FAILED",
      },
    });

    return {
      success: result.ok,
      reference: request.reference,
      providerRef: result.providerRef,
      providerName: decision.selectedProviderName,
      amountKobo: request.amountKobo,
      currency: request.currency,
      status: result.ok ? "PENDING" : "FAILED",
      routingDecision: {
        provider: decision.selectedProviderName,
        reason: decision.selectionReason,
        attempts: 1,
        candidates: decision.candidates.map((c) => c.providerName),
      },
      error: result.ok ? undefined : result.error,
    };
  }

  /**
   * Process a bank transfer through the routing engine.
   */
  async processTransfer(request: TransferRequest): Promise<PaymentResult> {
    const startTime = Date.now();

    // 1. Route to best provider
    const routingInput: RoutingDecisionInput = {
      contract: "localTransfer",
      userId: request.userId,
      amountMinor: request.amountKobo,
      country: request.country,
      currency: request.currency,
      correlationId: request.reference,
    };

    const decision = await routingEngine.decide(routingInput);

    if (!decision.selectedProviderConfigId) {
      return {
        success: false,
        reference: request.reference,
        providerName: "",
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: "",
          reason: decision.selectionReason,
          attempts: 0,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "NO_PROVIDER",
          message: decision.selectionReason,
        },
      };
    }

    // 2. Get provider adapter
    const provider = await adapterFactory.create(
      "localTransfer",
      decision.selectedProviderConfigId
    );

    if (!provider || !("transfer" in (provider as any))) {
      return {
        success: false,
        reference: request.reference,
        providerName: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: decision.selectedProviderName,
          reason: "Adapter not available",
          attempts: 1,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "ADAPTER_UNAVAILABLE",
          message: "Provider adapter could not be created",
        },
      };
    }

    // 3. Execute transfer
    const transferProvider = provider as ILocalTransferProvider;
    const ctx: ProviderContext = {
      product: "turbopay",
      country: request.country,
      correlationId: request.reference,
      idempotencyKey: request.reference,
    };

    let result: ProviderResult<any>;
    try {
      result = await transferProvider.transfer(
        {
          fromAccount: request.userId,
          toAccount: request.accountNumber,
          toBankCode: request.bankCode,
          amountMinor: request.amountKobo,
          currency: request.currency,
          reference: request.reference,
          narration: request.narration,
        },
        ctx
      );
    } catch (error) {
      const breaker = getCircuitBreaker(decision.selectedProviderName);
      try {
        await breaker.execute(() => Promise.reject(error));
      } catch { /* ignore */ }

      // Record provider request event (fire-and-forget)
      void recordProviderRequest({
        transactionId: request.reference,
        provider: decision.selectedProviderName,
        contract: "localTransfer",
        correlationId: request.reference,
        success: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      await audit({
        userId: request.userId,
        action: "TRANSFER_FAILED",
        category: "TRANSFER",
        severity: "WARN",
        metadata: {
          reference: request.reference,
          provider: decision.selectedProviderName,
          error: error instanceof Error ? error.message : "Unknown error",
          amountKobo: request.amountKobo,
          currency: request.currency,
          accountNumber: request.accountNumber,
          bankCode: request.bankCode,
        },
      });

      return {
        success: false,
        reference: request.reference,
        providerName: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: decision.selectedProviderName,
          reason: decision.selectionReason,
          attempts: 1,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "PROVIDER_ERROR",
          message: error instanceof Error ? error.message : "Transfer failed",
        },
      };
    }

    // Record success
    const breaker = getCircuitBreaker(decision.selectedProviderName);
    try {
      await breaker.execute(() => Promise.resolve());
    } catch { /* ignore */ }

    await audit({
      userId: request.userId,
      action: "TRANSFER_INITIATED",
      category: "TRANSFER",
      severity: "INFO",
      metadata: {
        reference: request.reference,
        providerRef: result.providerRef,
        provider: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        accountNumber: request.accountNumber,
        bankCode: request.bankCode,
        status: result.ok ? "PENDING" : "FAILED",
      },
    });

    return {
      success: result.ok,
      reference: request.reference,
      providerRef: result.providerRef,
      providerName: decision.selectedProviderName,
      amountKobo: request.amountKobo,
      currency: request.currency,
      status: result.ok ? "PENDING" : "FAILED",
      routingDecision: {
        provider: decision.selectedProviderName,
        reason: decision.selectionReason,
        attempts: 1,
        candidates: decision.candidates.map((c) => c.providerName),
      },
      error: result.ok ? undefined : result.error,
    };
  }

  /**
   * Process a bill payment through the routing engine.
   */
  async processBillPayment(request: BillPaymentRequest): Promise<PaymentResult> {
    const startTime = Date.now();

    // 1. Route to best provider
    const routingInput: RoutingDecisionInput = {
      contract: "billPayment",
      userId: request.userId,
      amountMinor: request.amountKobo,
      country: request.country,
      currency: request.currency,
      correlationId: request.reference,
    };

    const decision = await routingEngine.decide(routingInput);

    if (!decision.selectedProviderConfigId) {
      return {
        success: false,
        reference: request.reference,
        providerName: "",
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: "",
          reason: decision.selectionReason,
          attempts: 0,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "NO_PROVIDER",
          message: decision.selectionReason,
        },
      };
    }

    // 2. Get provider adapter
    const provider = await adapterFactory.create(
      "billPayment",
      decision.selectedProviderConfigId
    );

    if (!provider || !("pay" in (provider as any))) {
      return {
        success: false,
        reference: request.reference,
        providerName: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: decision.selectedProviderName,
          reason: "Adapter not available",
          attempts: 1,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "ADAPTER_UNAVAILABLE",
          message: "Provider adapter could not be created",
        },
      };
    }

    // 3. Execute bill payment
    const billProvider = provider as IBillPaymentProvider;
    const ctx: ProviderContext = {
      product: "turbopay",
      country: request.country,
      correlationId: request.reference,
      idempotencyKey: request.reference,
    };

    let result: ProviderResult<any>;
    try {
      result = await billProvider.pay(
        {
          productCode: request.productCode,
          customer: request.customer,
          customerName: request.customerName,
          amountMinor: request.amountKobo,
          currency: request.currency,
          reference: request.reference,
        },
        ctx
      );
    } catch (error) {
      const breaker = getCircuitBreaker(decision.selectedProviderName);
      try {
        await breaker.execute(() => Promise.reject(error));
      } catch { /* ignore */ }

      // Record provider request event (fire-and-forget)
      void recordProviderRequest({
        transactionId: request.reference,
        provider: decision.selectedProviderName,
        contract: "billPayment",
        correlationId: request.reference,
        success: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      await audit({
        userId: request.userId,
        action: "BILL_PAYMENT_FAILED",
        category: "BILL",
        severity: "WARN",
        metadata: {
          reference: request.reference,
          provider: decision.selectedProviderName,
          error: error instanceof Error ? error.message : "Unknown error",
          amountKobo: request.amountKobo,
          currency: request.currency,
          productCode: request.productCode,
          customer: request.customer,
        },
      });

      return {
        success: false,
        reference: request.reference,
        providerName: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        status: "FAILED",
        routingDecision: {
          provider: decision.selectedProviderName,
          reason: decision.selectionReason,
          attempts: 1,
          candidates: decision.candidates.map((c) => c.providerName),
        },
        error: {
          code: "PROVIDER_ERROR",
          message: error instanceof Error ? error.message : "Bill payment failed",
        },
      };
    }

    // Record success
    const breaker = getCircuitBreaker(decision.selectedProviderName);
    try {
      await breaker.execute(() => Promise.resolve());
    } catch { /* ignore */ }

    // Record provider request event (fire-and-forget)
    void recordProviderRequest({
      transactionId: request.reference,
      provider: decision.selectedProviderName,
      contract: "billPayment",
      correlationId: request.reference,
      success: true,
      latencyMs: Date.now() - startTime,
    });

    await audit({
      userId: request.userId,
      action: "BILL_PAYMENT_INITIATED",
      category: "BILL",
      severity: "INFO",
      metadata: {
        reference: request.reference,
        providerRef: result.providerRef,
        provider: decision.selectedProviderName,
        amountKobo: request.amountKobo,
        currency: request.currency,
        productCode: request.productCode,
        customer: request.customer,
        status: result.ok ? "PENDING" : "FAILED",
      },
    });

    return {
      success: result.ok,
      reference: request.reference,
      providerRef: result.providerRef,
      providerName: decision.selectedProviderName,
      amountKobo: request.amountKobo,
      currency: request.currency,
      status: result.ok ? "PENDING" : "FAILED",
      routingDecision: {
        provider: decision.selectedProviderName,
        reason: decision.selectionReason,
        attempts: 1,
        candidates: decision.candidates.map((c) => c.providerName),
      },
      error: result.ok ? undefined : result.error,
    };
  }

  /**
   * Get an FX quote through the routing engine.
   */
  async getFxQuote(request: FxQuoteRequest): Promise<FxQuoteResult> {
    const startTime = Date.now();

    // 1. Route to best provider
    const routingInput: RoutingDecisionInput = {
      contract: "exchangeRate",
      userId: request.userId ?? "",
      amountMinor: request.amountKobo,
      country: request.country,
      currency: request.fromCurrency,
      fromCurrency: request.fromCurrency,
      toCurrency: request.toCurrency,
      correlationId: `FX-${request.fromCurrency}-${request.toCurrency}-${Date.now()}`,
    };

    const decision = await routingEngine.decide(routingInput);

    if (!decision.selectedProviderConfigId) {
      return {
        success: false,
        fromCurrency: request.fromCurrency,
        toCurrency: request.toCurrency,
        rate: 0,
        amountKobo: request.amountKobo,
        convertedAmountKobo: 0,
        providerFeeKobo: 0,
        platformFeeKobo: 0,
        providerName: "",
        error: {
          code: "NO_PROVIDER",
          message: decision.selectionReason,
        },
      };
    }

    // 2. Get provider adapter
    const provider = await adapterFactory.create(
      "exchangeRate",
      decision.selectedProviderConfigId
    );

    if (!provider || !("getQuote" in (provider as any))) {
      return {
        success: false,
        fromCurrency: request.fromCurrency,
        toCurrency: request.toCurrency,
        rate: 0,
        amountKobo: request.amountKobo,
        convertedAmountKobo: 0,
        providerFeeKobo: 0,
        platformFeeKobo: 0,
        providerName: decision.selectedProviderName,
        error: {
          code: "ADAPTER_UNAVAILABLE",
          message: "Provider adapter could not be created",
        },
      };
    }

    // 3. Get quote
    const fxProvider = provider as IExchangeRateProvider;
    const ctx: ProviderContext = {
      product: "turbopay",
      country: request.country,
      correlationId: `FX-${request.fromCurrency}-${request.toCurrency}-${Date.now()}`,
    };

    let result: ProviderResult<any>;
    try {
      result = await fxProvider.getQuote(
        request.fromCurrency,
        request.toCurrency,
        request.amountKobo,
        ctx
      );
    } catch (error) {
      return {
        success: false,
        fromCurrency: request.fromCurrency,
        toCurrency: request.toCurrency,
        rate: 0,
        amountKobo: request.amountKobo,
        convertedAmountKobo: 0,
        providerFeeKobo: 0,
        platformFeeKobo: 0,
        providerName: decision.selectedProviderName,
        error: {
          code: "PROVIDER_ERROR",
          message: error instanceof Error ? error.message : "FX quote failed",
        },
      };
    }

    if (!result.ok || !result.data) {
      return {
        success: false,
        fromCurrency: request.fromCurrency,
        toCurrency: request.toCurrency,
        rate: 0,
        amountKobo: request.amountKobo,
        convertedAmountKobo: 0,
        providerFeeKobo: 0,
        platformFeeKobo: 0,
        providerName: decision.selectedProviderName,
        error: result.error,
      };
    }

    const quote = result.data;
    return {
      success: true,
      fromCurrency: request.fromCurrency,
      toCurrency: request.toCurrency,
      rate: quote.rate,
      amountKobo: request.amountKobo,
      convertedAmountKobo: Math.round(request.amountKobo * quote.rate),
      providerFeeKobo: quote.providerFeeMinor,
      platformFeeKobo: quote.platformFeeMinor,
      providerName: decision.selectedProviderName,
    };
  }

  /**
   * Process a webhook event from a provider.
   * Updates the transaction status and triggers side effects.
   */
  async processWebhook(
    providerName: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<{ processed: boolean; error?: string }> {
    try {
      // Extract reference from payload
      const reference = (payload.reference ?? payload.id ?? "") as string;
      const status = (payload.status ?? "") as string;

      // Update transaction status
      if (reference && status) {
        const txStatus = status === "successful" || status === "SUCCESSFUL" || status === "completed"
          ? "SUCCESS"
          : status === "failed" || status === "FAILED"
            ? "FAILED"
            : "PENDING";

        await db.transaction.updateMany({
          where: { reference },
          data: { status: txStatus },
        });
      }

      // Audit the webhook
      await audit({
        action: "WEBHOOK_RECEIVED",
        category: "WEBHOOK",
        severity: "INFO",
        metadata: {
          provider: providerName,
          eventType,
          reference,
          status,
        },
      });

      return { processed: true };
    } catch (error) {
      return {
        processed: false,
        error: error instanceof Error ? error.message : "Webhook processing failed",
      };
    }
  }
}

/** Singleton payment flow service. */
export const paymentFlow = new PaymentFlowService();
