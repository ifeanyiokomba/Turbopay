// TurboPay Intelligent Provider Selection Engine
// Automatically selects the best provider based on health, cost, speed, and feature match
// Implements the provider selection formula from the research

import {
  ProviderName,
  ProviderAdapter,
  PaymentOperation,
  ProviderCapabilities
} from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface ScoringWeights {
  health: number;
  latency: number;
  success_rate: number;
  cost: number;
  feature_match: number;
  settlement_speed: number;
}

export interface ProviderScore {
  provider: ProviderName;
  health: number;
  latency: number;
  success_rate: number;
  cost: number;
  feature_match: number;
  settlement_speed: number;
  total_score: number;
}

export interface ProviderHealthData {
  provider: ProviderName;
  is_healthy: boolean;
  success_count: number;
  failure_count: number;
  average_latency: number;
  recent_latencies: number[];
  last_success: Date | null;
  last_failure: Date | null;
  circuit_breaker_open: boolean;
  circuit_breaker_opened_at: Date | null;
}

export interface ProviderFeeData {
  provider: ProviderName;
  collection_fee_percent: number;
  collection_fee_flat: number;
  transfer_fee_flat: number;
  refund_fee: number;
  settlement_speed: 'instant' | 'same_day' | 't1' | 't2' | 't3' | 't7';
}

export interface CountryPreference {
  country: string;
  primary: ProviderName;
  secondary: ProviderName;
  tertiary?: ProviderName;
}

// =============================================================================
// PROVIDER SELECTION ENGINE
// =============================================================================

export class ProviderSelectionEngine {
  private healthData: Map<ProviderName, ProviderHealthData> = new Map();
  private feeData: Map<ProviderName, ProviderFeeData> = new Map();
  private capabilities: Map<ProviderName, ProviderCapabilities> = new Map();
  private weights: ScoringWeights;
  private countryPreferences: CountryPreference[];

  private readonly DEFAULT_WEIGHTS: ScoringWeights = {
    health: 0.20,
    latency: 0.15,
    success_rate: 0.25,
    cost: 0.20,
    feature_match: 0.20,
    settlement_speed: 0.10
  };

  private readonly DEFAULT_COUNTRY_PREFERENCES: CountryPreference[] = [
    { country: 'NG', primary: 'paystack', secondary: 'flutterwave', tertiary: 'monnify' },
    { country: 'GH', primary: 'flutterwave', secondary: 'paystack', tertiary: 'onafriq' },
    { country: 'KE', primary: 'flutterwave', secondary: 'paystack', tertiary: 'quickteller' },
    { country: 'ZA', primary: 'paystack', secondary: 'flutterwave', tertiary: 'onafriq' },
    { country: 'CI', primary: 'flutterwave', secondary: 'paystack', tertiary: 'onafriq' },
  ];

  private readonly DEFAULT_FEES: ProviderFeeData[] = [
    { provider: 'paystack', collection_fee_percent: 1.5, collection_fee_flat: 100, transfer_fee_flat: 50, refund_fee: 0, settlement_speed: 't1' },
    { provider: 'flutterwave', collection_fee_percent: 2.0, collection_fee_flat: 0, transfer_fee_flat: 50, refund_fee: 0, settlement_speed: 't1' },
    { provider: 'monnify', collection_fee_percent: 1.5, collection_fee_flat: 0, transfer_fee_flat: 40, refund_fee: 10, settlement_speed: 'same_day' },
    { provider: 'onafriq', collection_fee_percent: 2.0, collection_fee_flat: 0, transfer_fee_flat: 50, refund_fee: 0, settlement_speed: 't1' },
    { provider: 'remita', collection_fee_percent: 1.5, collection_fee_flat: 100, transfer_fee_flat: 25, refund_fee: 0, settlement_speed: 't1' },
    { provider: 'quickteller', collection_fee_percent: 1.5, collection_fee_flat: 50, transfer_fee_flat: 25, refund_fee: 0, settlement_speed: 't1' },
    // Mobile Money Providers (provisional)
    { provider: 'smartcash', collection_fee_percent: 1.5, collection_fee_flat: 0, transfer_fee_flat: 10, refund_fee: 0, settlement_speed: 'instant' },
    { provider: 'airtel_money', collection_fee_percent: 2.0, collection_fee_flat: 0, transfer_fee_flat: 25, refund_fee: 0, settlement_speed: 'instant' },
    { provider: 'mtn_momo', collection_fee_percent: 1.5, collection_fee_flat: 0, transfer_fee_flat: 15, refund_fee: 0, settlement_speed: 'instant' },
    { provider: 'mpesa', collection_fee_percent: 1.0, collection_fee_flat: 0, transfer_fee_flat: 10, refund_fee: 0, settlement_speed: 'instant' },
    { provider: 'paga', collection_fee_percent: 1.5, collection_fee_flat: 0, transfer_fee_flat: 10, refund_fee: 0, settlement_speed: 'instant' },
  ];

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = { ...this.DEFAULT_WEIGHTS, ...weights };
    this.countryPreferences = [...this.DEFAULT_COUNTRY_PREFERENCES];

