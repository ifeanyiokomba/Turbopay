// Onafriq Provider Adapter
// Implements unified provider interface for Onafriq API

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
  TransactionStatus,
  ExchangeRateResponse,
  ProviderHealthCheckResult,
  SettlementResponse,
  ProviderFeatureUnavailableError
} from '../types';
import { validateOnafriqSignature } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface OnafriqAdapterConfig extends BaseAdapterConfig {
  client_id: string;
  client_secret: string;
  api_key?: string;
  webhook_secret?: string;
}

// =============================================================================
// ONAFRIQ ADAPTER
// =============================================================================

export class OnafriqAdapter extends BaseAdapter {
  readonly name: ProviderName = 'onafriq';
  readonly displayName = 'Onafriq';
  readonly baseUrl = 'https://api.onafriq.com';
  readonly sandboxBaseUrl = 'https://sandbox.onafriq.com';

  private onafriqConfig: OnafriqAdapterConfig;

  constructor(config: OnafriqAdapterConfig) {
    super(config);
    this.onafriqConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    const response = await fetch(
      `${this.getBaseUrl()}/oauth2/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.onafriqConfig.client_id,
          client_secret: this.onafriqConfig.client_secret,
          grant_type: 'client_credentials'
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Onafriq authentication failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    this.setToken(data.access_token, data.expires_in);
  }

  async refreshToken(): Promise<void> {
    if (!this.isTokenExpired()) return;
    await this.authenticate();
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'onafriq',
      name: 'Onafriq',
      collections: {
        card: true, // Card collections confirmed via Onafriq platform
        bank_transfer: true,
        ussd: true,
        mobile_money: true,
        qr: false // Not documented in API
      },
      payouts: {
        bank_transfer: true,
        mobile_money: true,
        bulk: true,
        scheduled: true,
        instant: true
      },
      virtual_accounts: {
        dedicated: false,
        dynamic: false,
        static: false,
        bank_selection: false
      },
      bills: {
        airtime: false, // Only via Baxi portal, not REST API
        data: false,
        electricity: false,
        cable_tv: false,
        education: false
      },
      customers: {
        creation: true,
        kyc: true,
        bvn: false,
        nin: false
      },
      technical: {
        webhooks: true,
        idempotency: true,
        sandbox: true,
        multi_currency: true,
        international: true,
        recurring: true,
        refunds: false, // No public refund API
        reversals: false // No public reversal API
      },
      countries: [
        'NG', 'GH', 'KE', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'MW', 'EG',
        'ZA', 'SN', 'CI', 'CM', 'CD', 'MZ', 'MG', 'MU', 'BF', 'ML',
        'NE', 'TD', 'CG', 'GA', 'BW', 'SZ', 'LS', 'NA', 'KM', 'SC',
        'DZ', 'AO', 'BJ', 'CV', 'GQ', 'GM', 'GN', 'GW', 'LR', 'MR',
        'ST', 'TG'
      ],
      currencies: [
        'NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'MWK',
        'EGP', 'ZAR', 'XOF', 'XAF', 'CDF', 'MZN', 'MGF', 'MUR', 'BWP',
        'SZL', 'LSL', 'NAD', 'KMF', 'SCR', 'DZD', 'AOA', 'GNF', 'GMD'
      ]
    };
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    let customer_id = request.customer?.id;
    if (request.customer && !customer_id) {
      const customer = await this.createCustomer(request.customer);
      customer_id = customer.id;
    }

    const payload: any = {
      amount: request.amount,
      currency: request.currency,
      reference: request.reference,
      description: request.description,
      callback_url: request.redirect_url,
      customer_id: customer_id,
      metadata: request.metadata
    };

    if (request.payment_method) {
      payload.payment_method = this.mapPaymentMethod(request.payment_method);
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/collections/request', payload)
    );

    return this.mapTransactionResponse(response.data);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/collections/${reference}`)
    );
    return this.mapTransactionResponse(response.data);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  private mapPaymentMethod(method: any): any {
    switch (method.type) {
      case 'mobile_money':
        return {
          type: 'mobile_money',
          mobile_money: {
            phone_number: method.phone_number,
            country_code: method.country_code,
            network: method.network
          }
        };
      case 'bank_transfer':
        return { type: 'bank_transfer' };
      case 'ussd':
        return { type: 'ussd' };
      default:
        return { type: method.type };
    }
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const payload: any = {
      amount: request.amount,
      currency: request.currency,
      reference: request.reference,
      narration: request.narration,
      callback_url: request.callback_url,
      metadata: request.metadata
    };

    if (request.recipient.type === 'bank') {
      const bankRecipient = request.recipient as any;
      payload.recipient = {
        type: 'bank_account',
        bank_account: {
          code: bankRecipient.bank.code,
          account_number: bankRecipient.bank.account_number,
          name: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : ''
        }
      };
    } else if (request.recipient.type === 'mobile_money') {
      const momoRecipient = request.recipient as any;
      payload.recipient = {
        type: 'mobile_money',
        mobile_money: {
          phone_number: momoRecipient.mobile_money.phone_number,
          country_code: momoRecipient.mobile_money.country_code,
          network: momoRecipient.mobile_money.network
        }
      };
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/disbursements/request', payload)
    );

    return this.mapTransferResponse(response.data);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/disbursements/${reference}`)
    );
    return this.mapTransferResponse(response.data);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    await this.refreshToken();

    const batchItems = transfers.map(t => ({
      amount: t.amount,
      currency: t.currency,
      reference: t.reference,
      recipient: t.recipient.type === 'bank' ? {
        type: 'bank_account',
        bank_account: {
          code: (t.recipient as any).bank.code,
          account_number: (t.recipient as any).bank.account_number
        }
      } : {
        type: 'mobile_money',
        mobile_money: {
          phone_number: (t.recipient as any).mobile_money.phone_number,
          country_code: (t.recipient as any).mobile_money.country_code,
          network: (t.recipient as any).mobile_money.network
        }
      }
    }));

    const response = await this.httpClient.post('/disbursements/batch', {
      transfers: batchItems
    });

    return {
      id: response.data.batch_id || this.generateReference('bulk'),
      status: 'pending',
      total_amount: transfers.reduce((sum, t) => sum + t.amount, 0),
      total_count: transfers.length,
      successful_count: 0,
      failed_count: 0,
      transfers: [],
      created_at: new Date()
    };
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS (Not supported)
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new Error('Virtual accounts not supported by Onafriq');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Virtual accounts not supported by Onafriq');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/customers', {
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        metadata: customer.metadata
      })
    );

    return this.mapCustomerResponse(response.data);
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/customers/${id}`);
    return this.mapCustomerResponse(response.data);
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    await this.refreshToken();
    const response = await this.httpClient.put(`/customers/${id}`, {
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      metadata: customer.metadata
    });
    return this.mapCustomerResponse(response.data);
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    await this.refreshToken();
    const path = country ? `/banks?country=${country}` : '/banks';
    const response = await this.httpClient.get(path);
    return (response.data || []).map((b: any) => ({
      code: b.code,
      name: b.name,
      country: b.country
    }));
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    await this.refreshToken();
    const response = await this.httpClient.get(
      `/banks/resolve?code=${code}&account_number=${account_number}`
    );
    return {
      account_number: response.data.account_number,
      account_name: response.data.account_name,
      bank_code: code,
      bank_name: ''
    };
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/billers');
    return (response.data || []).map((b: any) => ({
      id: b.id,
      name: b.name,
      category: b.category || 'general',
      description: b.description
    }));
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/billers/${biller_id}/items`);
    return (response.data || []).map((i: any) => ({
      id: i.id,
      name: i.name,
      amount: i.amount,
      code: i.code
    }));
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/billers/pay', {
        biller_id: request.biller_id,
        item_id: request.item_id,
        amount: request.amount,
        customer_reference: request.customer_reference,
        customer_name: request.customer_name,
        customer_email: request.customer_email,
        customer_phone: request.customer_phone,
        metadata: request.metadata
      })
    );

    return this.mapTransactionResponse(response.data);
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('onafriq', 'refund');
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('onafriq', 'reversal');
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.get(`/fx/rate?from=${from_currency}&to=${to_currency}&amount=${amount}`)
    );

    return {
      from_currency,
      to_currency,
      rate: response.data.rate,
      amount,
      converted_amount: response.data.converted_amount,
      provider: 'onafriq',
      timestamp: new Date()
    };
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const start = Date.now();
    try {
      await this.refreshToken();
      const latency = Date.now() - start;
      return {
        provider: 'onafriq',
        is_healthy: true,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'onafriq',
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
    throw new ProviderFeatureUnavailableError('onafriq', 'settlement');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.onafriqConfig.webhook_secret) {
      console.error('[Onafriq] Webhook secret not configured — rejecting webhook');
      return false;
    }
    return validateOnafriqSignature(payload, signature, this.onafriqConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'collection.successful': 'payment.success',
      'collection.failed': 'payment.failed',
      'disbursement.successful': 'transfer.success',
      'disbursement.failed': 'transfer.failed',
      'disbursement.reversed': 'transfer.reversed'
    };

    return {
      event: eventMap[payload.event] || payload.event,
      data: this.mapTransactionResponse(payload),
      provider: 'onafriq',
      signature: '',
      timestamp: new Date(payload.timestamp || Date.now()),
      raw_payload: payload
    };
  }

  // ===========================================================================
  // MAPPING HELPERS
  // ===========================================================================

  private mapTransactionResponse(data: any): UnifiedTransactionResponse {
    return {
      id: data.id || data.reference,
      reference: data.reference,
      status: this.mapStatus(data.status),
      amount: data.amount,
      currency: data.currency,
      provider: 'onafriq',
      provider_reference: data.provider_reference,
      fees: data.fees,
      created_at: new Date(data.created_at || Date.now()),
      updated_at: new Date(data.updated_at || data.created_at || Date.now()),
      metadata: data.metadata,
      authorization: data.authorization
    };
  }

  private mapTransferResponse(data: any): UnifiedTransferResponse {
    return {
      id: data.id || data.reference,
      reference: data.reference,
      status: this.mapStatus(data.status),
      amount: data.amount,
      currency: data.currency,
      provider: 'onafriq',
      provider_reference: data.provider_reference,
      fees: data.fees,
      created_at: new Date(data.created_at || Date.now()),
      updated_at: new Date(data.updated_at || data.created_at || Date.now()),
      recipient: data.recipient
    };
  }

  private mapCustomerResponse(data: any): CustomerResponse {
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      phone: data.phone,
      metadata: data.metadata,
      created_at: new Date(data.created_at || Date.now()),
      updated_at: new Date(data.updated_at || data.created_at || Date.now())
    };
  }
}

export default OnafriqAdapter;
