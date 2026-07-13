// TurboPay International Transfer Service
// Cross-border payments using Onafriq (2000+ corridors), Flutterwave (30+ currencies),
// Remita (PAPSS), and Quickteller (PIPE)

import {
  ProviderName,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  ExchangeRateResponse,
  ProviderUnavailableError,
  ProviderFeatureUnavailableError
} from '../types';
import { ProviderRegistry, ProviderWrapper } from './provider-wrapper';
import { ProviderSelectionEngine, ProviderScore } from './provider-selection-engine';
import { LedgerService } from './ledger';
import { AnalyticsDashboard } from '../admin/dashboard/analytics-dashboard';
import { AuditLogService } from '../admin/dashboard/audit-log';

// =============================================================================
// TYPES
// =============================================================================

export interface InternationalTransferRequest {
  amount: number;
  source_currency: string;
  destination_currency: string;
  recipient: {
    name?: string;
    email?: string;
    phone?: string;
    bank_code?: string;
    account_number?: string;
    country: string;
    mobile_money?: {
      network: string;
      phone_number: string;
      country_code: string;
    };
  };
  narration?: string;
  reference: string;
  preferred_provider?: ProviderName;
}

export interface InternationalTransferResult {
  success: boolean;
  provider: ProviderName;
  transaction_id: string;
  reference: string;
  amount: number;
  source_currency: string;
  destination_currency: string;
  exchange_rate: number;
  converted_amount: number;
  fee: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  estimated_delivery?: Date;
  tracking_url?: string;
  error?: string;
}

export interface CrossBorderCorridor {
  source_country: string;
  destination_country: string;
  source_currency: string;
  destination_currency: string;
  supported_providers: ProviderName[];
  min_amount: number;
  max_amount: number;
  estimated_delivery: string;
  fee_structure: string;
}

export interface FXRate {
  provider: ProviderName;
  from_currency: string;
  to_currency: string;
  rate: number;
  inverse_rate: number;
  converted_amount: number;
  markup: number;
  timestamp: Date;
  valid_until: Date;
}

// =============================================================================
// INTERNATIONAL TRANSFER SERVICE
// =============================================================================

export class InternationalTransferService {
  private registry: ProviderRegistry;
  private selectionEngine: ProviderSelectionEngine;
  private ledger: LedgerService;
  private analytics: AnalyticsDashboard;
  private auditLog: AuditLogService;

