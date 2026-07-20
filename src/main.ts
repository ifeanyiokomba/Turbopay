// TurboPay Main Entry Point
// Initializes all services, registers providers, and starts the server
// This is the single entry point for the entire TurboPay system

import { ProviderSelectionEngine } from './services/provider-selection-engine';
import { ProviderRegistry } from './services/provider-wrapper';
import { ProviderRouter } from './services/provider-router';
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
import { OTPService } from './services/otp-service';
import { ComplianceService } from './services/compliance-service';
import { MobileMoneyOrchestrator } from './services/mobile-money-orchestrator';
import { FundingWorkflowService } from './services/funding-workflow';
import { GeoRoutedOrchestrator } from './services/geo-router';
import { AISupportService } from './services/ai-support';
import { PagaReverseAPIService } from './services/paga-reverse-api';
import { NotificationEngine } from './services/notification-engine';
import { EmailService } from './services/email-service';

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
    // Mobile Money Providers
    smartcash?: { client_id: string; client_secret: string; shortcode?: string; webhook_secret?: string };
    airtel_money?: { client_id: string; client_secret: string; api_key?: string; webhook_secret?: string };
    mtn_momo?: { api_key: string; api_secret: string; subscription_key: string; disbursement_subscription_key?: string; api_user?: string; callback_url?: string; target_environment?: string };
    mpesa?: { consumer_key: string; consumer_secret: string; shortcode: string; passkey: string; callback_url?: string; initiator_name?: string; security_credential?: string };
    paga?: { principal: string; credentials: string; hash_key: string; api_key?: string };
  };
  otp?: {
    api_key: string;
    sender_id: string;
    templates?: Record<string, { sms?: string; email_subject?: string; email_body?: string }>;
  };
  jwt_secret?: string;
}

export interface TurboPayInstance {
  // Core Services
  selectionEngine: ProviderSelectionEngine;
  registry: ProviderRegistry;
  router: ProviderRouter;
  processor: TransactionProcessor;
  ledger: LedgerService;

  // Feature Services
  bulkPayment: BulkPaymentService;
  settlement: SettlementReconciliationService;
  international: InternationalTransferService;
  virtualCard: VirtualCardService;
  multiCurrency: MultiCurrencyService;
  countryAccounts: CountryAccountsService;
  mobileMoney: MobileMoneyOrchestrator;
  fundingWorkflow: FundingWorkflowService;
  geoRouter: GeoRoutedOrchestrator;
  aiSupport: AISupportService;
  pagaReverseAPI: PagaReverseAPIService;
  notificationEngine: NotificationEngine;
  emailService: EmailService;

  // Auth & Security Services
  adminAuth: AdminAuthService;
  customerAuth: CustomerAuthService;
  otp: OTPService;
  compliance: ComplianceService;

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
  // 4. PROVIDER ROUTER (created early — used by feature services below)
  // ===========================================================================

  const router = new ProviderRouter();
  const geoRouter = new GeoRoutedOrchestrator();

  console.log('[TurboPay] Geo-Routed Orchestrator initialized');

  // ===========================================================================
  // 5. FEATURE SERVICES
  // ===========================================================================

  const bulkPayment = new BulkPaymentService(router, ledger);

  const webhookHandler = new WebhookHandler(
    router,
    { enableLogging: true, enableSignatureValidation: true }
  );

  const settlement = new SettlementReconciliationService(registry, ledger, analytics, auditLog);
  const international = new InternationalTransferService(registry, selectionEngine, ledger, analytics, auditLog);
  const virtualCard = new VirtualCardService(registry, ledger, analytics, auditLog);
  const multiCurrency = new MultiCurrencyService(registry, selectionEngine, ledger, auditLog);
  const countryAccounts = new CountryAccountsService(customerAuth, multiCurrency, ledger, auditLog);

  console.log('[TurboPay] Feature services initialized');

  // ===========================================================================
  // 5b. NEW SERVICES (OTP, Compliance, Mobile Money, Funding)
  // ===========================================================================

  const otp = new OTPService({
    api_key: config.otp?.api_key || process.env.OTP_API_KEY || '',
    sender_id: config.otp?.sender_id || process.env.OTP_SENDER_ID || '',
    templates: config.otp?.templates as any || {}
  });
  otp.registerPersistence(persistence);

  const compliance = new ComplianceService();
  compliance.registerPersistence(persistence);

  const mobileMoney = new MobileMoneyOrchestrator(selectionEngine, registry, ledger, webhookHandler);
  const fundingWorkflow = new FundingWorkflowService(selectionEngine, registry, ledger, mobileMoney);

  console.log('[TurboPay] OTP, Compliance, Mobile Money, and Funding services initialized');

  // ===========================================================================
  // 5c. AI SUPPORT & PAGA REVERSE-API
  // ===========================================================================

