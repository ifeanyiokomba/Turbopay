// TurboPay Core Transaction Processing Service
// Orchestrates provider selection engine with adapters for all payment operations
// Single entry point for all transaction processing with intelligent routing and failover

import {
  ProviderName,
  ProviderAdapter,
  PaymentOperation,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  VirtualAccountRequest,
  VirtualAccountResponse,
  BillPaymentRequest,
  BulkPaymentFile,
  BulkPaymentItem,
  UnifiedBulkTransferResponse,
  ProviderUnavailableError,
  ProviderFeatureUnavailableError
} from '../types';
import { ProviderSelectionEngine, ProviderScore } from './provider-selection-engine';
import { ProviderRegistry, ProviderWrapper } from './provider-wrapper';
import { LedgerService } from './ledger';
import { AnalyticsDashboard, TransactionRecord } from '../admin/dashboard/analytics-dashboard';
import { AuditLogService } from '../admin/dashboard/audit-log';
import { WebhookHandler } from './webhook-handler';

// =============================================================================
// TYPES
// =============================================================================

export interface TransactionConfig {
  max_retries: number;
  retry_delay_ms: number;
  enable_failover: boolean;
  enable_analytics: boolean;
  enable_audit_log: boolean;
  default_country: string;
  default_currency: string;
}

export interface TransactionContext {
  id: string;
  operation: PaymentOperation;
  country: string;
  currency: string;
  amount: number;
  started_at: Date;
  metadata?: Record<string, any>;
}

export interface TransactionResult<T> {
  success: boolean;
  data?: T;
  provider: ProviderName;
  attempts: number;
  total_latency_ms: number;
  failover_chain: ProviderName[];
  error?: string;
}

export interface ProcessPaymentRequest {
  request: UnifiedPaymentRequest;
  country?: string;
  currency?: string;
  preferred_provider?: ProviderName;
}

export interface ProcessTransferRequest {
  request: UnifiedTransferRequest;
  country?: string;
  currency?: string;
  preferred_provider?: ProviderName;
}

export interface ProcessBillPaymentRequest {
  request: BillPaymentRequest;
  country?: string;
  currency?: string;
  preferred_provider?: ProviderName;
}

// =============================================================================
// TRANSACTION PROCESSOR
// =============================================================================

export class TransactionProcessor {
  private selectionEngine: ProviderSelectionEngine;
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private analytics: AnalyticsDashboard;
  private auditLog: AuditLogService;
  private webhookHandler: WebhookHandler;
  private config: TransactionConfig;

  private readonly DEFAULT_CONFIG: TransactionConfig = {
    max_retries: 3,
    retry_delay_ms: 1000,
    enable_failover: true,
    enable_analytics: true,
    enable_audit_log: true,
    default_country: 'NG',
    default_currency: 'NGN'
  };

  constructor(
    selectionEngine: ProviderSelectionEngine,
    registry: ProviderRegistry,
    ledger: LedgerService,
    analytics: AnalyticsDashboard,
    auditLog: AuditLogService,
    webhookHandler: WebhookHandler,
    config?: Partial<TransactionConfig>
  ) {
    this.selectionEngine = selectionEngine;
    this.registry = registry;
    this.ledger = ledger;
    this.analytics = analytics;
    this.auditLog = auditLog;
    this.webhookHandler = webhookHandler;
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // PAYMENT PROCESSING
  // ===========================================================================

  async processPayment(params: ProcessPaymentRequest): Promise<TransactionResult<UnifiedTransactionResponse>> {
    const country = params.country || this.config.default_country;
    const currency = params.currency || this.config.default_currency;
    const amount = params.request.amount;

    return this.executeWithFailover<UnifiedTransactionResponse>(
      'card_collection',
      country,
      currency,
      amount,
      params.preferred_provider,
      async (adapter) => adapter.initializePayment(params.request),
      `payment_${params.request.reference}`
    );
  }

  async verifyPayment(reference: string, provider?: ProviderName): Promise<TransactionResult<UnifiedTransactionResponse>> {
    if (provider) {
      const wrapper = this.getProviderWrapper(provider);
      const startTime = Date.now();
      try {
        const result = await wrapper.verifyPayment(reference);
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(provider, latency);
        return {
          success: true,
          data: result,
          provider,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [provider]
        };
      } catch (error) {
        this.selectionEngine.recordFailure(provider);
        return {
          success: false,
          provider,
          attempts: 1,
          total_latency_ms: Date.now() - startTime,
          failover_chain: [provider],
          error: (error as Error).message
        };
      }
    }

    // Try all providers
    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      const startTime = Date.now();
      try {
        const result = await wrapper.verifyPayment(reference);
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(wrapper.name, latency);
        return {
          success: true,
          data: result,
          provider: wrapper.name,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [wrapper.name]
        };
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
      }
    }

    return {
      success: false,
      provider: providers[0]?.name || 'unknown',
      attempts: providers.length,
      total_latency_ms: 0,
      failover_chain: providers.map(p => p.name),
      error: 'No provider could verify the payment'
    };
  }

