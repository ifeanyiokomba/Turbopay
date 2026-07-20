// Smart Cash PSB Provider Adapter (Nigeria)
// Implements unified provider interface for Smart Cash mobile money
//
// NOTE: Smart Cash has no publicly available API documentation.
// This adapter is a scaffold based on common Nigerian PSB patterns.
// TODO: Verify all endpoint paths and auth flow against Smart Cash partner portal docs.

import { BaseAdapter, BaseAdapterConfig } from './base.adapter';
import {
  ProviderName,
  ProviderCapabilities,
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
  RecipientInfo,
  MobileMoneyPaymentMethod
} from '../types';
import { hmacSHA256 } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface SmartCashAdapterConfig extends BaseAdapterConfig {
  client_id: string;
  client_secret: string;
  shortcode?: string;
  webhook_secret?: string;
}

// =============================================================================
// SMART CASH ADAPTER
// =============================================================================

export class SmartCashAdapter extends BaseAdapter {
  readonly name: ProviderName = 'smartcash';
  readonly displayName = 'Smart Cash';
  readonly baseUrl = 'https://api.smartcash.ng/v1';
  readonly sandboxBaseUrl = 'https://sandbox.api.smartcash.ng/v1';

  private scConfig: SmartCashAdapterConfig;

  constructor(config: SmartCashAdapterConfig) {
    super(config);
    this.scConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION (OAuth2 client credentials — assumed pattern)
  // ===========================================================================

  async authenticate(): Promise<void> {
    // TODO: Confirm exact token endpoint against Smart Cash partner portal docs
    const response = await fetch(`${this.getBaseUrl()}/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.scConfig.client_id,
        client_secret: this.scConfig.client_secret
      })
    });

    if (!response.ok) {
      throw new Error(`Smart Cash authentication failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    this.setToken(data.access_token, data.expires_in);
    this.tokenExpiry = new Date(Date.now() + (data.expires_in * 1000));
  }

  async refreshToken(): Promise<void> {
    if (!this.isTokenExpired()) return;
    await this.authenticate();
  }

  // ===========================================================================
  // CAPABILITIES (Nigeria only)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'smartcash',
      name: 'Smart Cash',
      collections: {
        card: false,
        bank_transfer: false,
        ussd: false,
        mobile_money: true,
        qr: false
      },
      payouts: {
        bank_transfer: false,
        mobile_money: true,
        bulk: false,
        scheduled: false,
        instant: true
      },
      virtual_accounts: {
        dedicated: false,
        dynamic: false,
        static: false
      },
      bills: {
        airtime: true,
        data: true,
        electricity: false,
        cable_tv: false,
        education: false
      },
      customers: {
        creation: false,
        kyc: false,
        bvn: false
      },
      technical: {
        webhooks: true,
        idempotency: true,
        sandbox: true,
        multi_currency: false,
        international: false,
        recurring: false,
        refunds: true,
        reversals: true
      },
      countries: ['NG'],
      currencies: ['NGN']
    };
  }

  // ===========================================================================
  // COLLECTIONS (Request-to-Pay)
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('sc');
    const phone = request.payment_method?.type === 'mobile_money'
      ? (request.payment_method as MobileMoneyPaymentMethod).phone_number
      : undefined;

    // TODO: Confirm exact endpoint and payload shape against Smart Cash docs
    const payload: any = {
      amount: request.amount,
      currency: request.currency,
      reference,
      description: request.description,
      callback_url: request.callback_url,
      metadata: request.metadata
    };

    if (phone) {
      payload.msisdn = phone;
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/collection/requesttopay', payload)
    );

