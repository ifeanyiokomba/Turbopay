// TurboPay Admin Dashboard - Provider Management
// Comprehensive management of all payment providers, credentials, health, analytics, and services

import {
  ProviderName,
  ProviderCapabilities,
  ProviderAdapter,
  PaymentOperation,
  ProviderHealthCheckResult,
  SettlementResponse,
  AuditLog,
  LedgerEntry,
  Wallet,
  BulkPaymentFile,
  BulkPaymentReport
} from '../../types';
import { ProviderRouter, ProviderFeeStructure } from '../../services/provider-router';
import { HealthMonitor } from '../../services/health-monitor';
import { LedgerService } from '../../services/ledger';
import { BulkPaymentService } from '../../services/bulk-payment';

// =============================================================================
// TYPES
// =============================================================================

export interface ProviderCredential {
  id: string;
  provider: ProviderName;
  environment: 'sandbox' | 'production';
  keys: Record<string, string>;
  webhook_secret?: string;
  is_active: boolean;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

export interface ProviderConfig {
  id: string;
  name: ProviderName;
  display_name: string;
  is_enabled: boolean;
  environment: 'sandbox' | 'production';
  credentials: ProviderCredential[];
  fee_structure: ProviderFeeStructure;
  priority: number;
  regions: string[];
  supported_countries: string[];
  supported_currencies: string[];
  webhook_url?: string;
  callback_url?: string;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

export interface ProviderStatus {
  provider: ProviderName;
  is_healthy: boolean;
  is_enabled: boolean;
  latency: number;
  success_rate: number;
  failure_rate: number;
  last_error: string | null;
  last_health_check: Date;
  circuit_breaker_open: boolean;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  webhook_health: WebhookHealthStatus;
  api_key_status: ApiKeyStatus;
  version: string;
}

export interface WebhookHealthStatus {
  total_received: number;
  successful: number;
  failed: number;
  avg_processing_time: number;
  last_received_at: Date | null;
  last_error: string | null;
}

export interface ApiKeyStatus {
  is_valid: boolean;
  expires_at: Date | null;
  last_validated: Date | null;
  auth_type: string;
}

export interface ProviderAnalytics {
  provider: ProviderName;
  period: 'day' | 'week' | 'month';
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
  total_volume: number;
  total_fees: number;
  average_amount: number;
  success_rate: number;
  average_latency: number;
  daily_volume: DailyVolume[];
  revenue: RevenueBreakdown;
  settlement_summary: SettlementSummary;
}

export interface DailyVolume {
  date: string;
  transactions: number;
  volume: number;
  fees: number;
}

export interface RevenueBreakdown {
  collection_fees: number;
  transfer_fees: number;
  bill_payment_fees: number;
  total_revenue: number;
}

export interface SettlementSummary {
  total_settled: number;
  pending_settlement: number;
  settlement_count: number;
  last_settlement_date: Date | null;
}

export interface ProviderService {
  id: string;
  provider: ProviderName;
  name: string;
  category: string;
  operation: PaymentOperation;
  is_enabled: boolean;
  capabilities: string[];
  billers?: ServiceBiller[];
  banks?: ServiceBank[];
  currencies?: string[];
  countries?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface ServiceBiller {
  id: string;
  name: string;
  category: string;
  items: ServiceBillerItem[];
}

export interface ServiceBillerItem {
  id: string;
  name: string;
  amount?: number;
  code?: string;
}

export interface ServiceBank {
  code: string;
  name: string;
  country: string;
  type?: string;
}

export interface ServiceConfig {
  id: string;
  name: string;
  provider: ProviderName;
  operation: PaymentOperation;
  is_enabled: boolean;
  config: Record<string, any>;
  fee_override?: Partial<ProviderFeeStructure>;
  created_at: Date;
  updated_at: Date;
}

export interface AdminDashboardSummary {
  total_providers: number;
  active_providers: number;
  healthy_providers: number;
  total_transactions_today: number;
  total_volume_today: number;
  total_fees_today: number;
  success_rate_today: number;
  active_bulk_payments: number;
  pending_settlements: number;
  recent_audit_logs: AuditLog[];
}

// =============================================================================
// PROVIDER MANAGEMENT SERVICE
// =============================================================================

export class ProviderManagementService {
  private providerConfigs: Map<string, ProviderConfig> = new Map();
  private providerCredentials: Map<string, ProviderCredential> = new Map();
  private serviceConfigs: Map<string, ServiceConfig> = new Map();
  private providerServices: Map<string, ProviderService> = new Map();
  private router: ProviderRouter;
  private ledger: LedgerService;
  private bulkPaymentService: BulkPaymentService;

