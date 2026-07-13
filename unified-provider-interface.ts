// TurboPay Unified Provider Interface
// Phase 2: Capability Engine & Provider Adapters

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

// Provider Identification
export type ProviderName = 'paystack' | 'flutterwave' | 'monnify' | 'onafriq' | 'remita' | 'quickteller';

// Payment Operations
export type PaymentOperation = 
  | 'card_collection'
  | 'bank_transfer_collection'
  | 'ussd_collection'
  | 'mobile_money_collection'
  | 'qr_collection'
  | 'bank_transfer_payout'
  | 'mobile_money_payout'
  | 'bulk_payment'
  | 'virtual_account'
  | 'bill_payment'
  | 'airtime'
  | 'data'
  | 'electricity'
  | 'cable_tv'
  | 'education';

// Transaction Status
export type TransactionStatus = 'pending' | 'processing' | 'success' | 'failed' | 'reversed';

// Transfer Type
export type TransferType = 'instant' | 'scheduled' | 'deferred';

// =============================================================================
// DATA MODELS
// =============================================================================

// Customer Information
export interface CustomerInfo {
  email: string;
  name?: {
    first: string;
    middle?: string;
    last: string;
  };
  phone?: {
    country_code: string;
    number: string;
  };
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
  };
  bvn?: string;
  nin?: string;
  metadata?: Record<string, any>;
}

// Bank Account Recipient
export interface BankRecipient {
  type: 'bank';
  bank: {
    code: string;
    account_number: string;
    name?: string;
    branch?: string;
    routing_number?: string;
    swift_code?: string;
  };
  name?: {
    first: string;
    middle?: string;
    last: string;
  };
  email?: string;
  phone?: {
    country_code: string;
    number: string;
  };
}

// Mobile Money Recipient
export interface MobileMoneyRecipient {
  type: 'mobile_money';
  mobile_money: {
    network: string;
    phone_number: string;
    country_code: string;
    country?: string;
  };
  name?: {
    first: string;
    last: string;
  };
}

// Unified Recipient
export type RecipientInfo = BankRecipient | MobileMoneyRecipient;

// Unified Payment Request
export interface UnifiedPaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  description?: string;
  metadata?: Record<string, any>;
  callback_url?: string;
  redirect_url?: string;
  customer?: CustomerInfo;
  payment_method?: {
    type: 'card' | 'bank_transfer' | 'ussd' | 'mobile_money' | 'qr';
    [key: string]: any;
  };
}

// Unified Transfer Request
export interface UnifiedTransferRequest {
  amount: number;
  currency: string;
  reference: string;
  narration?: string;
  recipient: RecipientInfo;
  type?: TransferType;
  scheduled_date?: Date;
  callback_url?: string;
  metadata?: Record<string, any>;
}

// Virtual Account Request
export interface VirtualAccountRequest {
  reference: string;
  customer_id?: string;
  customer?: CustomerInfo;
  amount: number;
  currency: string;
  account_type: 'static' | 'dynamic';
  narration?: string;
  bvn?: string;
  expiry?: number; // seconds
}

// Bill Payment Request
export interface BillPaymentRequest {
  biller_id: string;
  item_id?: string;
  amount: number;
  customer_reference: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  due_date?: Date;
  metadata?: Record<string, any>;
}

// Unified Transaction Response
export interface UnifiedTransactionResponse {
  id: string;
  reference: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  provider: ProviderName;
  provider_reference?: string;
  fees?: number;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
  payment_method_details?: Record<string, any>;
  authorization?: {
    redirect_url?: string;
    pin_required?: boolean;
    otp_required?: boolean;
    [key: string]: any;
  };
}

// Virtual Account Response
export interface VirtualAccountResponse {
  id: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
  account_type: 'static' | 'dynamic';
  status: 'active' | 'inactive';
  currency: string;
  amount: number;
  expires_at?: Date;
  customer_id?: string;
  created_at: Date;
}

// Transfer Response
export interface UnifiedTransferResponse {
  id: string;
  reference: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  provider: ProviderName;
  provider_reference?: string;
  fees?: number;
  created_at: Date;
  updated_at: Date;
  recipient?: RecipientInfo;
  metadata?: Record<string, any>;
}