    const data = response.data.data || response.data;
    return this.mapTransactionResponse(data, reference);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/collection/requesttopay/${reference}`)
    );
    return this.mapTransactionResponse(response.data.data || response.data, reference);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // DISBURSEMENTS (Transfer to Mobile Money)
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('sc_t');
    const mobileMoneyRecipient = request.recipient as any;

    const payload: any = {
      amount: request.amount,
      currency: request.currency,
      reference,
      narration: request.narration,
      msisdn: mobileMoneyRecipient?.mobile_money?.phone_number,
      callback_url: request.callback_url,
      metadata: request.metadata
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/disbursement/transfer', payload)
    );

    const data = response.data.data || response.data;
    return this.mapTransferResponse(data, reference);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/disbursement/transfer/${reference}`)
    );
    return this.mapTransferResponse(response.data.data || response.data, reference);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    throw new Error('Smart Cash does not support bulk transfers');
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS (Not supported)
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new Error('Smart Cash does not support virtual accounts');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Smart Cash does not support virtual accounts');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('Smart Cash does not support customer creation via API');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Smart Cash does not support customer lookup via API');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Smart Cash does not support customer update via API');
  }

  // ===========================================================================
  // BANKS (Not supported)
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    return [];
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    throw new Error('Smart Cash does not support bank resolution');
  }

  // ===========================================================================
  // BILL PAYMENTS (Airtime/Data only)
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    // TODO: Confirm biller list endpoint against Smart Cash docs
    return [
      { id: 'airtime', name: 'Airtime', category: 'airtime' },
      { id: 'data', name: 'Data', category: 'data' }
    ];
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    return [];
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const reference = request.customer_reference || this.generateReference('sc_bill');

    // TODO: Confirm exact endpoint and payload against Smart Cash docs
    const payload = {
      biller_id: request.biller_id,
      item_id: request.item_id,
      amount: request.amount,
      customer_reference: request.customer_reference,
      metadata: request.metadata
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/bill-payment/pay', payload)
    );

    const data = response.data.data || response.data;
    return this.mapTransactionResponse(data, reference);
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const payload: any = {
      transaction_id,
      reason: reason || 'Refund requested'
    };
    if (amount) payload.amount = amount;

    const response = await this.withRetry(() =>
      this.httpClient.post('/collection/refund', payload)
    );

    const data = response.data.data || response.data;
    return this.mapTransactionResponse(data, transaction_id);
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    return this.refund(transaction_id, undefined, reason);
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck() {
    const start = Date.now();
    try {
      await this.refreshToken();
      return {
        provider: 'smartcash' as ProviderName,
        is_healthy: true,
        latency: Date.now() - start,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'smartcash' as ProviderName,
        is_healthy: false,
        latency: Date.now() - start,
        timestamp: new Date(),
        error: (error as Error).message
      };
    }
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.scConfig.webhook_secret) {
      console.error('[SmartCash] Webhook secret not configured — rejecting webhook');
      return false;
    }
    // TODO: Confirm webhook signature scheme against Smart Cash docs (assumed HMAC-SHA256)
    const computed = hmacSHA256(JSON.stringify(payload), this.scConfig.webhook_secret);
    return computed === signature;
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'payment.success': 'payment.success',
      'payment.failed': 'payment.failed',
      'transfer.success': 'transfer.success',
      'transfer.failed': 'transfer.failed'
    };

    return {
      event: eventMap[payload.event] || payload.event || 'unknown',
      data: this.mapTransactionResponse(payload.data || payload, payload.reference || ''),
      provider: 'smartcash',
      signature: '',
      timestamp: new Date(payload.timestamp || Date.now()),
      raw_payload: payload
    };
  }

  // ===========================================================================
  // MAPPING HELPERS
  // ===========================================================================

  private mapTransactionResponse(data: any, reference: string): UnifiedTransactionResponse {
    return {
      id: data.id || data.transaction_id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || data.state || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'smartcash',
      provider_reference: data.provider_reference || data.external_id,
      fees: data.fees || data.fee || 0,
      created_at: new Date(data.created_at || data.timestamp || Date.now()),
      updated_at: new Date(data.updated_at || data.timestamp || Date.now()),
      metadata: data.metadata || data.meta,
      authorization: data.authorization || {
        requires_otp: data.requires_otp,
        ussd_code: data.ussd_code
      }
    };
  }

  private mapTransferResponse(data: any, reference: string): UnifiedTransferResponse {
    return {
      id: data.id || data.transfer_id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || data.state || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'smartcash',
      provider_reference: data.provider_reference,
      fees: data.fees || data.fee || 0,
      created_at: new Date(data.created_at || data.timestamp || Date.now()),
      updated_at: new Date(data.updated_at || data.timestamp || Date.now())
    };
  }
}

export default SmartCashAdapter;
