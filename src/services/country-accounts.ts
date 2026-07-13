// TurboPay Country-Tailored User Accounts
// User accounts adapted to their country of usage
// Ghana users get GHS default, funding options specific to their country
// Users can add additional currencies alongside their default

import {
  ProviderName
} from '../types';
import { CustomerAuthService, CustomerUser, KYCTier } from '../auth/customer-auth.service';
import { MultiCurrencyService, WalletBalance, FundingMethod, CountryCurrencyConfig } from './multi-currency';
import { LedgerService } from './ledger';
import { AuditLogService } from '../admin/dashboard/audit-log';

// =============================================================================
// TYPES
// =============================================================================

export interface CountryUserAccount {
  user_id: string;
  email: string;
  phone?: string;
  first_name: string;
  last_name: string;
  country: string;
  country_name: string;
  primary_currency: string;
  additional_currencies: string[];
  kyc_tier: KYCTier;
  wallets: WalletBalance[];
  default_funding_methods: FundingMethod[];
  supported_providers: ProviderName[];
  settlement_currency: string;
  created_at: Date;
  last_login: Date | null;
}

export interface CreateUserAccountRequest {
  email: string;
  phone?: string;
  password: string;
  first_name: string;
  last_name: string;
  country: string;
}

export interface AddCurrencyRequest {
  user_id: string;
  currency: string;
}

export interface FundWalletRequest {
  user_id: string;
  currency: string;
  amount: number;
  funding_method_id: string;
  metadata?: Record<string, any>;
}

export interface FundWalletResponse {
  success: boolean;
  transaction_id?: string;
  payment_url?: string;
  instructions?: string;
  amount: number;
  currency: string;
  fee: number;
  provider: ProviderName;
  error?: string;
}

// =============================================================================
// COUNTRY ACCOUNTS SERVICE
// =============================================================================

export class CountryAccountsService {
  private customerAuth: CustomerAuthService;
  private multiCurrency: MultiCurrencyService;
  private ledger: LedgerService;
  private auditLog: AuditLogService;

  constructor(
    customerAuth: CustomerAuthService,
    multiCurrency: MultiCurrencyService,
    ledger: LedgerService,
    auditLog: AuditLogService
  ) {
    this.customerAuth = customerAuth;
    this.multiCurrency = multiCurrency;
    this.ledger = ledger;
    this.auditLog = auditLog;
  }

  // ===========================================================================
  // ACCOUNT CREATION
  // ===========================================================================

  async createAccount(params: CreateUserAccountRequest): Promise<CountryUserAccount> {
    // Get country config
    const countryConfig = this.multiCurrency.getCountryConfig(params.country);
    if (!countryConfig) {
      throw new Error(`Country ${params.country} is not supported`);
    }

    // Register user
    const result = await this.customerAuth.register({
      email: params.email,
      phone: params.phone,
      password: params.password,
      first_name: params.first_name,
      last_name: params.last_name
    });

    if (!result.success || !result.user) {
      throw new Error(result.error || 'Registration failed');
    }

    // Create wallet with primary currency
    this.multiCurrency.creditWallet(result.user.id, countryConfig.primary_currency, 0, 'initial_balance');

    // Build account
    const account: CountryUserAccount = {
      user_id: result.user.id,
      email: result.user.email,
      phone: result.user.phone,
      first_name: result.user.first_name,
      last_name: result.user.last_name,
      country: params.country,
      country_name: countryConfig.country_name,
      primary_currency: countryConfig.primary_currency,
      additional_currencies: [],
      kyc_tier: result.user.kyc_tier,
      wallets: this.multiCurrency.getUserWallets(result.user.id),
      default_funding_methods: countryConfig.default_funding_methods,
      supported_providers: countryConfig.supported_providers,
      settlement_currency: countryConfig.settlement_currency,
      created_at: result.user.created_at,
      last_login: result.user.last_login
    };

    // Audit log
    this.auditLog.log({
      event: 'admin.user.create',
      entity_type: 'customer_account',
      entity_id: result.user.id,
      metadata: {
        country: params.country,
        primary_currency: countryConfig.primary_currency,
        email: params.email
      },
      severity: 'info'
    });

    return account;
  }

  // ===========================================================================
  // ACCOUNT QUERIES
  // ===========================================================================

  getAccount(userId: string): CountryUserAccount | null {
    const user = this.customerAuth.getCustomer(userId);
    if (!user) return null;

    // Find country from user metadata or default to NG
    const country = (user as any).country || 'NG';
    const countryConfig = this.multiCurrency.getCountryConfig(country);

    return {
      user_id: user.id,
      email: user.email,
      phone: user.phone,
      first_name: user.first_name,
      last_name: user.last_name,
      country,
      country_name: countryConfig?.country_name || 'Nigeria',
      primary_currency: countryConfig?.primary_currency || 'NGN',
      additional_currencies: [],
      kyc_tier: user.kyc_tier,
      wallets: this.multiCurrency.getUserWallets(user.id),
      default_funding_methods: countryConfig?.default_funding_methods || [],
      supported_providers: countryConfig?.supported_providers || [],
      settlement_currency: countryConfig?.settlement_currency || 'NGN',
      created_at: user.created_at,
      last_login: user.last_login
    };
  }

  // ===========================================================================
  // CURRENCY MANAGEMENT
  // ===========================================================================