// Webhook Event
export interface UnifiedWebhookEvent {
  event: string;
  data: UnifiedTransactionResponse;
  provider: ProviderName;
  signature: string;
  timestamp: Date;
  raw_payload?: any;
}

// =============================================================================
// PROVIDER CAPABILITIES
// =============================================================================

export interface ProviderCapabilities {
  provider: ProviderName;
  name: string;
  collections: {
    card: boolean;
    bank_transfer: boolean;
    ussd: boolean;
    mobile_money: boolean;
    qr: boolean;
    opay: boolean;
  };
  payouts: {
    bank_transfer: boolean;
    mobile_money: boolean;
    bulk: boolean;
    scheduled: boolean;
    instant: boolean;
  };
  virtual_accounts: {
    dedicated: boolean;
    dynamic: boolean;
    static: boolean;
    bank_selection: boolean;
  };
  bills: {
    airtime: boolean;
    data: boolean;
    electricity: boolean;
    cable_tv: boolean;
    education: boolean;
    insurance: boolean;
    government: boolean;
  };
  customers: {
    creation: boolean;
    kyc: boolean;
    bvn: boolean;
    nin: boolean;
  };
  technical: {
    webhooks: boolean;
    idempotency: boolean;
    sandbox: boolean;
    multi_currency: boolean;
    international: boolean;
    recurring: boolean;
    refunds: boolean;
    reversals: boolean;
  };
  countries: string[];
  currencies: string[];
}

// =============================================================================
// PROVIDER ADAPTER INTERFACE
// =============================================================================

export interface ProviderAdapter {
  // Provider Info
  readonly name: ProviderName;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly sandboxBaseUrl: string;
  
  // Authentication
  authenticate(): Promise<void>;
  refreshToken(): Promise<void>;
  
  // Capabilities
  getCapabilities(): ProviderCapabilities;
  
  // Collections
  initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse>;
  verifyPayment(reference: string): Promise<UnifiedTransactionResponse>;
  getPaymentStatus(id: string): Promise<UnifiedTransactionResponse>;
  
  // Payouts
  createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse>;
  verifyTransfer(reference: string): Promise<UnifiedTransferResponse>;
  getTransferStatus(id: string): Promise<UnifiedTransferResponse>;
  
  // Bulk Transfers
  createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse>;
  
  // Virtual Accounts
  createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse>;
  getVirtualAccount(id: string): Promise<VirtualAccountResponse>;
  listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]>;
  
  // Customers
  createCustomer(customer: CustomerInfo): Promise<CustomerResponse>;
  getCustomer(id: string): Promise<CustomerResponse>;
  updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse>;
  
  // Banks
  listBanks(country?: string): Promise<Bank[]>;
  resolveBank(code: string, account_number: string): Promise<BankAccountResolution>;
  
  // Bill Payments
  listBillers(): Promise<Biller[]>;
  getBillerItems(biller_id: string): Promise<BillerItem[]>;
  payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse>;
  
  // Webhooks
  validateWebhook(payload: any, signature: string): boolean;
  parseWebhookEvent(payload: any): UnifiedWebhookEvent;
}

// Supporting Types
export interface UnifiedBulkTransferResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_amount: number;
  successful_count: number;
  failed_count: number;
  transfers: UnifiedTransferResponse[];
  created_at: Date;
}

export interface CustomerResponse {
  id: string;
  email: string;
  name?: {
    first: string;
    middle?: string;
    last: string;
  };
  phone?: {
    country_code: string;
    number: string;
  };
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Bank {
  code: string;
  name: string;
  longcode?: string;
  type?: string;
  country?: string;
}

export interface BankAccountResolution {
  account_number: string;
  account_name: string;
  bank_code: string;
  bank_name: string;
}

export interface Biller {
  id: string;
  name: string;
  category: string;
  description?: string;
  payment_items?: BillerItem[];
}

export interface BillerItem {
  id: string;
  name: string;
  amount?: number;
  code?: string;
}

// =============================================================================
// PROVIDER ROUTER
// =============================================================================

export interface RouterConfig {
  health_check_interval: number; // ms
  max_retries: number;
  retry_delay: number; // ms
  failover_enabled: boolean;
  circuit_breaker_threshold: number;
  circuit_breaker_timeout: number; // ms
}

export class ProviderRouter {
  private providers: Map<ProviderName, ProviderAdapter> = new Map();
  private healthMonitor: HealthMonitor;
  private capabilityEngine: CapabilityEngine;
  private config: RouterConfig;

