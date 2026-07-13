// TurboPay Multi-Currency Service
// Manages multiple currencies, conversions, and country-specific currency offerings
// Uses Flutterwave (30+ currencies), Onafriq (43 countries), Paystack (8 currencies)

import {
  ProviderName,
  ExchangeRateResponse
} from '../types';
import { ProviderRegistry } from './provider-wrapper';
import { ProviderSelectionEngine } from './provider-selection-engine';
import { LedgerService } from './ledger';
import { AuditLogService } from '../admin/dashboard/audit-log';

// =============================================================================
// TYPES
// =============================================================================

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  country: string;
  is_primary: boolean;
  is_supported: boolean;
  supported_providers: ProviderName[];
}

export interface CountryCurrencyConfig {
  country: string;
  country_name: string;
  primary_currency: string;
  supported_currencies: string[];
  default_funding_methods: FundingMethod[];
  supported_providers: ProviderName[];
  settlement_currency: string;
}

export interface FundingMethod {
  id: string;
  name: string;
  type: 'bank_transfer' | 'mobile_money' | 'card' | 'ussd' | 'cash' | 'wallet';
  currency: string;
  min_amount: number;
  max_amount: number;
  fee_percentage: number;
  fee_flat: number;
  processing_time: string;
  is_active: boolean;
  provider?: ProviderName;
  instructions?: string;
}

export interface CurrencyConversion {
  from_currency: string;
  to_currency: string;
  amount: number;
  rate: number;
  converted_amount: number;
  fee: number;
  net_amount: number;
  provider: ProviderName;
  timestamp: Date;
}

export interface WalletBalance {
  currency: string;
  balance: number;
  available_balance: number;
  held_balance: number;
  equivalent_in_primary: number;
  primary_currency_rate: number;
}

// =============================================================================
// MULTI-CURRENCY SERVICE
// =============================================================================

export class MultiCurrencyService {
  private registry: ProviderRegistry;
  private selectionEngine: ProviderSelectionEngine;
  private ledger: LedgerService;
  private auditLog: AuditLogService;

  private currencies: Map<string, CurrencyInfo> = new Map();
  private countryConfigs: Map<string, CountryCurrencyConfig> = new Map();
  private userWallets: Map<string, Map<string, number>> = new Map(); // userId -> currency -> balance

