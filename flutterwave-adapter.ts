// Flutterwave Provider Adapter Implementation
// Implements the unified provider interface for Flutterwave API v4.0.0

import crypto from 'crypto';
import {
  ProviderAdapter,
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
  TransactionStatus
} from './unified-provider-interface';

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface FlutterwaveConfig {
  client_id: string;
  client_secret: string;
  encryption_key?: string;
  public_key?: string;
  environment: 'sandbox' | 'production';
  webhook_secret?: string;
}

// =============================================================================
// FLUTTERWAVE ADAPTER
// =============================================================================

export class FlutterwaveAdapter implements ProviderAdapter {
  readonly name: ProviderName = 'flutterwave';
  readonly displayName = 'Flutterwave';
  readonly baseUrl = 'https://api.flutterwave.com/v4';
  readonly sandboxBaseUrl = 'https://developersandbox-api.flutterwave.com/v4';

  private config: FlutterwaveConfig;
  private access_token: string | null = null;
  private token_expiry: Date | null = null;

  constructor(config: FlutterwaveConfig) {
    this.config = config;
  }

  private get apiBaseUrl(): string {
    return this.config.environment === 'production' ? this.baseUrl : this.sandboxBaseUrl;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    const response = await fetch(
      'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.config.client_id,
          client_secret: this.config.client_secret,
          grant_type: 'client_credentials'
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.access_token = data.access_token;
    this.token_expiry = new Date(Date.now() + (data.expires_in * 1000));
  }

  async refreshToken(): Promise<void> {
    if (this.token_expiry && this.token_expiry > new Date()) {
      return; // Token still valid
    }
    await this.authenticate();
  }

  private async getAccessToken(): Promise<string> {
    await this.refreshToken();
    return this.access_token!;
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    body?: any,
    options?: { idempotency_key?: string }
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.apiBaseUrl}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    if (options?.idempotency_key) {
      headers['X-Idempotency-Key'] = options.idempotency_key;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json();

    if (data.status === 'failed') {
      throw new Error(data.error?.message || 'Request failed');
    }

    return data;
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
        qr: true,
        opay: true
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
        education: false,
        insurance: false,
        government: false
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
      countries: [
        'NG', 'GH', 'KE', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'MW', 'EG',
        'GB', 'EU', 'US'
      ],
      currencies: [
        'NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'MWK',
        'EGP', 'USD', 'EUR', 'GBP'
      ]
    };
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    // Create customer if not provided
    let customer_id = request.customer?.email;
    if (request.customer && !customer_id) {
      const customer = await this.createCustomer(request.customer);
      customer_id = customer.id;
    }

    // Create payment method based on type
    let payment_method_id: string | undefined;
    if (request.payment_method?.type === 'card') {
      payment_method_id = await this.createCardPaymentMethod(request.payment_method);
    } else if (request.payment_method?.type === 'mobile_money') {
      payment_method_id = await this.createMobileMoneyPaymentMethod(request.payment_method);
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
    if (payment_method_id) {
      chargeRequest.payment_method_id = payment_method_id;
    }

    // Make API call
    const response = await this.makeRequest<any>(
      'POST',
      '/charges',
      chargeRequest,
      { idempotency_key: request.reference }
    );

    // Map response to unified format
    return this.mapTransactionResponse(response.data);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    const response = await this.makeRequest<any>(
      'GET',
      `/charges/${reference}`
    );

    return this.mapTransactionResponse(response.data);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    const response = await this.makeRequest<any>(
      'GET',
      `/charges/${id}`
    );

    return this.mapTransactionResponse(response.data);
  }

  private async createCardPaymentMethod(cardData: any): Promise<string> {
    const response = await this.makeRequest<any>(
      'POST',
      '/payment-methods',
      {
        type: 'card',
        card: {
          encrypted_card_number: cardData.encrypted_card_number,
          encrypted_expiry_month: cardData.encrypted_expiry_month,
          encrypted_expiry_year: cardData.encrypted_expiry_year,
          encrypted_cvv: cardData.encrypted_cvv,
          nonce: cardData.nonce
        }
      }
    );

    return response.data.id;
  }

  private async createMobileMoneyPaymentMethod(momoData: any): Promise<string> {
    const response = await this.makeRequest<any>(
      'POST',
      '/payment-methods',
      {
        type: 'mobile_money',
        mobile_money: {
          country_code: momoData.country_code,
          network: momoData.network,
          phone_number: momoData.phone_number
        }
      }
    );

    return response.data.id;
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    // Build recipient based on type
    let recipient: any;
    if (request.recipient.type === 'bank') {
      const bankRecipient = request.recipient as any;
      recipient = {
        bank: {
          code: bankRecipient.bank.code,
          account_number: bankRecipient.bank.account_number
        }
      };
      if (bankRecipient.name) {
        recipient.name = bankRecipient.name;
      }
    } else if (request.recipient.type === 'mobile_money') {
      const momoRecipient = request.recipient as any;
      recipient = {
        mobile_money: {
          network: momoRecipient.mobile_money.network,
          msisdn: `${momoRecipient.mobile_money.country_code}${momoRecipient.mobile_money.phone_number}`
        }
      };
      if (momoRecipient.name) {
        recipient.name = momoRecipient.name;
      }
    }

    // Build transfer request
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

    // Add scheduled date if provided
    if (request.scheduled_date && request.type === 'scheduled') {
      transferRequest.disburse_option = {
        date_time: request.scheduled_date.toISOString(),
        timezone: 'Africa/Lagos'
      };
    }

    const response = await this.makeRequest<any>(
      'POST',
      '/direct-transfers',
      transferRequest,
      { idempotency_key: request.reference }
    );

    return this.mapTransferResponse(response.data);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    const response = await this.makeRequest<any>(
      'GET',
      `/transfers/${reference}`
    );

    return this.mapTransferResponse(response.data);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    const response = await this.makeRequest<any>(
      'GET',
      `/transfers/${id}`
    );

    return this.mapTransferResponse(response.data);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    // Build bulk transfer request
    const bulkTransfers = transfers.map(t => ({
      reference: t.reference,
      narration: t.narration,
      amount: t.amount,
      recipient: {
        type: t.recipient.type,
        ...(t.recipient.type === 'bank' 
          ? { bank: (t.recipient as any).bank }
          : { mobile_money: (t.recipient as any).mobile_money }
        )
      }
    }));

    const response = await this.makeRequest<any>(
      'POST',
      '/bulk-transfers',
      { transfers: bulkTransfers }
    );

    return {
      id: response.data.id,
      status: 'pending',
      total_amount: transfers.reduce((sum, t) => sum + t.amount, 0),
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
    const vaRequest: any = {
      reference: request.reference,
      customer_id: request.customer_id,
      amount: request.amount,
      currency: request.currency,
      account_type: request.account_type,
      narration: request.narration,
      bvn: request.bvn
    };

    if (request.expiry && request.account_type === 'dynamic') {
      vaRequest.expiry = request.expiry;
    }

    const response = await this.makeRequest<any>(
      'POST',
      '/virtual-accounts',
      vaRequest,
      { idempotency_key: request.reference }
    );

    return {
      id: response.data.id,
      account_number: response.data.account_number,
      bank_code: response.data.bank_code || '090567',
      bank_name: response.data.account_bank_name || 'Flutterwave MFB',
      account_type: response.data.account_type,
      status: response.data.status === 'active' ? 'active' : 'inactive',
      currency: response.data.currency,
      amount: response.data.amount,
      expires_at: response.data.account_expiration_datetime 
        ? new Date(response.data.account_expiration_datetime) 
        : undefined,
      customer_id: response.data.customer_id,
      created_at: new Date(response.data.created_datetime)
    };
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    const response = await this.makeRequest<any>(
      'GET',
      `/virtual-accounts/${id}`
    );

    return {
      id: response.data.id,
      account_number: response.data.account_number,
      bank_code: response.data.bank_code || '090567',
      bank_name: response.data.account_bank_name || 'Flutterwave MFB',
      account_type: response.data.account_type,
      status: response.data.status === 'active' ? 'active' : 'inactive',
      currency: response.data.currency,
      amount: response.data.amount,
      expires_at: response.data.account_expiration_datetime 
        ? new Date(response.data.account_expiration_datetime) 
        : undefined,
      customer_id: response.data.customer_id,
      created_at: new Date(response.data.created_datetime)
    };
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    const path = customer_id 
      ? `/virtual-accounts?customer_id=${customer_id}`
      : '/virtual-accounts';

    const response = await this.makeRequest<any>('GET', path);

    return (response.data || []).map((va: any) => ({
      id: va.id,
      account_number: va.account_number,
      bank_code: va.bank_code || '090567',
      bank_name: va.account_bank_name || 'Flutterwave MFB',
      account_type: va.account_type,
      status: va.status === 'active' ? 'active' : 'inactive',
      currency: va.currency,
      amount: va.amount,
      expires_at: va.account_expiration_datetime 
        ? new Date(va.account_expiration_datetime) 
        : undefined,
      customer_id: va.customer_id,
      created_at: new Date(va.created_datetime)
    }));
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    const response = await this.makeRequest<any>(
      'POST',
      '/customers',
      {
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        meta: customer.metadata
      }
    );

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      phone: response.data.phone,
      metadata: response.data.meta,
      created_at: new Date(response.data.created_datetime),
      updated_at: new Date(response.data.created_datetime)
    };
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    const response = await this.makeRequest<any>(
      'GET',
      `/customers/${id}`
    );

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      phone: response.data.phone,
      metadata: response.data.meta,
      created_at: new Date(response.data.created_datetime),
      updated_at: new Date(response.data.created_datetime)
    };
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    const response = await this.makeRequest<any>(
      'PUT',
      `/customers/${id}`,
      {
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        meta: customer.metadata
      }
    );

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      phone: response.data.phone,
      metadata: response.data.meta,
      created_at: new Date(response.data.created_datetime),
      updated_at: new Date(response.data.created_datetime)
    };
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    const path = country ? `/banks?country=${country}` : '/banks';
    const response = await this.makeRequest<any>('GET', path);

