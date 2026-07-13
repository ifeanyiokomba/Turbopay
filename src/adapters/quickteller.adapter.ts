// Quickteller Provider Adapter
// Implements unified provider interface for Quickteller API

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
  TransactionStatus,
  ExchangeRateResponse,
  ProviderHealthCheckResult,
  SettlementResponse,
  ProviderFeatureUnavailableError
} from '../types';
import { validateQuicktellerSignature, generateUUID, sha512Hash } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface QuicktellerAdapterConfig extends BaseAdapterConfig {
  client_id: string;
  client_secret: string;
  merchant_code: string;
  terminal_id?: string;
  webhook_secret?: string;
}

// =============================================================================
// QUICKTELLER ADAPTER
// =============================================================================

export class QuicktellerAdapter extends BaseAdapter {
  readonly name: ProviderName = 'quickteller';
  readonly displayName = 'Quickteller';
  readonly baseUrl = 'https://quickteller.com/api';
  readonly sandboxBaseUrl = 'https://sandbox.quickteller.com/api';

  private quicktellerConfig: QuicktellerAdapterConfig;
  private basicAuth: string;

  constructor(config: QuicktellerAdapterConfig) {
    super(config);
    this.quicktellerConfig = config;
    this.basicAuth = Buffer.from(
      `${config.client_id}:${config.client_secret}`
    ).toString('base64');
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    const response = await fetch(
      `${this.getBaseUrl()}/auth/token`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${this.basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' })
      }
    );

    if (!response.ok) {
      throw new Error(`Quickteller authentication failed: ${response.statusText}`);
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
      provider: 'quickteller',
      name: 'Quickteller',
      collections: {
        card: true,
        bank_transfer: true,
        ussd: true,
        mobile_money: false,
        qr: true
      },
      payouts: {
        bank_transfer: true,
        mobile_money: false,
        bulk: true,
        scheduled: false,
        instant: true
      },
      virtual_accounts: {
        dedicated: false,
        dynamic: false,
        static: false,
        bank_selection: false
      },
      bills: {
        airtime: true,
        data: true,
        electricity: true,
        cable_tv: true,
        education: true,
        insurance: true,
        government: true
      },
      customers: {
        creation: false,
        kyc: false,
        bvn: false,
        nin: false
      },
      technical: {
        webhooks: true,
        idempotency: false,
        sandbox: true,
        multi_currency: false,
        international: false,
        recurring: false,
        refunds: false,
        reversals: false
      },
      countries: ['NG'],
      currencies: ['NGN']
    };
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/v5/payment/request', {
        amount: request.amount,
        reference: request.reference,
        description: request.description || 'Payment',
        customer: {
          name: request.customer?.name ? `${request.customer.name.first} ${request.customer.name.last}` : '',
          email: request.customer?.email || '',
          phone: request.customer?.phone ? `+${request.customer.phone.country_code}${request.customer.phone.number}` : ''
        },
        paymentMethod: request.payment_method?.type || 'card',
        merchantCode: this.quicktellerConfig.merchant_code,
        callbackUrl: request.redirect_url,
        metadata: request.metadata
      })
    );

    return {
      id: response.data.data?.transactionId || request.reference,
      reference: request.reference,
      status: 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'quickteller',
      created_at: new Date(),
      updated_at: new Date(),
      authorization: {
        redirect_url: response.data.data?.paymentUrl,
        transaction_id: response.data.data?.transactionId
      },
      metadata: request.metadata
    };
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/v5/payment/verify/${reference}`)
    );

    const data = response.data.data;
    const statusMap: Record<string, TransactionStatus> = {
      'success': 'success',
      'failed': 'failed',
      'pending': 'pending',
      'reversed': 'reversed'
    };

    return {
      id: data.transactionId || reference,
      reference: data.reference || reference,
      status: statusMap[data.status?.toLowerCase()] || 'pending',
      amount: data.amount,
      currency: 'NGN',
      provider: 'quickteller',
      provider_reference: data.transactionId,
      created_at: new Date(data.transactionDate || Date.now()),
      updated_at: new Date(),
      metadata: data.metadata
    };
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    if (request.recipient.type !== 'bank') {
      throw new Error('Only bank transfers are supported by Quickteller');
    }

    const bankRecipient = request.recipient as any;
    const transactionId = generateUUID();

    const response = await this.withRetry(() =>
      this.httpClient.post('/v5/disbursements/single', {
        transactionId,
        amount: request.amount,
        bankCode: bankRecipient.bank.code,
        accountNumber: bankRecipient.bank.account_number,
        accountName: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : '',
        narration: request.narration,
        merchantCode: this.quicktellerConfig.merchant_code,
        terminalId: this.quicktellerConfig.terminal_id,
        callbackUrl: request.callback_url
      })
    );

    return {
      id: response.data.data?.transactionId || transactionId,
      reference: request.reference,
      status: 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'quickteller',
      created_at: new Date(),
      updated_at: new Date(),
      recipient: request.recipient,
      metadata: request.metadata
    };
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/v5/disbursements/verify/${reference}`)
    );

    const data = response.data.data;
    return {
      id: data.transactionId || reference,
      reference: reference,
      status: data.status === 'success' ? 'success' : 'pending',
      amount: data.amount,
      currency: 'NGN',
      provider: 'quickteller',
      created_at: new Date(data.transactionDate || Date.now()),
      updated_at: new Date()
    };
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    await this.refreshToken();

    const batchId = generateUUID();
    const batchItems = transfers.map(t => {
      if (t.recipient.type !== 'bank') {
        throw new Error('Only bank transfers are supported by Quickteller');
      }
      const bankRecipient = t.recipient as any;
      return {
        transactionId: t.reference,
        amount: t.amount,
        bankCode: bankRecipient.bank.code,
        accountNumber: bankRecipient.bank.account_number,
        accountName: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : '',
        narration: t.narration
      };
    });

    const response = await this.httpClient.post('/v5/disbursements/batch', {
      batchId,
      merchantCode: this.quicktellerConfig.merchant_code,
      terminalId: this.quicktellerConfig.terminal_id,
      transactions: batchItems
    });

    return {
      id: response.data.data?.batchId || batchId,
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
    throw new Error('Virtual accounts not supported by Quickteller');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Virtual accounts not supported by Quickteller');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS (Not supported)
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('Customer management not supported by Quickteller');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Customer management not supported by Quickteller');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Customer management not supported by Quickteller');
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/v5/banks');
    return (response.data.data || []).map((b: any) => ({
      code: b.bankCode,
      name: b.bankName,
      country: 'NG'
    }));
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    await this.refreshToken();
    const response = await this.httpClient.get(
      `/v5/banks/resolve?bankCode=${code}&accountNumber=${account_number}`
    );
    const data = response.data.data;
    return {
      account_number: data.accountNumber,
      account_name: data.accountName,
      bank_code: code,
      bank_name: ''
    };
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/v5/billers');
    return (response.data.data || []).map((b: any) => ({
      id: b.billerId,
      name: b.billerName,
      category: b.category || 'general',
      description: b.description
    }));
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/v5/billers/${biller_id}/items`);
    return (response.data.data || []).map((i: any) => ({
      id: i.itemId,
      name: i.itemName,
      amount: i.amount,
      code: i.itemCode
    }));
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const transactionId = generateUUID();
    const response = await this.withRetry(() =>
      this.httpClient.post('/v5/billpayments', {
        transactionId,
        billerId: request.biller_id,
        itemId: request.item_id,
        amount: request.amount,
        customerReference: request.customer_reference,
        customerName: request.customer_name,
        customerEmail: request.customer_email,
        customerPhone: request.customer_phone,
        merchantCode: this.quicktellerConfig.merchant_code,
        terminalId: this.quicktellerConfig.terminal_id
      })
    );

    return {
      id: response.data.data?.transactionId || transactionId,
      reference: request.customer_reference,
      status: 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'quickteller',
      provider_reference: response.data.data?.referenceCode,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: request.metadata
    };
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/v5/refunds', {
        transactionId: transaction_id,
        amount,
        reason: reason || 'Refund requested',
        merchantCode: this.quicktellerConfig.merchant_code
      })
    );

    return {
      id: response.data.data?.transactionId || transaction_id,
      reference: transaction_id,
      status: 'pending',
      amount: amount || 0,
      currency: 'NGN',
      provider: 'quickteller',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { reason }
    };
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('quickteller', 'reversal');
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    throw new ProviderFeatureUnavailableError('quickteller', 'exchange_rate');
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
        provider: 'quickteller',
        is_healthy: true,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'quickteller',
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
    throw new ProviderFeatureUnavailableError('quickteller', 'settlement');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.quicktellerConfig.webhook_secret) return true;
    return validateQuicktellerSignature(payload, signature, this.quicktellerConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'payment.successful': 'payment.success',
      'payment.failed': 'payment.failed',
      'disbursement.successful': 'transfer.success',
      'disbursement.failed': 'transfer.failed'
    };

    return {
      event: eventMap[payload.event] || payload.event,
      data: {
        id: payload.transactionId || payload.reference,
        reference: payload.reference,
        status: payload.status === 'successful' ? 'success' : 'failed',
        amount: payload.amount,
        currency: 'NGN',
        provider: 'quickteller',
        created_at: new Date(payload.transactionDate || Date.now()),
        updated_at: new Date()
      },
      provider: 'quickteller',
      signature: '',
      timestamp: new Date(payload.timestamp || Date.now()),
      raw_payload: payload
    };
  }
}

export default QuicktellerAdapter;
