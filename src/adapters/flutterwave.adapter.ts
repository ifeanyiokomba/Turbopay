// Flutterwave Provider Adapter
// Implements unified provider interface for Flutterwave API v4.0.0

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
  PaymentMethod,
  RecipientInfo,
  MobileMoneyPaymentMethod,
  ExchangeRateResponse,
  ProviderHealthCheckResult,
  SettlementResponse,
  ProviderFeatureUnavailableError
} from '../types';
import { validateFlutterwaveSignature, generateNonce, encryptAES256GCM } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface FlutterwaveAdapterConfig extends BaseAdapterConfig {
  client_id: string;
  client_secret: string;
  encryption_key?: string;
  public_key?: string;
  webhook_secret?: string;
}

// =============================================================================
// FLUTTERWAVE ADAPTER
// =============================================================================

export class FlutterwaveAdapter extends BaseAdapter {
  readonly name: ProviderName = 'flutterwave';
  readonly displayName = 'Flutterwave';
  readonly baseUrl = 'https://api.flutterwave.com/v4';
  readonly sandboxBaseUrl = 'https://developersandbox-api.flutterwave.com/v4';

  private flwConfig: FlutterwaveAdapterConfig;

  constructor(config: FlutterwaveAdapterConfig) {
    super(config);
    this.flwConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    const response = await fetch(
      'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.flwConfig.client_id,
          client_secret: this.flwConfig.client_secret,
          grant_type: 'client_credentials'
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Flutterwave authentication failed: ${response.statusText}`);
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
  // CAPABILITIES
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'flutterwave',
      name: 'Flutterwave',
      collections: {
        card: true,
        bank_transfer: true,
        ussd: true,
        mobile_money: true,
        qr: false, // Not supported in Flutterwave v4
        opay: false // Not documented in v4
      },
      payouts: {
        bank_transfer: true,
        mobile_money: true,
        bulk: true,
        scheduled: true,
        instant: true
      },
      virtual_accounts: {
        dedicated: true,
        dynamic: true,
        static: true,
        bank_selection: true
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
        nin: true
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
      countries: ['NG', 'GH', 'KE', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'MW', 'EG', 'GB', 'US'],
      currencies: ['NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'MWK', 'EGP', 'USD', 'EUR', 'GBP']
    };
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    // Create customer if provided
    let customer_id = request.customer?.id;
    if (request.customer && !customer_id) {
      const customer = await this.createCustomer(request.customer);
      customer_id = customer.id;
    }

    // Build charge request
    const chargeRequest: any = {
      reference: request.reference,
      currency: request.currency,
      amount: request.amount,
      redirect_url: request.redirect_url,
      meta: request.metadata
    };

    if (customer_id) {
      chargeRequest.customer_id = customer_id;
    }

    // Handle payment method
    if (request.payment_method) {
      const payment_method_id = await this.createPaymentMethod(request.payment_method);
      chargeRequest.payment_method_id = payment_method_id;
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/charges', chargeRequest, {
        idempotency_key: request.reference
      })
    );

    return this.mapTransactionResponse(response.data.data);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/charges/${reference}`)
    );
    return this.mapTransactionResponse(response.data.data);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  private async createPaymentMethod(paymentMethod: PaymentMethod): Promise<string> {
    await this.refreshToken();

    let payload: any = { type: paymentMethod.type };

    switch (paymentMethod.type) {
      case 'card':
        const card = paymentMethod as any;
        payload.card = {
          encrypted_card_number: card.encrypted_card_number,
          encrypted_expiry_month: card.encrypted_expiry_month,
          encrypted_expiry_year: card.encrypted_expiry_year,
          encrypted_cvv: card.encrypted_cvv,
          nonce: card.nonce
        };
        break;
      case 'mobile_money':
        const momo = paymentMethod as MobileMoneyPaymentMethod;
        payload.mobile_money = {
          country_code: momo.country_code,
          network: momo.network,
          phone_number: momo.phone_number
        };
        break;
    }

    const response = await this.httpClient.post('/payment-methods', payload);
    return response.data.data.id;
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const recipient = this.mapRecipient(request.recipient);

    const transferRequest: any = {
      action: request.type || 'instant',
      type: request.recipient.type === 'bank' ? 'bank' : 'mobile_money',
      reference: request.reference,
      narration: request.narration,
      callback_url: request.callback_url,
      meta: request.metadata,
      payment_instruction: {
        source_currency: request.currency,
        destination_currency: request.currency,
        amount: {
          value: request.amount,
          applies_to: 'destination_currency'
        },
        recipient
      }
    };

    if (request.scheduled_date && request.type === 'scheduled') {
      transferRequest.disburse_option = {
        date_time: request.scheduled_date.toISOString(),
        timezone: 'Africa/Lagos'
      };
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/direct-transfers', transferRequest, {
        idempotency_key: request.reference
      })
    );

    return this.mapTransferResponse(response.data.data);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/transfers/${reference}`)
    );
    return this.mapTransferResponse(response.data.data);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    await this.refreshToken();

    const bulkTransfers = transfers.map(t => ({
      reference: t.reference,
      narration: t.narration,
      amount: t.amount,
      recipient: this.mapRecipient(t.recipient)
    }));

    const response = await this.httpClient.post('/bulk-transfers', { transfers: bulkTransfers });

    return {
      id: response.data.data.id || this.generateReference('bulk'),
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
  // VIRTUAL ACCOUNTS
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    await this.refreshToken();

    const payload: any = {
      reference: request.reference,
      customer_id: request.customer_id,
      amount: request.amount,
      currency: request.currency,
      account_type: request.account_type,
      narration: request.narration,
      bvn: request.bvn
    };

    if (request.expiry && request.account_type === 'dynamic') {
      payload.expiry = request.expiry;
    }

    if (request.bank_code) {
      payload.bank_code = request.bank_code;
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/virtual-accounts', payload, {
        idempotency_key: request.reference
      })
    );

    return this.mapVirtualAccountResponse(response.data.data);
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/virtual-accounts/${id}`);
    return this.mapVirtualAccountResponse(response.data.data);
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    await this.refreshToken();
    const path = customer_id ? `/virtual-accounts?customer_id=${customer_id}` : '/virtual-accounts';
    const response = await this.httpClient.get(path);
    return (response.data.data || []).map((va: any) => this.mapVirtualAccountResponse(va));
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
        meta: customer.metadata
      })
    );

    return this.mapCustomerResponse(response.data.data);
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/customers/${id}`);
    return this.mapCustomerResponse(response.data.data);
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    await this.refreshToken();
    const response = await this.httpClient.put(`/customers/${id}`, {
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      meta: customer.metadata
    });
    return this.mapCustomerResponse(response.data.data);
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    await this.refreshToken();
    const path = country ? `/banks?country=${country}` : '/banks';
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
      `/banks/${code}/resolve?account_number=${account_number}`
    );
    return {
      account_number: response.data.data.account_number,
      account_name: response.data.data.account_name,
      bank_code: code,
      bank_name: ''
    };
  }

  // ===========================================================================
  // BILL PAYMENTS (Not supported in v4)
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    return [];
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    return [];
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    throw new Error('Bill payments not supported in Flutterwave v4 API');
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const payload: any = {
      transaction_id,
      comment: reason || 'Refund requested'
    };
    if (amount) {
      payload.amount = amount;
    }

    const response = await this.withRetry(() =>
      this.httpClient.post('/refunds', payload)
    );

    return {
      id: response.data.data.id || transaction_id,
      reference: response.data.data.transaction?.reference || transaction_id,
      status: 'pending',
      amount: response.data.data.amount || amount || 0,
      currency: response.data.data.transaction?.currency || 'NGN',
      provider: 'flutterwave',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { reason, refund_id: response.data.data.id }
    };
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    return this.refund(transaction_id, undefined, reason);
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.get(`/rates?from=${from_currency}&to=${to_currency}&amount=${amount}`)
    );

    return {
      from_currency,
      to_currency,
      rate: response.data.data.rate,
      amount,
      converted_amount: response.data.data.converted_amount,
      provider: 'flutterwave',
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
        provider: 'flutterwave',
        is_healthy: true,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'flutterwave',
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
    throw new ProviderFeatureUnavailableError('flutterwave', 'settlement');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.flwConfig.webhook_secret) return true;
    return validateFlutterwaveSignature(payload, signature, this.flwConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'charge.completed': 'payment.success',
      'charge.failed': 'payment.failed',
      'transfer.disburse': 'transfer.success',
      'transfer.failed': 'transfer.failed'
    };

    return {
      event: eventMap[payload.type] || payload.type,
      data: this.mapTransactionResponse(payload.data),
      provider: 'flutterwave',
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
      id: data.id,
      reference: data.reference,
      status: this.mapStatus(data.status),
      amount: data.amount,
      currency: data.currency,
      provider: 'flutterwave',
      provider_reference: data.processor_response?.code,
      fees: data.fees?.[0]?.amount,
      created_at: new Date(data.created_datetime || Date.now()),
      updated_at: new Date(data.created_datetime || Date.now()),
      metadata: data.meta,
      payment_method_details: data.payment_method,
      authorization: data.next_action
    };
  }

  private mapTransferResponse(data: any): UnifiedTransferResponse {
    return {
      id: data.id,
      reference: data.reference,
      status: this.mapStatus(data.status),
      amount: data.amount?.value || data.amount,
      currency: data.destination_currency || data.source_currency,
      provider: 'flutterwave',
      provider_reference: data.payment_information?.proof,
      fees: data.fee?.value,
      created_at: new Date(data.created_datetime || Date.now()),
      updated_at: new Date(data.created_datetime || Date.now()),
      recipient: data.recipient
    };
  }

  private mapVirtualAccountResponse(data: any): VirtualAccountResponse {
    return {
      id: data.id,
      account_number: data.account_number,
      bank_code: data.bank_code || '090567',
      bank_name: data.account_bank_name || 'Flutterwave MFB',
      account_type: data.account_type,
      status: data.status === 'active' ? 'active' : 'inactive',
      currency: data.currency,
      amount: data.amount,
      expires_at: data.account_expiration_datetime ? new Date(data.account_expiration_datetime) : undefined,
      customer_id: data.customer_id,
      created_at: new Date(data.created_datetime || Date.now())
    };
  }

  private mapCustomerResponse(data: any): CustomerResponse {
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      phone: data.phone,
      metadata: data.meta,
      created_at: new Date(data.created_datetime || Date.now()),
      updated_at: new Date(data.created_datetime || Date.now())
    };
  }

  private mapRecipient(recipient: RecipientInfo): any {
    if (recipient.type === 'bank') {
      const bankRecipient = recipient as any;
      return {
        type: 'bank',
        bank: {
          code: bankRecipient.bank.code,
          account_number: bankRecipient.bank.account_number
        },
        name: bankRecipient.name,
        email: bankRecipient.email,
        phone: bankRecipient.phone
      };
    } else {
      const momoRecipient = recipient as any;
      return {
        type: 'mobile_money',
        mobile_money: {
          network: momoRecipient.mobile_money.network,
          msisdn: `${momoRecipient.mobile_money.country_code}${momoRecipient.mobile_money.phone_number}`
        },
        name: momoRecipient.name
      };
    }
  }
}

export default FlutterwaveAdapter;