  // Analytics tracking (in production, backed by database)
  private transactionLog: Map<ProviderName, TransactionLogEntry[]> = new Map();
  private webhookLog: Map<ProviderName, WebhookLogEntry[]> = new Map();

  constructor(
    router: ProviderRouter,
    ledger?: LedgerService,
    bulkPaymentService?: BulkPaymentService
  ) {
    this.router = router;
    this.ledger = ledger || new LedgerService();
    this.bulkPaymentService = bulkPaymentService || new BulkPaymentService(router, this.ledger);
  }

  // ===========================================================================
  // DASHBOARD SUMMARY
  // ===========================================================================

  getDashboardSummary(): AdminDashboardSummary {
    const providers = this.router.getRegisteredProviders();
    const healthMonitor = this.router.getHealthMonitor();
    const activeProviders = providers.filter(p => this.isProviderEnabled(p));
    const healthyProviders = providers.filter(p => healthMonitor.isHealthy(p));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let totalTransactionsToday = 0;
    let totalVolumeToday = 0;
    let totalFeesToday = 0;
    let successfulToday = 0;

    for (const provider of providers) {
      const logs = this.transactionLog.get(provider) || [];
      const todayLogs = logs.filter(l => l.timestamp >= today);
      totalTransactionsToday += todayLogs.length;
      totalVolumeToday += todayLogs.reduce((sum, l) => sum + l.amount, 0);
      totalFeesToday += todayLogs.reduce((sum, l) => sum + l.fee, 0);
      successfulToday += todayLogs.filter(l => l.success).length;
    }

    return {
      total_providers: providers.length,
      active_providers: activeProviders.length,
      healthy_providers: healthyProviders.length,
      total_transactions_today: totalTransactionsToday,
      total_volume_today: totalVolumeToday,
      total_fees_today: totalFeesToday,
      success_rate_today: totalTransactionsToday > 0 ? successfulToday / totalTransactionsToday : 0,
      active_bulk_payments: 0,
      pending_settlements: 0,
      recent_audit_logs: this.ledger.getAuditLogs(undefined, undefined, 20)
    };
  }

  // ===========================================================================
  // PROVIDER CONFIGURATION
  // ===========================================================================

  getProviderConfigs(): ProviderConfig[] {
    return Array.from(this.providerConfigs.values());
  }

  getProviderConfig(id: string): ProviderConfig | undefined {
    return this.providerConfigs.get(id);
  }

  getProviderConfigByName(name: ProviderName): ProviderConfig | undefined {
    for (const config of this.providerConfigs.values()) {
      if (config.name === name) return config;
    }
    return undefined;
  }

