// TurboPay API Routes
// REST API endpoints for all services
// Exposes: Auth, Payments, Transfers, Bill Payments, Virtual Accounts, Wallets, Admin

import { TransactionProcessor } from '../services/transaction-processor';
import { InternationalTransferService } from '../services/international-transfer';
import { VirtualCardService } from '../services/virtual-card';
import { MultiCurrencyService } from '../services/multi-currency';
import { CountryAccountsService } from '../services/country-accounts';
import { SettlementReconciliationService } from '../services/settlement-reconciliation';
import { MarkupConfigService } from '../admin/dashboard/markup-config';
import { HealthDashboard } from '../admin/dashboard/health-dashboard';
import { AnalyticsDashboard } from '../admin/dashboard/analytics-dashboard';
import { AuditLogService } from '../admin/dashboard/audit-log';
import { AdminAuthService } from '../admin/auth/auth.service';
import { CustomerAuthService } from '../auth/customer-auth.service';
import { GeoRoutedOrchestrator } from '../services/geo-router';
import { GeoRoutingContext } from '../types';
import { ComplianceService } from '../services/compliance-service';

// =============================================================================
// ROUTE DEFINITIONS
// =============================================================================

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: any, res: any) => Promise<void>;
  middleware?: any[];
  description: string;
  requiredBodyFields?: string[];
  auth?: 'admin' | 'customer' | 'none';
}

export class TurboPayRoutes {
  private processor: TransactionProcessor;
  private international: InternationalTransferService;
  private virtualCard: VirtualCardService;
  private multiCurrency: MultiCurrencyService;
  private countryAccounts: CountryAccountsService;
  private settlement: SettlementReconciliationService;
  private markup: MarkupConfigService;
  private healthDashboard: HealthDashboard;
  private analytics: AnalyticsDashboard;
  private auditLog: AuditLogService;
  private adminAuth: AdminAuthService;
  private customerAuth: CustomerAuthService;
  private otp: any;
  private compliance: ComplianceService | undefined;
  private mobileMoney: any;
  private fundingWorkflow: any;
  private geoRouter: GeoRoutedOrchestrator | undefined;

  constructor(deps: {
    processor: TransactionProcessor;
    international: InternationalTransferService;
    virtualCard: VirtualCardService;
    multiCurrency: MultiCurrencyService;
    countryAccounts: CountryAccountsService;
    settlement: SettlementReconciliationService;
    markup: MarkupConfigService;
    healthDashboard: HealthDashboard;
    analytics: AnalyticsDashboard;
    auditLog: AuditLogService;
    adminAuth: AdminAuthService;
    customerAuth: CustomerAuthService;
    otp?: any;
    compliance?: ComplianceService;
    mobileMoney?: any;
    fundingWorkflow?: any;
    geoRouter?: GeoRoutedOrchestrator;
  }) {
    this.processor = deps.processor;
    this.international = deps.international;
    this.virtualCard = deps.virtualCard;
    this.multiCurrency = deps.multiCurrency;
    this.countryAccounts = deps.countryAccounts;
    this.settlement = deps.settlement;
    this.markup = deps.markup;
    this.healthDashboard = deps.healthDashboard;
    this.analytics = deps.analytics;
    this.auditLog = deps.auditLog;
    this.adminAuth = deps.adminAuth;
    this.customerAuth = deps.customerAuth;
    this.otp = deps.otp;
    this.compliance = deps.compliance;
    this.mobileMoney = deps.mobileMoney;
    this.fundingWorkflow = deps.fundingWorkflow;
    this.geoRouter = deps.geoRouter;
  }

  // ===========================================================================
  // ALL ROUTES
  // ===========================================================================

  getRoutes(): Route[] {
    return [
      // AUTH
      ...this.authRoutes(),
      // PAYMENTS
      ...this.paymentRoutes(),
      // TRANSFERS
      ...this.transferRoutes(),
      // BILL PAYMENTS
      ...this.billPaymentRoutes(),
      // VIRTUAL ACCOUNTS
      ...this.virtualAccountRoutes(),
      // VIRTUAL CARDS
      ...this.virtualCardRoutes(),
      // INTERNATIONAL TRANSFERS
      ...this.internationalRoutes(),
      // WALLETS & CURRENCY
      ...this.walletRoutes(),
      // ADMIN
      ...this.adminRoutes(),
      // HEALTH & ANALYTICS
      ...this.healthRoutes(),
      // GEO-ROUTING
      ...this.geoRoutes(),
      // COMPLIANCE & SECURITY
      ...this.complianceRoutes(),
    ];
  }