  // Supported currencies (verified from research)
  private readonly CURRENCY_DATA: CurrencyInfo[] = [
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimal_places: 2, country: 'NG', is_primary: true, is_supported: true, supported_providers: ['paystack', 'flutterwave', 'monnify', 'remita', 'quickteller'] },
    { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', decimal_places: 2, country: 'GH', is_primary: true, is_supported: true, supported_providers: ['paystack', 'flutterwave', 'onafriq'] },
    { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimal_places: 2, country: 'KE', is_primary: true, is_supported: true, supported_providers: ['paystack', 'flutterwave', 'onafriq', 'quickteller'] },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimal_places: 2, country: 'ZA', is_primary: true, is_supported: true, supported_providers: ['paystack', 'flutterwave', 'onafriq'] },
    { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimal_places: 0, country: 'UG', is_primary: true, is_supported: true, supported_providers: ['flutterwave', 'onafriq'] },
    { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', decimal_places: 2, country: 'TZ', is_primary: true, is_supported: true, supported_providers: ['flutterwave', 'onafriq'] },
    { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimal_places: 0, country: 'RW', is_primary: true, is_supported: true, supported_providers: ['flutterwave', 'onafriq'] },
    { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', decimal_places: 2, country: 'ET', is_primary: true, is_supported: true, supported_providers: ['flutterwave', 'onafriq'] },
    { code: 'XOF', name: 'CFA Franc BCEAO', symbol: 'CFA', decimal_places: 0, country: 'CI', is_primary: true, is_supported: true, supported_providers: ['paystack', 'flutterwave', 'onafriq'] },
    { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2, country: 'US', is_primary: false, is_supported: true, supported_providers: ['paystack', 'flutterwave', 'monnify', 'onafriq'] },
    { code: 'EUR', name: 'Euro', symbol: '€', decimal_places: 2, country: 'EU', is_primary: false, is_supported: true, supported_providers: ['flutterwave'] },
    { code: 'GBP', name: 'British Pound', symbol: '£', decimal_places: 2, country: 'GB', is_primary: false, is_supported: true, supported_providers: ['flutterwave'] },
  ];

  // Country configurations (verified from research)
  private readonly COUNTRY_CONFIGS: CountryCurrencyConfig[] = [
    {
      country: 'NG', country_name: 'Nigeria', primary_currency: 'NGN',
      supported_currencies: ['NGN', 'USD'],
      default_funding_methods: [
        { id: 'ng_bank_transfer', name: 'Bank Transfer', type: 'bank_transfer', currency: 'NGN', min_amount: 100, max_amount: 50000000, fee_percentage: 0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Transfer to your designated bank account' },
        { id: 'ng_card', name: 'Debit Card', type: 'card', currency: 'NGN', min_amount: 100, max_amount: 50000000, fee_percentage: 1.5, fee_flat: 100, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Pay with your Verve, Visa, or Mastercard' },
        { id: 'ng_ussd', name: 'USSD', type: 'ussd', currency: 'NGN', min_amount: 100, max_amount: 500000, fee_percentage: 1.5, fee_flat: 100, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Dial the USSD code on your phone' },
      ],
      supported_providers: ['paystack', 'flutterwave', 'monnify', 'remita', 'quickteller'],
      settlement_currency: 'NGN'
    },
    {
      country: 'GH', country_name: 'Ghana', primary_currency: 'GHS',
      supported_currencies: ['GHS', 'USD'],
      default_funding_methods: [
        { id: 'gh_bank_transfer', name: 'Bank Transfer', type: 'bank_transfer', currency: 'GHS', min_amount: 1, max_amount: 100000, fee_percentage: 0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'flutterwave', instructions: 'Transfer to your Flutterwave bank account' },
        { id: 'gh_mobile_money', name: 'Mobile Money (MTN/MoMo)', type: 'mobile_money', currency: 'GHS', min_amount: 1, max_amount: 50000, fee_percentage: 1.0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'flutterwave', instructions: 'Pay with MTN Mobile Money' },
        { id: 'gh_card', name: 'Debit Card', type: 'card', currency: 'GHS', min_amount: 1, max_amount: 100000, fee_percentage: 2.0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Pay with your Visa or Mastercard' },
      ],
      supported_providers: ['paystack', 'flutterwave', 'onafriq'],
      settlement_currency: 'GHS'
    },
    {
      country: 'KE', country_name: 'Kenya', primary_currency: 'KES',
      supported_currencies: ['KES', 'USD'],
      default_funding_methods: [
        { id: 'ke_mpesa', name: 'M-Pesa', type: 'mobile_money', currency: 'KES', min_amount: 10, max_amount: 500000, fee_percentage: 1.0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'flutterwave', instructions: 'Pay with M-Pesa' },
        { id: 'ke_bank_transfer', name: 'Bank Transfer', type: 'bank_transfer', currency: 'KES', min_amount: 100, max_amount: 10000000, fee_percentage: 0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'flutterwave', instructions: 'Transfer to your bank account' },
        { id: 'ke_card', name: 'Debit Card', type: 'card', currency: 'KES', min_amount: 100, max_amount: 10000000, fee_percentage: 2.0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Pay with your Visa or Mastercard' },
      ],
      supported_providers: ['paystack', 'flutterwave', 'onafriq', 'quickteller'],
      settlement_currency: 'KES'
    },
    {
      country: 'ZA', country_name: 'South Africa', primary_currency: 'ZAR',
      supported_currencies: ['ZAR', 'USD'],
      default_funding_methods: [
        { id: 'za_bank_transfer', name: 'Bank Transfer (EFT)', type: 'bank_transfer', currency: 'ZAR', min_amount: 10, max_amount: 10000000, fee_percentage: 0, fee_flat: 0, processing_time: '1-2 days', is_active: true, provider: 'paystack', instructions: 'Make an EFT to your bank account' },
        { id: 'za_card', name: 'Debit/Credit Card', type: 'card', currency: 'ZAR', min_amount: 10, max_amount: 10000000, fee_percentage: 2.5, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Pay with your Visa or Mastercard' },
        { id: 'za_capitec', name: 'Capitec Pay', type: 'bank_transfer', currency: 'ZAR', min_amount: 10, max_amount: 10000000, fee_percentage: 0, fee_flat: 0, processing_time: 'Instant', is_active: true, provider: 'paystack', instructions: 'Pay instantly with Capitec Pay' },
      ],
      supported_providers: ['paystack', 'flutterwave', 'onafriq'],
      settlement_currency: 'ZAR'
    },
  ];

  constructor(
    registry: ProviderRegistry,
    selectionEngine: ProviderSelectionEngine,
    ledger: LedgerService,
    auditLog: AuditLogService
  ) {
    this.registry = registry;
    this.selectionEngine = selectionEngine;
    this.ledger = ledger;
    this.auditLog = auditLog;

    // Initialize currencies
    for (const currency of this.CURRENCY_DATA) {
      this.currencies.set(currency.code, currency);
    }

    // Initialize country configs
    for (const config of this.COUNTRY_CONFIGS) {
      this.countryConfigs.set(config.country, config);
    }
  }

  // ===========================================================================
  // CURRENCY QUERIES
  // ===========================================================================

  getCurrency(code: string): CurrencyInfo | undefined {
    return this.currencies.get(code);
  }

  getAllCurrencies(): CurrencyInfo[] {
    return Array.from(this.currencies.values());
  }

  getSupportedCurrencies(country?: string): CurrencyInfo[] {
    let currencies = Array.from(this.currencies.values()).filter(c => c.is_supported);
    if (country) {
      const countryConfig = this.countryConfigs.get(country);
      if (countryConfig) {
        currencies = currencies.filter(c => countryConfig.supported_currencies.includes(c.code));
      }
    }
    return currencies;
  }

  // ===========================================================================
  // COUNTRY CONFIGURATION
  // ===========================================================================

  getCountryConfig(country: string): CountryCurrencyConfig | undefined {
    return this.countryConfigs.get(country);
  }

  getAllCountryConfigs(): CountryCurrencyConfig[] {
    return Array.from(this.countryConfigs.values());
  }

  getFundingMethods(country: string, currency?: string): FundingMethod[] {
    const config = this.countryConfigs.get(country);
    if (!config) return [];

    let methods = config.default_funding_methods.filter(m => m.is_active);
    if (currency) {
      methods = methods.filter(m => m.currency === currency);
    }
    return methods;
  }

  // ===========================================================================
  // CURRENCY CONVERSION
  // ===========================================================================

  async convertCurrency(params: {
    from_currency: string;
    to_currency: string;
    amount: number;
    preferred_provider?: ProviderName;
  }): Promise<CurrencyConversion | null> {
    if (params.from_currency === params.to_currency) {
      return {
        from_currency: params.from_currency,
        to_currency: params.to_currency,
        amount: params.amount,
        rate: 1,
        converted_amount: params.amount,
        fee: 0,
        net_amount: params.amount,
        provider: params.preferred_provider || 'paystack',
        timestamp: new Date()
      };
    }

    // Get exchange rate from providers
    const providers = params.preferred_provider
      ? [params.preferred_provider]
      : ['flutterwave', 'paystack', 'onafriq'] as ProviderName[];

    for (const provider of providers) {
      const wrapper = this.registry.get(provider);
      if (!wrapper) continue;

      try {
        if (wrapper.exchangeRate) {
          const rate = await wrapper.exchangeRate(params.from_currency, params.to_currency, params.amount);
          const fee = params.amount * 0.005; // 0.5% conversion fee
          const netAmount = rate.converted_amount - fee;

          return {
            from_currency: params.from_currency,
            to_currency: params.to_currency,
            amount: params.amount,
            rate: rate.rate,
            converted_amount: rate.converted_amount,
            fee,
            net_amount: netAmount,
            provider,
            timestamp: new Date()
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async compareRates(params: {
    from_currency: string;
    to_currency: string;
    amount: number;
  }): Promise<CurrencyConversion[]> {
    const conversions: CurrencyConversion[] = [];
    const providers = ['flutterwave', 'paystack', 'onafriq'] as ProviderName[];

    for (const provider of providers) {
      const conversion = await this.convertCurrency({
        ...params,
        preferred_provider: provider
      });
      if (conversion) {
        conversions.push(conversion);
      }
    }

    // Sort by best rate
    conversions.sort((a, b) => b.converted_amount - a.converted_amount);

    return conversions;
  }

  // ===========================================================================
  // WALLET MANAGEMENT
  // ===========================================================================

  getWalletBalance(userId: string, currency: string): number {
    const userWallets = this.userWallets.get(userId);
    return userWallets?.get(currency) || 0;
  }

  getUserWallets(userId: string): WalletBalance[] {
    const userWallets = this.userWallets.get(userId);
    if (!userWallets) return [];

    return Array.from(userWallets.entries()).map(([currency, balance]) => ({
      currency,
      balance,
      available_balance: balance,
      held_balance: 0,
      equivalent_in_primary: balance, // Would need FX rate
      primary_currency_rate: 1
    }));
  }

  creditWallet(userId: string, currency: string, amount: number, reference: string): void {
    if (!this.userWallets.has(userId)) {
      this.userWallets.set(userId, new Map());
    }

    const userWallets = this.userWallets.get(userId)!;
    const currentBalance = userWallets.get(currency) || 0;
    userWallets.set(currency, currentBalance + amount);

    // Record in ledger
    this.ledger.credit(
      userId,
      amount,
      currency,
      reference,
      undefined,
      `Wallet credit - ${currency}`
    );

    // Audit log
    this.auditLog.log({
      event: 'ledger.credit',
      entity_type: 'wallet',
      entity_id: `${userId}_${currency}`,
      metadata: { amount, currency, reference },
      severity: 'info'
    });
  }

  debitWallet(userId: string, currency: string, amount: number, reference: string): boolean {
    const userWallets = this.userWallets.get(userId);
    if (!userWallets) return false;

    const currentBalance = userWallets.get(currency) || 0;
    if (currentBalance < amount) return false;

    userWallets.set(currency, currentBalance - amount);

    // Record in ledger
    this.ledger.debit(
      userId,
      amount,
      currency,
      reference,
      undefined,
      `Wallet debit - ${currency}`
    );

    // Audit log
    this.auditLog.log({
      event: 'ledger.debit',
      entity_type: 'wallet',
      entity_id: `${userId}_${currency}`,
      metadata: { amount, currency, reference },
      severity: 'info'
    });

    return true;
  }

  // ===========================================================================
  // CURRENCY MANAGEMENT
  // ===========================================================================

  async addCurrency(params: { user_id: string; currency: string }): Promise<{ success: boolean; currency: string; message: string }> {
    // Check if currency is supported
    const currencyInfo = this.currencies.get(params.currency);
    if (!currencyInfo) {
      return { success: false, currency: params.currency, message: 'Currency not supported' };
    }

    // Create wallet for this currency
    this.creditWallet(params.user_id, params.currency, 0, 'currency_added');

    return { success: true, currency: params.currency, message: `Currency ${params.currency} added successfully` };
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

export default MultiCurrencyService;