  async saveProviderConfig(params: {
    name: ProviderName;
    display_name: string;
    environment: 'sandbox' | 'production';
    fee_structure: ProviderFeeStructure;
    priority?: number;
    regions?: string[];
    supported_countries?: string[];
    supported_currencies?: string[];
    webhook_url?: string;
    callback_url?: string;
    created_by: string;
  }): Promise<ProviderConfig> {
    const existing = this.getProviderConfigByName(params.name);

    if (existing) {
      existing.display_name = params.display_name;
      existing.environment = params.environment;
      existing.fee_structure = params.fee_structure;
      existing.regions = params.regions || existing.regions;
      existing.supported_countries = params.supported_countries || existing.supported_countries;
      existing.supported_currencies = params.supported_currencies || existing.supported_currencies;
      existing.webhook_url = params.webhook_url || existing.webhook_url;
      existing.callback_url = params.callback_url || existing.callback_url;
      existing.updated_at = new Date();
      this.providerConfigs.set(existing.id, existing);

      this.ledger.audit('provider.config.updated', 'provider', existing.id, {
        name: params.name, environment: params.environment
      }, params.created_by);

      return existing;
    }

    const newConfig: ProviderConfig = {
      id: this.generateId('config'),
      name: params.name,
      display_name: params.display_name,
      is_enabled: true,
      environment: params.environment,
      credentials: [],
      fee_structure: params.fee_structure,
      priority: params.priority || 0,
      regions: params.regions || [],
      supported_countries: params.supported_countries || [],
      supported_currencies: params.supported_currencies || [],
      webhook_url: params.webhook_url,
      callback_url: params.callback_url,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: params.created_by
    };

    this.providerConfigs.set(newConfig.id, newConfig);

    this.ledger.audit('provider.config.created', 'provider', newConfig.id, {
      name: params.name, environment: params.environment
    }, params.created_by);

    return newConfig;
  }

  // ===========================================================================
  // CREDENTIAL MANAGEMENT
  // ===========================================================================

  async saveCredential(params: {
    provider: ProviderName;
    environment: 'sandbox' | 'production';
    keys: Record<string, string>;
    webhook_secret?: string;
    expires_at?: Date;
    created_by: string;
  }): Promise<ProviderCredential> {
    const existing = Array.from(this.providerCredentials.values()).find(
      c => c.provider === params.provider && c.environment === params.environment
    );

    if (existing) {
      existing.keys = params.keys;
      existing.webhook_secret = params.webhook_secret;
      existing.expires_at = params.expires_at;
      existing.updated_at = new Date();
      this.providerCredentials.set(existing.id, existing);

      this.ledger.audit('credential.updated', 'credential', existing.id, {
        provider: params.provider, environment: params.environment
      }, params.created_by);

      return existing;
    }

    const credential: ProviderCredential = {
      id: this.generateId('cred'),
      provider: params.provider,
      environment: params.environment,
      keys: params.keys,
      webhook_secret: params.webhook_secret,
      is_active: true,
      expires_at: params.expires_at,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: params.created_by
    };

    this.providerCredentials.set(credential.id, credential);

    this.ledger.audit('credential.created', 'credential', credential.id, {
      provider: params.provider, environment: params.environment
    }, params.created_by);

    return credential;
  }

  getCredential(provider: ProviderName, environment: 'sandbox' | 'production'): ProviderCredential | undefined {
    return Array.from(this.providerCredentials.values()).find(
      c => c.provider === provider && c.environment === environment && c.is_active
    );
  }

  getProviderCredentials(provider: ProviderName): ProviderCredential[] {
    return Array.from(this.providerCredentials.values()).filter(c => c.provider === provider);
  }

  revokeCredential(credentialId: string): boolean {
    const credential = this.providerCredentials.get(credentialId);
    if (!credential) return false;
    credential.is_active = false;
    credential.updated_at = new Date();
    this.ledger.audit('credential.revoked', 'credential', credentialId);
    return true;
  }

  // ===========================================================================
  // PROVIDER TOGGLE (Enable/Disable without deployment)
  // ===========================================================================

  async toggleProvider(providerId: string, enabled: boolean): Promise<{ success: boolean; message: string }> {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      return { success: false, message: 'Provider not found' };
    }

    config.is_enabled = enabled;
    config.updated_at = new Date();
    this.providerConfigs.set(providerId, config);

    this.ledger.audit(
      enabled ? 'provider.enabled' : 'provider.disabled',
      'provider',
      providerId,
      { name: config.name }
    );

    return {
      success: true,
      message: `Provider ${config.display_name} ${enabled ? 'enabled' : 'disabled'}`
    };
  }

  isProviderEnabled(provider: ProviderName): boolean {
    const config = this.getProviderConfigByName(provider);
    return config?.is_enabled ?? false;
  }

