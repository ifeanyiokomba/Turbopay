// TurboPay Mobile Money Orchestration Service
// Unified interface for all mobile money providers (MTN MoMo, Airtel Money, M-Pesa, Paga)
// Handles collections, disbursements, transfers, airtime, data, bill payments
// Uses provider intelligence layer for routing and failover

import {
  ProviderName,
  ProviderAdapter,
  PaymentOperation,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  BillPaymentRequest,
  ProviderUnavailableError,
  ProviderFeatureUnavailableError
} from '../types';
import { ProviderSelectionEngine, ProviderScore } from './provider-selection-engine';
import { ProviderRegistry, ProviderWrapper } from './provider-wrapper';
import { LedgerService } from './ledger';
import { WebhookHandler } from './webhook-handler';

// =============================================================================
// TYPES
// =============================================================================

export type MobileMoneyOperation =
  | 'collection'
  | 'disbursement'
  | 'wallet_transfer'
  | 'merchant_payment'
  | 'airtime'
  | 'data'
  | 'bill_payment'
  | 'transaction_status'
  | 'balance_inquiry'
  | 'refund';

export interface MobileMoneyCountry {
  code: string;
  name: string;
  currencies: string[];
  providers: ProviderName[];
  supported_operations: MobileMoneyOperation[];
}

export interface MobileMoneyProviderConfig {
  provider: ProviderName;
  countries: string[];
  credentials: Record<string, string>;
  enabled: boolean;
}

export interface CollectionRequest {
  amount: number;
  currency: string;
  phone_number: string;
  country_code: string;
  network: string;
  reference: string;
  description?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
  preferred_provider?: ProviderName;
}

export interface DisbursementRequest {
  amount: number;
  currency: string;
  phone_number: string;
  country_code: string;
  network: string;
  reference: string;
  narration?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
  preferred_provider?: ProviderName;
}

