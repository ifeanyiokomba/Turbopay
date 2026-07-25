// TurboPay Unified Payment Service
// Single synchronized entry point for ALL payment operations across ALL providers
// Every provider is wrapped identically — services flow through one unified interface

import {
  ProviderName,
  ProviderAdapter,
  ProviderCapabilities,
  PaymentOperation,
  RouterConfig,
  Environment,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  VirtualAccountRequest,
  VirtualAccountResponse,
  UnifiedBulkTransferResponse,
  CustomerInfo,
  CustomerResponse,
  Bank,
  BankAccountResolution,
  Biller,
  BillerItem,
  BillPaymentRequest,
  UnifiedWebhookEvent,
  ProviderUnavailableError,
  ProviderFeatureUnavailableError,
  ExchangeRateResponse,
  ProviderHealthCheckResult,
  SettlementResponse,
  RefundRequest,
  ReversalRequest,
  Wallet,
  LedgerEntry,
  JournalEntry,
  AuditLog,
  BulkPaymentFile,
  BulkPaymentReport,
  BulkPaymentValidationResult
} from '../types';
import { ProviderRouter } from './provider-router';
import { ProviderRegistry, ProviderWrapper } from './provider-wrapper';
import { LedgerService } from './ledger';
import { BulkPaymentService, BulkPaymentCSVRow } from './bulk-payment';
import { ProviderManagementService } from '../admin/dashboard/provider-management';

// =============================================================================
// SERVICE CONFIG
// =============================================================================

export interface UnifiedServiceConfig {
  environment: Environment;
  router_config?: Partial<RouterConfig>;
}

// =============================================================================
// PROVIDER CONFIGS
// =============================================================================

export interface FlutterwaveConfig {
  client_id: string;
  client_secret: string;
  encryption_key?: string;
  public_key?: string;
  webhook_secret?: string;
}

export interface PaystackConfig {
  secret_key: string;
  public_key: string;
  webhook_secret?: string;
}

export interface MonnifyConfig {
  api_key: string;
  api_secret: string;
  contract_code: string;
  webhook_secret?: string;
}

export interface OnafriqConfig {
  client_id: string;
  client_secret: string;
  api_key?: string;
  webhook_secret?: string;
}

export interface RemitaConfig {
  api_key: string;
  api_secret: string;
  merchant_id: string;
  webhook_secret?: string;
}

export interface QuicktellerConfig {
  client_id: string;
  client_secret: string;
  merchant_code: string;
  terminal_id?: string;
  webhook_secret?: string;
}

// =============================================================================
// UNIFIED PAYMENT SERVICE
// =============================================================================

export class UnifiedPaymentService {
  private router: ProviderRouter;
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private bulkPaymentService: BulkPaymentService;
  private admin: ProviderManagementService;
  private config: UnifiedServiceConfig;

