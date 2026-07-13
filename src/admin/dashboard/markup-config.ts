// TurboPay Markup Configuration
// Admin sets TurboPay's percentage charge which is added to provider fees
// This is how TurboPay makes money on every transaction

import { ProviderName, PaymentOperation } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface MarkupRule {
  id: string;
  name: string;
  provider?: ProviderName; // null = applies to all providers
  operation?: PaymentOperation; // null = applies to all operations
  country?: string; // null = applies to all countries
  currency?: string; // null = applies to all currencies
  markup_type: 'percentage' | 'flat' | 'hybrid';
  markup_value: number; // percentage (e.g., 0.5 = 0.5%) or flat amount
  flat_amount?: number; // For hybrid: flat fee added on top
  min_amount?: number; // Minimum transaction amount for this rule
  max_amount?: number; // Maximum transaction amount for this rule
  is_active: boolean;
  priority: number; // Higher priority rules override lower ones
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

export interface MarkupCalculation {
  rule_id: string;
  rule_name: string;
  provider_fee: number;
  turbopay_markup: number;
  total_fee: number;
  total_percentage: number;
}

export interface FeeBreakdown {
  provider: ProviderName;
  operation: PaymentOperation;
  amount: number;
  currency: string;
  country: string;
  provider_fee: number;
  provider_fee_percentage: number;
  turbopay_markup: number;
  turbopay_markup_percentage: number;
  total_fee: number;
  total_fee_percentage: number;
  net_amount: number;
  applied_rule: MarkupRule | null;
}

export interface MarkupAnalytics {
  total_transactions: number;
  total_volume: number;
  total_provider_fees: number;
  total_turbopay_markup: number;
  total_revenue: number;
  average_markup_percentage: number;
  revenue_by_provider: Record<ProviderName, number>;
  revenue_by_operation: Record<string, number>;
  revenue_by_country: Record<string, number>;
}

// =============================================================================
// MARKUP CONFIGURATION SERVICE
// =============================================================================

export class MarkupConfigService {
  private rules: Map<string, MarkupRule> = new Map();
  private readonly DEFAULT_MARKUP_PERCENTAGE = 0.5; // 0.5% default TurboPay charge

  constructor() {
    this.initializeDefaultRules();
  }

  // ===========================================================================
  // RULE MANAGEMENT
  // ===========================================================================

  createRule(params: {
    name: string;
    provider?: ProviderName;
    operation?: PaymentOperation;
    country?: string;
    currency?: string;
    markup_type: 'percentage' | 'flat' | 'hybrid';
    markup_value: number;
    flat_amount?: number;
    min_amount?: number;
    max_amount?: number;
    priority?: number;
    created_by: string;
  }): MarkupRule {
    const rule: MarkupRule = {
      id: this.generateId('rule'),
      name: params.name,
      provider: params.provider,
      operation: params.operation,
      country: params.country,
      currency: params.currency,
      markup_type: params.markup_type,
      markup_value: params.markup_value,
      flat_amount: params.flat_amount,
      min_amount: params.min_amount,
      max_amount: params.max_amount,
      is_active: true,
      priority: params.priority || 0,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: params.created_by
    };

    this.rules.set(rule.id, rule);
    return rule;
  }

  updateRule(id: string, updates: Partial<MarkupRule>): MarkupRule | null {
    const rule = this.rules.get(id);
    if (!rule) return null;

    const updatedRule = { ...rule, ...updates, updated_at: new Date() };
    this.rules.set(id, updatedRule);
    return updatedRule;
  }

  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  toggleRule(id: string, active: boolean): MarkupRule | null {
    const rule = this.rules.get(id);
    if (!rule) return null;

    rule.is_active = active;
    rule.updated_at = new Date();
    return rule;
  }

  getRule(id: string): MarkupRule | undefined {
    return this.rules.get(id);
  }

  getAllRules(): MarkupRule[] {
    return Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);
  }

  // ===========================================================================
  // FEE CALCULATION
  // ===========================================================================

  calculateFee(params: {
    provider: ProviderName;
    operation: PaymentOperation;
    amount: number;
    currency: string;
    country: string;
    provider_fee: number;
  }): FeeBreakdown {
    // Find applicable rule
    const applicableRule = this.findApplicableRule(params);

    // Calculate TurboPay markup
    let turbopayMarkup = 0;
    let turbopayMarkupPercentage = 0;

    if (applicableRule) {
      switch (applicableRule.markup_type) {
        case 'percentage':
          turbopayMarkup = (params.amount * applicableRule.markup_value) / 100;
          turbopayMarkupPercentage = applicableRule.markup_value;
          break;
        case 'flat':
          turbopayMarkup = applicableRule.markup_value;
          turbopayMarkupPercentage = (applicableRule.markup_value / params.amount) * 100;
          break;
        case 'hybrid':
          turbopayMarkup = (params.amount * applicableRule.markup_value) / 100 + (applicableRule.flat_amount || 0);
          turbopayMarkupPercentage = (turbopayMarkup / params.amount) * 100;
          break;
      }
    } else {
      // Use default markup
      turbopayMarkup = (params.amount * this.DEFAULT_MARKUP_PERCENTAGE) / 100;
      turbopayMarkupPercentage = this.DEFAULT_MARKUP_PERCENTAGE;
    }

    const totalFee = params.provider_fee + turbopayMarkup;
    const totalFeePercentage = (totalFee / params.amount) * 100;
    const netAmount = params.amount - totalFee;

    return {
      provider: params.provider,
      operation: params.operation,
      amount: params.amount,
      currency: params.currency,
      country: params.country,
      provider_fee: params.provider_fee,
      provider_fee_percentage: (params.provider_fee / params.amount) * 100,
      turbopay_markup: turbopayMarkup,
      turbopay_markup_percentage: turbopayMarkupPercentage,
      total_fee: totalFee,
      total_fee_percentage: totalFeePercentage,
      net_amount: netAmount,
      applied_rule: applicableRule
    };
  }

  private findApplicableRule(params: {
    provider: ProviderName;
    operation: PaymentOperation;
    amount: number;
    currency: string;
    country: string;
  }): MarkupRule | null {
    const activeRules = Array.from(this.rules.values())
      .filter(r => r.is_active)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of activeRules) {
      // Check provider match
      if (rule.provider && rule.provider !== params.provider) continue;

      // Check operation match
      if (rule.operation && rule.operation !== params.operation) continue;

      // Check country match
      if (rule.country && rule.country !== params.country) continue;

      // Check currency match
      if (rule.currency && rule.currency !== params.currency) continue;

      // Check amount range
      if (rule.min_amount && params.amount < rule.min_amount) continue;
      if (rule.max_amount && params.amount > rule.max_amount) continue;

      return rule;
    }

    return null;
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  calculateMarkupAnalytics(transactions: {
    provider: ProviderName;
    operation: string;
    amount: number;
    provider_fee: number;
    turbopay_markup: number;
    country: string;
  }[]): MarkupAnalytics {
    let totalVolume = 0;
    let totalProviderFees = 0;
    let totalTurboPayMarkup = 0;
    const revenueByProvider: Record<string, number> = {};
    const revenueByOperation: Record<string, number> = {};
    const revenueByCountry: Record<string, number> = {};

    for (const txn of transactions) {
      totalVolume += txn.amount;
      totalProviderFees += txn.provider_fee;
      totalTurboPayMarkup += txn.turbopay_markup;

      revenueByProvider[txn.provider] = (revenueByProvider[txn.provider] || 0) + txn.turbopay_markup;
      revenueByOperation[txn.operation] = (revenueByOperation[txn.operation] || 0) + txn.turbopay_markup;
      revenueByCountry[txn.country] = (revenueByCountry[txn.country] || 0) + txn.turbopay_markup;
    }

    return {
      total_transactions: transactions.length,
      total_volume: totalVolume,
      total_provider_fees: totalProviderFees,
      total_turbopay_markup: totalTurboPayMarkup,
      total_revenue: totalTurboPayMarkup,
      average_markup_percentage: totalVolume > 0 ? (totalTurboPayMarkup / totalVolume) * 100 : 0,
      revenue_by_provider: revenueByProvider as Record<ProviderName, number>,
      revenue_by_operation: revenueByOperation,
      revenue_by_country: revenueByCountry
    };
  }

  // ===========================================================================
  // PRESETS
  // ===========================================================================

  private initializeDefaultRules(): void {
    // Default: 0.5% markup on all transactions
    this.createRule({
      name: 'Default Global Markup',
      markup_type: 'percentage',
      markup_value: 0.5,
      priority: 0,
      created_by: 'system'
    });

    // Higher markup for international transactions
    this.createRule({
      name: 'International Transaction Markup',
      operation: 'bank_transfer_payout',
      markup_type: 'percentage',
      markup_value: 1.0,
      priority: 10,
      created_by: 'system'
    });

    // Lower markup for high-volume operations
    this.createRule({
      name: 'Bulk Payment Discount',
      operation: 'bulk_payment',
      markup_type: 'percentage',
      markup_value: 0.3,
      priority: 5,
      created_by: 'system'
    });
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }
}

export default MarkupConfigService;