  // ===========================================================================
  // AUTH ROUTES
  // ===========================================================================

  private authRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/auth/admin/login',
        description: 'Admin login',
        requiredBodyFields: ['email', 'password'],
        handler: async (req, res) => {
          const result = await this.adminAuth.login(req.body);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/auth/admin/logout',
        description: 'Admin logout',
        handler: async (req, res) => {
          await this.adminAuth.logout(req.headers.authorization?.replace('Bearer ', '') || '');
          res.json({ success: true });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/auth/admin/password-reset',
        description: 'Admin password reset request',
        requiredBodyFields: ['email'],
        handler: async (req, res) => {
          const result = await this.adminAuth.requestPasswordReset(req.body.email);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/auth/admin/password-reset/confirm',
        description: 'Admin password reset confirm',
        requiredBodyFields: ['token', 'new_password'],
        handler: async (req, res) => {
          const result = await this.adminAuth.confirmPasswordReset(req.body.token, req.body.new_password);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/auth/customer/register',
        description: 'Customer registration',
        requiredBodyFields: ['email', 'password', 'first_name', 'last_name'],
        handler: async (req, res) => {
          const result = await this.customerAuth.register(req.body);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/auth/customer/login',
        description: 'Customer login',
        requiredBodyFields: ['email', 'password'],
        handler: async (req, res) => {
          const result = await this.customerAuth.login(req.body);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/auth/customer/kyc',
        description: 'Customer KYC verification',
        handler: async (req, res) => {
          const result = await this.customerAuth.verifyKYC({
            user_id: req.user?.id,
            bvn: req.body.bvn,
            nin: req.body.nin,
            verification_method: req.body.verification_method || 'monnify'
          });
          res.json(result);
        }
      },
    ];
  }

  // ===========================================================================
  // PAYMENT ROUTES
  // ===========================================================================

  private paymentRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/payments/initialize',
        description: 'Initialize a payment',
        auth: 'customer',
        requiredBodyFields: ['amount', 'currency', 'country'],
        handler: async (req, res) => {
          const result = await this.processor.processPayment({
            request: req.body,
            country: req.body.country,
            currency: req.body.currency,
            preferred_provider: req.body.preferred_provider
          });
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/payments/verify/:reference',
        description: 'Verify a payment',
        auth: 'customer',
        handler: async (req, res) => {
          const result = await this.processor.verifyPayment(req.params.reference, req.query.provider);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/payments/refund',
        description: 'Process a refund',
        auth: 'customer',
        requiredBodyFields: ['transaction_id', 'amount'],
        handler: async (req, res) => {
          const result = await this.processor.processRefund({
            transaction_id: req.body.transaction_id,
            amount: req.body.amount,
            reason: req.body.reason,
            country: req.body.country,
            currency: req.body.currency,
            preferred_provider: req.body.preferred_provider
          });
          res.json(result);
        }
      },
    ];
  }

  // ===========================================================================
  // TRANSFER ROUTES
  // ===========================================================================

  private transferRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/transfers/single',
        description: 'Process a single transfer',
        auth: 'customer',
        requiredBodyFields: ['amount', 'currency', 'country'],
        handler: async (req, res) => {
          const result = await this.processor.processTransfer({
            request: req.body,
            country: req.body.country,
            currency: req.body.currency,
            preferred_provider: req.body.preferred_provider
          });
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/transfers/bulk',
        description: 'Process bulk transfers',
        auth: 'customer',
        requiredBodyFields: ['transfers'],
        handler: async (req, res) => {
          const result = await this.processor.processBulkTransfers(
            req.body.transfers,
            req.body.country,
            req.body.currency,
            req.body.preferred_provider
          );
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/banks',
        description: 'List banks',
        handler: async (req, res) => {
          const result = await this.processor.listBanks(req.query.country, req.query.provider);
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/banks/resolve',
        description: 'Resolve bank account',
        requiredBodyFields: ['code', 'account_number'],
        handler: async (req, res) => {
          const result = await this.processor.resolveBank(req.body.code, req.body.account_number, req.body.provider);
          res.json(result);
        }
      },
    ];
  }

  // ===========================================================================
  // BILL PAYMENT ROUTES
  // ===========================================================================

  private billPaymentRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/bills/pay',
        description: 'Pay a bill',
        auth: 'customer',
        requiredBodyFields: ['amount', 'currency', 'country'],
        handler: async (req, res) => {
          const result = await this.processor.processBillPayment({
            request: req.body,
            country: req.body.country,
            currency: req.body.currency,
            preferred_provider: req.body.preferred_provider
          });
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/bills/billers',
        description: 'List billers',
        handler: async (req, res) => {
          const result = await this.processor.listBillers(req.query.provider);
          res.json(result);
        }
      },
    ];
  }