  // ===========================================================================
  // FEE MANAGEMENT
  // ===========================================================================

  async updateProviderFees(
    providerId: string,
    fees: Partial<ProviderFeeStructure>
  ): Promise<{ success: boolean; message: string }> {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      return { success: false, message: 'Provider not found' };
    }

    config.fee_structure = { ...config.fee_structure, ...fees };
    config.updated_at = new Date();
    this.providerConfigs.set(providerId, config);

    this.router.setProviderFees(config.name, fees);

    this.ledger.audit('provider.fees.updated', 'provider', providerId, { fees });

    return { success: true, message: `Fees updated for ${config.display_name}` };
  }

  async updateProviderPriority(providerId: string, priority: number): Promise<{ success: boolean; message: string }> {
    const config = this.providerConfigs.get(providerId);
    if (!config) {
      return { success: false, message: 'Provider not found' };
    }

    config.priority = priority;
    config.updated_at = new Date();
    this.providerConfigs.set(providerId, config);

    return { success: true, message: `Priority updated for ${config.display_name}` };
  }

  // ===========================================================================
  // PROVIDER HEALTH (Live Status)
  // ===========================================================================

  async getProviderHealth(): Promise<ProviderStatus[]> {
    const providers = this.router.getRegisteredProviders();
    const healthMonitor = this.router.getHealthMonitor();

    const statuses: ProviderStatus[] = [];

    for (const provider of providers) {
      const health = healthMonitor.getHealth(provider);
      const adapter = this.router.getProvider(provider);

      // Run live health check
      let healthCheck: ProviderHealthCheckResult | null = null;
      if (adapter?.healthCheck) {
        try {
          healthCheck = await adapter.healthCheck();
        } catch {
          healthCheck = {
            provider,
            is_healthy: false,
            latency: 0,
            timestamp: new Date(),
            error: 'Health check failed'
          };
        }
      }

      const webhookLogs = this.webhookLog.get(provider) || [];
      const recentWebhooks = webhookLogs.slice(-100);
      const successfulWebhooks = recentWebhooks.filter(w => w.success).length;

      statuses.push({
        provider,
        is_healthy: healthCheck?.is_healthy ?? health.is_healthy,
        is_enabled: this.isProviderEnabled(provider),
        latency: healthCheck?.latency ?? health.average_latency,
        success_rate: health.success_count + health.failure_count > 0
          ? health.success_count / (health.success_count + health.failure_count)
          : 1,
        failure_rate: health.success_count + health.failure_count > 0
          ? health.failure_count / (health.success_count + health.failure_count)
          : 0,
        last_error: health.last_failure
          ? `Last failure at ${health.last_failure.toISOString()}`
          : null,
        last_health_check: healthCheck?.timestamp ?? health.last_health_check,
        circuit_breaker_open: false,
        total_requests: health.success_count + health.failure_count,
        successful_requests: health.success_count,
        failed_requests: health.failure_count,
        webhook_health: {
          total_received: recentWebhooks.length,
          successful: successfulWebhooks,
          failed: recentWebhooks.length - successfulWebhooks,
          avg_processing_time: recentWebhooks.length > 0
            ? recentWebhooks.reduce((sum, w) => sum + w.processing_time, 0) / recentWebhooks.length
            : 0,
          last_received_at: recentWebhooks.length > 0
            ? recentWebhooks[recentWebhooks.length - 1].timestamp
            : null,
          last_error: recentWebhooks.find(w => !w.success)?.error || null
        },
        api_key_status: this.getApiKeyStatus(provider),
        version: adapter?.baseUrl || 'unknown'
      });
    }

    return statuses;
  }

  async resetProviderHealth(provider: ProviderName): Promise<void> {
    this.router.getHealthMonitor().resetHealth(provider);
    this.ledger.audit('provider.health.reset', 'provider', provider);
  }

  // ===========================================================================
  // PROVIDER ANALYTICS
  // ===========================================================================

