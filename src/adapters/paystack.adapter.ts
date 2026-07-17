// Paystack Provider Adapter
// Implements unified provider interface for Paystack API

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
import { validatePaystackSignature, sha512Hash } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface PaystackAdapterConfig extends BaseAdapterConfig {
  secret_key: string;
  public_key: string;
  webhook_secret?: string;
}

// =============================================================================
// PAYSTACK ADAPTER
// =============================================================================

export class PaystackAdapter extends BaseAdapter {
  readonly name: ProviderName = 'paystack';
  readonly displayName = 'Paystack';
  readonly baseUrl = 'https://api.paystack.co';
  readonly sandboxBaseUrl = 'https://api.paystack.co';

  private paystackConfig: PaystackAdapterConfig;

  constructor(config: PaystackAdapterConfig) {
    super(config);
    this.paystackConfig = config;
    this.setToken(config.secret_key);
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    this.setToken(this.paystackConfig.secret_key);
  }

  async refreshToken(): Promise<void> {
    // Paystack uses static secret key, no refresh needed
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'paystack',
      name: 'Paystack',
      collections: {
        card: true,
        bank_transfer: true,
        ussd: true,
        mobile_money: false,
        qr: false // Paystack does NOT support QR codes
      },
      payouts: {
        bank_transfer: true,
        mobile_money: false,
        bulk: true,
        scheduled: true,
        instant: true
      },
      virtual_accounts: {
        dedicated: true,
        dynamic: true,
        static: true,
        bank_selection: false
      },
      bills: {
        airtime: false,
        data: false,
        electricity: false,
        cable_tv: false,
        education: false
      },
      customers: {
        creation: true,
        kyc: true,
        bvn: true,
        nin: false
      },
      technical: {
        webhooks: true,
        idempotency: true,
        sandbox: true,
        multi_currency: true,
        international: true,
        recurring: true,
        refunds: true,
        reversals: true
      },
      countries: ['NG', 'GH', 'ZA', 'KE'],
      currencies: ['NGN', 'GHS', 'ZAR', 'KES']
    };
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    // Email is required by Paystack API — throw if not provided
    if (!request.customer?.email) {
      throw new Error('Customer email is required for Paystack payments');
    }

    // Create customer if provided
    let customer_code = request.customer?.id;
    if (request.customer && !customer_code) {
      const customer = await this.createCustomer(request.customer);
      customer_code = customer.id;
    }

    const payload: any = {
      amount: Math.round(request.amount * 100), // Convert to kobo/cents
      reference: request.reference,
      email: request.customer.email,
      currency: request.currency,
      callback_url: request.redirect_url,
      metadata: {
        custom_fields: [],
        ...request.metadata
      }
    };

    if (customer_code) {
      payload.customer = customer_code;
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/transaction/initialize', payload)
    );