  // ===========================================================================
  // VIRTUAL ACCOUNT ROUTES
  // ===========================================================================

  private virtualAccountRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/virtual-accounts',
        description: 'Create virtual account',
        auth: 'customer',
        requiredBodyFields: ['country', 'currency'],
        handler: async (req, res) => {
          const result = await this.processor.processVirtualAccount({
            request: req.body,
            country: req.body.country,
            currency: req.body.currency,
            preferred_provider: req.body.preferred_provider
          });
          res.json(result);
        }
      },
    ];
  }

  // ===========================================================================
  // VIRTUAL CARD ROUTES
  // ===========================================================================

  private virtualCardRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/cards/create',
        description: 'Create virtual card',
        auth: 'customer',
        requiredBodyFields: ['currency', 'amount'],
        handler: async (req, res) => {
          try {
            const card = await this.virtualCard.createCard({
              ...req.body,
              user_id: req.user?.id
            });
            res.json({ success: true, card });
          } catch (error) {
            res.json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'POST',
        path: '/api/v1/cards/block',
        description: 'Block virtual card',
        auth: 'customer',
        requiredBodyFields: ['card_id'],
        handler: async (req, res) => {
          try {
            const card = await this.virtualCard.blockCard({
              card_id: req.body.card_id,
              provider: req.body.provider,
              reason: req.body.reason
            });
            res.json({ success: true, card });
          } catch (error) {
            res.json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'POST',
        path: '/api/v1/cards/unblock',
        description: 'Unblock virtual card',
        auth: 'customer',
        requiredBodyFields: ['card_id'],
        handler: async (req, res) => {
          try {
            const card = await this.virtualCard.unblockCard({
              card_id: req.body.card_id,
              provider: req.body.provider
            });
            res.json({ success: true, card });
          } catch (error) {
            res.json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'GET',
        path: '/api/v1/cards',
        description: 'List user cards',
        auth: 'customer',
        handler: async (req, res) => {
          const cards = this.virtualCard.getUserCards(req.user?.id);
          res.json({ success: true, cards });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/cards/supported-providers',
        description: 'List providers with card support',
        handler: async (req, res) => {
          const providers = this.virtualCard.getSupportedProviders();
          res.json({ success: true, providers });
        }
      },
    ];
  }

  // ===========================================================================
  // INTERNATIONAL TRANSFER ROUTES
  // ===========================================================================

  private internationalRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/international/transfer',
        description: 'Process international transfer',
        auth: 'customer',
        requiredBodyFields: ['amount', 'source_currency', 'destination_currency'],
        handler: async (req, res) => {
          const result = await this.international.transfer(req.body);
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/international/corridors',
        description: 'List supported corridors',
        handler: async (req, res) => {
          const corridors = this.international.getSupportedCorridors(
            req.query.source_country,
            req.query.destination_country
          );
          res.json({ success: true, corridors });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/international/rates',
        description: 'Compare exchange rates',
        auth: 'customer',
        requiredBodyFields: ['from_currency', 'to_currency', 'amount'],
        handler: async (req, res) => {
          const rates = await this.international.compareExchangeRates(
            req.body.from_currency,
            req.body.to_currency,
            req.body.amount
          );
          res.json({ success: true, rates });
        }
      },
    ];
  }

  // ===========================================================================
  // WALLET & CURRENCY ROUTES
  // ===========================================================================

  private walletRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/account/create',
        description: 'Create country-tailored account',
        auth: 'customer',
        handler: async (req, res) => {
          try {
            const account = await this.countryAccounts.createAccount(req.body);
            res.json({ success: true, account });
          } catch (error) {
            res.json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'GET',
        path: '/api/v1/account',
        description: 'Get user account',
        auth: 'customer',
        handler: async (req, res) => {
          const account = this.countryAccounts.getAccount(req.user?.id);
          res.json({ success: true, account });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/wallet/fund',
        description: 'Fund wallet',
        auth: 'customer',
        handler: async (req, res) => {
          const result = await this.countryAccounts.fundWallet({
            ...req.body,
            user_id: req.user?.id
          });
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/wallet/balance',
        description: 'Get wallet balance',
        auth: 'customer',
        handler: async (req, res) => {
          const wallets = this.multiCurrency.getUserWallets(req.user?.id);
          res.json({ success: true, wallets });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/wallet/convert',
        description: 'Convert currency',
        auth: 'customer',
        handler: async (req, res) => {
          const result = await this.countryAccounts.convertCurrency({
            ...req.body,
            user_id: req.user?.id
          });
          res.json(result);
        }
      },
      {
        method: 'POST',
        path: '/api/v1/wallet/add-currency',
        description: 'Add additional currency',
        auth: 'customer',
        handler: async (req, res) => {
          const result = await this.multiCurrency.addCurrency({
            ...req.body,
            user_id: req.user?.id
          });
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/currencies',
        description: 'List supported currencies',
        handler: async (req, res) => {
          const currencies = this.multiCurrency.getSupportedCurrencies(req.query.country);
          res.json({ success: true, currencies });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/countries',
        description: 'List supported countries',
        handler: async (req, res) => {
          const countries = this.multiCurrency.getAllCountryConfigs();
          res.json({ success: true, countries });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/funding-methods/:country',
        description: 'Get funding methods for country',
        handler: async (req, res) => {
          const methods = this.multiCurrency.getFundingMethods(req.params.country, req.query.currency);
          res.json({ success: true, methods });
        }
      },
    ];
  }

  // ===========================================================================
  // ADMIN ROUTES
  // ===========================================================================

  /**
   * Verify the request has a valid admin session.
   * Returns true if authenticated, false otherwise (sends 401/403 response).
   */
  private async requireAdmin(req: any, res: any): Promise<boolean> {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return false;
    }
    if (req.user.role !== 'master_admin' && req.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return false;
    }
    return true;
  }

  private adminRoutes(): Route[] {
    return [
      // Markup Configuration
      {
        method: 'GET',
        path: '/api/v1/admin/markup/rules',
        description: 'List markup rules',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const rules = this.markup.getAllRules();
          res.json({ success: true, rules });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/admin/markup/rules',
        description: 'Create markup rule',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const rule = this.markup.createRule({ ...req.body, created_by: req.user?.id });
          res.json({ success: true, rule });
        }
      },
      {
        method: 'PUT',
        path: '/api/v1/admin/markup/rules/:id',
        description: 'Update markup rule',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const rule = this.markup.updateRule(req.params.id, req.body);
          res.json({ success: true, rule });
        }
      },
      {
        method: 'DELETE',
        path: '/api/v1/admin/markup/rules/:id',
        description: 'Delete markup rule',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const deleted = this.markup.deleteRule(req.params.id);
          res.json({ success: deleted });
        }
      },

      // Settlement
      {
        method: 'POST',
        path: '/api/v1/admin/settlements/initiate',
        description: 'Initiate settlement',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const batch = await this.settlement.initiateSettlement(req.body);
          res.json({ success: true, batch });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/admin/settlements/pending',
        description: 'List pending settlements',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const settlements = this.settlement.getPendingSettlements();
          res.json({ success: true, settlements });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/admin/settlements/summary',
        description: 'Get settlement summary',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const summary = this.settlement.getSettlementSummary(req.query.provider);
          res.json({ success: true, summary });
        }
      },

      // Reconciliation
      {
        method: 'POST',
        path: '/api/v1/admin/reconciliation',
        description: 'Reconcile transaction',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const record = await this.settlement.reconcileTransaction(req.body);
          res.json({ success: true, record });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/admin/reconciliation/report',
        description: 'Generate reconciliation report',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const report = await this.settlement.generateReconciliationReport({
            provider: req.query.provider,
            start_date: new Date(req.query.start_date),
            end_date: new Date(req.query.end_date)
          });
          res.json({ success: true, report });
        }
      },

      // Users
      {
        method: 'GET',
        path: '/api/v1/admin/users',
        description: 'List admin users',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const users = this.adminAuth.getAllUsers();
          res.json({ success: true, users });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/admin/users',
        description: 'Create admin user',
        requiredBodyFields: ['email', 'password', 'first_name', 'last_name', 'role'],
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const user = await this.adminAuth.createUser({ ...req.body, created_by: req.user?.id });
          res.json({ success: true, user });
        }
      },

      // Audit Log
      {
        method: 'GET',
        path: '/api/v1/admin/audit-log',
        description: 'Query audit log',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const entries = this.auditLog.query({
            event: req.query.event,
            entity_type: req.query.entity_type,
            actor: req.query.actor,
            severity: req.query.severity,
            start_date: req.query.start_date ? new Date(req.query.start_date) : undefined,
            end_date: req.query.end_date ? new Date(req.query.end_date) : undefined,
            limit: parseInt(req.query.limit || '100'),
            offset: parseInt(req.query.offset || '0')
          });
          res.json({ success: true, entries });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/admin/audit-log/stats',
        description: 'Get audit log stats',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const stats = this.auditLog.getStats(req.query.period || 'day');
          res.json({ success: true, stats });
        }
      },
    ];
  }

  // ===========================================================================
  // HEALTH & ANALYTICS ROUTES
  // ===========================================================================

  private healthRoutes(): Route[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/webhooks/:provider',
        description: 'Receive webhook from payment provider',
        handler: async (req, res) => {
          try {
            const result = await this.processor.processWebhook(
              req.params.provider,
              req.body,
              req.headers
            );
            res.json(result);
          } catch (error) {
            res.status(500).json({ error: (error as Error).message });
          }
        }
      },
      {
        method: 'GET',
        path: '/api/v1/health',
        description: 'System health check',
        handler: async (req, res) => {
          const result = await this.processor.healthCheck();
          res.json(result);
        }
      },
      {
        method: 'GET',
        path: '/api/v1/health/providers',
        description: 'Provider health status',
        handler: async (req, res) => {
          const statuses = this.healthDashboard.getAllProviderStatuses();
          res.json({ success: true, statuses });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/health/summary',
        description: 'Health dashboard summary',
        handler: async (req, res) => {
          const summary = this.healthDashboard.getSummary();
          res.json({ success: true, summary });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/health/check',
        description: 'Run health check',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const results = await this.healthDashboard.runHealthCheck();
          res.json({ success: true, results });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/summary',
        description: 'Analytics summary',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const summary = this.analytics.getSummary(req.query.period || 'day');
          res.json({ success: true, summary });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/providers',
        description: 'Provider analytics',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const analytics = this.analytics.getAllProviderAnalytics(req.query.period || 'day');
          res.json({ success: true, analytics });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/analytics/cost-comparison',
        description: 'Cost comparison across providers',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const comparison = this.analytics.getCostComparison(req.query.operation);
          res.json({ success: true, comparison });
        }
      },
    ];
  }

  // ===========================================================================
  // COMPLIANCE & SECURITY ROUTES
  // ===========================================================================

  private complianceRoutes(): Route[] {
    if (!this.compliance) return [];
    const compliance = this.compliance;

    return [
      // Homepage Trust Data
      {
        method: 'GET',
        path: '/api/v1/trust',
        description: 'Get homepage trust data (indicators, compliance, badges, logos)',
        handler: async (req, res) => {
          const data = compliance.getHomepageTrustData();
          res.json({ success: true, data });
        }
      },

      // Compliance Certifications
      {
        method: 'GET',
        path: '/api/v1/admin/compliance/certifications',
        description: 'List all compliance certifications',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const certs = compliance.getAllCertifications();
          res.json({ success: true, certifications: certs });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/admin/compliance/certifications',
        description: 'Create compliance certification',
        requiredBodyFields: ['name', 'description', 'status'],
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const cert = compliance.createCertification(
            { ...req.body, created_by: req.user?.id },
            req.user?.id,
            req.ip,
            req.headers['user-agent']
          );
          res.json({ success: true, certification: cert });
        }
      },
      {
        method: 'PUT',
        path: '/api/v1/admin/compliance/certifications/:id',
        description: 'Update compliance certification',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const cert = compliance.updateCertification(
            req.params.id, req.body, req.user?.id, req.ip, req.headers['user-agent']
          );
          if (!cert) { res.status(404).json({ success: false, error: 'Not found' }); return; }
          res.json({ success: true, certification: cert });
        }
      },
      {
        method: 'DELETE',
        path: '/api/v1/admin/compliance/certifications/:id',
        description: 'Delete compliance certification',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const deleted = compliance.deleteCertification(req.params.id, req.user?.id, req.ip, req.headers['user-agent']);
          res.json({ success: deleted });
        }
      },

      // Security Badges
      {
        method: 'GET',
        path: '/api/v1/admin/compliance/badges',
        description: 'List all security badges',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const badges = compliance.getAllSecurityBadges();
          res.json({ success: true, badges });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/admin/compliance/badges',
        description: 'Create security badge',
        requiredBodyFields: ['name', 'description', 'icon'],
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const badge = compliance.createSecurityBadge(
            req.body, req.user?.id, req.ip, req.headers['user-agent']
          );
          res.json({ success: true, badge });
        }
      },
      {
        method: 'PUT',
        path: '/api/v1/admin/compliance/badges/:id',
        description: 'Update security badge',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const badge = compliance.updateSecurityBadge(
            req.params.id, req.body, req.user?.id, req.ip, req.headers['user-agent']
          );
          if (!badge) { res.status(404).json({ success: false, error: 'Not found' }); return; }
          res.json({ success: true, badge });
        }
      },
      {
        method: 'DELETE',
        path: '/api/v1/admin/compliance/badges/:id',
        description: 'Delete security badge',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const deleted = compliance.deleteSecurityBadge(req.params.id, req.user?.id, req.ip, req.headers['user-agent']);
          res.json({ success: deleted });
        }
      },
      {
        method: 'PUT',
        path: '/api/v1/admin/compliance/badges/:id/reorder',
        description: 'Reorder security badge',
        requiredBodyFields: ['priority'],
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const reordered = compliance.reorderSecurityBadge(req.params.id, req.body.priority, req.user?.id);
          res.json({ success: reordered });
        }
      },

      // Provider Logos
      {
        method: 'GET',
        path: '/api/v1/admin/compliance/provider-logos',
        description: 'List all provider logos',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const logos = compliance.getAllProviderLogos();
          res.json({ success: true, logos });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/admin/compliance/provider-logos',
        description: 'Create provider logo',
        requiredBodyFields: ['provider_name', 'logo_url', 'display_name'],
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const logo = compliance.createProviderLogo(
            req.body, req.user?.id, req.ip, req.headers['user-agent']
          );
          res.json({ success: true, logo });
        }
      },
      {
        method: 'PUT',
        path: '/api/v1/admin/compliance/provider-logos/:id',
        description: 'Update provider logo',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const logo = compliance.updateProviderLogo(
            req.params.id, req.body, req.user?.id, req.ip, req.headers['user-agent']
          );
          if (!logo) { res.status(404).json({ success: false, error: 'Not found' }); return; }
          res.json({ success: true, logo });
        }
      },
      {
        method: 'DELETE',
        path: '/api/v1/admin/compliance/provider-logos/:id',
        description: 'Delete provider logo',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const deleted = compliance.deleteProviderLogo(req.params.id, req.user?.id, req.ip, req.headers['user-agent']);
          res.json({ success: deleted });
        }
      },

      // Trust Messages
      {
        method: 'GET',
        path: '/api/v1/admin/compliance/trust-messages',
        description: 'List all trust messages',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const messages = compliance.getAllTrustIndicators();
          res.json({ success: true, messages });
        }
      },
      {
        method: 'POST',
        path: '/api/v1/admin/compliance/trust-messages',
        description: 'Create trust message',
        requiredBodyFields: ['title', 'message', 'type'],
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const msg = compliance.createTrustMessage(
            req.body, req.user?.id, req.ip, req.headers['user-agent']
          );
          res.json({ success: true, message: msg });
        }
      },

      // Compliance Audit Log
      {
        method: 'GET',
        path: '/api/v1/admin/compliance/audit-log',
        description: 'Get compliance audit log',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const logs = compliance.getAuditLogs({
            entity_type: req.query.entity_type as string,
            admin_id: req.query.admin_id as string,
            start_date: req.query.start_date ? new Date(req.query.start_date as string) : undefined,
            end_date: req.query.end_date ? new Date(req.query.end_date as string) : undefined,
            limit: parseInt(req.query.limit as string || '100'),
            offset: parseInt(req.query.offset as string || '0')
          });
          res.json({ success: true, logs });
        }
      },
    ];
  }

  // ===========================================================================
  // GEO-ROUTING ROUTES
  // ===========================================================================

  private geoRoutes(): Route[] {
    if (!this.geoRouter) return [];

    return [
      {
        method: 'POST',
        path: '/api/v1/geo/route',
        description: 'Get geo-routing decision for a transaction',
        auth: 'customer',
        requiredBodyFields: ['source_country', 'currency', 'operation', 'amount'],
        handler: async (req, res) => {
          try {
            const context: GeoRoutingContext = {
              source_country: req.body.source_country,
              destination_country: req.body.destination_country,
              currency: req.body.currency,
              operation: req.body.operation,
              amount: req.body.amount,
              customer_kyc_tier: req.body.customer_kyc_tier,
              preferred_provider: req.body.preferred_provider
            };
            const decision = this.geoRouter!.route(context);
            res.json({ success: true, decision });
          } catch (error) {
            res.status(400).json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'POST',
        path: '/api/v1/geo/validate',
        description: 'Validate a transaction against geo-routing rules',
        auth: 'customer',
        requiredBodyFields: ['source_country', 'currency', 'operation', 'amount'],
        handler: async (req, res) => {
          try {
            const context: GeoRoutingContext = {
              source_country: req.body.source_country,
              destination_country: req.body.destination_country,
              currency: req.body.currency,
              operation: req.body.operation,
              amount: req.body.amount,
              customer_kyc_tier: req.body.customer_kyc_tier
            };
            const validation = this.geoRouter!.validateTransaction(context);
            res.json({ success: true, validation });
          } catch (error) {
            res.status(400).json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'POST',
        path: '/api/v1/geo/preview',
        description: 'Preview routing decision with alternatives without executing',
        auth: 'customer',
        requiredBodyFields: ['source_country', 'currency', 'operation', 'amount'],
        handler: async (req, res) => {
          try {
            const context: GeoRoutingContext = {
              source_country: req.body.source_country,
              destination_country: req.body.destination_country,
              currency: req.body.currency,
              operation: req.body.operation,
              amount: req.body.amount,
              customer_kyc_tier: req.body.customer_kyc_tier,
              preferred_provider: req.body.preferred_provider
            };
            const preview = this.geoRouter!.previewRouting(context);
            res.json({ success: true, preview });
          } catch (error) {
            res.status(400).json({ success: false, error: (error as Error).message });
          }
        }
      },
      {
        method: 'GET',
        path: '/api/v1/geo/countries',
        description: 'List all supported countries with geo configs',
        handler: async (req, res) => {
          const countries = this.geoRouter!.getSupportedCountries();
          res.json({ success: true, countries });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/geo/countries/:code',
        description: 'Get country config by code',
        handler: async (req, res) => {
          const config = this.geoRouter!.getCountryConfig(req.params.code);
          if (!config) {
            res.status(404).json({ success: false, error: 'Country not found' });
            return;
          }
          res.json({ success: true, config });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/geo/corridors',
        description: 'List cross-border corridors',
        handler: async (req, res) => {
          const corridors = req.query.source
            ? this.geoRouter!.getCorridorsFromCountry(req.query.source as string)
            : this.geoRouter!.getSupportedCountries().length > 0
              ? this.geoRouter!['crossBorderCorridors']
              : [];
          res.json({ success: true, corridors });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/geo/corridors/:source/:destination',
        description: 'Get specific cross-border corridor',
        handler: async (req, res) => {
          const corridor = this.geoRouter!.getCorridor(req.params.source, req.params.destination);
          if (!corridor) {
            res.status(404).json({ success: false, error: 'Corridor not found' });
            return;
          }
          res.json({ success: true, corridor });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/geo/analytics',
        description: 'Get geo-routing analytics',
        auth: 'admin',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const analytics = this.geoRouter!.getRouteAnalytics();
          res.json({ success: true, analytics });
        }
      },
      {
        method: 'GET',
        path: '/api/v1/geo/audit-log',
        description: 'Get geo-routing audit log',
        auth: 'admin',
        handler: async (req, res) => {
          if (!await this.requireAdmin(req, res)) return;
          const log = this.geoRouter!.getAuditLog({
            country: req.query.country as string,
            provider: req.query.provider as any,
            route_type: req.query.route_type as any,
            since: req.query.since ? new Date(req.query.since as string) : undefined
          });
          res.json({ success: true, log });
        }
      },
    ];
  }
}

export default TurboPayRoutes;