  getProviderAnalytics(period: 'day' | 'week' | 'month' = 'day'): ProviderAnalytics[] {
    const providers = this.router.getRegisteredProviders();
    const healthMonitor = this.router.getHealthMonitor();

    return providers.map(provider => {
      const health = healthMonitor.getHealth(provider);
      const logs = this.transactionLog.get(provider) || [];

      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      const periodLogs = logs.filter(l => l.timestamp >= startDate);
      const successfulLogs = periodLogs.filter(l => l.success);

      const totalVolume = periodLogs.reduce((sum, l) => sum + l.amount, 0);
      const totalFees = periodLogs.reduce((sum, l) => sum + l.fee, 0);

      // Daily volume breakdown
      const dailyVolume: DailyVolume[] = [];
      const dailyMap = new Map<string, { transactions: number; volume: number; fees: number }>();

      for (const log of periodLogs) {
        const dateKey = log.timestamp.toISOString().split('T')[0];
        const existing = dailyMap.get(dateKey) || { transactions: 0, volume: 0, fees: 0 };
        existing.transactions++;
        existing.volume += log.amount;
        existing.fees += log.fee;
        dailyMap.set(dateKey, existing);
      }

      for (const [date, data] of dailyMap) {
        dailyVolume.push({ date, ...data });
      }

      dailyVolume.sort((a, b) => a.date.localeCompare(b.date));

      return {
        provider,
        period,
        total_transactions: periodLogs.length,
        successful_transactions: successfulLogs.length,
        failed_transactions: periodLogs.length - successfulLogs.length,
        total_volume: totalVolume,
        total_fees: totalFees,
        average_amount: periodLogs.length > 0 ? totalVolume / periodLogs.length : 0,
        success_rate: periodLogs.length > 0 ? successfulLogs.length / periodLogs.length : 0,
        average_latency: health.average_latency,
        daily_volume: dailyVolume,
        revenue: {
          collection_fees: totalFees * 0.6,
          transfer_fees: totalFees * 0.3,
          bill_payment_fees: totalFees * 0.1,
          total_revenue: totalFees
        },
        settlement_summary: {
          total_settled: totalVolume * 0.95,
          pending_settlement: totalVolume * 0.05,
          settlement_count: Math.ceil(periodLogs.length / 10),
          last_settlement_date: now
        }
      };
    });
  }

  // ===========================================================================
  // CAPABILITY MANAGEMENT
  // ===========================================================================

  getCapabilitySummary(): Record<PaymentOperation, ProviderName[]> {
    return this.router.getCapabilitySummary();
  }

  getProviderCapabilities(provider: ProviderName): ProviderCapabilities | undefined {
    return this.router.getCapabilityEngine().getCapabilities(provider);
  }

  // ===========================================================================
  // PROVIDER SERVICES (Auto-discovery)
  // ===========================================================================

