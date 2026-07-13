// TurboPay Main Entry Point
// Initializes all services, registers providers, and starts the server
// This is the single entry point for the entire TurboPay system

import { ProviderSelectionEngine } from './services/provider-selection-engine';
import { ProviderRegistry } from './services/provider-wrapper';
import { TransactionProcessor } from './services/transaction-processor';
import { LedgerService } from './services/ledger';
import { BulkPaymentService } from './services/bulk-payment';
import { SettlementReconciliationService } from './services/settlement-reconciliation';
import { InternationalTransferService } from './services/international-transfer';
import { VirtualCardService } from './services/virtual-card';
import { MultiCurrencyService } from './services/multi-currency';
import { CountryAccountsService } from './services/country-accounts';
import { WebhookHandler } from './services/webhook-handler';
import { AdminAuthService } from './admin/auth/auth.service';
import { CustomerAuthService } from './auth/customer-auth.service';
import { ProviderManagementService } from './admin/dashboard/provider-management';
import { HealthDashboard } from './admin/dashboard/health-dashboard';
import { AnalyticsDashboard } from './admin/dashboard/analytics-dashboard';
import { AuditLogService } from './admin/dashboard/audit-log';
import { MarkupConfigService } from './admin/dashboard/markup-config';
import { TurboPayRoutes } from './api/routes';
import { PersistenceManager } from './utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export interface TurboPayConfig {
  port: number;
  host: string;
  environment: 'sandbox' | 'production';
  providers: {
    paystack?: { secret_key: string; public_key: string; webhook_secret?: string };
    flutterwave?: { client_id: string; client_secret: string; encryption_key?: string; public_key?: string; webhook_secret?: string };
    flutterwave_v3?: { secret_key: string; public_key?: string; webhook_secret?: string };
    monnify?: { api_key: string; api_secret: string; contract_code: string; webhook_secret?: string };
    onafriq?: { client_id: string; client_secret: string; api_key?: string; webhook_secret?: string };
    remita?: { api_key: string; api_secret: string; merchant_id: string; webhook_secret?: string };
    quickteller?: { client_id: string; client_secret: string; merchant_code: string; terminal_id?: string; webhook_secret?: string };
  };
  jwt_secret?: string;
}

export interface TurboPayInstance {
  // Core Services
  selectionEngine: ProviderSelectionEngine;
  registry: ProviderRegistry;
  processor: TransactionProcessor;
  ledger: LedgerService;

  // Feature Services
  bulkPayment: BulkPaymentService;
  settlement: SettlementReconciliationService;
  international: InternationalTransferService;
  virtualCard: VirtualCardService;
  multiCurrency: MultiCurrencyService;
  countryAccounts: CountryAccountsService;

  // Auth Services
  adminAuth: AdminAuthService;
  customerAuth: CustomerAuthService;

  // Dashboard Services
  providerManagement: ProviderManagementService;
  healthDashboard: HealthDashboard;
  analytics: AnalyticsDashboard;
  auditLog: AuditLogService;
  markup: MarkupConfigService;

  // API
  routes: TurboPayRoutes;