  // ===========================================================================
  // TRANSFER PROCESSING
  // ===========================================================================

  async processTransfer(params: ProcessTransferRequest): Promise<TransactionResult<UnifiedTransferResponse>> {
    const country = params.country || this.config.default_country;
    const currency = params.currency || this.config.default_currency;
    const amount = params.request.amount;

    return this.executeWithFailover<UnifiedTransferResponse>(
      'bank_transfer_payout',
      country,
      currency,
      amount,
      params.preferred_provider,
      async (adapter) => adapter.createTransfer(params.request),
      `transfer_${params.request.reference}`
    );
  }

  async processBulkTransfers(
    transfers: UnifiedTransferRequest[],
    country?: string,
    currency?: string,
    preferred_provider?: ProviderName
  ): Promise<TransactionResult<UnifiedBulkTransferResponse>> {
    const countryParam = country || this.config.default_country;
    const currencyParam = currency || this.config.default_currency;
    const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);

    return this.executeWithFailover<UnifiedBulkTransferResponse>(
      'bulk_payment',
      countryParam,
      currencyParam,
      totalAmount,
      preferred_provider,
      async (adapter) => adapter.createBulkTransfers(transfers),
      `bulk_${Date.now()}`
    );
  }

  // ===========================================================================
  // VIRTUAL ACCOUNT PROCESSING
  // ===========================================================================

  async processVirtualAccount(params: {
    request: VirtualAccountRequest;
    country?: string;
    currency?: string;
    preferred_provider?: ProviderName;
  }): Promise<TransactionResult<VirtualAccountResponse>> {
    const country = params.country || this.config.default_country;
    const currency = params.currency || this.config.default_currency;
    const amount = params.request.amount;

    return this.executeWithFailover<VirtualAccountResponse>(
      'virtual_account',
      country,
      currency,
      amount,
      params.preferred_provider,
      async (adapter) => adapter.createVirtualAccount(params.request),
      `va_${params.request.reference}`
    );
  }

  // ===========================================================================
  // BILL PAYMENT PROCESSING
  // ===========================================================================

  async processBillPayment(params: ProcessBillPaymentRequest): Promise<TransactionResult<UnifiedTransactionResponse>> {
    const country = params.country || this.config.default_country;
    const currency = params.currency || this.config.default_currency;
    const amount = params.request.amount;

    return this.executeWithFailover<UnifiedTransactionResponse>(
      'bill_payment',
      country,
      currency,
      amount,
      params.preferred_provider,
      async (adapter) => adapter.payBill(params.request),
      `bill_${params.request.customer_reference}`
    );
  }

  // ===========================================================================
  // REFUND PROCESSING
  // ===========================================================================

  async processRefund(params: {
    transaction_id: string;
    amount?: number;
    reason?: string;
    country?: string;
    currency?: string;
    preferred_provider?: ProviderName;
  }): Promise<TransactionResult<UnifiedTransactionResponse>> {
    const country = params.country || this.config.default_country;
    const currency = params.currency || this.config.default_currency;

    return this.executeWithFailover<UnifiedTransactionResponse>(
      'refund',
      country,
      currency,
      params.amount || 0,
      params.preferred_provider,
      async (adapter) => {
        if (!adapter.refund) {
          throw new ProviderFeatureUnavailableError(adapter.name, 'refund');
        }
        return adapter.refund(params.transaction_id, params.amount, params.reason);
      },
      `refund_${params.transaction_id}`
    );
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async getExchangeRate(params: {
    from_currency: string;
    to_currency: string;
    amount: number;
    preferred_provider?: ProviderName;
  }): Promise<TransactionResult<any>> {
    const country = this.config.default_country;

    return this.executeWithFailover<any>(
      'fx',
      country,
      params.from_currency,
      params.amount,
      params.preferred_provider,
      async (adapter) => {
        if (!adapter.exchangeRate) {
          throw new ProviderFeatureUnavailableError(adapter.name, 'exchange_rate');
        }
        return adapter.exchangeRate(params.from_currency, params.to_currency, params.amount);
      },
      `fx_${Date.now()}`
    );
  }

  // ===========================================================================
  // BANK OPERATIONS
  // ===========================================================================

  async listBanks(country?: string, provider?: ProviderName): Promise<TransactionResult<any[]>> {
    if (provider) {
      const wrapper = this.getProviderWrapper(provider);
      const startTime = Date.now();
      try {
        const result = await wrapper.listBanks(country);
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(provider, latency);
        return {
          success: true,
          data: result,
          provider,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [provider]
        };
      } catch (error) {
        this.selectionEngine.recordFailure(provider);
        return {
          success: false,
          provider,
          attempts: 1,
          total_latency_ms: Date.now() - startTime,
          failover_chain: [provider],
          error: (error as Error).message
        };
      }
    }

    // Try first available provider
    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      const startTime = Date.now();
      try {
        const result = await wrapper.listBanks(country);
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(wrapper.name, latency);
        return {
          success: true,
          data: result,
          provider: wrapper.name,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [wrapper.name]
        };
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
      }
    }

    return {
      success: false,
      provider: providers[0]?.name || 'unknown',
      attempts: providers.length,
      total_latency_ms: 0,
      failover_chain: providers.map(p => p.name),
      error: 'No provider could list banks'
    };
  }

  async resolveBank(code: string, account_number: string, provider?: ProviderName): Promise<TransactionResult<any>> {
    if (provider) {
      const wrapper = this.getProviderWrapper(provider);
      const startTime = Date.now();
      try {
        const result = await wrapper.resolveBank(code, account_number);
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(provider, latency);
        return {
          success: true,
          data: result,
          provider,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [provider]
        };
      } catch (error) {
        this.selectionEngine.recordFailure(provider);
        return {
          success: false,
          provider,
          attempts: 1,
          total_latency_ms: Date.now() - startTime,
          failover_chain: [provider],
          error: (error as Error).message
        };
      }
    }

    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      const startTime = Date.now();
      try {
        const result = await wrapper.resolveBank(code, account_number);
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(wrapper.name, latency);
        return {
          success: true,
          data: result,
          provider: wrapper.name,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [wrapper.name]
        };
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
      }
    }

    return {
      success: false,
      provider: providers[0]?.name || 'unknown',
      attempts: providers.length,
      total_latency_ms: 0,
      failover_chain: providers.map(p => p.name),
      error: 'No provider could resolve bank account'
    };
  }

  // ===========================================================================
  // BILLER OPERATIONS
  // ===========================================================================

  async listBillers(provider?: ProviderName): Promise<TransactionResult<any[]>> {
    if (provider) {
      const wrapper = this.getProviderWrapper(provider);
      const startTime = Date.now();
      try {
        const result = await wrapper.listBillers();
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(provider, latency);
        return {
          success: true,
          data: result,
          provider,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [provider]
        };
      } catch (error) {
        this.selectionEngine.recordFailure(provider);
        return {
          success: false,
          provider,
          attempts: 1,
          total_latency_ms: Date.now() - startTime,
          failover_chain: [provider],
          error: (error as Error).message
        };
      }
    }

    // Collect billers from all providers
    const allBillers: any[] = [];
    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      const startTime = Date.now();
      try {
        const billers = await wrapper.listBillers();
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(wrapper.name, latency);
        allBillers.push(...billers.map(b => ({ ...b, source_provider: wrapper.name })));
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
      }
    }

    return {
      success: allBillers.length > 0,
      data: allBillers,
      provider: providers[0]?.name || 'unknown',
      attempts: providers.length,
      total_latency_ms: 0,
      failover_chain: providers.map(p => p.name),
      error: allBillers.length === 0 ? 'No billers found from any provider' : undefined
    };
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck(provider?: ProviderName): Promise<TransactionResult<any>> {
    if (provider) {
      const wrapper = this.getProviderWrapper(provider);
      const startTime = Date.now();
      try {
        const result = await wrapper.healthCheck();
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(provider, latency);
        return {
          success: true,
          data: result,
          provider,
          attempts: 1,
          total_latency_ms: latency,
          failover_chain: [provider]
        };
      } catch (error) {
        this.selectionEngine.recordFailure(provider);
        return {
          success: false,
          provider,
          attempts: 1,
          total_latency_ms: Date.now() - startTime,
          failover_chain: [provider],
          error: (error as Error).message
        };
      }
    }

    // Check all providers
    const results: any[] = [];
    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      const startTime = Date.now();
      try {
        const result = await wrapper.healthCheck();
        const latency = Date.now() - startTime;
        this.selectionEngine.recordSuccess(wrapper.name, latency);
        results.push({ ...result, provider_name: wrapper.name });
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
        results.push({ provider: wrapper.name, is_healthy: false });
      }
    }

    return {
      success: true,
      data: results,
      provider: providers[0]?.name || 'unknown',
      attempts: providers.length,
      total_latency_ms: 0,
      failover_chain: providers.map(p => p.name)
    };
  }

  // ===========================================================================
  // WEBHOOK PROCESSING
  // ===========================================================================

  async processWebhook(
    provider: ProviderName,
    payload: any,
    headers: Record<string, string> = {}
  ): Promise<TransactionResult<any>> {
    const startTime = Date.now();

    try {
      const result = await this.webhookHandler.handleWebhook(provider, payload, headers);
      const latency = Date.now() - startTime;

      // Record analytics
      if (this.config.enable_analytics) {
        this.analytics.recordTransaction({
          id: `webhook_${Date.now()}`,
          provider,
          operation: 'bill_payment' as PaymentOperation,
          amount: 0,
          currency: 'NGN',
          fee: 0,
          status: result.success ? 'success' : 'failed',
          country: this.config.default_country,
          created_at: new Date(),
          latency_ms: latency
        });
      }

      // Record audit
      if (this.config.enable_audit_log) {
        this.auditLog.log({
          event: result.success ? 'webhook.processed' : 'webhook.failed',
          entity_type: 'webhook',
          entity_id: `${provider}_${Date.now()}`,
          metadata: { provider, event: result.event, success: result.success },
          severity: result.success ? 'info' : 'error'
        });
      }

      return {
        success: result.success,
        data: result,
        provider,
        attempts: 1,
        total_latency_ms: latency,
        failover_chain: [provider]
      };
    } catch (error) {
      return {
        success: false,
        provider,
        attempts: 1,
        total_latency_ms: Date.now() - startTime,
        failover_chain: [provider],
        error: (error as Error).message
      };
    }
  }

  // ===========================================================================
  // CORE EXECUTION WITH FAILOVER
  // ===========================================================================

  private async executeWithFailover<T>(
    operation: PaymentOperation,
    country: string,
    currency: string,
    amount: number,
    preferredProvider: ProviderName | undefined,
    executor: (adapter: ProviderWrapper) => Promise<T>,
    transactionId: string
  ): Promise<TransactionResult<T>> {
    const startTime = Date.now();
    const failoverChain: ProviderName[] = [];

    // Get failover chain from selection engine
    const scoredProviders = this.selectionEngine.getFailoverChain(operation, country, currency, amount);

    // If preferred provider is specified and capable, try it first
    let orderedProviders: ProviderScore[];
    if (preferredProvider) {
      const preferredScore = scoredProviders.find(p => p.provider === preferredProvider);
      const otherProviders = scoredProviders.filter(p => p.provider !== preferredProvider);
      orderedProviders = preferredScore ? [preferredScore, ...otherProviders] : scoredProviders;
    } else {
      orderedProviders = scoredProviders;
    }

    let lastError: string | undefined;

    for (const score of orderedProviders) {
      const wrapper = this.registry.get(score.provider);
      if (!wrapper) continue;

      failoverChain.push(score.provider);

      // Record analytics - transaction initiated
      if (this.config.enable_analytics) {
        this.analytics.recordTransaction({
          id: transactionId,
          provider: score.provider,
          operation,
          amount,
          currency,
          fee: 0,
          status: 'pending',
          country,
          created_at: new Date()
        });
      }

      // Execute with retries
      for (let attempt = 0; attempt <= this.config.max_retries; attempt++) {
        const attemptStart = Date.now();
        try {
          const result = await executor(wrapper);
          const latency = Date.now() - attemptStart;

          // Record success
          this.selectionEngine.recordSuccess(score.provider, latency);

          // Record analytics - transaction success
          if (this.config.enable_analytics) {
            this.analytics.updateTransactionStatus(transactionId, 'success', 0, latency);
          }

          // Record audit
          if (this.config.enable_audit_log) {
            this.auditLog.log({
              event: 'transaction.success',
              entity_type: 'transaction',
              entity_id: transactionId,
              metadata: {
                provider: score.provider,
                operation,
                amount,
                currency,
                latency_ms: latency,
                attempts: attempt + 1
              },
              severity: 'info'
            });
          }

          return {
            success: true,
            data: result,
            provider: score.provider,
            attempts: attempt + 1,
            total_latency_ms: Date.now() - startTime,
            failover_chain: failoverChain
          };
        } catch (error) {
          const latency = Date.now() - attemptStart;
          lastError = (error as Error).message;

          // Check if this is a feature unavailable error - don't retry or failover for this
          if (error instanceof ProviderFeatureUnavailableError) {
            this.selectionEngine.recordFailure(score.provider);
            break; // Move to next provider
          }

          // Record failure
          this.selectionEngine.recordFailure(score.provider);

          // Retry logic
          if (attempt < this.config.max_retries) {
            await this.delay(this.config.retry_delay_ms * Math.pow(2, attempt));
            continue;
          }
        }
      }

      // If failover is disabled, stop here
      if (!this.config.enable_failover) break;
    }

    // All providers failed
    if (this.config.enable_analytics) {
      this.analytics.updateTransactionStatus(transactionId, 'failed', 0, Date.now() - startTime, lastError);
    }

    if (this.config.enable_audit_log) {
      this.auditLog.log({
        event: 'transaction.failed',
        entity_type: 'transaction',
        entity_id: transactionId,
        metadata: {
          operation,
          amount,
          currency,
          error: lastError,
          providers_attempted: failoverChain
        },
        severity: 'error'
      });
    }

    return {
      success: false,
      provider: failoverChain[0] || 'unknown',
      attempts: failoverChain.length * (this.config.max_retries + 1),
      total_latency_ms: Date.now() - startTime,
      failover_chain: failoverChain,
      error: lastError || 'All providers failed'
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private getProviderWrapper(provider: ProviderName): ProviderWrapper {
    const wrapper = this.registry.get(provider);
    if (!wrapper) {
      throw new ProviderUnavailableError(`Provider '${provider}' is not registered`);
    }
    return wrapper;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  updateConfig(config: Partial<TransactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TransactionConfig {
    return { ...this.config };
  }
}

export default TransactionProcessor;