export interface WalletTransferRequest {
  amount: number;
  currency: string;
  source_phone: string;
  destination_phone: string;
  country_code: string;
  network: string;
  reference: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface MerchantPaymentRequest {
  amount: number;
  currency: string;
  phone_number: string;
  country_code: string;
  network: string;
  merchant_id: string;
  reference: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface AirtimeDataRequest {
  amount: number;
  currency: string;
  phone_number: string;
  country_code: string;
  network: string;
  product_code: string;
  reference: string;
  metadata?: Record<string, any>;
}

export interface BalanceInquiryRequest {
  phone_number: string;
  country_code: string;
  network: string;
  reference: string;
  metadata?: Record<string, any>;
}

export interface MobileMoneyResult {
  success: boolean;
  data?: any;
  provider: ProviderName;
  operation: MobileMoneyOperation;
  reference: string;
  attempts: number;
  failover_chain: ProviderName[];
  error?: string;
  requires_webhook?: boolean;
  pending_reference?: string;
}

// =============================================================================
// MOBILE MONEY ORCHESTRATION SERVICE
// =============================================================================

export class MobileMoneyOrchestrator {
  private selectionEngine: ProviderSelectionEngine;
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private webhookHandler: WebhookHandler;

  // Country-specific provider mappings
  private readonly COUNTRY_PROVIDERS: MobileMoneyCountry[] = [
    {
      code: 'NG',
      name: 'Nigeria',
      currencies: ['NGN'],
      providers: ['paystack', 'flutterwave', 'monnify'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'airtime', 'data', 'bill_payment', 'transaction_status', 'balance_inquiry', 'refund']
    },
    {
      code: 'GH',
      name: 'Ghana',
      currencies: ['GHS'],
      providers: ['flutterwave', 'onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry', 'refund']
    },
    {
      code: 'KE',
      name: 'Kenya',
      currencies: ['KES'],
      providers: ['flutterwave', 'onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry', 'refund']
    },
    {
      code: 'TZ',
      name: 'Tanzania',
      currencies: ['TZS'],
      providers: ['onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry']
    },
    {
      code: 'UG',
      name: 'Uganda',
      currencies: ['UGX'],
      providers: ['onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry']
    },
    {
      code: 'ZA',
      name: 'South Africa',
      currencies: ['ZAR'],
      providers: ['paystack', 'flutterwave', 'onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'airtime', 'data', 'transaction_status', 'balance_inquiry', 'refund']
    },
    {
      code: 'CI',
      name: 'Ivory Coast',
      currencies: ['XOF'],
      providers: ['flutterwave', 'onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry']
    },
    {
      code: 'SN',
      name: 'Senegal',
      currencies: ['XOF'],
      providers: ['onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry']
    },
    {
      code: 'CM',
      name: 'Cameroon',
      currencies: ['XAF'],
      providers: ['onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry']
    },
    {
      code: 'RW',
      name: 'Rwanda',
      currencies: ['RWF'],
      providers: ['onafriq'],
      supported_operations: ['collection', 'disbursement', 'wallet_transfer', 'merchant_payment', 'airtime', 'data', 'transaction_status', 'balance_inquiry']
    },
  ];

  // Supported mobile money networks per country
  private readonly NETWORK_MAP: Record<string, string[]> = {
    NG: ['MTN', 'Airtel', 'Glo', '9mobile'],
    GH: ['MTN', 'Vodafone', 'AirtelTigo'],
    KE: ['Safaricom', 'Airtel'],
    TZ: ['Vodacom', 'Airtel', 'Tigo'],
    UG: ['MTN', 'Airtel'],
    ZA: ['Vodacom', 'MTN', 'Cell C'],
    CI: ['MTN', 'Orange', 'Moov'],
    SN: ['Orange', 'Free', 'Tigo'],
    CM: ['MTN', 'Orange'],
    RW: ['MTN', 'Airtel'],
  };

  constructor(
    selectionEngine: ProviderSelectionEngine,
    registry: ProviderRegistry,
    ledger: LedgerService,
    webhookHandler: WebhookHandler
  ) {
    this.selectionEngine = selectionEngine;
    this.registry = registry;
    this.ledger = ledger;
    this.webhookHandler = webhookHandler;
  }

  // ===========================================================================
  // COLLECTION (Funding)
  // ===========================================================================

  async collect(request: CollectionRequest): Promise<MobileMoneyResult> {
    const country = this.getCountryConfig(request.country_code);
    if (!country) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'collection',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Country ${request.country_code} is not supported for mobile money collections`
      };
    }

    if (!country.supported_operations.includes('collection')) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'collection',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Collection is not supported in ${country.name}`
      };
    }

    return this.executeWithFailover(
      'mobile_money_collection',
      request.country_code,
      request.currency,
      request.amount,
      request.preferred_provider,
      async (adapter) => {
        const paymentRequest: UnifiedPaymentRequest = {
          amount: request.amount,
          currency: request.currency,
          reference: request.reference,
          description: request.description,
          callback_url: request.callback_url,
          metadata: {
            ...request.metadata,
            phone_number: request.phone_number,
            country_code: request.country_code,
            network: request.network,
            type: 'mobile_money_collection'
          },
          payment_method: {
            type: 'mobile_money',
            country_code: request.country_code,
            network: request.network,
            phone_number: request.phone_number
          }
        };

        const result = await adapter.initializePayment(paymentRequest);

        // Record in ledger
        this.ledger.hold(
          result.id,
          request.amount,
          request.currency,
          request.reference,
          `Mobile money collection from ${request.phone_number}`
        );

        return result;
      },
      request.reference
    );
  }

  // ===========================================================================
  // DISBURSEMENT (Withdrawal)
  // ===========================================================================

  async disburse(request: DisbursementRequest): Promise<MobileMoneyResult> {
    const country = this.getCountryConfig(request.country_code);
    if (!country) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'disbursement',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Country ${request.country_code} is not supported for mobile money disbursements`
      };
    }

    if (!country.supported_operations.includes('disbursement')) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'disbursement',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Disbursement is not supported in ${country.name}`
      };
    }