    // Initialize default fee data
    for (const fee of this.DEFAULT_FEES) {
      this.feeData.set(fee.provider, fee);
    }
  }

  // ===========================================================================
  // REGISTRATION
  // ===========================================================================

  registerProvider(provider: ProviderName, capabilities: ProviderCapabilities): void {
    this.capabilities.set(provider, capabilities);

    // Initialize health data
    if (!this.healthData.has(provider)) {
      this.healthData.set(provider, {
        provider,
        is_healthy: true,
        success_count: 0,
        failure_count: 0,
        average_latency: 0,
        recent_latencies: [],
        last_success: null,
        last_failure: null,
        circuit_breaker_open: false,
        circuit_breaker_opened_at: null
      });
    }
  }

  // ===========================================================================
  // HEALTH RECORDING
  // ===========================================================================

  recordSuccess(provider: ProviderName, latency: number): void {
    const health = this.getOrCreateHealth(provider);
    health.success_count++;
    health.last_success = new Date();
    health.is_healthy = true;

    // Record latency
    health.recent_latencies.push(latency);
    if (health.recent_latencies.length > 100) {
      health.recent_latencies.shift();
    }
    health.average_latency = health.recent_latencies.reduce((a, b) => a + b, 0) / health.recent_latencies.length;

    // Reset circuit breaker on success
    health.circuit_breaker_open = false;
    health.circuit_breaker_opened_at = null;
  }

  recordFailure(provider: ProviderName): void {
    const health = this.getOrCreateHealth(provider);
    health.failure_count++;
    health.last_failure = new Date();

    // Check failure rate
    const total = health.success_count + health.failure_count;
    if (total >= 5) {
      const failureRate = health.failure_count / total;
      if (failureRate > 0.5) {
        health.is_healthy = false;
      }
    }

    // Circuit breaker logic
    if (health.failure_count >= 5) {
      health.circuit_breaker_open = true;
      health.circuit_breaker_opened_at = new Date();
      health.is_healthy = false;
    }
  }

  // ===========================================================================
  // PROVIDER SELECTION
  // ===========================================================================

  selectBestProvider(
    operation: PaymentOperation,
    country: string = 'NG',
    currency: string = 'NGN',
    amount: number = 1000,
    preferredProvider?: ProviderName
  ): ProviderScore | null {
    // Get all providers with this capability
    const capableProviders = this.getCapableProviders(operation, country, currency);

    if (capableProviders.length === 0) return null;

    // Score each provider
    const scores = capableProviders.map(provider => ({
      provider,
      ...this.calculateScore(provider, operation, country, currency, amount)
    }));

    // Sort by total score (highest first)
    scores.sort((a, b) => b.total_score - a.total_score);

    // Check if preferred provider is in top 3
    if (preferredProvider) {
      const preferredScore = scores.find(s => s.provider === preferredProvider);
      if (preferredScore && preferredScore.total_score >= scores[0].total_score * 0.8) {
        return preferredScore;
      }
    }

    return scores[0];
  }

  getFailoverChain(
    operation: PaymentOperation,
    country: string = 'NG',
    currency: string = 'NGN',
    amount: number = 1000
  ): ProviderScore[] {
    const capableProviders = this.getCapableProviders(operation, country, currency);

    const scores = capableProviders.map(provider => ({
      provider,
      ...this.calculateScore(provider, operation, country, currency, amount)
    }));

    scores.sort((a, b) => b.total_score - a.total_score);
    return scores;
  }

  // ===========================================================================
  // SCORING
  // ===========================================================================

  private calculateScore(
    provider: ProviderName,
    operation: PaymentOperation,
    country: string,
    currency: string,
    amount: number
  ): Omit<ProviderScore, 'provider'> {
    const healthScore = this.calculateHealthScore(provider);
    const latencyScore = this.calculateLatencyScore(provider);
    const successRateScore = this.calculateSuccessRateScore(provider);
    const costScore = this.calculateCostScore(provider, operation, amount);
    const featureMatchScore = this.calculateFeatureMatchScore(provider, operation);
    const settlementSpeedScore = this.calculateSettlementSpeedScore(provider);

    const totalScore =
      healthScore * this.weights.health +
      latencyScore * this.weights.latency +
      successRateScore * this.weights.success_rate +
      costScore * this.weights.cost +
      featureMatchScore * this.weights.feature_match +
      settlementSpeedScore * this.weights.settlement_speed;

    return {
      health: Math.round(healthScore * 100) / 100,
      latency: Math.round(latencyScore * 100) / 100,
      success_rate: Math.round(successRateScore * 100) / 100,
      cost: Math.round(costScore * 100) / 100,
      feature_match: Math.round(featureMatchScore * 100) / 100,
      settlement_speed: Math.round(settlementSpeedScore * 100) / 100,
      total_score: Math.round(totalScore * 1000) / 1000
    };
  }

  private calculateHealthScore(provider: ProviderName): number {
    const health = this.healthData.get(provider);
    if (!health) return 0.5; // Default score for unknown providers

    // Check circuit breaker
    if (health.circuit_breaker_open) {
      const timeSinceOpen = Date.now() - (health.circuit_breaker_opened_at?.getTime() || 0);
      if (timeSinceOpen < 300000) { // 5 minutes cooldown
        return 0;
      }
      // Reset circuit breaker after cooldown
      health.circuit_breaker_open = false;
      health.circuit_breaker_opened_at = null;
    }

    const total = health.success_count + health.failure_count;
    if (total === 0) return 1; // No data, assume healthy

    const successRate = health.success_count / total;
    return Math.min(successRate * 1.2, 1);
  }

  private calculateLatencyScore(provider: ProviderName): number {
    const health = this.healthData.get(provider);
    if (!health || health.recent_latencies.length === 0) return 0.5;

    // Normalize: 0ms = 1.0, 5000ms = 0.0
    const score = 1 - (health.average_latency / 5000);
    return Math.max(0, Math.min(score, 1));
  }

  private calculateSuccessRateScore(provider: ProviderName): number {
    const health = this.healthData.get(provider);
    if (!health) return 0.5;

    const total = health.success_count + health.failure_count;
    if (total === 0) return 1;

    return health.success_count / total;
  }

  private calculateCostScore(provider: ProviderName, operation: PaymentOperation, amount: number): number {
    const fees = this.feeData.get(provider);
    if (!fees) return 0.5;

    // Calculate total fee for this operation
    let fee = 0;

    if (operation.includes('collection')) {
      fee = (amount * fees.collection_fee_percent / 100) + fees.collection_fee_flat;
    } else if (operation.includes('payout') || operation === 'bulk_payment') {
      fee = fees.transfer_fee_flat;
    } else if (operation === 'refund') {
      fee = fees.refund_fee;
    }

    // Compare against other providers
    const allFees = Array.from(this.feeData.values()).map(f => {
      if (operation.includes('collection')) {
        return (amount * f.collection_fee_percent / 100) + f.collection_fee_flat;
      } else if (operation.includes('payout') || operation === 'bulk_payment') {
        return f.transfer_fee_flat;
      }
      return f.refund_fee;
    });

    const minFee = Math.min(...allFees);
    const maxFee = Math.max(...allFees);

    if (maxFee === minFee) return 1;

    // Lower fee = higher score
    return 1 - ((fee - minFee) / (maxFee - minFee));
  }

  private calculateFeatureMatchScore(provider: ProviderName, operation: PaymentOperation): number {
    const caps = this.capabilities.get(provider);
    if (!caps) return 0;

    return this.checkCapability(caps, operation) ? 1 : 0;
  }

  private calculateSettlementSpeedScore(provider: ProviderName): number {
    const fees = this.feeData.get(provider);
    if (!fees) return 0.5;

    const speedScores: Record<string, number> = {
      'instant': 1.0,
      'same_day': 0.9,
      't1': 0.7,
      't2': 0.5,
      't3': 0.3,
      't7': 0.1
    };

    return speedScores[fees.settlement_speed] || 0.5;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private getCapableProviders(
    operation: PaymentOperation,
    country: string,
    currency: string
  ): ProviderName[] {
    const providers: ProviderName[] = [];

    for (const [provider, caps] of this.capabilities) {
      if (!this.checkCapability(caps, operation)) continue;

      // Check country support
      if (caps.countries.length > 0 && !caps.countries.includes(country)) continue;

      // Check currency support
      if (caps.currencies.length > 0 && !caps.currencies.includes(currency)) continue;

      providers.push(provider);
    }

    return providers;
  }

  private checkCapability(caps: ProviderCapabilities, operation: PaymentOperation): boolean {
    switch (operation) {
      case 'card_collection': return caps.collections.card;
      case 'bank_transfer_collection': return caps.collections.bank_transfer;
      case 'ussd_collection': return caps.collections.ussd;
      case 'mobile_money_collection': return caps.collections.mobile_money;
      case 'qr_collection': return caps.collections.qr;
      case 'bank_transfer_payout': return caps.payouts.bank_transfer;
      case 'mobile_money_payout': return caps.payouts.mobile_money;
      case 'bulk_payment': return caps.payouts.bulk;
      case 'virtual_account': return caps.virtual_accounts.dedicated || caps.virtual_accounts.dynamic || caps.virtual_accounts.static;
      case 'bill_payment': return caps.bills.airtime || caps.bills.data || caps.bills.electricity || caps.bills.cable_tv || caps.bills.education;
      case 'airtime': return caps.bills.airtime;
      case 'data': return caps.bills.data;
      case 'electricity': return caps.bills.electricity;
      case 'cable_tv': return caps.bills.cable_tv;
      case 'education': return caps.bills.education;
      case 'refund': return caps.technical.refunds;
      case 'reversal': return caps.technical.reversals;
      case 'papss': return caps.technical.international;
      case 'fx': return caps.technical.multi_currency;
      case 'mobile_money': return caps.collections.mobile_money || caps.payouts.mobile_money;
      case 'merchant_collection': return caps.collections.bank_transfer || caps.collections.card;
      default: return false;
    }
  }

  private getOrCreateHealth(provider: ProviderName): ProviderHealthData {
    if (!this.healthData.has(provider)) {
      this.healthData.set(provider, {
        provider,
        is_healthy: true,
        success_count: 0,
        failure_count: 0,
        average_latency: 0,
        recent_latencies: [],
        last_success: null,
        last_failure: null,
        circuit_breaker_open: false,
        circuit_breaker_opened_at: null
      });
    }
    return this.healthData.get(provider)!;
  }

  // ===========================================================================
  // ACCESSORS
  // ===========================================================================

  getHealthData(provider: ProviderName): ProviderHealthData | undefined {
    return this.healthData.get(provider);
  }

  getAllHealthData(): Map<ProviderName, ProviderHealthData> {
    return this.healthData;
  }

  getFeeData(provider: ProviderName): ProviderFeeData | undefined {
    return this.feeData.get(provider);
  }

  setFeeData(provider: ProviderName, fees: Partial<ProviderFeeData>): void {
    const existing = this.feeData.get(provider) || this.DEFAULT_FEES.find(f => f.provider === provider);
    if (existing) {
      this.feeData.set(provider, { ...existing, ...fees });
    }
  }

  setWeights(weights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  getWeights(): ScoringWeights {
    return { ...this.weights };
  }

  resetHealth(provider: ProviderName): void {
    this.healthData.delete(provider);
  }
}

export default ProviderSelectionEngine;
