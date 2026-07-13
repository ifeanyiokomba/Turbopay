// Remita Provider Adapter
// Implements unified provider interface for Remita API

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
import { generateRemitaHash, validateRemitaSignature, generateUUID } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface RemitaAdapterConfig extends BaseAdapterConfig {
  api_key: string;
  api_secret: string;
  merchant_id: string;
  webhook_secret?: string;
}

// =============================================================================
// REMITA ADAPTER
// =============================================================================

export class RemitaAdapter extends BaseAdapter {
  readonly name: ProviderName = 'remita';
  readonly displayName = 'Remita';
  readonly baseUrl = 'https://login.remita.net';
  readonly sandboxBaseUrl = 'https://login.remita.net';

  private remitaConfig: RemitaAdapterConfig;

  constructor(config: RemitaAdapterConfig) {
    super(config);
    this.remitaConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    // Remita uses API key + HMAC for authentication
    // No OAuth token needed
  }

  async refreshToken(): Promise<void> {
    // No token refresh needed
  }

  protected getCommonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.remitaConfig.api_key}`
    };
  }

  private generateHash(requestId: string, amount: number): string {
    return generateRemitaHash(
      this.remitaConfig.api_key,
      this.remitaConfig.merchant_id,
      requestId,
      amount
    );
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'remita',
      name: 'Remita',
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
        airtime: true,
        data: true,
        electricity: true,
        cable_tv: true,
        education: true,
        insurance: true,
        government: true
      },
      customers: {
        creation: true,
        kyc: true,
        bvn: true,
        nin: true
      },
      technical: {
        webhooks: true,
        idempotency: false,
        sandbox: true,
        multi_currency: false,
        international: false,
        recurring: true,
        refunds: true,
        reversals: true
      },
      countries: ['NG'],
      currencies: ['NGN']
    };
  }

  // ===========================================================================
  // COLLECTIONS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    const requestId = request.reference || generateUUID();
    const hash = this.generateHash(requestId, request.amount);

    const payload = {
      merchantId: this.remitaConfig.merchant_id,
      apiKey: this.remitaConfig.api_key,
      serviceTypeId: request.metadata?.service_type_id || '',
      amount: request.amount,
      requestId: requestId,
      responseUrl: request.redirect_url,
      orderRef: request.description,
      customFields: request.metadata ? Object.entries(request.metadata).map(([key, value]) => ({
        name: key,
        value: String(value),
        type: 'MANDATORY'
      })) : [],
      hash: hash
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/remita/ecomm/init', payload)
    );

    return {
      id: response.data.RRR || requestId,
      reference: requestId,
      status: 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'remita',
      provider_reference: response.data.RRR,
      created_at: new Date(),
      updated_at: new Date(),
      authorization: {
        redirect_url: response.data.redirectUrl,
        rrr: response.data.RRR
      },
      metadata: request.metadata
    };
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    const response = await this.withRetry(() =>
      this.httpClient.get(`/remita/ecomm/${reference}`)
    );

    const data = response.data;
    const statusMap: Record<string, TransactionStatus> = {
      '001': 'success',
      '010': 'pending',
      '011': 'failed',
      '012': 'pending'
    };

    return {
      id: data.RRR || reference,
      reference: data.orderRef || reference,
      status: statusMap[data.status] || 'pending',
      amount: data.amount,
      currency: 'NGN',
      provider: 'remita',
      provider_reference: data.RRR,
      created_at: new Date(data.paymentDate || Date.now()),
      updated_at: new Date(),
      metadata: data.customFields
    };
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // PAYOUTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    if (request.recipient.type !== 'bank') {
      throw new Error('Only bank transfers are supported by Remita');
    }

    const bankRecipient = request.recipient as any;
    const requestId = request.reference || generateUUID();
    const hash = this.generateHash(requestId, request.amount);

    const payload = {
      merchantId: this.remitaConfig.merchant_id,
      apiKey: this.remitaConfig.api_key,
      requestId: requestId,
      destinationBankCode: bankRecipient.bank.code,
      destinationAccountNumber: bankRecipient.bank.account_number,
      destinationAccountName: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : '',
      amount: request.amount,
      narration: request.narration,
      hash: hash
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/remita/payroll/single', payload)
    );

    return {
      id: response.data.reference || requestId,
      reference: requestId,
      status: 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'remita',
      provider_reference: response.data.remitaReference,
      created_at: new Date(),
      updated_at: new Date(),
      recipient: request.recipient,
      metadata: request.metadata
    };
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    const response = await this.withRetry(() =>
      this.httpClient.get(`/remita/payroll/${reference}/status`)
    );

    const data = response.data;
    return {
      id: data.reference || reference,
      reference: reference,
      status: data.status === 'SUCCESS' ? 'success' : 'pending',
      amount: data.amount,
      currency: 'NGN',
      provider: 'remita',
      created_at: new Date(data.createdOn || Date.now()),
      updated_at: new Date()
    };
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    const batchId = generateUUID();
    const requestId = generateUUID();

    const batchItems = transfers.map(t => {
      if (t.recipient.type !== 'bank') {
        throw new Error('Only bank transfers are supported by Remita');
      }
      const bankRecipient = t.recipient as any;
      return {
        bankCode: bankRecipient.bank.code,
        accountNumber: bankRecipient.bank.account_number,
        accountName: bankRecipient.name ? `${bankRecipient.name.first} ${bankRecipient.name.last}` : '',
        amount: t.amount,
        narration: t.narration
      };
    });

    const hash = this.generateHash(requestId, transfers.reduce((sum, t) => sum + t.amount, 0));

    const response = await this.httpClient.post('/remita/payroll/bulk', {
      merchantId: this.remitaConfig.merchant_id,
      apiKey: this.remitaConfig.api_key,
      requestId: requestId,
      payroll: batchItems,
      hash: hash
    });

    return {
      id: response.data.reference || batchId,
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
    throw new Error('Virtual accounts not supported by Remita');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Virtual accounts not supported by Remita');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    const id = generateUUID();
    return {
      id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      metadata: customer.metadata,
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Customer retrieval not supported by Remita');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Customer update not supported by Remita');
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    // Use Flutterwave's bank list API as primary source (more reliable)
    try {
      const response = await this.httpClient.get(
        'https://api.flutterwave.com/v3/banks?country=NG'
      );
      return (response.data.data || []).map((b: any) => ({
        code: b.code,
        name: b.name,
        country: 'NG'
      }));
    } catch {
      // Fallback to hardcoded Nigerian banks
      return [
        { code: '044', name: 'Access Bank', country: 'NG' },
        { code: '063', name: 'Diamond Bank', country: 'NG' },
        { code: '050', name: 'Ecobank Nigeria', country: 'NG' },
        { code: '045', name: 'Equity Bank', country: 'NG' },
        { code: '070', name: 'Fidelity Bank', country: 'NG' },
        { code: '011', name: 'First Bank of Nigeria', country: 'NG' },
        { code: '214', name: 'First City Monument Bank', country: 'NG' },
        { code: '058', name: 'Guaranty Trust Bank', country: 'NG' },
        { code: '030', name: 'Heritage Bank', country: 'NG' },
        { code: '082', name: 'Keystone Bank', country: 'NG' },
        { code: '076', name: 'Polaris Bank', country: 'NG' },
        { code: '101', name: ' Providus Bank', country: 'NG' },
        { code: '221', name: 'Stanbic IBTC Bank', country: 'NG' },
        { code: '068', name: 'Standard Chartered Bank', country: 'NG' },
        { code: '232', name: 'Sterling Bank', country: 'NG' },
        { code: '032', name: 'Union Bank of Nigeria', country: 'NG' },
        { code: '033', name: 'United Bank for Africa', country: 'NG' },
        { code: '035', name: 'Wema Bank', country: 'NG' },
        { code: '057', name: 'Zenith Bank', country: 'NG' },
      ];
    }
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    // Use Flutterwave's bank resolution API (more reliable than Paystack dependency)
    try {
      const response = await this.httpClient.get(
        `https://api.flutterwave.com/v3/banks/${code}/resolve?account_number=${account_number}`
      );
      return {
        account_number: response.data.data.account_number,
        account_name: response.data.data.account_name,
        bank_code: code,
        bank_name: ''
      };
    } catch {
      return {
        account_number,
        account_name: 'Account name unavailable',
        bank_code: code,
        bank_name: ''
      };
    }
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    const response = await this.httpClient.get('/remita/api/v1/billers/list');
    return (response.data || []).map((b: any) => ({
      id: b.billId,
      name: b.billName,
      category: b.billCategory || 'general',
      description: b.billDescription
    }));
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    const response = await this.httpClient.get(`/remita/api/v1/billers/${biller_id}/items`);
    return (response.data || []).map((i: any) => ({
      id: i.itemId,
      name: i.itemName,
      amount: i.amount,
      code: i.itemCode
    }));
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    const requestId = request.customer_reference || generateUUID();
    const hash = this.generateHash(requestId, request.amount);

    const response = await this.withRetry(() =>
      this.httpClient.post('/remita/api/v1/payment', {
        billerId: request.biller_id,
        itemId: request.item_id,
        amount: request.amount,
        requestId: requestId,
        customerName: request.customer_name,
        customerEmail: request.customer_email,
        customerPhone: request.customer_phone,
        hash: hash
      })
    );

    return {
      id: response.data.rrr || requestId,
      reference: requestId,
      status: response.data.status === '001' ? 'success' : 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'remita',
      provider_reference: response.data.rrr,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: request.metadata
    };
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    const requestId = generateUUID();
    const hash = this.generateHash(requestId, amount || 0);

    const response = await this.withRetry(() =>
      this.httpClient.post('/remita/api/v1/refund', {
        rrr: transaction_id,
        amount: amount,
        reason: reason || 'Refund requested',
        requestId,
        hash
      })
    );

    return {
      id: response.data.rrr || transaction_id,
      reference: requestId,
      status: 'pending',
      amount: amount || 0,
      currency: 'NGN',
      provider: 'remita',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { reason }
    };
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('remita', 'reversal');
  }

  // ===========================================================================
  // EXCHANGE RATE
  // ===========================================================================

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    throw new ProviderFeatureUnavailableError('remita', 'exchange_rate');
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const start = Date.now();
    try {
      // Remita uses API key auth, just verify it's set
      if (!this.remitaConfig.api_key) {
        throw new Error('API key not configured');
      }
      const latency = Date.now() - start;
      return {
        provider: 'remita',
        is_healthy: true,
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'remita',
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
    throw new ProviderFeatureUnavailableError('remita', 'settlement');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.remitaConfig.webhook_secret) return true;
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return validateRemitaSignature(rawBody, signature, this.remitaConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'SUCCESS': 'payment.success',
      'FAILED': 'payment.failed',
      'PENDING': 'payment.pending'
    };

    return {
      event: eventMap[payload.status] || payload.status,
      data: {
        id: payload.rrr || payload.reference,
        reference: payload.orderRef || payload.reference,
        status: payload.status === '001' ? 'success' : 'pending',
        amount: payload.amount,
        currency: 'NGN',
        provider: 'remita',
        provider_reference: payload.rrr,
        created_at: new Date(payload.paymentDate || Date.now()),
        updated_at: new Date()
      },
      provider: 'remita',
      signature: '',
      timestamp: new Date(payload.paymentDate || Date.now()),
      raw_payload: payload
    };
  }
}

export default RemitaAdapter;
