// TurboPay Provider Router
// Intelligent routing with failover, circuit breaker, and cost optimization

import {
  ProviderName,
  ProviderAdapter,
  ProviderCapabilities,
  PaymentOperation,
  RouterConfig,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  VirtualAccountRequest,
  VirtualAccountResponse,
  UnifiedBulkTransferResponse,
  CustomerInfo,
  CustomerResponse,
  Bank,
  BankAccountResolution,
  Biller,
  BillerItem,
  BillPaymentRequest,
  UnifiedWebhookEvent,
  ProviderUnavailableError
} from '../types';
import { CapabilityEngine } from './capability-engine';
import { HealthMonitor } from './health-monitor';

// =============================================================================
// FEE STRUCTURE
// =============================================================================

export interface ProviderFeeStructure {
  // Collection fees (percentage)
  collection_fee_percent: number;
  collection_fee_flat: number;  // flat fee in minor units (kobo/cents)
  
  // Transfer fees (percentage)
  transfer_fee_percent: number;
  transfer_fee_flat: number;
  
  // Virtual account fees
  virtual_account_fee: number;
  
  // Bill payment fees
  bill_payment_fee_percent: number;
  bill_payment_fee_flat: number;
  
  // Currency conversion spread (percentage)
  fx_spread: number;
  
  // Minimum fee per transaction
  minimum_fee: number;
  
  // Maximum fee cap
  maximum_fee: number;
}

// Default fee structures for each provider
const DEFAULT_FEES: Record<ProviderName, ProviderFeeStructure> = {
  flutterwave: {
    collection_fee_percent: 1.4,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 10,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 0,
    bill_payment_fee_flat: 0,
    fx_spread: 0.5,
    minimum_fee: 10,
    maximum_fee: 2000
  },
  paystack: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 10,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 0,
    bill_payment_fee_flat: 0,
    fx_spread: 0.5,
    minimum_fee: 10,
    maximum_fee: 2000
  },
  monnify: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 10,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 0,
    bill_payment_fee_flat: 0,
    fx_spread: 0,
    minimum_fee: 10,
    maximum_fee: 2000
  },
  onafriq: {
    collection_fee_percent: 2.0,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.5,
    transfer_fee_flat: 50,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 0,
    fx_spread: 1.0,
    minimum_fee: 50,
    maximum_fee: 5000
  },
  remita: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 100,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 25,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 50,
    fx_spread: 0,
    minimum_fee: 50,
    maximum_fee: 3000
  },
  quickteller: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 50,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 25,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 50,
    fx_spread: 0,
    minimum_fee: 50,
    maximum_fee: 3000
  },
  // Mobile Money Providers (provisional — confirm against provider docs)
  smartcash: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 10,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 0,
    fx_spread: 0,
    minimum_fee: 10,
    maximum_fee: 2000
  },
  airtel_money: {
    collection_fee_percent: 2.0,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.5,
    transfer_fee_flat: 25,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.5,
    bill_payment_fee_flat: 0,
    fx_spread: 0,
    minimum_fee: 25,
    maximum_fee: 3000
  },
  mtn_momo: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 15,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 0,
    fx_spread: 0,
    minimum_fee: 15,
    maximum_fee: 2500
  },
  mpesa: {
    collection_fee_percent: 1.0,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 10,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 0,
    fx_spread: 0,
    minimum_fee: 10,
    maximum_fee: 2000
  },
  paga: {
    collection_fee_percent: 1.5,
    collection_fee_flat: 0,
    transfer_fee_percent: 1.0,
    transfer_fee_flat: 10,
    virtual_account_fee: 0,
    bill_payment_fee_percent: 1.0,
    bill_payment_fee_flat: 0,
    fx_spread: 0,
    minimum_fee: 10,
    maximum_fee: 2000
  }
};

// =============================================================================
// SCORING WEIGHTS
// =============================================================================

export interface ScoringWeights {
  health: number;
  latency: number;
  success_rate: number;
  feature_match: number;
  cost: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  health: 0.20,
  latency: 0.15,
  success_rate: 0.25,
  feature_match: 0.20,
  cost: 0.20
};

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: RouterConfig = {
  health_check_interval: 60000,
  max_retries: 3,
  retry_delay: 1000,
  failover_enabled: true,
  circuit_breaker_threshold: 5,
  circuit_breaker_timeout: 300000,
  default_timeout: 30000
};

// =============================================================================
// PROVIDER ROUTER
// =============================================================================

