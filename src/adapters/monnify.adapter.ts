// Monnify Provider Adapter
// Implements unified provider interface for Monnify API

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
import { validateMonnifySignature, hmacSHA256 } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface MonnifyAdapterConfig extends BaseAdapterConfig {
  api_key: string;
  api_secret: string;
  contract_code: string;
  webhook_secret?: string;
}

// =============================================================================
// MONNIFY ADAPTER
// =============================================================================

export class MonnifyAdapter extends BaseAdapter {
  readonly name: ProviderName = 'monnify';
  readonly displayName = 'Monnify';
  readonly baseUrl = 'https://api.monnify.com';
  readonly sandboxBaseUrl = 'https://sandbox.monnify.com';

  private monnifyConfig: MonnifyAdapterConfig;

  constructor(config: MonnifyAdapterConfig) {
    super(config);
    this.monnifyConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    const credentials = Buffer.from(
      `${this.monnifyConfig.api_key}:${this.monnifyConfig.api_secret}`
    ).toString('base64');

    const response = await fetch(
      `${this.getBaseUrl()}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Monnify authentication failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    this.setToken(data.responseBody.accessToken, data.responseBody.expiresIn);
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
      provider: 'monnify',
      name: 'Monnify',
      collections: {
        card: false,
        bank_transfer: true,
        ussd: false,
        mobile_money: false,
        qr: false
      },
      payouts: {
        bank_transfer: true,
        mobile_money: false,
        bulk: true,
        scheduled: false,
        instant: true
      },
      virtual_accounts: {
        dedicated: true,
        dynamic: true,
        static: false,
        bank_selection: true
      },
      bills: {
        airtime: true,
        data: true,
        electricity: true,
        cable_tv: true,
        education: true,
        insurance: false,
        government: false,
        betting: true
      },
      customers: {
        creation: false,
        kyc: false,
        bvn: false,
        nin: false
      },
      technical: {
        webhooks: true,
        idempotency: true,
        sandbox: true,
        multi_currency: false,
        international: false,
        recurring: false,
        refunds: true,
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

    const payload: any = {
      amount: request.amount,
      reference: request.reference,
      customerName: request.customer?.name ? `${request.customer.name.first} ${request.customer.name.last}` : 'Customer',
      customerEmail: request.customer?.email || 'customer@example.com',
      paymentReference: request.reference,
      paymentDescription: request.description || 'Payment',
      currencyCode: request.currency,
      contractCode: this.monnifyConfig.contract_code,
      redirectUrl: request.redirect_url,
      paymentMethods: ['BANK_TRANSFER'],
      metadata: request.metadata
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/api/v1/merchant/transactions/init-transaction', payload)
    );

    const data = response.data.responseBody;
    return {
      id: data.transactionReference,
      reference: data.transactionReference,
      status: 'pending',
      amount: request.amount,
      currency: request.currency,
      provider: 'monnify',
      created_at: new Date(),
      updated_at: new Date(),
      authorization: {
        redirect_url: data.redirectUrl,
        checkout_url: data.checkoutUrl
      },
      metadata: request.metadata
    };
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/api/v2/transactions/${reference}`)
    );
    return this.mapTransactionResponse(response.data.responseBody);
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
      throw new Error('Only bank transfers are supported by Monnify');
    }

    const bankRecipient = request.recipient as any;
    const payload = {
      amount: request.amount,
      reference: request.reference,
      narration: request.narration,
      bankCode: bankRecipient.bank.code,
      bankAccountNumber: bankRecipient.bank.account_number,
      accountName: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : '',
      currency: request.currency,
      contractCode: this.monnifyConfig.contract_code
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/api/v2/disbursements/single', payload)
    );

    return {
      id: response.data.responseBody?.batchReference || request.reference,
      reference: request.reference,
      status: 'pending',
      amount: request.amount,
      currency: request.currency,
      provider: 'monnify',
      created_at: new Date(),
      updated_at: new Date(),
      recipient: request.recipient,
      metadata: request.metadata
    };
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/api/v2/disbursements/transactions/${reference}`);
    return this.mapTransferResponse(response.data.responseBody);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    await this.refreshToken();

    const batchItems = transfers.map(t => {
      if (t.recipient.type !== 'bank') {
        throw new Error('Only bank transfers are supported by Monnify');
      }
      const bankRecipient = t.recipient as any;
      return {
        amount: t.amount,
        reference: t.reference,
        narration: t.narration,
        bankCode: bankRecipient.bank.code,
        bankAccountNumber: bankRecipient.bank.account_number,
        accountName: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : ''
      };
    });

    const response = await this.httpClient.post('/api/v2/disbursements/batch', {
      title: `Bulk Transfer ${Date.now()}`,
      sourceCurrency: transfers[0]?.currency || 'NGN',
      contractCode: this.monnifyConfig.contract_code,
      items: batchItems
    });

    return {
      id: response.data.responseBody?.batchReference || this.generateReference('bulk'),
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

    const payload = {
      contractCode: this.monnifyConfig.contract_code,
      accountReference: request.reference,
      accountName: request.narration || `VA ${request.reference}`,
      currencyCode: request.currency,
      customerEmail: request.customer?.email || 'customer@example.com',
      customerName: request.customer?.name ? `${request.customer.name.first} ${request.customer.name.last}` : 'Customer',
      bvn: request.bvn
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/api/v1/bank-transfer/reserved-accounts', payload)
    );

    const data = response.data.responseBody;
    return {
      id: data.accountReference,
      account_number: data.accountNumber,
      bank_code: data.bankCode || '035',
      bank_name: data.bankName || 'Wema Bank',
      account_type: 'dynamic',
      status: 'active',
      currency: request.currency,
      amount: request.amount,
      customer_id: request.customer_id,
      created_at: new Date()
    };
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/api/v1/bank-transfer/reserved-accounts/${id}`);
    const data = response.data.responseBody;
    return {
      id: data.accountReference,
      account_number: data.accountNumber,
      bank_code: data.bankCode,
      bank_name: data.bankName,
      account_type: 'dynamic',
      status: data.status === 'ACTIVE' ? 'active' : 'inactive',
      currency: data.currencyCode,
      amount: 0,
      created_at: new Date()
    };
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    await this.refreshToken();
    const response = await this.httpClient.get(
      `/api/v1/bank-transfer/reserved-accounts?contractCode=${this.monnifyConfig.contract_code}`
    );
    return (response.data.responseBody || []).map((va: any) => ({
      id: va.accountReference,
      account_number: va.accountNumber,
      bank_code: va.bankCode,
      bank_name: va.bankName,
      account_type: 'dynamic',
      status: va.status === 'ACTIVE' ? 'active' : 'inactive',
      currency: va.currencyCode,
      amount: 0,
      created_at: new Date(va.createdOn || Date.now())
    }));
  }

  // ===========================================================================
  // CUSTOMERS (Not supported)
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('Customer management not supported by Monnify');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Customer management not supported by Monnify');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Customer management not supported by Monnify');
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/api/v1/banks');
    return (response.data.responseBody || []).map((b: any) => ({
      code: b.bankCode,
      name: b.bankName,
      country: 'NG'
    }));
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    await this.refreshToken();
    const response = await this.httpClient.get(
      `/api/v1/banks/resolve?bankCode=${code}&accountNumber=${account_number}`
    );
    const data = response.data.responseBody;
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

    const response = await this.withRetry(() =>
      this.httpClient.get('/api/v2/billers')
    );

    const billers = response.data.responseBody || [];
    return billers.map((b: any) => ({
      id: b.billerCode,
      name: b.billerName,
      category: b.category || 'general',
      description: b.description,
      payment_items: (b.items || []).map((item: any) => ({
        id: item.itemCode || item.code,
        name: item.itemName || item.name,
        amount: item.amount,
        code: item.itemCode || item.code
      }))
    }));
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.get('/api/v2/billers')
    );

    const billers = response.data.responseBody || [];
    const biller = billers.find((b: any) => b.billerCode === biller_id);
    if (!biller) return [];

    return (biller.items || []).map((item: any) => ({
      id: item.itemCode || item.code,
      name: item.itemName || item.name,
      amount: item.amount,
      code: item.itemCode || item.code
    }));
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    // Validate customer first
    const validationResponse = await this.withRetry(() =>
      this.httpClient.post('/api/v1/billers/validate', {
        billerCode: request.biller_id,
        customerReference: request.customer_reference
      })
    );

    if (!validationResponse.data.responseBody?.valid) {
      throw new Error(`Customer validation failed: ${validationResponse.data.responseMessage || 'Invalid customer reference'}`);
    }

    // Process payment
    const response = await this.withRetry(() =>
      this.httpClient.post('/api/v1/billers/pay', {
        billerCode: request.biller_id,
        itemCode: request.item_id,
        amount: request.amount,
        customerReference: request.customer_reference,
        customerName: request.customer_name,
        customerEmail: request.customer_email,
        customerPhone: request.customer_phone,
        paymentReference: request.customer_reference
      })
    );

    return {
      id: response.data.responseBody?.reference || request.customer_reference,
      reference: request.customer_reference,
      status: response.data.responseBody?.status === 'SUCCESSFUL' ? 'success' : 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'monnify',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: {
        biller_id: request.biller_id,
        item_id: request.item_id,
        validation: validationResponse.data.responseBody
      }
    };
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post(`/api/v2/transactions/${transaction_id}/refund`, {
        refundAmount: amount,
        refundNote: reason || 'Refund requested'
      })
    );

    return {
      id: response.data.responseBody?.reference || transaction_id,
      reference: transaction_id,
      status: 'pending',
      amount: amount || 0,
      currency: 'NGN',
      provider: 'monnify',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { reason }
    };
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('monnify', 'reversal');
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    throw new ProviderFeatureUnavailableError('monnify', 'exchange_rate');
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
        provider: 'monnify',
        is_healthy: true,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'monnify',
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
    throw new ProviderFeatureUnavailableError('monnify', 'settlement');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.monnifyConfig.webhook_secret) return true;
    return validateMonnifySignature(payload, signature, this.monnifyConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'SUCCESSFUL': 'payment.success',
      'FAILED': 'payment.failed',
      'SETTLED': 'settlement.success'
    };

    return {
      event: eventMap[payload.eventType] || payload.eventType,
      data: this.mapTransactionResponse(payload.eventData),
      provider: 'monnify',
      signature: '',
      timestamp: new Date(payload.dateCreated || Date.now()),
      raw_payload: payload
    };
  }

  // ===========================================================================
  // MAPPING HELPERS
  // ===========================================================================

  private mapTransactionResponse(data: any): UnifiedTransactionResponse {
    const statusMap: Record<string, TransactionStatus> = {
      'SUCCESS': 'success',
      'FAILED': 'failed',
      'PENDING': 'pending',
      'PAID': 'success'
    };

    return {
      id: data.transactionReference || data.reference,
      reference: data.paymentReference || data.reference,
      status: statusMap[data.transactionStatus] || 'pending',
      amount: data.amountPaid || data.amount,
      currency: data.currency,
      provider: 'monnify',
      provider_reference: data.transactionReference,
      fees: data.fee,
      created_at: new Date(data.dateCreated || Date.now()),
      updated_at: new Date(data.dateCreated || Date.now()),
      metadata: data.metadata
    };
  }

  private mapTransferResponse(data: any): UnifiedTransferResponse {
    const statusMap: Record<string, TransactionStatus> = {
      'SUCCESS': 'success',
      'FAILED': 'failed',
      'PENDING': 'pending'
    };

    return {
      id: data.reference,
      reference: data.reference,
      status: statusMap[data.status] || 'pending',
      amount: data.amount,
      currency: data.currency,
      provider: 'monnify',
      created_at: new Date(data.createdOn || Date.now()),
      updated_at: new Date(data.createdOn || Date.now())
    };
  }
}

export default MonnifyAdapter;