    return {
      id: response.data.data.reference,
      reference: response.data.data.reference,
      status: 'pending',
      amount: request.amount,
      currency: request.currency,
      provider: 'paystack',
      created_at: new Date(),
      updated_at: new Date(),
      authorization: {
        redirect_url: response.data.data.authorization_url,
        access_code: response.data.data.access_code
      },
      metadata: request.metadata
    };
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/transaction/verify/${reference}`)
    );
    return this.mapTransactionResponse(response.data.data);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    // Create recipient first
    const recipient = await this.createTransferRecipient(request);

    const payload: any = {
      source: 'balance',
      amount: Math.round(request.amount * 100),
      recipient: recipient.id,
      reason: request.narration,
      currency: request.currency,
      reference: request.reference
    };

    if (request.scheduled_date && request.type === 'scheduled') {
      payload.execute_at = request.scheduled_date.toISOString();
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/transfer', payload)
    );

    return this.mapTransferResponse(response.data.data);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/transfer/verify/${reference}`)
    );
    return this.mapTransferResponse(response.data.data);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/transfer/${id}`)
    );
    return this.mapTransferResponse(response.data.data);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    await this.refreshToken();

    // Create recipients and transfers
    const bulkTransfers = await Promise.all(
      transfers.map(async (t) => {
        const recipient = await this.createTransferRecipient(t);
        return {
          amount: Math.round(t.amount * 100),
          recipient: recipient.id,
          reason: t.narration,
          reference: t.reference
        };
      })
    );

    const response = await this.httpClient.post('/transfer/batch', {
      transfers: bulkTransfers
    });

    return {
      id: response.data.data.batch_id || this.generateReference('bulk'),
      status: 'pending',
      total_amount: transfers.reduce((sum, t) => sum + t.amount, 0),
      total_count: transfers.length,
      successful_count: 0,
      failed_count: 0,
      transfers: [],
      created_at: new Date()
    };
  }

  private async createTransferRecipient(request: UnifiedTransferRequest): Promise<any> {
    let recipientData: any;

    if (request.recipient.type === 'bank') {
      const bankRecipient = request.recipient as any;
      recipientData = {
        type: 'nuban',
        name: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : '',
        account_number: bankRecipient.bank.account_number,
        bank_code: bankRecipient.bank.code,
        currency: request.currency
      };
    } else {
      throw new Error('Mobile money transfers not supported by Paystack');
    }

    const response = await this.httpClient.post('/transferrecipient', recipientData);
    return response.data.data;
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    await this.refreshToken();

    const payload: any = {
      customer: request.customer_id,
      preferred_bank: request.bank_code || 'wema-bank',
      subaccount: request.reference,
      split_code: undefined
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/dedicated_account', payload)
    );

    const data = response.data.data;
    return {
      id: data.id.toString(),
      account_number: data.account_number,
      bank_code: data.bank.code,
      bank_name: data.bank.name,
      account_type: 'dedicated',
      status: data.status === 'active' ? 'active' : 'inactive',
      currency: data.currency,
      amount: request.amount,
      customer_id: request.customer_id,
      created_at: new Date(data.created_at || Date.now())
    };
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/dedicated_account/${id}`);
    const data = response.data.data;
    return {
      id: data.id.toString(),
      account_number: data.account_number,
      bank_code: data.bank.code,
      bank_name: data.bank.name,
      account_type: 'dedicated',
      status: data.status === 'active' ? 'active' : 'inactive',
      currency: data.currency,
      amount: 0,
      created_at: new Date(data.created_at || Date.now())
    };
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    await this.refreshToken();
    const path = customer_id ? `/dedicated_account?customer=${customer_id}` : '/dedicated_account';
    const response = await this.httpClient.get(path);
    return (response.data.data || []).map((va: any) => ({
      id: va.id.toString(),
      account_number: va.account_number,
      bank_code: va.bank.code,
      bank_name: va.bank.name,
      account_type: 'dedicated',
      status: va.status === 'active' ? 'active' : 'inactive',
      currency: va.currency,
      amount: 0,
      created_at: new Date(va.created_at || Date.now())
    }));
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/customer', {
        email: customer.email,
        first_name: customer.name?.first,
        last_name: customer.name?.last,
        phone: customer.phone ? `+${customer.phone.country_code}${customer.phone.number}` : undefined,
        metadata: customer.metadata
      })
    );

    return this.mapCustomerResponse(response.data.data);
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/customer/${id}`);
    return this.mapCustomerResponse(response.data.data);
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    await this.refreshToken();
    const response = await this.httpClient.put(`/customer/${id}`, {
      email: customer.email,
      first_name: customer.name?.first,
      last_name: customer.name?.last,
      phone: customer.phone ? `+${customer.phone.country_code}${customer.phone.number}` : undefined,
      metadata: customer.metadata
    });
    return this.mapCustomerResponse(response.data.data);
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    await this.refreshToken();
    const path = country ? `/bank?country=${country}` : '/bank';
    const response = await this.httpClient.get(path);
    return (response.data.data || []).map((b: any) => ({
      code: b.code,
      name: b.name,
      longcode: b.longcode,
      type: b.type,
      country: b.country
    }));
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    await this.refreshToken();
    const response = await this.httpClient.get(
      `/bank/resolve?account_number=${account_number}&bank_code=${code}`
    );
    return {
      account_number: response.data.data.account_number,
      account_name: response.data.data.account_name,
      bank_code: code,
      bank_name: ''
    };
  }

  // ===========================================================================
  // BILL PAYMENTS (Not supported)
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    return [];
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    return [];
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    throw new Error('Bill payments not supported by Paystack');
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const payload: any = {
      transaction: transaction_id,
      merchant_note: reason || 'Refund requested'
    };
    if (amount) {
      payload.amount = Math.round(amount * 100);
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/refund', payload)
    );

    return {
      id: response.data.data.id?.toString() || transaction_id,
      reference: response.data.data.reference || transaction_id,
      status: 'pending',
      amount: (response.data.data.amount || 0) / 100,
      currency: response.data.data.currency || 'NGN',
      provider: 'paystack',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { reason }
    };
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('paystack', 'reversal');
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    throw new ProviderFeatureUnavailableError('paystack', 'exchange_rate');
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
        provider: 'paystack',
        is_healthy: true,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'paystack',
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
    throw new ProviderFeatureUnavailableError('paystack', 'settlement');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.paystackConfig.webhook_secret) {
      console.error('[Paystack] Webhook secret not configured — rejecting webhook');
      return false;
    }
    const rawBody = JSON.stringify(payload);
    return validatePaystackSignature(rawBody, signature, this.paystackConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'charge.success': 'payment.success',
      'charge.failed': 'payment.failed',
      'transfer.success': 'transfer.success',
      'transfer.failed': 'transfer.failed',
      'transfer.reversed': 'transfer.reversed',
      'dedicated_account.assign_account.success': 'virtual_account.success'
    };

    return {
      event: eventMap[payload.event] || payload.event,
      data: this.mapTransactionResponse(payload.data),
      provider: 'paystack',
      signature: '',
      timestamp: new Date(payload.created_at || Date.now()),
      raw_payload: payload
    };
  }

  // ===========================================================================
  // MAPPING HELPERS
  // ===========================================================================

  private mapTransactionResponse(data: any): UnifiedTransactionResponse {
    const statusMap: Record<string, TransactionStatus> = {
      'success': 'success',
      'failed': 'failed',
      'abandoned': 'cancelled',
      'reversed': 'reversed',
      'pending': 'pending'
    };

    return {
      id: data.id?.toString() || data.reference,
      reference: data.reference,
      status: statusMap[data.status] || 'pending',
      amount: data.amount / 100, // Convert from kobo
      currency: data.currency,
      provider: 'paystack',
      provider_reference: data.id?.toString(),
      fees: data.fees / 100,
      created_at: new Date(data.created_at || Date.now()),
      updated_at: new Date(data.updated_at || data.created_at || Date.now()),
      metadata: data.metadata,
      authorization: data.authorization
    };
  }

  private mapTransferResponse(data: any): UnifiedTransferResponse {
    const statusMap: Record<string, TransactionStatus> = {
      'success': 'success',
      'failed': 'failed',
      'reversed': 'reversed',
      'pending': 'pending',
      'queued': 'pending',
      'awaiting_review': 'processing'
    };

    return {
      id: data.id?.toString(),
      reference: data.reference,
      status: statusMap[data.status] || 'pending',
      amount: data.amount / 100,
      currency: data.currency,
      provider: 'paystack',
      provider_reference: data.transfer_code,
      fees: data.fees / 100,
      created_at: new Date(data.created_at || Date.now()),
      updated_at: new Date(data.updated_at || data.created_at || Date.now()),
      metadata: data.reason ? { reason: data.reason } : undefined
    };
  }

  private mapCustomerResponse(data: any): CustomerResponse {
    const nameParts = (data.full_name || '').split(' ');
    return {
      id: data.customer_code || data.id?.toString(),
      email: data.email,
      name: {
        first: data.first_name || nameParts[0] || '',
        last: data.last_name || nameParts.slice(1).join(' ') || ''
      },
      phone: data.phone ? {
        country_code: data.phone.startsWith('+') ? data.phone.slice(1, 3) : '234',
        number: data.phone.replace(/^\+\d+/, '')
      } : undefined,
      metadata: data.metadata,
      created_at: new Date(data.created_at || Date.now()),
      updated_at: new Date(data.updated_at || data.created_at || Date.now())
    };
  }
}

export default PaystackAdapter;