  async discoverProviderServices(provider: ProviderName): Promise<ProviderService[]> {
    const adapter = this.router.getProvider(provider);
    if (!adapter) return [];

    const services: ProviderService[] = [];
    const capabilities = adapter.getCapabilities();

    // Bill payment services
    if (capabilities.bills.airtime) {
      services.push(this.createService(provider, 'Airtime', 'bills', 'airtime'));
    }
    if (capabilities.bills.data) {
      services.push(this.createService(provider, 'Data', 'bills', 'data'));
    }
    if (capabilities.bills.electricity) {
      services.push(this.createService(provider, 'Electricity', 'bills', 'electricity'));
    }
    if (capabilities.bills.cable_tv) {
      services.push(this.createService(provider, 'Cable TV', 'bills', 'cable_tv'));
    }
    if (capabilities.bills.education) {
      services.push(this.createService(provider, 'Education', 'bills', 'education'));
    }
    if (capabilities.bills.insurance) {
      services.push(this.createService(provider, 'Insurance', 'bills', 'bill_payment'));
    }
    if (capabilities.bills.government) {
      services.push(this.createService(provider, 'Government', 'bills', 'bill_payment'));
    }

    // Collection services
    if (capabilities.collections.card) {
      services.push(this.createService(provider, 'Card Collection', 'collections', 'card_collection'));
    }
    if (capabilities.collections.bank_transfer) {
      services.push(this.createService(provider, 'Bank Transfer Collection', 'collections', 'bank_transfer_collection'));
    }
    if (capabilities.collections.ussd) {
      services.push(this.createService(provider, 'USSD Collection', 'collections', 'ussd_collection'));
    }
    if (capabilities.collections.mobile_money) {
      services.push(this.createService(provider, 'Mobile Money Collection', 'collections', 'mobile_money_collection'));
    }
    if (capabilities.collections.qr) {
      services.push(this.createService(provider, 'QR Collection', 'collections', 'qr_collection'));
    }

    // Payout services
    if (capabilities.payouts.bank_transfer) {
      services.push(this.createService(provider, 'Bank Transfer Payout', 'payouts', 'bank_transfer_payout'));
    }
    if (capabilities.payouts.mobile_money) {
      services.push(this.createService(provider, 'Mobile Money Payout', 'payouts', 'mobile_money_payout'));
    }
    if (capabilities.payouts.bulk) {
      services.push(this.createService(provider, 'Bulk Payments', 'payouts', 'bulk_payment'));
    }

    // Virtual accounts
    if (capabilities.virtual_accounts.dedicated || capabilities.virtual_accounts.dynamic) {
      services.push(this.createService(provider, 'Virtual Accounts', 'accounts', 'virtual_account'));
    }

    // Store discovered services
    for (const service of services) {
      this.providerServices.set(service.id, service);
    }

    return services;
  }

  getProviderServices(provider: ProviderName): ProviderService[] {
    return Array.from(this.providerServices.values()).filter(s => s.provider === provider);
  }

  getAllProviderServices(): ProviderService[] {
    return Array.from(this.providerServices.values());
  }

  async toggleService(serviceId: string, enabled: boolean): Promise<{ success: boolean; message: string }> {
    const service = this.providerServices.get(serviceId);
    if (!service) {
      return { success: false, message: 'Service not found' };
    }

    service.is_enabled = enabled;
    service.updated_at = new Date();

    this.ledger.audit(
      enabled ? 'service.enabled' : 'service.disabled',
      'service',
      serviceId,
      { provider: service.provider, name: service.name }
    );

    return { success: true, message: `Service ${service.name} ${enabled ? 'enabled' : 'disabled'}` };
  }

  // ===========================================================================
  // FEE COMPARISON
  // ===========================================================================

  compareFees(operation: PaymentOperation, amount: number, currency: string = 'NGN') {
    return this.router.compareFees(operation, amount, currency);
  }

  getCheapestProvider(operation: PaymentOperation, amount: number, currency: string = 'NGN'): ProviderName | null {
    const comparisons = this.compareFees(operation, amount, currency);
    return comparisons.length > 0 ? comparisons[0].provider : null;
  }

  // ===========================================================================
  // SETTLEMENT MANAGEMENT
  // ===========================================================================

  getSettlements(provider?: ProviderName): SettlementResponse[] {
    if (provider) {
      return this.ledger.getProviderSettlements(provider);
    }
    // Return all settlements from ledger
    return [];
  }

  // ===========================================================================
  // LEDGER ACCESS
  // ===========================================================================

  getLedgerEntries(walletId: string, limit?: number): LedgerEntry[] {
    return this.ledger.getLedgerEntries(walletId, { limit });
  }

  getWalletBalance(walletId: string): { balance: number; available: number; held: number } | null {
    return this.ledger.getWalletBalance(walletId);
  }

  getUserWallets(userId: string): Wallet[] {
    return this.ledger.getUserWallets(userId);
  }

  // ===========================================================================
  // BULK PAYMENT ACCESS
  // ===========================================================================

  getBulkPayments(): BulkPaymentFile[] {
    return [];
  }

