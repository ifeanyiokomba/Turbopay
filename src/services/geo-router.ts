// TurboPay Geo-Routed Orchestrator Engine
// Geographic intelligence layer for provider selection, compliance, and cross-border routing

import {
  ProviderName,
  PaymentOperation,
  ProviderCapabilities,
  ProviderAdapter,
  GeoZone,
  ComplianceLevel,
  CountryConfig,
  RegulatoryRequirement,
  TransactionLimits,
  GeoRoute,
  GeoCrossBorderCorridor,
  GeoRoutingContext,
  GeoRoutingDecision,
  UnifiedPaymentRequest,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  ProviderUnavailableError,
  PaymentFailedError
} from '../types';
import { CapabilityEngine } from './capability-engine';
import { HealthMonitor } from './health-monitor';
import { ProviderRouter, ProviderFeeStructure } from './provider-router';

// =============================================================================
// COUNTRY CONFIGURATIONS
// =============================================================================

const COUNTRY_REGISTRY: Map<string, CountryConfig> = new Map([
  ['NG', {
    country_code: 'NG',
    country_name: 'Nigeria',
    zone: 'west_africa',
    currencies: ['NGN'],
    primary_currency: 'NGN',
    default_provider: 'paystack',
    fallback_providers: ['flutterwave', 'monnify', 'paga', 'smartcash', 'mtn_momo', 'remita'],
    compliance_level: 'enhanced',
    regulatory_requirements: [
      { type: 'kyc', description: 'BVN required for transfers > ₦50,000', mandatory: true, max_transaction_without: 50000 },
      { type: 'aml', description: 'CBN AML compliance', mandatory: true },
      { type: 'transaction_limit', description: 'CBN daily transfer limits apply', mandatory: true },
      { type: 'license', description: 'PSB/MFB license required for mobile money', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 100,
      max_amount: 50000000,
      daily_limit: 5000000,
      monthly_limit: 50000000,
      single_transfer_limit: 5000000,
      currency: 'NGN'
    },
    supported_operations: [
      'card_collection', 'bank_transfer_collection', 'ussd_collection',
      'mobile_money_collection', 'qr_collection', 'bank_transfer_payout',
      'mobile_money_payout', 'bulk_payment', 'virtual_account',
      'bill_payment', 'airtime', 'data', 'electricity', 'cable_tv',
      'education', 'refund', 'reversal', 'merchant_collection',
      'bank_resolution', 'bvn', 'kyc', 'mobile_money'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['GH', {
    country_code: 'GH',
    country_name: 'Ghana',
    zone: 'west_africa',
    currencies: ['GHS'],
    primary_currency: 'GHS',
    default_provider: 'flutterwave',
    fallback_providers: ['paystack', 'mtn_momo', 'airtel_money', 'onafriq'],
    compliance_level: 'enhanced',
    regulatory_requirements: [
      { type: 'kyc', description: 'Ghana Card required', mandatory: true },
      { type: 'aml', description: 'AML/CFT compliance per Bank of Ghana', mandatory: true },
      { type: 'license', description: 'Electronic Money Issuer license', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 1,
      max_amount: 100000,
      daily_limit: 30000,
      monthly_limit: 300000,
      single_transfer_limit: 30000,
      currency: 'GHS'
    },
    supported_operations: [
      'card_collection', 'bank_transfer_collection', 'mobile_money_collection',
      'bank_transfer_payout', 'mobile_money_payout', 'bill_payment',
      'airtime', 'data', 'refund', 'mobile_money', 'merchant_collection'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['KE', {
    country_code: 'KE',
    country_name: 'Kenya',
    zone: 'east_africa',
    currencies: ['KES'],
    primary_currency: 'KES',
    default_provider: 'flutterwave',
    fallback_providers: ['mpesa', 'airtel_money', 'paystack'],
    compliance_level: 'enhanced',
    regulatory_requirements: [
      { type: 'kyc', description: 'National ID or Passport required', mandatory: true },
      { type: 'aml', description: 'CBK AML guidelines', mandatory: true },
      { type: 'license', description: 'Payment Service Provider license', mandatory: true },
      { type: 'data_residency', description: 'Customer data must be stored locally', mandatory: false }
    ],
    transaction_limits: {
      min_amount: 1,
      max_amount: 1500000,
      daily_limit: 300000,
      monthly_limit: 3000000,
      single_transfer_limit: 300000,
      currency: 'KES'
    },
    supported_operations: [
      'card_collection', 'bank_transfer_collection', 'mobile_money_collection',
      'bank_transfer_payout', 'mobile_money_payout', 'bill_payment',
      'airtime', 'data', 'refund', 'mobile_money', 'merchant_collection'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['ZA', {
    country_code: 'ZA',
    country_name: 'South Africa',
    zone: 'southern_africa',
    currencies: ['ZAR'],
    primary_currency: 'ZAR',
    default_provider: 'paystack',
    fallback_providers: ['flutterwave', 'onafriq'],
    compliance_level: 'strict',
    regulatory_requirements: [
      { type: 'kyc', description: 'FICA verification required', mandatory: true },
      { type: 'aml', description: 'FIC AML/CFT compliance', mandatory: true },
      { type: 'license', description: 'Payment service provider license', mandatory: true },
      { type: 'data_residency', description: 'POPIA compliance required', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 10,
      max_amount: 5000000,
      daily_limit: 1000000,
      monthly_limit: 10000000,
      single_transfer_limit: 1000000,
      currency: 'ZAR'
    },
    supported_operations: [
      'card_collection', 'bank_transfer_collection', 'bank_transfer_payout',
      'bulk_payment', 'virtual_account', 'refund', 'reversal',
      'merchant_collection', 'bank_resolution'
    ],
    requires_kyc_tier: 2,
    cross_border_enabled: true
  }],
  ['CI', {
    country_code: 'CI',
    country_name: 'Cote d\'Ivoire',
    zone: 'west_africa',
    currencies: ['XOF'],
    primary_currency: 'XOF',
    default_provider: 'flutterwave',
    fallback_providers: ['onafriq', 'paystack'],
    compliance_level: 'basic',
    regulatory_requirements: [
      { type: 'kyc', description: 'National ID required for large transactions', mandatory: false, max_transaction_without: 500000 },
      { type: 'aml', description: 'BCEAO AML compliance', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 500,
      max_amount: 10000000,
      daily_limit: 2000000,
      monthly_limit: 20000000,
      single_transfer_limit: 2000000,
      currency: 'XOF'
    },
    supported_operations: [
      'card_collection', 'bank_transfer_collection', 'mobile_money_collection',
      'bank_transfer_payout', 'mobile_money_payout', 'bill_payment',
      'airtime', 'data', 'refund', 'mobile_money', 'merchant_collection'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['SN', {
    country_code: 'SN',
    country_name: 'Senegal',
    zone: 'west_africa',
    currencies: ['XOF'],
    primary_currency: 'XOF',
    default_provider: 'flutterwave',
    fallback_providers: ['onafriq'],
    compliance_level: 'basic',
    regulatory_requirements: [
      { type: 'aml', description: 'BCEAO AML compliance', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 500,
      max_amount: 5000000,
      daily_limit: 1000000,
      monthly_limit: 10000000,
      single_transfer_limit: 1000000,
      currency: 'XOF'
    },
    supported_operations: [
      'card_collection', 'bank_transfer_collection', 'mobile_money_collection',
      'bank_transfer_payout', 'mobile_money_payout', 'bill_payment',
      'airtime', 'refund', 'mobile_money', 'merchant_collection'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['UG', {
    country_code: 'UG',
    country_name: 'Uganda',
    zone: 'east_africa',
    currencies: ['UGX'],
    primary_currency: 'UGX',
    default_provider: 'flutterwave',
    fallback_providers: ['mtn_momo', 'airtel_money', 'onafriq'],
    compliance_level: 'basic',
    regulatory_requirements: [
      { type: 'kyc', description: 'National ID required', mandatory: true },
      { type: 'aml', description: 'BOU AML compliance', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 1000,
      max_amount: 20000000,
      daily_limit: 7000000,
      monthly_limit: 70000000,
      single_transfer_limit: 7000000,
      currency: 'UGX'
    },
    supported_operations: [
      'mobile_money_collection', 'mobile_money_payout', 'bill_payment',
      'airtime', 'data', 'refund', 'mobile_money'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['TZ', {
    country_code: 'TZ',
    country_name: 'Tanzania',
    zone: 'east_africa',
    currencies: ['TZS'],
    primary_currency: 'TZS',
    default_provider: 'flutterwave',
    fallback_providers: ['mtn_momo', 'airtel_money'],
    compliance_level: 'basic',
    regulatory_requirements: [
      { type: 'kyc', description: 'National ID required', mandatory: true },
      { type: 'aml', description: 'BOT AML compliance', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 1000,
      max_amount: 10000000,
      daily_limit: 5000000,
      monthly_limit: 50000000,
      single_transfer_limit: 5000000,
      currency: 'TZS'
    },
    supported_operations: [
      'mobile_money_collection', 'mobile_money_payout', 'bill_payment',
      'airtime', 'data', 'refund', 'mobile_money'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: true
  }],
  ['RW', {
    country_code: 'RW',
    country_name: 'Rwanda',
    zone: 'east_africa',
    currencies: ['RWF'],
    primary_currency: 'RWF',
    default_provider: 'flutterwave',
    fallback_providers: ['mtn_momo'],
    compliance_level: 'basic',
    regulatory_requirements: [
      { type: 'kyc', description: 'National ID required', mandatory: true },
      { type: 'aml', description: 'BNR AML compliance', mandatory: true }
    ],
    transaction_limits: {
      min_amount: 500,
      max_amount: 5000000,
      daily_limit: 2000000,
      monthly_limit: 20000000,
      single_transfer_limit: 2000000,
      currency: 'RWF'
    },
    supported_operations: [
      'mobile_money_collection', 'mobile_money_payout', 'bill_payment',
      'airtime', 'data', 'refund', 'mobile_money'
    ],
    requires_kyc_tier: 1,
    cross_border_enabled: false
  }]
]);

// =============================================================================
// CROSS-BORDER CORRIDORS
// =============================================================================

const CROSS_BORDER_CORRIDORS: GeoCrossBorderCorridor[] = [
  // West Africa corridors
  {
    source_country: 'NG', destination_country: 'GH',
    source_currency: 'NGN', destination_currency: 'GHS',
    supported_providers: ['flutterwave', 'paystack', 'onafriq'],
    fx_provider: 'flutterwave', fx_markup_percent: 1.5,
    settlement_speed: 't1', min_amount: 1000, max_amount: 10000000,
    compliance_required: ['aml_check', 'beneficiary_verification']
  },
  {
    source_country: 'NG', destination_country: 'CI',
    source_currency: 'NGN', destination_currency: 'XOF',
    supported_providers: ['flutterwave', 'onafriq'],
    fx_provider: 'onafriq', fx_markup_percent: 2.0,
    settlement_speed: 't2', min_amount: 5000, max_amount: 20000000,
    compliance_required: ['aml_check', 'beneficiary_verification']
  },
  {
    source_country: 'GH', destination_country: 'NG',
    source_currency: 'GHS', destination_currency: 'NGN',
    supported_providers: ['flutterwave', 'paystack'],
    fx_provider: 'flutterwave', fx_markup_percent: 1.5,
    settlement_speed: 't1', min_amount: 10, max_amount: 5000000,
    compliance_required: ['aml_check']
  },
  // East Africa corridors
  {
    source_country: 'KE', destination_country: 'UG',
    source_currency: 'KES', destination_currency: 'UGX',
    supported_providers: ['flutterwave', 'mtn_momo'],
    fx_provider: 'flutterwave', fx_markup_percent: 2.0,
    settlement_speed: 't1', min_amount: 100, max_amount: 5000000,
    compliance_required: ['aml_check']
  },
  {
    source_country: 'KE', destination_country: 'TZ',
    source_currency: 'KES', destination_currency: 'TZS',
    supported_providers: ['flutterwave', 'mtn_momo', 'airtel_money'],
    fx_provider: 'flutterwave', fx_markup_percent: 2.0,
    settlement_speed: 't1', min_amount: 100, max_amount: 5000000,
    compliance_required: ['aml_check']
  },
  // Cross-zone corridors
  {
    source_country: 'NG', destination_country: 'KE',
    source_currency: 'NGN', destination_currency: 'KES',
    supported_providers: ['flutterwave', 'paystack'],
    fx_provider: 'flutterwave', fx_markup_percent: 2.5,
    settlement_speed: 't2', min_amount: 5000, max_amount: 10000000,
    compliance_required: ['aml_check', 'beneficiary_verification', 'source_of_funds']
  },
  {
    source_country: 'NG', destination_country: 'ZA',
    source_currency: 'NGN', destination_currency: 'ZAR',
    supported_providers: ['flutterwave', 'paystack'],
    fx_provider: 'flutterwave', fx_markup_percent: 2.5,
    settlement_speed: 't2', min_amount: 5000, max_amount: 10000000,
    compliance_required: ['aml_check', 'beneficiary_verification', 'fica_compliance']
  }
];

// =============================================================================
// GEO-ROUTED ORCHESTRATOR ENGINE
// =============================================================================

export class GeoRoutedOrchestrator {
  private providers: Map<ProviderName, ProviderAdapter> = new Map();
  private capabilityEngine: CapabilityEngine;
  private healthMonitor: HealthMonitor;
  private providerRouter: ProviderRouter;
  private countryRegistry: Map<string, CountryConfig>;
  private crossBorderCorridors: GeoCrossBorderCorridor[];
  private auditLog: GeoRoutingAuditEntry[] = [];

  constructor(config?: {
    countryRegistry?: Map<string, CountryConfig>;
    crossBorderCorridors?: GeoCrossBorderCorridor[];
  }) {
    this.countryRegistry = config?.countryRegistry || new Map(COUNTRY_REGISTRY);
    this.crossBorderCorridors = config?.crossBorderCorridors || [...CROSS_BORDER_CORRIDORS];
    this.capabilityEngine = new CapabilityEngine();
    this.healthMonitor = new HealthMonitor({
      health_check_interval: 60000,
      max_retries: 3,
      retry_delay: 1000,
      failover_enabled: true,
      circuit_breaker_threshold: 5,
      circuit_breaker_timeout: 300000,
      default_timeout: 30000
    });
    this.providerRouter = new ProviderRouter();
  }

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  registerProvider(adapter: ProviderAdapter): void {
    this.providers.set(adapter.name, adapter);
    this.capabilityEngine.register(adapter.name, adapter.getCapabilities());
    this.providerRouter.registerProviderSync(adapter);
  }

  async registerProviderAsync(adapter: ProviderAdapter): Promise<void> {
    this.providers.set(adapter.name, adapter);
    this.capabilityEngine.register(adapter.name, adapter.getCapabilities());
    await this.providerRouter.registerProvider(adapter);
  }

  // ===========================================================================
  // COUNTRY CONFIGURATION
  // ===========================================================================

  getCountryConfig(countryCode: string): CountryConfig | undefined {
    return this.countryRegistry.get(countryCode.toUpperCase());
  }

  registerCountryConfig(config: CountryConfig): void {
    this.countryRegistry.set(config.country_code.toUpperCase(), config);
  }

  updateCountryConfig(countryCode: string, updates: Partial<CountryConfig>): void {
    const existing = this.countryRegistry.get(countryCode.toUpperCase());
    if (existing) {
      this.countryRegistry.set(countryCode.toUpperCase(), { ...existing, ...updates });
    }
  }

  getSupportedCountries(): CountryConfig[] {
    return Array.from(this.countryRegistry.values());
  }

  getCountryByZone(zone: GeoZone): CountryConfig[] {
    return Array.from(this.countryRegistry.values()).filter(c => c.zone === zone);
  }

  // ===========================================================================
  // CROSS-BORDER CORRIDORS
  // ===========================================================================

  getCorridor(sourceCountry: string, destinationCountry: string): GeoCrossBorderCorridor | undefined {
    return this.crossBorderCorridors.find(
      c => c.source_country === sourceCountry.toUpperCase() &&
           c.destination_country === destinationCountry.toUpperCase()
    );
  }

  getCorridorsFromCountry(countryCode: string): GeoCrossBorderCorridor[] {
    return this.crossBorderCorridors.filter(
      c => c.source_country === countryCode.toUpperCase()
    );
  }

  getCorridorsToCountry(countryCode: string): GeoCrossBorderCorridor[] {
    return this.crossBorderCorridors.filter(
      c => c.destination_country === countryCode.toUpperCase()
    );
  }

  registerCorridor(corridor: GeoCrossBorderCorridor): void {
    this.crossBorderCorridors.push(corridor);
  }

  // ===========================================================================
  // GEO-ROUTING DECISIONS
  // ===========================================================================

  /**
   * Main routing decision engine — resolves the best provider for a geo-contextualized request
   */
  route(context: GeoRoutingContext): GeoRoutingDecision {
    const sourceConfig = this.countryRegistry.get(context.source_country.toUpperCase());

    // Determine route type
    const routeType = this.resolveRouteType(context);

    // Cross-border routing
    if (routeType === 'cross_border' && context.destination_country) {
      return this.routeCrossBorder(context, sourceConfig);
    }

    // Domestic routing
    return this.routeDomestic(context, sourceConfig);
  }

  /**
   * Route a domestic transaction
   */
  private routeDomestic(
    context: GeoRoutingContext,
    sourceConfig?: CountryConfig
  ): GeoRoutingDecision {
    const countryCode = context.source_country.toUpperCase();
    const config = sourceConfig || this.countryRegistry.get(countryCode);

    if (!config) {
      // Fallback: no country config — use generic routing
      return this.routeGeneric(context);
    }

    // Check if operation is supported in this country
    if (!config.supported_operations.includes(context.operation)) {
      throw new PaymentFailedError(
        `Operation '${context.operation}' is not supported in ${config.country_name}`,
        config.default_provider,
        'UNSUPPORTED_OPERATION'
      );
    }

    // Check transaction limits
    const limitViolation = this.checkTransactionLimits(context, config);
    if (limitViolation) {
      throw new PaymentFailedError(limitViolation, config.default_provider, 'LIMIT_EXCEEDED');
    }

    // Check KYC requirements
    const kycWarning = this.checkKycRequirements(context, config);

    // Get capable providers for this country
    const capableProviders = this.capabilityEngine.getProvidersWithCapability(
      context.operation,
      countryCode,
      context.currency
    );

    // Filter to registered providers
    const registeredProviders = capableProviders.filter(p => this.providers.has(p));

    // Apply country preference ordering
    const orderedProviders = this.applyCountryPreference(
      registeredProviders,
      config,
      context.preferred_provider
    );

    // Filter healthy providers
    const healthyProviders = orderedProviders.filter(p => this.healthMonitor.isHealthy(p));

    // Use healthy if available, else all capable
    const candidates = healthyProviders.length > 0 ? healthyProviders : orderedProviders;

    if (candidates.length === 0) {
      throw new ProviderUnavailableError(
        `No providers available for ${context.operation} in ${config.country_name}`
      );
    }

    const primary = candidates[0];
    const fallbackChain = candidates.slice(1);

    // Calculate estimated fee
    const estimatedFee = this.providerRouter.calculateFee(
      primary,
      context.operation,
      context.amount,
      context.currency
    );

    // Build regulatory warnings
    const regulatoryWarnings: string[] = [];
    if (kycWarning) regulatoryWarnings.push(kycWarning);
    if (config.compliance_level === 'strict') {
      regulatoryWarnings.push('Strict compliance mode: enhanced monitoring active');
    }

    const decision: GeoRoutingDecision = {
      provider: primary,
      fallback_chain: fallbackChain,
      estimated_fee: estimatedFee,
      compliance_verified: true,
      regulatory_warnings: regulatoryWarnings,
      route_type: 'domestic',
      zone: config.zone,
      reason: this.buildDecisionReason(primary, config, 'domestic')
    };

    this.auditLog.push({
      timestamp: new Date(),
      context,
      decision,
      country_config: config
    });

    return decision;
  }

  /**
   * Route a cross-border transaction
   */
  private routeCrossBorder(
    context: GeoRoutingContext,
    sourceConfig?: CountryConfig
  ): GeoRoutingDecision {
    const destCountry = context.destination_country!.toUpperCase();
    const sourceCountry = context.source_country.toUpperCase();
    const destConfig = this.countryRegistry.get(destCountry);

    // Find cross-border corridor
    const corridor = this.getCorridor(sourceCountry, destCountry);

    if (!corridor) {
      throw new ProviderUnavailableError(
        `No cross-border corridor available from ${sourceCountry} to ${destCountry}`
      );
    }

    // Check corridor amount limits
    if (context.amount < corridor.min_amount || context.amount > corridor.max_amount) {
      throw new PaymentFailedError(
        `Amount ${context.amount} is outside corridor limits (${corridor.min_amount} - ${corridor.max_amount})`,
        corridor.fx_provider,
        'CORRIDOR_LIMIT_EXCEEDED'
      );
    }

    // Filter corridor providers to registered ones
    const corridorProviders = corridor.supported_providers.filter(
      (p: ProviderName) => this.providers.has(p) && this.healthMonitor.isHealthy(p)
    );

    if (corridorProviders.length === 0) {
      throw new ProviderUnavailableError(
        `No corridor providers available for ${sourceCountry} → ${destCountry}`
      );
    }

    const primary = corridorProviders[0];
    const fallbackChain = corridorProviders.slice(1);

    // Calculate estimated fee including FX markup
    const baseFee = this.providerRouter.calculateFee(
      primary,
      context.operation,
      context.amount,
      corridor.source_currency
    );
    const fxMarkup = context.amount * (corridor.fx_markup_percent / 100);
    const estimatedFee = baseFee + fxMarkup;

    // Build warnings
    const regulatoryWarnings: string[] = [];
    if (destConfig?.compliance_level === 'strict') {
      regulatoryWarnings.push(`Destination ${destConfig.country_name} has strict compliance — enhanced KYC required`);
    }
    if (corridor.compliance_required.includes('source_of_funds')) {
      regulatoryWarnings.push('Source of funds documentation may be required');
    }

    const decision: GeoRoutingDecision = {
      provider: primary,
      fallback_chain: fallbackChain,
      estimated_fee: estimatedFee,
      fx_markup: corridor.fx_markup_percent,
      compliance_verified: true,
      regulatory_warnings: regulatoryWarnings,
      route_type: 'cross_border',
      zone: sourceConfig?.zone || 'global',
      reason: this.buildDecisionReason(primary, sourceConfig, 'cross_border', corridor)
    };

    this.auditLog.push({
      timestamp: new Date(),
      context,
      decision,
      corridor
    });

    return decision;
  }

  /**
   * Generic routing when no country config exists
   */
  private routeGeneric(context: GeoRoutingContext): GeoRoutingDecision {
    const capableProviders = this.capabilityEngine.getProvidersWithCapability(
      context.operation,
      undefined,
      context.currency
    );

    const registeredProviders = capableProviders.filter(p => this.providers.has(p));
    const healthyProviders = registeredProviders.filter(p => this.healthMonitor.isHealthy(p));

    const candidates = healthyProviders.length > 0 ? healthyProviders : registeredProviders;

    if (candidates.length === 0) {
      throw new ProviderUnavailableError(
        `No providers available for ${context.operation} with currency ${context.currency}`
      );
    }

    const primary = candidates[0];

    return {
      provider: primary,
      fallback_chain: candidates.slice(1),
      estimated_fee: this.providerRouter.calculateFee(primary, context.operation, context.amount, context.currency),
      compliance_verified: false,
      regulatory_warnings: ['No country configuration — compliance not verified'],
      route_type: 'domestic',
      zone: 'global',
      reason: `Generic routing: ${primary} is the only capable healthy provider`
    };
  }

  // ===========================================================================
  // EXECUTION WITH GEO-ROUTING
  // ===========================================================================

  /**
   * Execute a payment with geo-routing intelligence
   */
  async executePayment(
    request: UnifiedPaymentRequest,
    context: GeoRoutingContext
  ): Promise<UnifiedPaymentResponse & { geo_decision: GeoRoutingDecision }> {
    const decision = this.route(context);

    let lastError: Error | null = null;
    const allProviders = [decision.provider, ...decision.fallback_chain];

    for (const providerName of allProviders) {
      const adapter = this.providers.get(providerName);
      if (!adapter) continue;

      try {
        const startTime = Date.now();
        const result = await adapter.initializePayment(request);
        const latency = Date.now() - startTime;

        this.healthMonitor.recordSuccess(providerName, latency);
        this.recordTransaction(context, providerName, 'success', latency);

        return {
          ...result,
          provider: providerName,
          geo_decision: decision
        };
      } catch (error) {
        lastError = error as Error;
        this.healthMonitor.recordFailure(providerName);
        this.recordTransaction(context, providerName, 'failed');

        if (!this.providerRouter.getHealthMonitor().isHealthy(providerName)) {
          continue; // Try next provider
        }
      }
    }

    throw lastError || new ProviderUnavailableError('All geo-routed providers failed');
  }

  /**
   * Execute a transfer with geo-routing intelligence
   */
  async executeTransfer(
    request: UnifiedTransferRequest,
    context: GeoRoutingContext
  ): Promise<UnifiedTransferResponse & { geo_decision: GeoRoutingDecision }> {
    const decision = this.route(context);

    let lastError: Error | null = null;
    const allProviders = [decision.provider, ...decision.fallback_chain];

    for (const providerName of allProviders) {
      const adapter = this.providers.get(providerName);
      if (!adapter) continue;

      try {
        const startTime = Date.now();
        const result = await adapter.createTransfer(request);
        const latency = Date.now() - startTime;

        this.healthMonitor.recordSuccess(providerName, latency);
        this.recordTransaction(context, providerName, 'success', latency);

        return {
          ...result,
          provider: providerName,
          geo_decision: decision
        };
      } catch (error) {
        lastError = error as Error;
        this.healthMonitor.recordFailure(providerName);
        this.recordTransaction(context, providerName, 'failed');
      }
    }

    throw lastError || new ProviderUnavailableError('All geo-routed providers failed');
  }

  // ===========================================================================
  // COMPLIANCE & VALIDATION
  // ===========================================================================

  /**
   * Check if a transaction is allowed based on country limits
   */
  validateTransaction(context: GeoRoutingContext): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const config = this.countryRegistry.get(context.source_country.toUpperCase());

    if (!config) {
      warnings.push('No country configuration — cannot validate limits');
      return { valid: true, errors, warnings };
    }

    // Check operation support
    if (!config.supported_operations.includes(context.operation)) {
      errors.push(`Operation '${context.operation}' not supported in ${config.country_name}`);
    }

    // Check transaction limits
    const limitError = this.checkTransactionLimits(context, config);
    if (limitError) errors.push(limitError);

    // Check KYC
    const kycWarning = this.checkKycRequirements(context, config);
    if (kycWarning) warnings.push(kycWarning);

    // Cross-border checks
    if (context.destination_country && context.destination_country.toUpperCase() !== context.source_country.toUpperCase()) {
      const corridor = this.getCorridor(context.source_country, context.destination_country);
      if (!corridor) {
        errors.push(`No cross-border corridor from ${context.source_country} to ${context.destination_country}`);
      } else {
        if (context.amount < corridor.min_amount) {
          errors.push(`Minimum amount for corridor: ${corridor.min_amount} ${context.currency}`);
        }
        if (context.amount > corridor.max_amount) {
          errors.push(`Maximum amount for corridor: ${corridor.max_amount} ${context.currency}`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Get full routing preview without executing
   */
  previewRouting(context: GeoRoutingContext): {
    decision: GeoRoutingDecision;
    validation: { valid: boolean; errors: string[]; warnings: string[] };
    alternatives: GeoRoutingDecision[];
  } {
    const validation = this.validateTransaction(context);
    const decision = this.route(context);

    // Build alternative routes from fallback chain
    const alternatives: GeoRoutingDecision[] = decision.fallback_chain.map(providerName => ({
      provider: providerName,
      fallback_chain: [],
      estimated_fee: this.providerRouter.calculateFee(providerName, context.operation, context.amount, context.currency),
      compliance_verified: decision.compliance_verified,
      regulatory_warnings: decision.regulatory_warnings,
      route_type: decision.route_type,
      zone: decision.zone,
      reason: `Alternative: ${providerName}`
    }));

    return { decision, validation, alternatives };
  }

  // ===========================================================================
  // ANALYTICS & REPORTING
  // ===========================================================================

  getAuditLog(filters?: {
    country?: string;
    provider?: ProviderName;
    route_type?: 'domestic' | 'cross_border' | 'regional';
    since?: Date;
  }): GeoRoutingAuditEntry[] {
    let log = [...this.auditLog];

    if (filters) {
      if (filters.country) {
        const country = filters.country.toUpperCase();
        log = log.filter(e => e.context.source_country === country);
      }
      if (filters.provider) {
        const provider = filters.provider;
        log = log.filter(e => e.decision.provider === provider);
      }
      if (filters.route_type) {
        const routeType = filters.route_type;
        log = log.filter(e => e.decision.route_type === routeType);
      }
      if (filters.since) {
        const since = filters.since;
        log = log.filter(e => e.timestamp >= since);
      }
    }

    return log;
  }

  getRouteAnalytics(): {
    total_routes: number;
    domestic_routes: number;
    cross_border_routes: number;
    by_country: Record<string, number>;
    by_provider: Record<string, number>;
    compliance_rate: number;
  } {
    const total = this.auditLog.length;
    const domestic = this.auditLog.filter(e => e.decision.route_type === 'domestic').length;
    const crossBorder = this.auditLog.filter(e => e.decision.route_type === 'cross_border').length;

    const byCountry: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    let compliantCount = 0;

    for (const entry of this.auditLog) {
      byCountry[entry.context.source_country] = (byCountry[entry.context.source_country] || 0) + 1;
      byProvider[entry.decision.provider] = (byProvider[entry.decision.provider] || 0) + 1;
      if (entry.decision.compliance_verified) compliantCount++;
    }

    return {
      total_routes: total,
      domestic_routes: domestic,
      cross_border_routes: crossBorder,
      by_country: byCountry,
      by_provider: byProvider,
      compliance_rate: total > 0 ? (compliantCount / total) * 100 : 100
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private resolveRouteType(context: GeoRoutingContext): 'domestic' | 'cross_border' | 'regional' {
    if (!context.destination_country) return 'domestic';
    if (context.source_country.toUpperCase() === context.destination_country.toUpperCase()) {
      return 'domestic';
    }

    const sourceConfig = this.countryRegistry.get(context.source_country.toUpperCase());
    const destConfig = this.countryRegistry.get(context.destination_country.toUpperCase());

    if (sourceConfig && destConfig && sourceConfig.zone === destConfig.zone) {
      return 'regional';
    }

    return 'cross_border';
  }

  private applyCountryPreference(
    providers: ProviderName[],
    config: CountryConfig,
    preferred?: ProviderName
  ): ProviderName[] {
    // If preferred is specified and available, put it first
    if (preferred && providers.includes(preferred)) {
      return [preferred, ...providers.filter(p => p !== preferred)];
    }

    // Sort by country config preferences
    const sorted: ProviderName[] = [];
    const remaining = [...providers];

    // Default provider first
    if (remaining.includes(config.default_provider)) {
      sorted.push(config.default_provider);
      remaining.splice(remaining.indexOf(config.default_provider), 1);
    }

    // Fallback providers in order
    for (const fallback of config.fallback_providers) {
      if (remaining.includes(fallback)) {
        sorted.push(fallback);
        remaining.splice(remaining.indexOf(fallback), 1);
      }
    }

    // Any remaining providers
    sorted.push(...remaining);

    return sorted;
  }

  private checkTransactionLimits(
    context: GeoRoutingContext,
    config: CountryConfig
  ): string | null {
    const limits = config.transaction_limits;

    if (context.amount < limits.min_amount) {
      return `Minimum amount is ${limits.min_amount} ${limits.currency}`;
    }
    if (context.amount > limits.max_amount) {
      return `Maximum amount is ${limits.max_amount} ${limits.currency}`;
    }
    if (context.amount > limits.single_transfer_limit) {
      return `Single transfer limit is ${limits.single_transfer_limit} ${limits.currency}`;
    }

    return null;
  }

  private checkKycRequirements(
    context: GeoRoutingContext,
    config: CountryConfig
  ): string | null {
    const kycTier = context.customer_kyc_tier || 0;

    if (kycTier < config.requires_kyc_tier) {
      return `KYC tier ${config.requires_kyc_tier} required for ${config.country_name} — current tier: ${kycTier}`;
    }

    // Check regulatory requirements
    for (const req of config.regulatory_requirements) {
      if (req.type === 'kyc' && req.mandatory && req.max_transaction_without) {
        if (context.amount > req.max_transaction_without && kycTier < 2) {
          return req.description;
        }
      }
    }

    return null;
  }

  private buildDecisionReason(
    provider: ProviderName,
    config: CountryConfig | undefined,
    routeType: 'domestic' | 'cross_border' | 'regional',
    corridor?: GeoCrossBorderCorridor
  ): string {
    if (routeType === 'cross_border' && corridor) {
      return `Cross-border route via ${provider} (${corridor.source_country} → ${corridor.destination_country}), FX markup: ${corridor.fx_markup_percent}%, settlement: ${corridor.settlement_speed}`;
    }

    if (config) {
      return `Domestic route in ${config.country_name}: ${provider} is the ${config.default_provider === provider ? 'primary' : 'fallback'} provider, compliance level: ${config.compliance_level}`;
    }

    return `Generic route: ${provider}`;
  }

  private recordTransaction(
    context: GeoRoutingContext,
    provider: ProviderName,
    status: 'success' | 'failed',
    latency?: number
  ): void {
    this.auditLog.push({
      timestamp: new Date(),
      context,
      decision: {
        provider,
        fallback_chain: [],
        estimated_fee: 0,
        compliance_verified: false,
        regulatory_warnings: [],
        route_type: this.resolveRouteType(context),
        zone: this.countryRegistry.get(context.source_country.toUpperCase())?.zone || 'global',
        reason: `Transaction ${status}`
      },
      status,
      latency
    });
  }

  // ===========================================================================
  // ACCESSORS
  // ===========================================================================

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  getCapabilityEngine(): CapabilityEngine {
    return this.capabilityEngine;
  }

  getProviderRouter(): ProviderRouter {
    return this.providerRouter;
  }
}

// =============================================================================
// AUDIT LOG TYPES
// =============================================================================

export interface GeoRoutingAuditEntry {
  timestamp: Date;
  context: GeoRoutingContext;
  decision: GeoRoutingDecision;
  country_config?: CountryConfig;
  corridor?: GeoCrossBorderCorridor;
  status?: 'success' | 'failed';
  latency?: number;
}

// Response type for payment execution
interface UnifiedPaymentResponse {
  id: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  provider: ProviderName;
  created_at: Date;
  updated_at: Date;
}

export default GeoRoutedOrchestrator;