  constructor(config: RouterConfig) {
    this.config = config;
    this.healthMonitor = new HealthMonitor(config);
    this.capabilityEngine = new CapabilityEngine();
  }

  // Register a provider
  registerProvider(adapter: ProviderAdapter): void {
    this.providers.set(adapter.name, adapter);
    this.capabilityEngine.registerCapabilities(adapter.name, adapter.getCapabilities());
  }

  // Select best provider for a given operation
  selectProvider(
    operation: PaymentOperation,
    country: string,
    currency: string,
    preferredProvider?: ProviderName
  ): ProviderAdapter {
    // If preferred provider is specified and available, use it
    if (preferredProvider) {
      const provider = this.providers.get(preferredProvider);
      if (provider && this.healthMonitor.isHealthy(preferredProvider)) {
        return provider;
      }
    }

    // Get providers with the required capability
    const capableProviders = this.capabilityEngine.getProvidersWithCapability(
      operation,
      country,
      currency
    );

    // Filter to registered providers
    const registeredProviders = capableProviders.filter(p => this.providers.has(p));

    // Filter by health status
    const healthyProviders = registeredProviders.filter(p => 
      this.healthMonitor.isHealthy(p)
    );

    // If no healthy providers, try all capable providers
    const candidatesToScore = healthyProviders.length > 0 ? healthyProviders : registeredProviders;

    if (candidatesToScore.length === 0) {
      throw new ProviderUnavailableError(
        `No providers available for operation ${operation} in ${country} with currency ${currency}`
      );
    }

    // Sort by score
    const scoredProviders = candidatesToScore.map(p => ({
      provider: p,
      score: this.calculateScore(p, operation, country, currency)
    })).sort((a, b) => b.score - a.score);

    return this.providers.get(scoredProviders[0].provider)!;
  }

  // Execute operation with failover
  async executeWithFailover<T>(
    operation: PaymentOperation,
    country: string,
    currency: string,
    executor: (adapter: ProviderAdapter) => Promise<T>
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

    let lastError: Error | null = null;

    for (const providerName of candidates) {
      try {
        const adapter = this.providers.get(providerName)!;
        const result = await executor(adapter);
        this.healthMonitor.recordSuccess(providerName);
        return { ...result, provider: providerName };
      } catch (error) {
        lastError = error as Error;
        this.healthMonitor.recordFailure(providerName);
        
        if (!this.config.failover_enabled) {
          throw error;
        }
      }
    }

    throw lastError || new ProviderUnavailableError('All providers failed');
  }

  // Calculate provider score
  private calculateScore(
    providerName: ProviderName,
    operation: PaymentOperation,
    country: string,
    currency: string
  ): number {
    const health = this.healthMonitor.getHealthScore(providerName);
    const latency = this.healthMonitor.getLatencyScore(providerName);
    const successRate = this.healthMonitor.getSuccessRate(providerName);
    const featureMatch = this.capabilityEngine.getFeatureMatch(providerName, operation);

    // Weighted scoring
    return (health * 0.25) + (latency * 0.2) + (successRate * 0.3) + (featureMatch * 0.25);
  }

  // Get provider adapter
  getProvider(name: ProviderName): ProviderAdapter | undefined {
    return this.providers.get(name);
  }

  // Get all registered providers
  getRegisteredProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }
}

// =============================================================================
// HEALTH MONITOR
// =============================================================================

interface ProviderHealth {
  is_healthy: boolean;
  success_count: number;
  failure_count: number;
  last_success: Date | null;
  last_failure: Date | null;
  average_latency: number;
  recent_latencies: number[];
}