export class ProviderRouter {
  private providers: Map<ProviderName, ProviderAdapter> = new Map();
  private capabilityEngine: CapabilityEngine;
  private healthMonitor: HealthMonitor;
  private config: RouterConfig;
  private feeStructures: Map<ProviderName, ProviderFeeStructure> = new Map();
  private scoringWeights: ScoringWeights;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.capabilityEngine = new CapabilityEngine();
    this.healthMonitor = new HealthMonitor(this.config);
    this.scoringWeights = { ...DEFAULT_WEIGHTS };
    
    // Initialize default fee structures
    for (const [provider, fees] of Object.entries(DEFAULT_FEES)) {
      this.feeStructures.set(provider as ProviderName, fees);
    }
  }

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  /**
   * Register a provider adapter
   */
  async registerProvider(adapter: ProviderAdapter): Promise<void> {
    try {
      await adapter.authenticate();
      this.providers.set(adapter.name, adapter);
      this.capabilityEngine.register(adapter.name, adapter.getCapabilities());
      console.log(`[Router] Registered provider: ${adapter.name}`);
    } catch (error) {
      console.error(`[Router] Failed to register provider ${adapter.name}:`, error);
    }
  }

  /**
   * Register provider without authentication
   */
  registerProviderSync(adapter: ProviderAdapter): void {
    this.providers.set(adapter.name, adapter);
    this.capabilityEngine.register(adapter.name, adapter.getCapabilities());
    console.log(`[Router] Registered provider (sync): ${adapter.name}`);
  }

  /**
   * Get registered providers
   */
  getRegisteredProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider adapter
   */
  getProvider(name: ProviderName): ProviderAdapter | undefined {
    return this.providers.get(name);
  }

  // ===========================================================================
  // FEE MANAGEMENT
  // ===========================================================================

  /**
   * Set custom fee structure for a provider
   */
  setProviderFees(provider: ProviderName, fees: Partial<ProviderFeeStructure>): void {
    const existingFees = this.feeStructures.get(provider) || DEFAULT_FEES[provider];
    this.feeStructures.set(provider, { ...existingFees, ...fees });
    console.log(`[Router] Updated fees for ${provider}`);
  }

  /**
   * Get fee structure for a provider
   */
  getProviderFees(provider: ProviderName): ProviderFeeStructure {
    return this.feeStructures.get(provider) || DEFAULT_FEES[provider];
  }

  /**
   * Calculate fee for a transaction
   */
  calculateFee(
    provider: ProviderName,
    operation: PaymentOperation,
    amount: number,
    currency: string = 'NGN'
  ): number {
    const fees = this.getProviderFees(provider);
    let fee = 0;

    switch (operation) {
      case 'card_collection':
      case 'bank_transfer_collection':
      case 'ussd_collection':
      case 'mobile_money_collection':
      case 'qr_collection':
        fee = (amount * fees.collection_fee_percent / 100) + fees.collection_fee_flat;
        break;

      case 'bank_transfer_payout':
      case 'mobile_money_payout':
        fee = (amount * fees.transfer_fee_percent / 100) + fees.transfer_fee_flat;
        break;

      case 'bulk_payment':
        fee = (amount * fees.transfer_fee_percent / 100) + fees.transfer_fee_flat;
        break;

      case 'virtual_account':
        fee = fees.virtual_account_fee;
        break;

      case 'bill_payment':
      case 'airtime':
      case 'data':
      case 'electricity':
      case 'cable_tv':
      case 'education':
        fee = (amount * fees.bill_payment_fee_percent / 100) + fees.bill_payment_fee_flat;
        break;

      default:
        fee = fees.collection_fee_flat;
    }

    // Apply minimum and maximum fee caps
    fee = Math.max(fee, fees.minimum_fee);
    fee = Math.min(fee, fees.maximum_fee);

    return Math.round(fee);
  }

  /**
   * Compare fees across providers
   */
  compareFees(
    operation: PaymentOperation,
    amount: number,
    currency: string = 'NGN'
  ): { provider: ProviderName; fee: number; feePercentage: number }[] {
    const providers = this.getRegisteredProviders();
    
    return providers.map(provider => {
      const fee = this.calculateFee(provider, operation, amount, currency);
      const feePercentage = amount > 0 ? (fee / amount) * 100 : 0;
      
      return {
        provider,
        fee,
        feePercentage: Math.round(feePercentage * 100) / 100
      };
    }).sort((a, b) => a.fee - b.fee);
  }

  // ===========================================================================
  // SCORING WEIGHTS
  // ===========================================================================

  /**
   * Set custom scoring weights
   */
  setScoringWeights(weights: Partial<ScoringWeights>): void {
    this.scoringWeights = { ...this.scoringWeights, ...weights };
    
    // Normalize weights to sum to 1
    const total = Object.values(this.scoringWeights).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const key of Object.keys(this.scoringWeights)) {
        (this.scoringWeights as any)[key] /= total;
      }
    }
    
    console.log(`[Router] Updated scoring weights:`, this.scoringWeights);
  }

  /**
   * Get current scoring weights
   */
  getScoringWeights(): ScoringWeights {
    return { ...this.scoringWeights };
  }

  // ===========================================================================
  // PROVIDER SELECTION
  // ===========================================================================

  /**
   * Select best provider for operation
   */
  selectProvider(
    operation: PaymentOperation,
    country: string,
    currency: string,
    preferredProvider?: ProviderName,
    amount?: number
  ): ProviderAdapter {
    // If preferred provider is specified and available, use it
    if (preferredProvider) {
      const provider = this.providers.get(preferredProvider);
      if (provider && this.healthMonitor.isHealthy(preferredProvider)) {
        return provider;
      }
    }

    // Get capable providers
    const capableProviders = this.capabilityEngine.getProvidersWithCapability(
      operation,
      country,
      currency
    );

    // Filter to registered providers
    const registeredProviders = capableProviders.filter(p => this.providers.has(p));

    // Filter by health
    const healthyProviders = registeredProviders.filter(p =>
      this.healthMonitor.isHealthy(p)
    );

    // If no healthy providers, try all capable providers
    const candidates = healthyProviders.length > 0 ? healthyProviders : registeredProviders;

    if (candidates.length === 0) {
      throw new ProviderUnavailableError(
        `No providers available for ${operation} in ${country} with currency ${currency}`
      );
    }

    // Sort by score
    const scoredProviders = candidates.map(p => ({
      provider: p,
      score: this.calculateScore(p, operation, country, currency, amount)
    })).sort((a, b) => b.score - a.score);

    return this.providers.get(scoredProviders[0].provider)!;
  }

  /**
   * Execute operation with failover
   */
  async executeWithFailover<T>(
    operation: PaymentOperation,
    country: string,
    currency: string,
    executor: (adapter: ProviderAdapter) => Promise<T>,
    amount?: number
  ): Promise<T & { provider: ProviderName }> {
    const capableProviders = this.capabilityEngine.getProvidersWithCapability(
      operation,
      country,
      currency
    );

    const registeredProviders = capableProviders.filter(p => this.providers.has(p));
    const healthyProviders = registeredProviders.filter(p =>
      this.healthMonitor.isHealthy(p)
    );

    const candidates = healthyProviders.length > 0 ? healthyProviders : registeredProviders;

    if (candidates.length === 0) {
      throw new ProviderUnavailableError(
        `No providers available for ${operation} in ${country} with currency ${currency}`
      );
    }

    // Sort candidates by score
    const scoredCandidates = candidates.map(p => ({
      provider: p,
      score: this.calculateScore(p, operation, country, currency, amount)
    })).sort((a, b) => b.score - a.score);

    let lastError: Error | null = null;

    for (const { provider: providerName } of scoredCandidates) {
      try {
        const adapter = this.providers.get(providerName)!;
        const startTime = Date.now();
        const result = await executor(adapter);
        const latency = Date.now() - startTime;

        this.healthMonitor.recordSuccess(providerName, latency);
        return { ...result, provider: providerName };
      } catch (error) {
        lastError = error as Error;
        this.healthMonitor.recordFailure(providerName);
        console.error(`[Router] Provider ${providerName} failed:`, error);

        if (!this.config.failover_enabled) {
          throw error;
        }
      }
    }

    throw lastError || new ProviderUnavailableError('All providers failed');
  }

  // ===========================================================================
  // SCORING
  // ===========================================================================

  /**
   * Calculate provider score with cost optimization
   * 
   * Score = (health × w1) + (latency × w2) + (successRate × w3) + (featureMatch × w4) + (costScore × w5)
   * 
   * CostScore: Lower fees = higher score
   *   - 1.0 = cheapest provider
   *   - 0.0 = most expensive provider
   */
  private calculateScore(
    provider: ProviderName,
    operation: PaymentOperation,
    country: string,
    currency: string,
    amount?: number
  ): number {
    const weights = this.scoringWeights;
    
    // Health score (0-1)
    const health = this.healthMonitor.getHealthScore(provider);
    
    // Latency score (0-1, lower latency = higher score)
    const latency = this.healthMonitor.getLatencyScore(provider);
    
    // Success rate (0-1)
    const successRate = this.healthMonitor.getSuccessRate(provider);
    
    // Feature match (0 or 1)
    const featureMatch = this.capabilityEngine.getFeatureMatch(provider, operation);
    
    // Cost score (0-1, lower fees = higher score)
    const costScore = this.calculateCostScore(provider, operation, amount || 1000, currency);

    // Weighted scoring
    const score = (
      health * weights.health +
      latency * weights.latency +
      successRate * weights.success_rate +
      featureMatch * weights.feature_match +
      costScore * weights.cost
    );

    return Math.round(score * 1000) / 1000; // Round to 3 decimal places
  }

  /**
   * Calculate cost score for a provider
   * Lower fees = higher score (inverted)
   */
  private calculateCostScore(
    provider: ProviderName,
    operation: PaymentOperation,
    amount: number,
    currency: string
  ): number {
    // Get fees for all capable providers
    const capableProviders = this.capabilityEngine.getProvidersWithCapability(
      operation,
      currency
    ).filter(p => this.providers.has(p));

    if (capableProviders.length === 0) return 0.5;
    if (capableProviders.length === 1) return 1;

    // Calculate fees for all providers
    const fees = capableProviders.map(p => ({
      provider: p,
      fee: this.calculateFee(p, operation, amount, currency)
    }));

    // Find min and max fees
    const minFee = Math.min(...fees.map(f => f.fee));
    const maxFee = Math.max(...fees.map(f => f.fee));
    const feeRange = maxFee - minFee;

    // If all fees are the same, return 1
    if (feeRange === 0) return 1;

    // Calculate this provider's fee
    const providerFee = this.calculateFee(provider, operation, amount, currency);

    // Invert: lower fee = higher score
    // Score = 1 - ((providerFee - minFee) / feeRange)
    const score = 1 - ((providerFee - minFee) / feeRange);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get detailed scoring breakdown for a provider
   */
  getScoreBreakdown(
    provider: ProviderName,
    operation: PaymentOperation,
    country: string,
    currency: string,
    amount: number = 1000
  ): {
    health: number;
    latency: number;
    successRate: number;
    featureMatch: number;
    costScore: number;
    totalScore: number;
    fee: number;
  } {
    const weights = this.scoringWeights;
    
    const health = this.healthMonitor.getHealthScore(provider);
    const latency = this.healthMonitor.getLatencyScore(provider);
    const successRate = this.healthMonitor.getSuccessRate(provider);
    const featureMatch = this.capabilityEngine.getFeatureMatch(provider, operation);
    const costScore = this.calculateCostScore(provider, operation, amount, currency);
    const fee = this.calculateFee(provider, operation, amount, currency);

    const totalScore = (
      health * weights.health +
      latency * weights.latency +
      successRate * weights.success_rate +
      featureMatch * weights.feature_match +
      costScore * weights.cost
    );

    return {
      health: Math.round(health * 100) / 100,
      latency: Math.round(latency * 100) / 100,
      successRate: Math.round(successRate * 100) / 100,
      featureMatch,
      costScore: Math.round(costScore * 100) / 100,
      totalScore: Math.round(totalScore * 1000) / 1000,
      fee
    };
  }

  // ===========================================================================
  // ACCESSORS
  // ===========================================================================

  /**
   * Get health monitor
   */
  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  /**
   * Get capability engine
   */
  getCapabilityEngine(): CapabilityEngine {
    return this.capabilityEngine;
  }

  /**
   * Get capability summary
   */
  getCapabilitySummary(): Record<PaymentOperation, ProviderName[]> {
    return this.capabilityEngine.getSummary();
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Initialize payment with routing
   */
  async initializePayment(
    request: UnifiedPaymentRequest,
    country: string,
    currency: string
  ): Promise<UnifiedTransactionResponse & { provider: ProviderName }> {
    return this.executeWithFailover(
      'bank_transfer_collection',
      country,
      currency,
      async (adapter) => adapter.initializePayment(request),
      request.amount
    );
  }

  /**
   * Create transfer with routing
   */
  async createTransfer(
    request: UnifiedTransferRequest,
    country: string,
    currency: string
  ): Promise<UnifiedTransferResponse & { provider: ProviderName }> {
    return this.executeWithFailover(
      'bank_transfer_payout',
      country,
      currency,
      async (adapter) => adapter.createTransfer(request),
      request.amount
    );
  }

  /**
   * Create virtual account with routing
   */
  async createVirtualAccount(
    request: VirtualAccountRequest,
    country: string,
    currency: string
  ): Promise<VirtualAccountResponse & { provider: ProviderName }> {
    return this.executeWithFailover(
      'virtual_account',
      country,
      currency,
      async (adapter) => adapter.createVirtualAccount(request),
      request.amount
    );
  }

  /**
   * Pay bill with routing
   */
  async payBill(
    request: BillPaymentRequest,
    country: string,
    currency: string
  ): Promise<UnifiedTransactionResponse & { provider: ProviderName }> {
    return this.executeWithFailover(
      'airtime',
      country,
      currency,
      async (adapter) => adapter.payBill(request),
      request.amount
    );
  }
}

export default ProviderRouter;