    return this.executeWithFailover(
      'mobile_money_payout',
      request.country_code,
      request.currency,
      request.amount,
      request.preferred_provider,
      async (adapter) => {
        const transferRequest: UnifiedTransferRequest = {
          amount: request.amount,
          currency: request.currency,
          reference: request.reference,
          narration: request.narration,
          callback_url: request.callback_url,
          metadata: {
            ...request.metadata,
            phone_number: request.phone_number,
            country_code: request.country_code,
            network: request.network,
            type: 'mobile_money_disbursement'
          },
          recipient: {
            type: 'mobile_money',
            mobile_money: {
              network: request.network,
              phone_number: request.phone_number,
              country_code: request.country_code,
              country: country.name
            }
          }
        };

        const result = await adapter.createTransfer(transferRequest);

        // Record in ledger
        this.ledger.debit(
          result.id,
          request.amount,
          request.currency,
          request.reference,
          undefined,
          undefined,
          `Mobile money disbursement to ${request.phone_number}`
        );

        return result;
      },
      request.reference
    );
  }

  // ===========================================================================
  // WALLET TRANSFER
  // ===========================================================================

  async walletTransfer(request: WalletTransferRequest): Promise<MobileMoneyResult> {
    // Wallet transfers are typically internal or provider-specific
    // Route to the best provider for the country
    const country = this.getCountryConfig(request.country_code);
    if (!country) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'wallet_transfer',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Country ${request.country_code} is not supported`
      };
    }

    return this.executeWithFailover(
      'mobile_money_payout',
      request.country_code,
      request.currency,
      request.amount,
      undefined,
      async (adapter) => {
        const transferRequest: UnifiedTransferRequest = {
          amount: request.amount,
          currency: request.currency,
          reference: request.reference,
          narration: request.description,
          metadata: {
            source_phone: request.source_phone,
            destination_phone: request.destination_phone,
            network: request.network,
            type: 'wallet_transfer'
          },
          recipient: {
            type: 'mobile_money',
            mobile_money: {
              network: request.network,
              phone_number: request.destination_phone,
              country_code: request.country_code
            }
          }
        };

        return adapter.createTransfer(transferRequest);
      },
      request.reference
    );
  }

  // ===========================================================================
  // MERCHANT PAYMENT
  // ===========================================================================

  async merchantPayment(request: MerchantPaymentRequest): Promise<MobileMoneyResult> {
    const country = this.getCountryConfig(request.country_code);
    if (!country) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'merchant_payment',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Country ${request.country_code} is not supported`
      };
    }

    return this.executeWithFailover(
      'merchant_collection',
      request.country_code,
      request.currency,
      request.amount,
      undefined,
      async (adapter) => {
        const paymentRequest: UnifiedPaymentRequest = {
          amount: request.amount,
          currency: request.currency,
          reference: request.reference,
          description: request.description,
          metadata: {
            ...request.metadata,
            phone_number: request.phone_number,
            network: request.network,
            merchant_id: request.merchant_id,
            type: 'merchant_payment'
          },
          payment_method: {
            type: 'mobile_money',
            country_code: request.country_code,
            network: request.network,
            phone_number: request.phone_number
          }
        };

        if (adapter.merchantCollection) {
          return adapter.merchantCollection(paymentRequest);
        }
        return adapter.initializePayment(paymentRequest);
      },
      request.reference
    );
  }

  // ===========================================================================
  // AIRTIME & DATA
  // ===========================================================================

  async buyAirtime(request: AirtimeDataRequest): Promise<MobileMoneyResult> {
    const country = this.getCountryConfig(request.country_code);
    if (!country) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'airtime',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Country ${request.country_code} is not supported`
      };
    }

    return this.executeWithFailover(
      'airtime',
      request.country_code,
      request.currency,
      request.amount,
      undefined,
      async (adapter) => {
        const billRequest: BillPaymentRequest = {
          biller_id: request.network,
          item_id: request.product_code,
          amount: request.amount,
          customer_reference: request.phone_number,
          metadata: {
            ...request.metadata,
            type: 'airtime',
            phone_number: request.phone_number,
            network: request.network
          }
        };

        return adapter.payBill(billRequest);
      },
      request.reference
    );
  }

  async buyData(request: AirtimeDataRequest): Promise<MobileMoneyResult> {
    const country = this.getCountryConfig(request.country_code);
    if (!country) {
      return {
        success: false,
        provider: 'onafriq',
        operation: 'data',
        reference: request.reference,
        attempts: 0,
        failover_chain: [],
        error: `Country ${request.country_code} is not supported`
      };
    }

    return this.executeWithFailover(
      'data',
      request.country_code,
      request.currency,
      request.amount,
      undefined,
      async (adapter) => {
        const billRequest: BillPaymentRequest = {
          biller_id: request.network,
          item_id: request.product_code,
          amount: request.amount,
          customer_reference: request.phone_number,
          metadata: {
            ...request.metadata,
            type: 'data',
            phone_number: request.phone_number,
            network: request.network
          }
        };

        return adapter.payBill(billRequest);
      },
      request.reference
    );
  }

  // ===========================================================================
  // TRANSACTION STATUS
  // ===========================================================================

  async getTransactionStatus(
    reference: string,
    country_code: string,
    preferred_provider?: ProviderName
  ): Promise<MobileMoneyResult> {
    const startTime = Date.now();
    const failoverChain: ProviderName[] = [];

    // Try preferred provider first
    if (preferred_provider) {
      const wrapper = this.registry.get(preferred_provider);
      if (wrapper) {
        failoverChain.push(preferred_provider);
        try {
          const result = await wrapper.getPaymentStatus(reference);
          this.selectionEngine.recordSuccess(preferred_provider, Date.now() - startTime);
          return {
            success: true,
            data: result,
            provider: preferred_provider,
            operation: 'transaction_status',
            reference,
            attempts: 1,
            failover_chain: failoverChain
          };
        } catch {
          this.selectionEngine.recordFailure(preferred_provider);
        }
      }
    }

    // Try all providers
    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      failoverChain.push(wrapper.name);
      try {
        const result = await wrapper.getPaymentStatus(reference);
        this.selectionEngine.recordSuccess(wrapper.name, Date.now() - startTime);
        return {
          success: true,
          data: result,
          provider: wrapper.name,
          operation: 'transaction_status',
          reference,
          attempts: failoverChain.length,
          failover_chain: failoverChain
        };
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
      }
    }

    return {
      success: false,
      provider: failoverChain[0] || 'onafriq',
      operation: 'transaction_status',
      reference,
      attempts: failoverChain.length,
      failover_chain: failoverChain,
      error: 'Could not retrieve transaction status from any provider'
    };
  }

  // ===========================================================================
  // BALANCE INQUIRY
  // ===========================================================================

  async getBalance(request: BalanceInquiryRequest): Promise<MobileMoneyResult> {
    const startTime = Date.now();
    const failoverChain: ProviderName[] = [];

    const providers = this.registry.getAll();
    for (const wrapper of providers) {
      failoverChain.push(wrapper.name);
      try {
        // Use exchange rate endpoint or a provider-specific balance check
        if (wrapper.exchangeRate) {
          const result = await wrapper.exchangeRate('NGN', 'NGN', 0);
          this.selectionEngine.recordSuccess(wrapper.name, Date.now() - startTime);
          return {
            success: true,
            data: result,
            provider: wrapper.name,
            operation: 'balance_inquiry',
            reference: request.reference,
            attempts: failoverChain.length,
            failover_chain: failoverChain
          };
        }
      } catch {
        this.selectionEngine.recordFailure(wrapper.name);
      }
    }

    return {
      success: false,
      provider: failoverChain[0] || 'onafriq',
      operation: 'balance_inquiry',
      reference: request.reference,
      attempts: failoverChain.length,
      failover_chain: failoverChain,
      error: 'Balance inquiry not available'
    };
  }

  // ===========================================================================
  // REFUND
  // ===========================================================================

  async refund(
    transaction_id: string,
    amount: number,
    reason: string,
    country_code: string,
    preferred_provider?: ProviderName
  ): Promise<MobileMoneyResult> {
    return this.executeWithFailover(
      'refund',
      country_code,
      'NGN', // Default currency, should be passed properly
      amount,
      preferred_provider,
      async (adapter) => {
        if (!adapter.refund) {
          throw new ProviderFeatureUnavailableError(adapter.name, 'refund');
        }
        return adapter.refund(transaction_id, amount, reason);
      },
      `refund_${transaction_id}`
    );
  }

  // ===========================================================================
  // COUNTRY & NETWORK HELPERS
  // ===========================================================================

  getSupportedCountries(): MobileMoneyCountry[] {
    return [...this.COUNTRY_PROVIDERS];
  }

  getCountryConfig(countryCode: string): MobileMoneyCountry | undefined {
    return this.COUNTRY_PROVIDERS.find(c => c.code === countryCode);
  }

  getSupportedNetworks(countryCode: string): string[] {
    return this.NETWORK_MAP[countryCode] || [];
  }

  getSupportedOperations(countryCode: string): MobileMoneyOperation[] {
    const country = this.getCountryConfig(countryCode);
    return country?.supported_operations || [];
  }

  isOperationSupported(countryCode: string, operation: MobileMoneyOperation): boolean {
    const operations = this.getSupportedOperations(countryCode);
    return operations.includes(operation);
  }

  getProvidersForCountry(countryCode: string): ProviderName[] {
    const country = this.getCountryConfig(countryCode);
    return country?.providers || [];
  }

  // ===========================================================================
  // CORE EXECUTION
  // ===========================================================================

  private async executeWithFailover<T>(
    operation: PaymentOperation,
    country: string,
    currency: string,
    amount: number,
    preferredProvider: ProviderName | undefined,
    executor: (adapter: ProviderWrapper) => Promise<T>,
    reference: string
  ): Promise<MobileMoneyResult & { data?: T }> {
    const startTime = Date.now();
    const failoverChain: ProviderName[] = [];

    // Get failover chain from selection engine
    const scoredProviders = this.selectionEngine.getFailoverChain(operation, country, currency, amount);

    // Order providers: preferred first if specified
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

      // Execute with retries
      for (let attempt = 0; attempt < 3; attempt++) {
        const attemptStart = Date.now();
        try {
          const result = await executor(wrapper);
          const latency = Date.now() - attemptStart;

          this.selectionEngine.recordSuccess(score.provider, latency);

          return {
            success: true,
            data: result,
            provider: score.provider,
            operation: operation as MobileMoneyOperation,
            reference,
            attempts: failoverChain.length,
            failover_chain: failoverChain
          };
        } catch (error) {
          lastError = (error as Error).message;
          this.selectionEngine.recordFailure(score.provider);

          if (error instanceof ProviderFeatureUnavailableError) {
            break; // Move to next provider
          }

          if (attempt < 2) {
            await this.delay(1000 * Math.pow(2, attempt));
          }
        }
      }
    }

    return {
      success: false,
      provider: failoverChain[0] || 'onafriq',
      operation: operation as MobileMoneyOperation,
      reference,
      attempts: failoverChain.length * 3,
      failover_chain: failoverChain,
      error: lastError || 'All providers failed'
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default MobileMoneyOrchestrator;