  const aiSupport = new AISupportService();
  aiSupport.registerPersistence(persistence);

  const pagaReverseAPI = new PagaReverseAPIService();

  const notificationEngine = new NotificationEngine();
  notificationEngine.registerPersistence(persistence);

  const emailService = new EmailService({
    api_key: process.env.RESEND_API_KEY || '',
    from_name: 'TurboPay',
    from_email: process.env.EMAIL_FROM || 'noreply@turbopay.com',
    reply_to: process.env.EMAIL_REPLY_TO || 'support@turbopay.com',
    frontend_url: process.env.FRONTEND_URL || `http://${config.host}:${config.port}`
  });
  emailService.registerPersistence(persistence);

  console.log('[TurboPay] AI Support, Paga Reverse-API, Notifications, and Email services initialized');

  // ===========================================================================
  // 6. PROVIDER MANAGEMENT
  // ===========================================================================

  const providerManagement = new ProviderManagementService(router, ledger, bulkPayment);

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
    customerAuth,
    otp,
    compliance,
    mobileMoney,
    fundingWorkflow,
    geoRouter,
    aiSupport,
    pagaReverseAPI,
    notificationEngine,
    emailService
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
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
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
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
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
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
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
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
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
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
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
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
        console.log('[TurboPay] ✓ Quickteller registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Quickteller registration failed:', (error as Error).message);
      }
    }

    // ==========================================================================
    // Mobile Money Providers
    // ==========================================================================

    // Smart Cash (Nigeria)
    if (config.providers.smartcash) {
      try {
        const { SmartCashAdapter } = await import('./adapters/smartcash.adapter');
        const adapter = new SmartCashAdapter({
          environment: config.environment,
          ...config.providers.smartcash
        });
        registry.register(adapter);
        selectionEngine.registerProvider('smartcash', adapter.getCapabilities());
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
        console.log('[TurboPay] ✓ Smart Cash registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Smart Cash registration failed:', (error as Error).message);
      }
    }

    // Airtel Money (Multi-country, excludes Nigeria)
    if (config.providers.airtel_money) {
      try {
        const { AirtelMoneyAdapter } = await import('./adapters/airtel-money.adapter');
        const adapter = new AirtelMoneyAdapter({
          environment: config.environment,
          ...config.providers.airtel_money
        });
        registry.register(adapter);
        selectionEngine.registerProvider('airtel_money', adapter.getCapabilities());
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
        console.log('[TurboPay] ✓ Airtel Money registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Airtel Money registration failed:', (error as Error).message);
      }
    }

    // MTN MoMo (Multi-country, includes Nigeria)
    if (config.providers.mtn_momo) {
      try {
        const { MTNMoMoAdapter } = await import('./adapters/mtn-momo.adapter');
        const adapter = new MTNMoMoAdapter({
          environment: config.environment,
          ...config.providers.mtn_momo
        });
        registry.register(adapter);
        selectionEngine.registerProvider('mtn_momo', adapter.getCapabilities());
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
        console.log('[TurboPay] ✓ MTN MoMo registered');
      } catch (error) {
        console.error('[TurboPay] ✗ MTN MoMo registration failed:', (error as Error).message);
      }
    }

    // M-Pesa (Kenya primarily)
    if (config.providers.mpesa) {
      try {
        const { MPesaAdapter } = await import('./adapters/mpesa.adapter');
        const adapter = new MPesaAdapter({
          environment: config.environment,
          ...config.providers.mpesa
        });
        registry.register(adapter);
        selectionEngine.registerProvider('mpesa', adapter.getCapabilities());
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
        console.log('[TurboPay] ✓ M-Pesa registered');
      } catch (error) {
        console.error('[TurboPay] ✗ M-Pesa registration failed:', (error as Error).message);
      }
    }

    // Paga (Nigeria)
    if (config.providers.paga) {
      try {
        const { PagaAdapter } = await import('./adapters/paga.adapter');
        const adapter = new PagaAdapter({
          environment: config.environment,
          ...config.providers.paga
        });
        registry.register(adapter);
        selectionEngine.registerProvider('paga', adapter.getCapabilities());
        await router.registerProvider(adapter);
        geoRouter.registerProvider(adapter);
        console.log('[TurboPay] ✓ Paga registered');
      } catch (error) {
        console.error('[TurboPay] ✗ Paga registration failed:', (error as Error).message);
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
    router,
    processor,
    ledger,

    // Features
    bulkPayment,
    settlement,
    international,
    virtualCard,
    multiCurrency,
    countryAccounts,
    mobileMoney,
    fundingWorkflow,
    geoRouter,
    aiSupport,
    pagaReverseAPI,
    notificationEngine,
    emailService,

    // Auth & Security
    adminAuth,
    customerAuth,
    otp,
    compliance,

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