  constructor(config: UnifiedServiceConfig) {
    this.config = config;
    this.router = new ProviderRouter(config.router_config);
    this.registry = new ProviderRegistry();
    this.ledger = new LedgerService();
    this.bulkPaymentService = new BulkPaymentService(this.router, this.ledger);
    this.admin = new ProviderManagementService(this.router, this.ledger, this.bulkPaymentService);
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<void> {
    console.log('[TurboPay] Initializing payment service...');
    console.log(`[TurboPay] Environment: ${this.config.environment}`);
  }

  // ===========================================================================
  // PROVIDER REGISTRATION (Each provider wrapped identically)
  // ===========================================================================

  async registerPaystack(config: PaystackConfig): Promise<ProviderWrapper> {
    const { PaystackAdapter } = await import('../adapters/paystack.adapter');
    const adapter = new PaystackAdapter({
      environment: this.config.environment,
      ...config
    });
    await this.router.registerProvider(adapter);
    return this.registry.register(adapter);
  }

  async registerFlutterwave(config: FlutterwaveConfig): Promise<ProviderWrapper> {
    const { FlutterwaveAdapter } = await import('../adapters/flutterwave.adapter');
    const adapter = new FlutterwaveAdapter({
      environment: this.config.environment,
      ...config
    });
    await this.router.registerProvider(adapter);
    return this.registry.register(adapter);
  }

  async registerMonnify(config: MonnifyConfig): Promise<ProviderWrapper> {
    const { MonnifyAdapter } = await import('../adapters/monnify.adapter');
    const adapter = new MonnifyAdapter({
      environment: this.config.environment,
      ...config
    });
    await this.router.registerProvider(adapter);
    return this.registry.register(adapter);
  }

  async registerOnafriq(config: OnafriqConfig): Promise<ProviderWrapper> {
    const { OnafriqAdapter } = await import('../adapters/onafriq.adapter');
    const adapter = new OnafriqAdapter({
      environment: this.config.environment,
      ...config
    });
    await this.router.registerProvider(adapter);
    return this.registry.register(adapter);
  }

  async registerRemita(config: RemitaConfig): Promise<ProviderWrapper> {
    const { RemitaAdapter } = await import('../adapters/remita.adapter');
    const adapter = new RemitaAdapter({
      environment: this.config.environment,
      ...config
    });
    await this.router.registerProvider(adapter);
    return this.registry.register(adapter);
  }

  async registerQuickteller(config: QuicktellerConfig): Promise<ProviderWrapper> {
    const { QuicktellerAdapter } = await import('../adapters/quickteller.adapter');
    const adapter = new QuicktellerAdapter({
      environment: this.config.environment,
      ...config
    });
    await this.router.registerProvider(adapter);
    return this.registry.register(adapter);
  }

  // ===========================================================================
  // DIRECT PROVIDER ACCESS (Get any provider's wrapped interface)
  // ===========================================================================

  provider(name: ProviderName): ProviderWrapper {
    const wrapper = this.registry.get(name);
    if (!wrapper) {
      throw new ProviderUnavailableError(`Provider '${name}' is not registered`);
    }
    return wrapper;
  }

  getRegisteredProviders(): ProviderName[] {
    return this.registry.getNames();
  }

  getAllProviders(): ProviderWrapper[] {
    return this.registry.getAll();
  }

  getHealthyProviders(): ProviderWrapper[] {
    return this.registry.getHealthy();
  }

  getProvidersForOperation(operation: PaymentOperation, country?: string, currency?: string): ProviderWrapper[] {
    return this.registry.getCapable(operation, country, currency);
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  getProviderCapabilities(provider: ProviderName): ProviderCapabilities | undefined {
    return this.router.getCapabilityEngine().getCapabilities(provider);
  }

  getCapabilitySummary(): Record<PaymentOperation, ProviderName[]> {
    return this.router.getCapabilitySummary();
  }

  supports(provider: ProviderName, operation: PaymentOperation): boolean {
    const wrapper = this.registry.get(provider);
    return wrapper ? wrapper.supports(operation) : false;
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(
    request: UnifiedPaymentRequest,
    country: string = 'NG',
    currency: string = 'NGN'
  ): Promise<UnifiedTransactionResponse> {
    return this.router.initializePayment(request, country, currency);
  }

  async verifyPayment(reference: string, provider?: ProviderName): Promise<UnifiedTransactionResponse> {
    return this.getWrapper(provider).verifyPayment(reference);
  }

  async getPaymentStatus(id: string, provider?: ProviderName): Promise<UnifiedTransactionResponse> {
    return this.getWrapper(provider).getPaymentStatus(id);
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(
    request: UnifiedTransferRequest,
    country: string = 'NG',
    currency: string = 'NGN'
  ): Promise<UnifiedTransferResponse> {
    return this.router.createTransfer(request, country, currency);
  }

  async verifyTransfer(reference: string, provider?: ProviderName): Promise<UnifiedTransferResponse> {
    return this.getWrapper(provider).verifyTransfer(reference);
  }

  async getTransferStatus(id: string, provider?: ProviderName): Promise<UnifiedTransferResponse> {
    return this.getWrapper(provider).getTransferStatus(id);
  }

  async createBulkTransfers(
    transfers: UnifiedTransferRequest[],
    country: string = 'NG',
    currency: string = 'NGN'
  ): Promise<UnifiedBulkTransferResponse> {
    return this.router.executeWithFailover(
      'bulk_payment', country, currency,
      async (adapter) => adapter.createBulkTransfers(transfers)
    );
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS
  // ===========================================================================

  async createVirtualAccount(
    request: VirtualAccountRequest,
    country: string = 'NG',
    currency: string = 'NGN'
  ): Promise<VirtualAccountResponse> {
    return this.router.createVirtualAccount(request, country, currency);
  }

  async getVirtualAccount(id: string, provider?: ProviderName): Promise<VirtualAccountResponse> {
    return this.getWrapper(provider).getVirtualAccount(id);
  }

  async listVirtualAccounts(customer_id?: string, provider?: ProviderName): Promise<VirtualAccountResponse[]> {
    return this.getWrapper(provider).listVirtualAccounts(customer_id);
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo, provider?: ProviderName): Promise<CustomerResponse> {
    return this.getWrapper(provider).createCustomer(customer);
  }

  async getCustomer(id: string, provider?: ProviderName): Promise<CustomerResponse> {
    return this.getWrapper(provider).getCustomer(id);
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>, provider?: ProviderName): Promise<CustomerResponse> {
    return this.getWrapper(provider).updateCustomer(id, customer);
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string, provider?: ProviderName): Promise<Bank[]> {
    return this.getWrapper(provider).listBanks(country);
  }

  async resolveBank(code: string, account_number: string, provider?: ProviderName): Promise<BankAccountResolution> {
    return this.getWrapper(provider).resolveBank(code, account_number);
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(provider?: ProviderName): Promise<Biller[]> {
    return this.getWrapper(provider).listBillers();
  }

  async getBillerItems(biller_id: string, provider?: ProviderName): Promise<BillerItem[]> {
    return this.getWrapper(provider).getBillerItems(biller_id);
  }

  async payBill(request: BillPaymentRequest, provider?: ProviderName): Promise<UnifiedTransactionResponse> {
    return this.getWrapper(provider).payBill(request);
  }

  // ===========================================================================
  // REFUNDS & REVERSALS
  // ===========================================================================

  async refund(request: RefundRequest, country: string = 'NG', currency: string = 'NGN'): Promise<UnifiedTransactionResponse> {
    return this.router.executeWithFailover(
      'refund', country, currency,
      async (adapter) => {
        if (!adapter.refund) throw new ProviderFeatureUnavailableError(adapter.name, 'refund');
        return adapter.refund(request.transaction_id, request.amount, request.reason);
      }
    );
  }

  async reverse(request: ReversalRequest, country: string = 'NG', currency: string = 'NGN'): Promise<UnifiedTransactionResponse> {
    return this.router.executeWithFailover(
      'reversal', country, currency,
      async (adapter) => {
        if (!adapter.reverse) throw new ProviderFeatureUnavailableError(adapter.name, 'reversal');
        return adapter.reverse(request.transaction_id, request.reason);
      }
    );
  }

  // ===========================================================================
  // EXCHANGE RATES
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number, provider?: ProviderName): Promise<ExchangeRateResponse> {
    return this.getWrapper(provider).exchangeRate(from_currency, to_currency, amount);
  }

  // ===========================================================================
  // MERCHANT COLLECTION
  // ===========================================================================

  async merchantCollection(
    request: UnifiedPaymentRequest,
    country: string = 'NG',
    currency: string = 'NGN'
  ): Promise<UnifiedTransactionResponse> {
    return this.router.executeWithFailover(
      'merchant_collection', country, currency,
      async (adapter) => {
        if (!adapter.merchantCollection) return adapter.initializePayment(request);
        return adapter.merchantCollection(request);
      },
      request.amount
    );
  }

  // ===========================================================================
  // HEALTH CHECKS
  // ===========================================================================

  async healthCheck(provider?: ProviderName): Promise<ProviderHealthCheckResult | Map<ProviderName, ProviderHealthCheckResult>> {
    if (provider) {
      return this.getWrapper(provider).healthCheck();
    }
    return this.registry.healthCheckAll();
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(provider: ProviderName, payload: any, signature: string): boolean {
    return this.getWrapper(provider).validateWebhook(payload, signature);
  }

  parseWebhookEvent(provider: ProviderName, payload: any): UnifiedWebhookEvent {
    return this.getWrapper(provider).parseWebhookEvent(payload);
  }

  // ===========================================================================
  // LEDGER
  // ===========================================================================

  getLedger(): LedgerService { return this.ledger; }

  createWallet(userId: string, currency: string = 'NGN'): Wallet {
    return this.ledger.createWallet(userId, currency);
  }

  getWallet(walletId: string): Wallet | undefined {
    return this.ledger.getWallet(walletId);
  }

  getUserWallets(userId: string): Wallet[] {
    return this.ledger.getUserWallets(userId);
  }

  async creditWallet(walletId: string, amount: number, currency: string, reference: string, provider?: ProviderName, description?: string): Promise<LedgerEntry> {
    return this.ledger.credit(walletId, amount, currency, reference, provider, undefined, description);
  }

  async debitWallet(walletId: string, amount: number, currency: string, reference: string, provider?: ProviderName, description?: string): Promise<LedgerEntry> {
    return this.ledger.debit(walletId, amount, currency, reference, provider, undefined, description);
  }

  async holdFunds(walletId: string, amount: number, currency: string, reference: string, description?: string): Promise<LedgerEntry> {
    return this.ledger.hold(walletId, amount, currency, reference, description);
  }

  async releaseFunds(walletId: string, amount: number, currency: string, reference: string, description?: string): Promise<LedgerEntry> {
    return this.ledger.release(walletId, amount, currency, reference, description);
  }

  getWalletBalance(walletId: string): { balance: number; available: number; held: number } | null {
    return this.ledger.getWalletBalance(walletId);
  }

  getLedgerEntries(walletId: string, limit?: number): LedgerEntry[] {
    return this.ledger.getLedgerEntries(walletId, { limit });
  }

  createJournal(reference: string, lines: { wallet_id: string; type: 'debit' | 'credit'; amount: number; currency: string }[], description?: string): JournalEntry {
    return this.ledger.createJournal(reference, lines, description);
  }

  async commitJournal(journalId: string): Promise<JournalEntry> {
    return this.ledger.commitJournal(journalId);
  }

  // ===========================================================================
  // SETTLEMENTS
  // ===========================================================================

  recordSettlement(provider: ProviderName, totalAmount: number, currency: string, fee: number, reference: string, transactionIds: string[]): SettlementResponse {
    return this.ledger.recordSettlement(provider, totalAmount, currency, fee, reference, transactionIds);
  }

  getSettlements(provider?: ProviderName): SettlementResponse[] {
    return provider ? this.ledger.getProviderSettlements(provider) : [];
  }

  // ===========================================================================
  // AUDIT
  // ===========================================================================

  getAuditLogs(entityType?: string, entityId?: string, limit?: number): AuditLog[] {
    return this.ledger.getAuditLogs(entityType, entityId, limit);
  }

  // ===========================================================================
  // BULK PAYMENTS
  // ===========================================================================

  getBulkPaymentService(): BulkPaymentService { return this.bulkPaymentService; }

  parseBulkPaymentCSV(csvContent: string): BulkPaymentCSVRow[] {
    return this.bulkPaymentService.parseCSV(csvContent);
  }

  validateBulkPayment(rows: BulkPaymentCSVRow[], currency?: string): BulkPaymentValidationResult {
    return this.bulkPaymentService.validate(rows, currency);
  }

  createBulkPayment(filename: string, originalFilename: string, mimeType: string, size: number, uploadedBy: string, rows: BulkPaymentCSVRow[], currency?: string): BulkPaymentFile {
    return this.bulkPaymentService.createBulkPayment(filename, originalFilename, mimeType, size, uploadedBy, rows, currency);
  }

  async processBulkPayment(bulkPaymentId: string, walletId?: string): Promise<BulkPaymentReport> {
    return this.bulkPaymentService.processBulkPayment(bulkPaymentId, walletId);
  }

  getBulkPaymentReport(bulkPaymentId: string): BulkPaymentReport {
    return this.bulkPaymentService.generateReport(bulkPaymentId);
  }

  // ===========================================================================
  // ADMIN
  // ===========================================================================

  getAdmin(): ProviderManagementService { return this.admin; }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private getWrapper(provider?: ProviderName): ProviderWrapper {
    if (provider) {
      const wrapper = this.registry.get(provider);
      if (!wrapper) throw new ProviderUnavailableError(`Provider '${provider}' is not registered`);
      return wrapper;
    }
    const providers = this.registry.getAll();
    if (providers.length === 0) throw new ProviderUnavailableError('No providers registered');
    return providers[0];
  }
}

export default UnifiedPaymentService;