  // Lifecycle
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// =============================================================================
// TURBOPAY FACTORY
// =============================================================================

export function createTurboPay(config: TurboPayConfig): TurboPayInstance {
  console.log('[TurboPay] Initializing...');

  // ===========================================================================
  // 1. CORE SERVICES
  // ===========================================================================

  const selectionEngine = new ProviderSelectionEngine();
  const registry = new ProviderRegistry();
  const ledger = new LedgerService();
  const auditLog = new AuditLogService();

  console.log('[TurboPay] Core services initialized');

  // ===========================================================================
  // 2. AUTH SERVICES
  // ===========================================================================

  const adminAuth = new AdminAuthService();
  const customerAuth = new CustomerAuthService();

  console.log('[TurboPay] Auth services initialized');

  // ===========================================================================
  // 2b. PERSISTENCE
  // ===========================================================================

  const persistence = new PersistenceManager(process.env.DATA_DIR || './data');
  adminAuth.registerPersistence(persistence);
  customerAuth.registerPersistence(persistence);
  ledger.registerPersistence(persistence);

  console.log('[TurboPay] Persistence initialized');

  // ===========================================================================
  // 3. DASHBOARD SERVICES
  // ===========================================================================

  const analytics = new AnalyticsDashboard();
  const healthDashboard = new HealthDashboard(selectionEngine, registry);
  const markup = new MarkupConfigService();

  console.log('[TurboPay] Dashboard services initialized');

  // ===========================================================================
  // 4. FEATURE SERVICES
  // ===========================================================================

  const bulkPayment = new BulkPaymentService(
    { registerProvider: async () => {}, getRegisteredProviders: () => [], getCapabilityEngine: () => ({ getSummary: () => ({} as any) }) } as any,
    ledger
  );

  const webhookHandler = new WebhookHandler(
    { registerProvider: async () => {}, getProvider: () => undefined, getRegisteredProviders: () => [] } as any,
    { enableLogging: true, enableSignatureValidation: true }
  );

  const settlement = new SettlementReconciliationService(registry, ledger, analytics, auditLog);
  const international = new InternationalTransferService(registry, selectionEngine, ledger, analytics, auditLog);
  const virtualCard = new VirtualCardService(registry, ledger, analytics, auditLog);
  const multiCurrency = new MultiCurrencyService(registry, selectionEngine, ledger, auditLog);
  const countryAccounts = new CountryAccountsService(customerAuth, multiCurrency, ledger, auditLog);

  console.log('[TurboPay] Feature services initialized');

  // ===========================================================================
  // 5. PROVIDER MANAGEMENT
  // ===========================================================================

  const providerManagement = new ProviderManagementService(
    { registerProvider: async () => {}, getRegisteredProviders: () => [], getCapabilityEngine: () => ({ getSummary: () => ({} as any) }) } as any,
    ledger,
    bulkPayment
  );

  console.log('[TurboPay] Provider management initialized');

  // ===========================================================================
  // 6. TRANSACTION PROCESSOR
  // ===========================================================================

  const processor = new TransactionProcessor(
    selectionEngine,
    registry,
    ledger,
    analytics,
    auditLog,
    webhookHandler,
    {
      max_retries: 3,
      retry_delay_ms: 1000,
      enable_failover: true,
      enable_analytics: true,
      enable_audit_log: true,
      default_country: 'NG',
      default_currency: 'NGN'
    }
  );

  console.log('[TurboPay] Transaction processor initialized');

  // ===========================================================================
  // 7. API ROUTES
  // ===========================================================================

  const routes = new TurboPayRoutes({
    processor,
    international,
    virtualCard,
    multiCurrency,
    countryAccounts,
    settlement,
    markup,
    healthDashboard,
    analytics,
    auditLog,
    adminAuth,
    customerAuth
  });

  console.log('[TurboPay] API routes initialized');

  // ===========================================================================
  // 8. PROVIDER REGISTRATION
  // ===========================================================================

  async function registerProviders(): Promise<void> {
    console.log('[TurboPay] Registering providers...');

    // Paystack
    if (config.providers.paystack) {
      try {
        const { PaystackAdapter } = await import('./adapters/paystack.adapter');
        const adapter = new PaystackAdapter({
          environment: config.environment,
          ...config.providers.paystack
        });
        registry.register(adapter);
        selectionEngine.registerProvider('paystack', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Paystack registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Paystack registration failed:', (error as Error).message);
      }
    }

    // Flutterwave v4
    if (config.providers.flutterwave) {
      try {
        const { FlutterwaveAdapter } = await import('./adapters/flutterwave.adapter');
        const adapter = new FlutterwaveAdapter({
          environment: config.environment,
          ...config.providers.flutterwave
        });
        registry.register(adapter);
        selectionEngine.registerProvider('flutterwave', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Flutterwave v4 registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Flutterwave v4 registration failed:', (error as Error).message);
      }
    }

    // Flutterwave v3 (for splits/chargebacks)
    if (config.providers.flutterwave_v3) {
      try {
        const { FlutterwaveV3Adapter } = await import('./adapters/flutterwave-v3.adapter');
        const adapter = new FlutterwaveV3Adapter({
          environment: config.environment,
          ...config.providers.flutterwave_v3
        });
        // Register v3 as a separate capability set
        selectionEngine.registerProvider('flutterwave', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Flutterwave v3 registered (splits/chargebacks/bills)');
      } catch (error) {
        console.error('[TurboPay] ✗ Flutterwave v3 registration failed:', (error as Error).message);
      }
    }

    // Monnify
    if (config.providers.monnify) {
      try {
        const { MonnifyAdapter } = await import('./adapters/monnify.adapter');
        const adapter = new MonnifyAdapter({
          environment: config.environment,
          ...config.providers.monnify
        });
        registry.register(adapter);
        selectionEngine.registerProvider('monnify', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Monnify registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Monnify registration failed:', (error as Error).message);
      }
    }

    // Onafriq
    if (config.providers.onafriq) {
      try {
        const { OnafriqAdapter } = await import('./adapters/onafriq.adapter');
        const adapter = new OnafriqAdapter({
          environment: config.environment,
          ...config.providers.onafriq
        });
        registry.register(adapter);
        selectionEngine.registerProvider('onafriq', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Onafriq registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Onafriq registration failed:', (error as Error).message);
      }
    }

    // Remita
    if (config.providers.remita) {
      try {
        const { RemitaAdapter } = await import('./adapters/remita.adapter');
        const adapter = new RemitaAdapter({
          environment: config.environment,
          ...config.providers.remita
        });
        registry.register(adapter);
        selectionEngine.registerProvider('remita', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Remita registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Remita registration failed:', (error as Error).message);
      }
    }

    // Quickteller
    if (config.providers.quickteller) {
      try {
        const { QuicktellerAdapter } = await import('./adapters/quickteller.adapter');
        const adapter = new QuicktellerAdapter({
          environment: config.environment,
          ...config.providers.quickteller
        });
        registry.register(adapter);
        selectionEngine.registerProvider('quickteller', adapter.getCapabilities());
        console.log('[TurboPay] ✓ Quickteller registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Quickteller registration failed:', (error as Error).message);
      }
    }

    const registeredProviders = registry.getNames();
    console.log(`[TurboPay] ${registeredProviders.length} provider(s) registered: ${registeredProviders.join(', ')}`);
  }

  // ===========================================================================
  // 9. LIFECYCLE
  // ===========================================================================

  async function start(): Promise<void> {
    console.log('[TurboPay] Starting...');

    // Register providers
    await registerProviders();

    // Start health monitoring
    healthDashboard.startPeriodicHealthChecks(60000);
    console.log('[TurboPay] Health monitoring started (60s interval)');

    // Run initial health check
    await healthDashboard.runHealthCheck();
    console.log('[TurboPay] Initial health check completed');

    // Log startup
    auditLog.log({
      event: 'admin.login',
      entity_type: 'system',
      entity_id: 'turbopay',
      metadata: {
        environment: config.environment,
        providers: registry.getNames(),
        port: config.port
      },
      severity: 'info'
    });

    console.log(`[TurboPay] ✓ Running on ${config.host}:${config.port} (${config.environment})`);
    console.log(`[TurboPay] ✓ API base: http://${config.host}:${config.port}/api/v1`);
  }

  async function stop(): Promise<void> {
    console.log('[TurboPay] Stopping...');

    // Flush persistence before shutdown
    persistence.stop();

    // Stop health monitoring
    healthDashboard.stopPeriodicHealthChecks();

    // Log shutdown
    auditLog.log({
      event: 'admin.logout',
      entity_type: 'system',
      entity_id: 'turbopay',
      metadata: { reason: 'shutdown' },
      severity: 'info'
    });

    console.log('[TurboPay] ✓ Stopped');
  }

  // ===========================================================================
  // RETURN INSTANCE
  // ===========================================================================

  console.log('[TurboPay] ✓ Initialization complete');

  return {
    // Core
    selectionEngine,
    registry,
    processor,
    ledger,

    // Features
    bulkPayment,
    settlement,
    international,
    virtualCard,
    multiCurrency,
    countryAccounts,

    // Auth
    adminAuth,
    customerAuth,

    // Dashboard
    providerManagement,
    healthDashboard,
    analytics,
    auditLog,
    markup,

    // API
    routes,

    // Lifecycle
    start,
    stop
  };
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default createTurboPay;