  // Supported corridors (verified from research)
  private readonly SUPPORTED_CORRIDORS: CrossBorderCorridor[] = [
    // Onafriq corridors (43 countries)
    { source_country: 'NG', destination_country: 'GH', source_currency: 'NGN', destination_currency: 'GHS', supported_providers: ['onafriq', 'flutterwave'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1-3% of amount' },
    { source_country: 'NG', destination_country: 'KE', source_currency: 'NGN', destination_currency: 'KES', supported_providers: ['onafriq', 'flutterwave'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1-3% of amount' },
    { source_country: 'NG', destination_country: 'ZA', source_currency: 'NGN', destination_currency: 'ZAR', supported_providers: ['onafriq', 'flutterwave'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1-3% of amount' },
    { source_country: 'NG', destination_country: 'UG', source_currency: 'NGN', destination_currency: 'UGX', supported_providers: ['onafriq', 'flutterwave'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1-3% of amount' },
    { source_country: 'NG', destination_country: 'TZ', source_currency: 'NGN', destination_currency: 'TZS', supported_providers: ['onafriq', 'flutterwave'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1-3% of amount' },
    { source_country: 'NG', destination_country: 'RW', source_currency: 'NGN', destination_currency: 'RWF', supported_providers: ['onafriq', 'flutterwave'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1-3% of amount' },

    // Flutterwave corridors (30+ currencies)
    { source_country: 'NG', destination_country: 'US', source_currency: 'NGN', destination_currency: 'USD', supported_providers: ['flutterwave'], min_amount: 5000, max_amount: 50000000, estimated_delivery: '1-3 days', fee_structure: '2-4% of amount' },
    { source_country: 'NG', destination_country: 'GB', source_currency: 'NGN', destination_currency: 'GBP', supported_providers: ['flutterwave'], min_amount: 5000, max_amount: 50000000, estimated_delivery: '1-3 days', fee_structure: '2-4% of amount' },
    { source_country: 'NG', destination_country: 'EU', source_currency: 'NGN', destination_currency: 'EUR', supported_providers: ['flutterwave'], min_amount: 5000, max_amount: 50000000, estimated_delivery: '1-3 days', fee_structure: '2-4% of amount' },

    // Remita PAPSS corridors
    { source_country: 'NG', destination_country: 'GH', source_currency: 'NGN', destination_currency: 'GHS', supported_providers: ['remita'], min_amount: 1000, max_amount: 5000000, estimated_delivery: 'Real-time', fee_structure: '0.5-1% of amount' },
    { source_country: 'NG', destination_country: 'KE', source_currency: 'NGN', destination_currency: 'KES', supported_providers: ['remita'], min_amount: 1000, max_amount: 5000000, estimated_delivery: 'Real-time', fee_structure: '0.5-1% of amount' },

    // Quickteller PIPE corridors
    { source_country: 'NG', destination_country: 'KE', source_currency: 'NGN', destination_currency: 'KES', supported_providers: ['quickteller'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1.4% + ₦10' },
    { source_country: 'NG', destination_country: 'CM', source_currency: 'NGN', destination_currency: 'XAF', supported_providers: ['quickteller'], min_amount: 1000, max_amount: 10000000, estimated_delivery: '1-2 hours', fee_structure: '1.4% + ₦10' },
  ];

  constructor(
    registry: ProviderRegistry,
    selectionEngine: ProviderSelectionEngine,
    ledger: LedgerService,
    analytics: AnalyticsDashboard,
    auditLog: AuditLogService
  ) {
    this.registry = registry;
    this.selectionEngine = selectionEngine;
    this.ledger = ledger;
    this.analytics = analytics;
    this.auditLog = auditLog;
  }

  // ===========================================================================
  // INTERNATIONAL TRANSFER
  // ===========================================================================

  async transfer(params: InternationalTransferRequest): Promise<InternationalTransferResult> {
    // Find supported providers for this corridor
    const corridor = this.findCorridor(
      params.recipient.country,
      params.source_currency,
      params.destination_currency
    );

    // Determine which provider to use
    let provider: ProviderName;

    if (params.preferred_provider) {
      // Verify preferred provider supports this corridor
      if (corridor && corridor.supported_providers.includes(params.preferred_provider)) {
        provider = params.preferred_provider;
      } else {
        // Fall back to selection engine
        const best = this.selectionEngine.selectBestProvider(
          'bank_transfer_payout',
          params.recipient.country,
          params.destination_currency,
          params.amount
        );
        if (!best) {
          return {
            success: false,
            provider: 'paystack' as ProviderName,
            transaction_id: '',
            reference: params.reference,
            amount: params.amount,
            source_currency: params.source_currency,
            destination_currency: params.destination_currency,
            exchange_rate: 0,
            converted_amount: 0,
            fee: 0,
            status: 'failed',
            error: `No provider supports corridor ${params.source_currency} → ${params.destination_currency}`
          };
        }
        provider = best.provider;
      }
    } else {
      // Use selection engine to find best provider
      const scoredProviders = this.selectionEngine.getFailoverChain(
        'bank_transfer_payout',
        params.recipient.country,
        params.destination_currency,
        params.amount
      );

      // Filter to providers that support this corridor
      const corridorProviders = scoredProviders.filter(
        s => corridor?.supported_providers.includes(s.provider) ||
          this.supportsCorridor(s.provider, params.recipient.country, params.destination_currency)
      );

      if (corridorProviders.length === 0) {
        return {
          success: false,
          provider: 'paystack' as ProviderName,
          transaction_id: '',
          reference: params.reference,
          amount: params.amount,
          source_currency: params.source_currency,
          destination_currency: params.destination_currency,
          exchange_rate: 0,
          converted_amount: 0,
          fee: 0,
          status: 'failed',
          error: `No provider supports corridor ${params.source_currency} → ${params.destination_currency}`
        };
      }

      provider = corridorProviders[0].provider;
    }

    // Execute transfer with failover
    const wrapper = this.registry.get(provider);
    if (!wrapper) {
      return {
        success: false,
        provider,
        transaction_id: '',
        reference: params.reference,
        amount: params.amount,
        source_currency: params.source_currency,
        destination_currency: params.destination_currency,
        exchange_rate: 0,
        converted_amount: 0,
        fee: 0,
        status: 'failed',
        error: `Provider ${provider} not registered`
      };
    }

    // Get exchange rate
    let exchangeRate = 1;
    let convertedAmount = params.amount;
    let fxProvider = provider;

    if (params.source_currency !== params.destination_currency) {
      try {
        const rate = await this.getExchangeRate(
          params.source_currency,
          params.destination_currency,
          params.amount,
          provider
        );
        if (rate) {
          exchangeRate = rate.rate;
          convertedAmount = rate.converted_amount;
          fxProvider = rate.provider;
        }
      } catch {
        // Use default rate if FX lookup fails
      }
    }

    // Create transfer request
    const transferRequest: UnifiedTransferRequest = {
      amount: params.amount,
      currency: params.source_currency,
      reference: params.reference,
      narration: params.narration,
      recipient: params.recipient.mobile_money ? {
        type: 'mobile_money',
        mobile_money: params.recipient.mobile_money
      } : {
        type: 'bank',
        bank: {
          code: params.recipient.bank_code || '',
          account_number: params.recipient.account_number || '',
          name: params.recipient.name
        }
      }
    };

    // Execute
    const startTime = Date.now();
    try {
      const result = await wrapper.createTransfer(transferRequest);
      const latency = Date.now() - startTime;

      this.selectionEngine.recordSuccess(provider, latency);

      // Record analytics
      this.analytics.recordTransaction({
        id: result.id || params.reference,
        provider,
        operation: 'bank_transfer_payout',
        amount: params.amount,
        currency: params.source_currency,
        fee: result.fees || 0,
        status: result.status,
        country: params.recipient.country,
        created_at: new Date(),
        latency_ms: latency
      });

      // Audit log
      this.auditLog.log({
        event: 'transaction.initiated',
        entity_type: 'international_transfer',
        entity_id: params.reference,
        metadata: {
          provider,
          source_currency: params.source_currency,
          destination_currency: params.destination_currency,
          amount: params.amount,
          exchange_rate: exchangeRate,
          converted_amount: convertedAmount,
          recipient_country: params.recipient.country
        },
        severity: 'info'
      });

      return {
        success: true,
        provider,
        transaction_id: result.id || params.reference,
        reference: params.reference,
        amount: params.amount,
        source_currency: params.source_currency,
        destination_currency: params.destination_currency,
        exchange_rate: exchangeRate,
        converted_amount: convertedAmount,
        fee: result.fees || 0,
        status: result.status === 'success' ? 'completed' : result.status === 'failed' ? 'failed' : 'pending',
        estimated_delivery: corridor ? this.parseEstimatedDelivery(corridor.estimated_delivery) : undefined
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.selectionEngine.recordFailure(provider);

      return {
        success: false,
        provider,
        transaction_id: '',
        reference: params.reference,
        amount: params.amount,
        source_currency: params.source_currency,
        destination_currency: params.destination_currency,
        exchange_rate: exchangeRate,
        converted_amount: convertedAmount,
        fee: 0,
        status: 'failed',
        error: (error as Error).message
      };
    }
  }

  // ===========================================================================
  // EXCHANGE RATES
  // ===========================================================================

  async getExchangeRate(
    from_currency: string,
    to_currency: string,
    amount: number,
    preferred_provider?: ProviderName
  ): Promise<FXRate | null> {
    const providers = preferred_provider
      ? [preferred_provider]
      : ['flutterwave', 'onafriq'] as ProviderName[];

    for (const provider of providers) {
      const wrapper = this.registry.get(provider);
      if (!wrapper) continue;

      try {
        if (wrapper.exchangeRate) {
          const rate = await wrapper.exchangeRate(from_currency, to_currency, amount);
          return {
            provider,
            from_currency,
            to_currency,
            rate: rate.rate,
            inverse_rate: 1 / rate.rate,
            converted_amount: rate.converted_amount,
            markup: 0,
            timestamp: new Date(),
            valid_until: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async compareExchangeRates(
    from_currency: string,
    to_currency: string,
    amount: number
  ): Promise<FXRate[]> {
    const rates: FXRate[] = [];
    const providers = ['flutterwave', 'onafriq'] as ProviderName[];

    for (const provider of providers) {
      const rate = await this.getExchangeRate(from_currency, to_currency, amount, provider);
      if (rate) {
        rates.push(rate);
      }
    }

    // Sort by rate (best rate first)
    rates.sort((a, b) => b.rate - a.rate);

    return rates;
  }

  // ===========================================================================
  // CORRIDOR QUERIES
  // ===========================================================================

  getSupportedCorridors(source_country?: string, destination_country?: string): CrossBorderCorridor[] {
    let corridors = [...this.SUPPORTED_CORRIDORS];

    if (source_country) {
      corridors = corridors.filter(c => c.source_country === source_country);
    }

    if (destination_country) {
      corridors = corridors.filter(c => c.destination_country === destination_country);
    }

    return corridors;
  }

  isCorridorSupported(source_country: string, destination_country: string, source_currency: string, destination_currency: string): boolean {
    return this.SUPPORTED_CORRIDORS.some(
      c => c.source_country === source_country &&
        c.destination_country === destination_country &&
        c.source_currency === source_currency &&
        c.destination_currency === destination_currency
    );
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private findCorridor(
    destination_country: string,
    source_currency: string,
    destination_currency: string
  ): CrossBorderCorridor | undefined {
    return this.SUPPORTED_CORRIDORS.find(
      c => c.destination_country === destination_country &&
        c.source_currency === source_currency &&
        c.destination_currency === destination_currency
    );
  }

  private supportsCorridor(
    provider: ProviderName,
    destination_country: string,
    destination_currency: string
  ): boolean {
    const caps = this.selectionEngine['capabilities']?.get(provider);
    if (!caps) return false;

    // Check if provider supports destination country
    if (caps.countries.length > 0 && !caps.countries.includes(destination_country)) {
      return false;
    }

    // Check if provider supports destination currency
    if (caps.currencies.length > 0 && !caps.currencies.includes(destination_currency)) {
      return false;
    }

    return caps.technical.international;
  }

  private parseEstimatedDelivery(delivery: string): Date {
    const now = new Date();

    if (delivery.includes('hour')) {
      const hours = parseInt(delivery) || 1;
      return new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    if (delivery.includes('day')) {
      const days = parseInt(delivery) || 1;
      return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    }

    if (delivery.includes('Real-time')) {
      return new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes
    }

    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

export default InternationalTransferService;