  async addCurrency(params: AddCurrencyRequest): Promise<{ success: boolean; currency: string; message: string }> {
    const user = this.customerAuth.getCustomer(params.user_id);
    if (!user) {
      return { success: false, currency: params.currency, message: 'User not found' };
    }

    // Check if currency is supported
    const currencyInfo = this.multiCurrency.getCurrency(params.currency);
    if (!currencyInfo) {
      return { success: false, currency: params.currency, message: 'Currency not supported' };
    }

    // Check if user's country supports this currency
    const country = (user as any).country || 'NG';
    const countryConfig = this.multiCurrency.getCountryConfig(country);
    if (countryConfig && !countryConfig.supported_currencies.includes(params.currency)) {
      return { success: false, currency: params.currency, message: `Currency ${params.currency} is not available in ${country}` };
    }

    // Create wallet for this currency
    this.multiCurrency.creditWallet(params.user_id, params.currency, 0, 'currency_added');

    // Audit log
    this.auditLog.log({
      event: 'provider.config.update',
      entity_type: 'customer_wallet',
      entity_id: `${params.user_id}_${params.currency}`,
      metadata: { currency: params.currency, action: 'added' },
      severity: 'info'
    });

    return { success: true, currency: params.currency, message: `Currency ${params.currency} added successfully` };
  }

  // ===========================================================================
  // WALLET FUNDING
  // ===========================================================================

  async fundWallet(params: FundWalletRequest): Promise<FundWalletResponse> {
    const user = this.customerAuth.getCustomer(params.user_id);
    if (!user) {
      return { success: false, amount: params.amount, currency: params.currency, fee: 0, provider: 'paystack' as ProviderName, error: 'User not found' };
    }

    // Get country config
    const country = (user as any).country || 'NG';
    const countryConfig = this.multiCurrency.getCountryConfig(country);
    if (!countryConfig) {
      return { success: false, amount: params.amount, currency: params.currency, fee: 0, provider: 'paystack' as ProviderName, error: 'Country not supported' };
    }

    // Find funding method
    const fundingMethod = countryConfig.default_funding_methods.find(m => m.id === params.funding_method_id);
    if (!fundingMethod) {
      return { success: false, amount: params.amount, currency: params.currency, fee: 0, provider: 'paystack' as ProviderName, error: 'Funding method not found' };
    }

    // Validate amount
    if (params.amount < fundingMethod.min_amount) {
      return { success: false, amount: params.amount, currency: params.currency, fee: 0, provider: 'paystack' as ProviderName, error: `Minimum amount is ${fundingMethod.min_amount} ${params.currency}` };
    }

    if (params.amount > fundingMethod.max_amount) {
      return { success: false, amount: params.amount, currency: params.currency, fee: 0, provider: 'paystack' as ProviderName, error: `Maximum amount is ${fundingMethod.max_amount} ${params.currency}` };
    }

    // Calculate fee
    const fee = (params.amount * fundingMethod.fee_percentage / 100) + fundingMethod.fee_flat;
    const totalAmount = params.amount + fee;

    // Get provider for this funding method
    const provider = fundingMethod.provider || countryConfig.supported_providers[0];

    // Create transaction reference
    const reference = `fund_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // In production, this would call the provider's payment initialization
    // For now, simulate the flow
    const paymentUrl = `https://pay.${provider}.com/initialize?reference=${reference}&amount=${totalAmount}&currency=${params.currency}`;

    // Audit log
    this.auditLog.log({
      event: 'transaction.initiated',
      entity_type: 'wallet_funding',
      entity_id: reference,
      metadata: {
        user_id: params.user_id,
        amount: params.amount,
        currency: params.currency,
        fee,
        provider,
        funding_method: params.funding_method_id
      },
      severity: 'info'
    });

    return {
      success: true,
      transaction_id: reference,
      payment_url: paymentUrl,
      instructions: fundingMethod.instructions,
      amount: params.amount,
      currency: params.currency,
      fee,
      provider
    };
  }

  // ===========================================================================
  // CONVERSION
  // ===========================================================================

  async convertCurrency(params: {
    user_id: string;
    from_currency: string;
    to_currency: string;
    amount: number;
  }): Promise<{ success: boolean; conversion?: any; error?: string }> {
    // Check if user has sufficient balance
    const balance = this.multiCurrency.getWalletBalance(params.user_id, params.from_currency);
    if (balance < params.amount) {
      return { success: false, error: 'Insufficient balance' };
    }

    // Get conversion rate
    const conversion = await this.multiCurrency.convertCurrency({
      from_currency: params.from_currency,
      to_currency: params.to_currency,
      amount: params.amount
    });

    if (!conversion) {
      return { success: false, error: 'Conversion not available for this currency pair' };
    }

    // Debit from source wallet
    const debited = this.multiCurrency.debitWallet(
      params.user_id,
      params.from_currency,
      params.amount,
      `convert_${params.from_currency}_to_${params.to_currency}`
    );

    if (!debited) {
      return { success: false, error: 'Failed to debit wallet' };
    }

    // Credit to target wallet
    this.multiCurrency.creditWallet(
      params.user_id,
      params.to_currency,
      conversion.net_amount,
      `convert_${params.from_currency}_to_${params.to_currency}`
    );

    return { success: true, conversion };
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

export default CountryAccountsService;