    return (response.data || []).map((bank: any) => ({
      code: bank.code,
      name: bank.name,
      longcode: bank.longcode,
      type: bank.type,
      country: bank.country
    }));
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    const response = await this.makeRequest<any>(
      'GET',
      `/banks/${code}/resolve?account_number=${account_number}`
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
    // Flutterwave doesn't have bill payments in v4 API
    return [];
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    // Flutterwave doesn't have bill payments in v4 API
    return [];
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    throw new Error('Bill payments not supported in Flutterwave v4 API');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.config.webhook_secret) {
      return true; // Skip validation if no secret configured
    }

    const hash = crypto
      .createHmac('sha256', this.config.webhook_secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
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
      timestamp: new Date(payload.timestamp),
      raw_payload: payload
    };
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private mapTransactionResponse(data: any): UnifiedTransactionResponse {
    const statusMap: Record<string, TransactionStatus> = {
      'succeeded': 'success',
      'pending': 'pending',
      'failed': 'failed',
      'cancelled': 'failed'
    };

    return {
      id: data.id,
      reference: data.reference,
      status: statusMap[data.status] || 'pending',
      amount: data.amount,
      currency: data.currency,
      provider: 'flutterwave',
      provider_reference: data.processor_response?.code,
      fees: data.fees?.[0]?.amount,
      created_at: new Date(data.created_datetime),
      updated_at: new Date(data.created_datetime),
      metadata: data.meta,
      payment_method_details: data.payment_method,
      authorization: data.next_action
    };
  }

  private mapTransferResponse(data: any): UnifiedTransferResponse {
    const statusMap: Record<string, TransactionStatus> = {
      'SUCCESSFUL': 'success',
      'FAILED': 'failed',
      'NEW': 'pending',
      'PENDING': 'pending'
    };

    return {
      id: data.id,
      reference: data.reference,
      status: statusMap[data.status] || 'pending',
      amount: data.amount?.value || data.amount,
      currency: data.destination_currency || data.source_currency,
      provider: 'flutterwave',
      provider_reference: data.payment_information?.proof,
      fees: data.fee?.value,
      created_at: new Date(data.created_datetime),
      updated_at: new Date(data.created_datetime),
      recipient: data.recipient
    };
  }
}

export default FlutterwaveAdapter;