  getBulkPaymentReport(id: string): BulkPaymentReport | null {
    try {
      return this.bulkPaymentService.generateReport(id);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // AUDIT LOG ACCESS
  // ===========================================================================

  getAuditLogs(entityType?: string, entityId?: string, limit?: number): AuditLog[] {
    return this.ledger.getAuditLogs(entityType, entityId, limit);
  }

  // ===========================================================================
  // RECORD TRANSACTIONS (for analytics)
  // ===========================================================================

  recordTransaction(
    provider: ProviderName,
    amount: number,
    fee: number,
    success: boolean,
    operation: string
  ): void {
    if (!this.transactionLog.has(provider)) {
      this.transactionLog.set(provider, []);
    }

    this.transactionLog.get(provider)!.push({
      amount,
      fee,
      success,
      operation,
      timestamp: new Date()
    });
  }

  recordWebhook(
    provider: ProviderName,
    success: boolean,
    processingTime: number,
    error?: string
  ): void {
    if (!this.webhookLog.has(provider)) {
      this.webhookLog.set(provider, []);
    }

    this.webhookLog.get(provider)!.push({
      success,
      processing_time: processingTime,
      error,
      timestamp: new Date()
    });
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private getApiKeyStatus(provider: ProviderName): ApiKeyStatus {
    const credential = Array.from(this.providerCredentials.values()).find(
      c => c.provider === provider && c.is_active
    );

    if (!credential) {
      return {
        is_valid: false,
        expires_at: null,
        last_validated: null,
        auth_type: 'none'
      };
    }

    return {
      is_valid: credential.is_active,
      expires_at: credential.expires_at || null,
      last_validated: credential.updated_at,
      auth_type: Object.keys(credential.keys)[0] || 'unknown'
    };
  }

  private createService(
    provider: ProviderName,
    name: string,
    category: string,
    operation: PaymentOperation
  ): ProviderService {
    const existing = Array.from(this.providerServices.values()).find(
      s => s.provider === provider && s.operation === operation
    );

    if (existing) return existing;

    const capabilities = this.router.getCapabilityEngine().getCapabilities(provider);

    return {
      id: this.generateId('svc'),
      provider,
      name,
      category,
      operation,
      is_enabled: true,
      capabilities: this.getCapabilityList(capabilities),
      countries: capabilities?.countries || [],
      currencies: capabilities?.currencies || [],
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  private getCapabilityList(capabilities: ProviderCapabilities | undefined): string[] {
    if (!capabilities) return [];

    const list: string[] = [];
    if (capabilities.collections.card) list.push('card');
    if (capabilities.collections.bank_transfer) list.push('bank_transfer');
    if (capabilities.collections.ussd) list.push('ussd');
    if (capabilities.collections.mobile_money) list.push('mobile_money');
    if (capabilities.collections.qr) list.push('qr');
    if (capabilities.payouts.bank_transfer) list.push('payout_bank');
    if (capabilities.payouts.mobile_money) list.push('payout_mobile');
    if (capabilities.payouts.bulk) list.push('bulk');
    if (capabilities.virtual_accounts.dedicated) list.push('dedicated_va');
    if (capabilities.virtual_accounts.dynamic) list.push('dynamic_va');
    if (capabilities.bills.airtime) list.push('airtime');
    if (capabilities.bills.data) list.push('data');
    if (capabilities.bills.electricity) list.push('electricity');
    if (capabilities.bills.cable_tv) list.push('cable_tv');
    if (capabilities.bills.education) list.push('education');
    if (capabilities.bills.insurance) list.push('insurance');
    if (capabilities.bills.government) list.push('government');
    if (capabilities.technical.refunds) list.push('refunds');
    if (capabilities.technical.reversals) list.push('reversals');
    if (capabilities.technical.international) list.push('international');
    if (capabilities.technical.multi_currency) list.push('multi_currency');
    return list;
  }

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface TransactionLogEntry {
  amount: number;
  fee: number;
  success: boolean;
  operation: string;
  timestamp: Date;
}

interface WebhookLogEntry {
  success: boolean;
  processing_time: number;
  error?: string;
  timestamp: Date;
}

export default ProviderManagementService;