export class HealthMonitor {
  private health: Map<ProviderName, ProviderHealth> = new Map();
  private config: RouterConfig;
  private circuit_breakers: Map<ProviderName, { is_open: boolean; opened_at: Date | null }> = new Map();

  constructor(config: RouterConfig) {
    this.config = config;
  }

  // Check if provider is healthy
  isHealthy(provider: ProviderName): boolean {
    const providerHealth = this.health.get(provider);
    const circuitBreaker = this.circuit_breakers.get(provider);

    // Check circuit breaker
    if (circuitBreaker?.is_open) {
      const timeSinceOpen = Date.now() - circuitBreaker.opened_at!.getTime();
      if (timeSinceOpen > this.config.circuit_breaker_timeout) {
        // Reset circuit breaker
        circuitBreaker.is_open = false;
        circuitBreaker.opened_at = null;
      } else {
        return false;
      }
    }

    if (!providerHealth) {
      return true; // Default to healthy if no data
    }

    return providerHealth.is_healthy;
  }

  // Record successful operation
  recordSuccess(provider: ProviderName): void {
    const providerHealth = this.getOrCreateHealth(provider);
    providerHealth.success_count++;
    providerHealth.last_success = new Date();
    providerHealth.is_healthy = true;

    // Reset circuit breaker
    const circuitBreaker = this.circuit_breakers.get(provider);
    if (circuitBreaker?.is_open) {
      circuitBreaker.is_open = false;
      circuitBreaker.opened_at = null;
    }
  }

  // Record failed operation
  recordFailure(provider: ProviderName): void {
    const providerHealth = this.getOrCreateHealth(provider);
    providerHealth.failure_count++;
    providerHealth.last_failure = new Date();

    // Check if we should open circuit breaker
    const totalRequests = providerHealth.success_count + providerHealth.failure_count;
    const failureRate = providerHealth.failure_count / totalRequests;

    if (totalRequests >= 10 && failureRate > 0.5) {
      this.openCircuitBreaker(provider);
    }
  }

  // Record latency
  recordLatency(provider: ProviderName, latency: number): void {
    const providerHealth = this.getOrCreateHealth(provider);
    providerHealth.recent_latencies.push(latency);
    
    // Keep only last 100 latencies
    if (providerHealth.recent_latencies.length > 100) {
      providerHealth.recent_latencies.shift();
    }

    // Calculate average
    providerHealth.average_latency = 
      providerHealth.recent_latencies.reduce((a, b) => a + b, 0) / 
      providerHealth.recent_latencies.length;
  }

  // Get health score (0-1)
  getHealthScore(provider: ProviderName): number {
    const providerHealth = this.health.get(provider);
    if (!providerHealth) return 1;

    const totalRequests = providerHealth.success_count + providerHealth.failure_count;
    if (totalRequests === 0) return 1;

    const successRate = providerHealth.success_count / totalRequests;
    return Math.min(successRate * 1.2, 1); // Slight boost for high success rates
  }

  // Get latency score (0-1, lower latency = higher score)
  getLatencyScore(provider: ProviderName): number {
    const providerHealth = this.health.get(provider);
    if (!providerHealth || providerHealth.average_latency === 0) return 1;

    // Normalize: 0ms = 1.0, 5000ms = 0.0
    const score = 1 - (providerHealth.average_latency / 5000);
    return Math.max(0, Math.min(score, 1));
  }

  // Get success rate (0-1)
  getSuccessRate(provider: ProviderName): number {
    const providerHealth = this.health.get(provider);
    if (!providerHealth) return 1;

    const totalRequests = providerHealth.success_count + providerHealth.failure_count;
    if (totalRequests === 0) return 1;

    return providerHealth.success_count / totalRequests;
  }

  // Open circuit breaker
  private openCircuitBreaker(provider: ProviderName): void {
    this.circuit_breakers.set(provider, {
      is_open: true,
      opened_at: new Date()
    });
  }

  // Get or create health record
  private getOrCreateHealth(provider: ProviderName): ProviderHealth {
    if (!this.health.has(provider)) {
      this.health.set(provider, {
        is_healthy: true,
        success_count: 0,
        failure_count: 0,
        last_success: null,
        last_failure: null,
        average_latency: 0,
        recent_latencies: []
      });
    }
    return this.health.get(provider)!;
  }
}

