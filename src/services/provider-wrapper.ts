// TurboPay Provider Wrapper
// Wraps each provider adapter into a synchronized, uniform interface
// All providers expose the same methods — unsupported features throw ProviderFeatureUnavailableError

import {
  ProviderName,
  ProviderAdapter,
  ProviderCapabilities,
  PaymentOperation,
  CustomerInfo,
  CustomerResponse,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  VirtualAccountRequest,
  VirtualAccountResponse,
  BillPaymentRequest,
  Bank,
  BankAccountResolution,
  Biller,
  BillerItem,
  UnifiedWebhookEvent,
  UnifiedBulkTransferResponse,
  ExchangeRateResponse,
  ProviderHealthCheckResult,
  SettlementResponse,
  ProviderFeatureUnavailableError,
  ProviderUnavailableError
} from '../types';

// =============================================================================
// PROVIDER WRAPPER
// =============================================================================

export class ProviderWrapper {
  readonly provider: ProviderName;
  private adapter: ProviderAdapter;
  private _isHealthy: boolean = true;
  private _lastHealthCheck: Date | null = null;

  constructor(adapter: ProviderAdapter) {
    this.provider = adapter.name;
    this.adapter = adapter;
  }

  // ===========================================================================
  // METADATA
  // ===========================================================================

  get name(): ProviderName {
    return this.provider;
  }

  get displayName(): string {
    return this.adapter.displayName;
  }

  get baseUrl(): string {
    return this.adapter.baseUrl;
  }

  get sandboxBaseUrl(): string {
    return this.adapter.sandboxBaseUrl;
  }

  get isHealthy(): boolean {
    return this._isHealthy;
  }

  get lastHealthCheck(): Date | null {
    return this._lastHealthCheck;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    await this.adapter.authenticate();
  }

  async refreshToken(): Promise<void> {
    await this.adapter.refreshToken();
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return this.adapter.getCapabilities();
  }