// =============================================================================
// CAPABILITY ENGINE
// =============================================================================

export class CapabilityEngine {
  private capabilities: Map<ProviderName, ProviderCapabilities> = new Map();

  // Register provider capabilities
  registerCapabilities(provider: ProviderName, capabilities: ProviderCapabilities): void {
    this.capabilities.set(provider, capabilities);
  }

  // Get providers with specific capability
  getProvidersWithCapability(
    operation: PaymentOperation,
    country?: string,
    currency?: string
  ): ProviderName[] {
    const providers: ProviderName[] = [];

    for (const [provider, caps] of this.capabilities) {
      if (this.hasCapability(caps, operation)) {
        // Check country support if specified
        if (country && caps.countries.length > 0) {
          if (!caps.countries.includes(country)) {
            continue;
          }
        }

        // Check currency support if specified
        if (currency && caps.currencies.length > 0) {
          if (!caps.currencies.includes(currency)) {
            continue;
          }
        }

        providers.push(provider);
      }
    }

    return providers;
  }

  // Check if provider has specific capability
  private hasCapability(caps: ProviderCapabilities, operation: PaymentOperation): boolean {
    switch (operation) {
      case 'card_collection':
        return caps.collections.card;
      case 'bank_transfer_collection':
        return caps.collections.bank_transfer;
      case 'ussd_collection':
        return caps.collections.ussd;
      case 'mobile_money_collection':
        return caps.collections.mobile_money;
      case 'qr_collection':
        return caps.collections.qr;
      case 'bank_transfer_payout':
        return caps.payouts.bank_transfer;
      case 'mobile_money_payout':
        return caps.payouts.mobile_money;
      case 'bulk_payment':
        return caps.payouts.bulk;
      case 'virtual_account':
        return caps.virtual_accounts.dedicated || caps.virtual_accounts.dynamic || caps.virtual_accounts.static;
      case 'bill_payment':
        return caps.bills.airtime || caps.bills.data || caps.bills.electricity || caps.bills.cable_tv;
      case 'airtime':
        return caps.bills.airtime;
      case 'data':
        return caps.bills.data;
      case 'electricity':
        return caps.bills.electricity;
      case 'cable_tv':
        return caps.bills.cable_tv;
      case 'education':
        return caps.bills.education;
      default:
        return false;
    }
  }

  // Get feature match score (0-1)
  getFeatureMatch(provider: ProviderName, operation: PaymentOperation): number {
    const caps = this.capabilities.get(provider);
    if (!caps) return 0;

    const hasCapability = this.hasCapability(caps, operation);
    return hasCapability ? 1 : 0;
  }

  // Get provider capabilities
  getCapabilities(provider: ProviderName): ProviderCapabilities | undefined {
    return this.capabilities.get(provider);
  }

  // Get all capabilities
  getAllCapabilities(): Map<ProviderName, ProviderCapabilities> {
    return this.capabilities;
  }
}

// =============================================================================
// CUSTOM ERRORS
// =============================================================================

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class PaymentFailedError extends Error {
  public provider: ProviderName;
  public provider_error?: string;

  constructor(message: string, provider: ProviderName, provider_error?: string) {
    super(message);
    this.name = 'PaymentFailedError';
    this.provider = provider;
    this.provider_error = provider_error;
  }
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  ProviderName,
  PaymentOperation,
  TransactionStatus,
  TransferType,
  CustomerInfo,
  BankRecipient,
  MobileMoneyRecipient,
  RecipientInfo,
  UnifiedPaymentRequest,
  UnifiedTransferRequest,
  VirtualAccountRequest,
  BillPaymentRequest,
  UnifiedTransactionResponse,
  VirtualAccountResponse,
  UnifiedTransferResponse,
  UnifiedWebhookEvent,
  ProviderCapabilities,
  ProviderAdapter,
  ProviderRouter,
  HealthMonitor,
  CapabilityEngine,
  RouterConfig,
  UnifiedBulkTransferResponse,
  CustomerResponse,
  Bank,
  BankAccountResolution,
  Biller,
  BillerItem
};