  supports(operation: PaymentOperation): boolean {
    const caps = this.adapter.getCapabilities();
    return this.checkCapability(caps, operation);
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    return this.adapter.initializePayment(request);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    return this.adapter.verifyPayment(reference);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.adapter.getPaymentStatus(id);
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    return this.adapter.createTransfer(request);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    return this.adapter.verifyTransfer(reference);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.adapter.getTransferStatus(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    return this.adapter.createBulkTransfers(transfers);
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    return this.adapter.createVirtualAccount(request);
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    return this.adapter.getVirtualAccount(id);
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return this.adapter.listVirtualAccounts(customer_id);
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    return this.adapter.createCustomer(customer);
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    return this.adapter.getCustomer(id);
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    return this.adapter.updateCustomer(id, customer);
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    return this.adapter.listBanks(country);
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    return this.adapter.resolveBank(code, account_number);
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    return this.adapter.listBillers();
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    return this.adapter.getBillerItems(biller_id);
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    return this.adapter.payBill(request);
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    return this.adapter.validateWebhook(payload, signature);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    return this.adapter.parseWebhookEvent(payload);
  }

  // ===========================================================================
  // REFUNDS & REVERSALS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    if (!this.adapter.refund) {
      throw new ProviderFeatureUnavailableError(this.provider, 'refund');
    }
    return this.adapter.refund(transaction_id, amount, reason);
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    if (!this.adapter.reverse) {
      throw new ProviderFeatureUnavailableError(this.provider, 'reversal');
    }
    return this.adapter.reverse(transaction_id, reason);
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    if (!this.adapter.exchangeRate) {
      throw new ProviderFeatureUnavailableError(this.provider, 'exchange_rate');
    }
    return this.adapter.exchangeRate(from_currency, to_currency, amount);
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const start = Date.now();
    try {
      let result: ProviderHealthCheckResult;

      if (this.adapter.healthCheck) {
        result = await this.adapter.healthCheck();
      } else {
        await this.adapter.refreshToken();
        result = {
          provider: this.provider,
          is_healthy: true,
          latency: Date.now() - start,
          timestamp: new Date()
        };
      }

      this._isHealthy = result.is_healthy;
      this._lastHealthCheck = result.timestamp;
      return result;
    } catch (error) {
      this._isHealthy = false;
      this._lastHealthCheck = new Date();
      return {
        provider: this.provider,
        is_healthy: false,
        latency: Date.now() - start,
        timestamp: new Date(),
        error: (error as Error).message
      };
    }
  }

  // ===========================================================================
  // SETTLEMENT
  // ===========================================================================

  async settlement(): Promise<SettlementResponse> {
    if (!this.adapter.settlement) {
      throw new ProviderFeatureUnavailableError(this.provider, 'settlement');
    }
    return this.adapter.settlement();
  }

  // ===========================================================================
  // MERCHANT COLLECTION
  // ===========================================================================

  async merchantCollection(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    if (!this.adapter.merchantCollection) {
      return this.adapter.initializePayment(request);
    }
    return this.adapter.merchantCollection(request);
  }

  // ===========================================================================
  // RAW ADAPTER ACCESS
  // ===========================================================================

  getAdapter(): ProviderAdapter {
    return this.adapter;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private checkCapability(caps: ProviderCapabilities, operation: PaymentOperation): boolean {
    switch (operation) {
      case 'card_collection': return caps.collections.card;
      case 'bank_transfer_collection': return caps.collections.bank_transfer;
      case 'ussd_collection': return caps.collections.ussd;
      case 'mobile_money_collection': return caps.collections.mobile_money;
      case 'qr_collection': return caps.collections.qr;
      case 'bank_transfer_payout': return caps.payouts.bank_transfer;
      case 'mobile_money_payout': return caps.payouts.mobile_money;
      case 'bulk_payment': return caps.payouts.bulk;
      case 'virtual_account': return caps.virtual_accounts.dedicated || caps.virtual_accounts.dynamic || caps.virtual_accounts.static;
      case 'bill_payment': return caps.bills.airtime || caps.bills.data || caps.bills.electricity || caps.bills.cable_tv || caps.bills.education;
      case 'airtime': return caps.bills.airtime;
      case 'data': return caps.bills.data;
      case 'electricity': return caps.bills.electricity;
      case 'cable_tv': return caps.bills.cable_tv;
      case 'education': return caps.bills.education;
      case 'refund': return caps.technical.refunds;
      case 'reversal': return caps.technical.reversals;
      case 'papss': return caps.technical.international;
      case 'fx': return caps.technical.multi_currency;
      case 'bank_resolution': return caps.collections.bank_transfer;
      case 'bvn': return caps.customers.bvn;
      case 'kyc': return caps.customers.kyc;
      case 'mobile_money': return caps.collections.mobile_money || caps.payouts.mobile_money;
      case 'merchant_collection': return caps.collections.bank_transfer || caps.collections.card;
      default: return false;
    }
  }
}

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

export class ProviderRegistry {
  private wrappers: Map<ProviderName, ProviderWrapper> = new Map();

  register(adapter: ProviderAdapter): ProviderWrapper {
    const wrapper = new ProviderWrapper(adapter);
    this.wrappers.set(adapter.name, wrapper);
    return wrapper;
  }

  get(provider: ProviderName): ProviderWrapper | undefined {
    return this.wrappers.get(provider);
  }

  getAll(): ProviderWrapper[] {
    return Array.from(this.wrappers.values());
  }

  getNames(): ProviderName[] {
    return Array.from(this.wrappers.keys());
  }

  has(provider: ProviderName): boolean {
    return this.wrappers.has(provider);
  }

  remove(provider: ProviderName): boolean {
    return this.wrappers.delete(provider);
  }

  getHealthy(): ProviderWrapper[] {
    return this.getAll().filter(w => w.isHealthy);
  }

  getCapable(operation: PaymentOperation, country?: string, currency?: string): ProviderWrapper[] {
    return this.getAll().filter(w => {
      if (!w.supports(operation)) return false;
      const caps = w.getCapabilities();
      if (country && caps.countries.length > 0 && !caps.countries.includes(country)) return false;
      if (currency && caps.currencies.length > 0 && !caps.currencies.includes(currency)) return false;
      return true;
    });
  }

  async healthCheckAll(): Promise<Map<ProviderName, ProviderHealthCheckResult>> {
    const results = new Map<ProviderName, ProviderHealthCheckResult>();
    const checks = this.getAll().map(async w => {
      const result = await w.healthCheck();
      results.set(w.name, result);
    });
    await Promise.all(checks);
    return results;
  }
}

export default ProviderWrapper;
