// Airtel Money Provider Adapter (Multi-country, excludes Nigeria)
// Implements unified provider interface for Airtel Money API
// Nigeria runs through Smart Cash PSB, not this adapter
//
// Developer portal: developers.airtel.africa
// Staging: https://openapiuat.airtel.africa; Production: https://openapi.airtel.africa

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

export interface AirtelMoneyAdapterConfig extends BaseAdapterConfig {
  client_id: string;
  client_secret: string;
  api_key?: string;
  webhook_secret?: string;
}

// =============================================================================
// AIRTEL MONEY ADAPTER
// =============================================================================

export class AirtelMoneyAdapter extends BaseAdapter {
  readonly name: ProviderName = 'airtel_money';
  readonly displayName = 'Airtel Money';
  readonly baseUrl = 'https://openapi.airtel.africa';
  readonly sandboxBaseUrl = 'https://openapiuat.airtel.africa';

  private airtelConfig: AirtelMoneyAdapterConfig;

  constructor(config: AirtelMoneyAdapterConfig) {
    super(config);
    this.airtelConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION (OAuth2 client credentials)
  // ===========================================================================

  async authenticate(): Promise<void> {
    const response = await fetch(`${this.getBaseUrl()}/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.airtelConfig.client_id,
        client_secret: this.airtelConfig.client_secret
      })
    });

    if (!response.ok) {
      throw new Error(`Airtel Money authentication failed: ${response.statusText}`);
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
  // CAPABILITIES (Multi-country, excludes Nigeria)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'airtel_money',
      name: 'Airtel Money',
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
        idempotency: false,
        sandbox: true,
        multi_currency: false,
        international: false,
        recurring: false,
        refunds: true,
        reversals: false
      },
      // Airtel's markets excluding Nigeria (NG runs through Smart Cash)
      countries: ['KE', 'TZ', 'UG', 'ZM', 'MW', 'CD', 'RW', 'BF', 'CI', 'GA', 'NE'],
      currencies: ['KES', 'TZS', 'UGX', 'ZMW', 'MWK', 'CDF', 'RWF', 'XOF']
    };
  }

  // ===========================================================================
  // COLLECTIONS (Request-to-Pay)
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('airtel');
    const phone = request.payment_method?.type === 'mobile_money'
      ? (request.payment_method as MobileMoneyPaymentMethod).phone_number
      : undefined;

    // TODO: Confirm exact endpoint path against Airtel developer portal docs
    const payload: any = {
      transaction: {
        amount: request.amount,
        currency: request.currency,
        reference,
        description: request.description
      },
      customer: {
        msisdn: phone
      },
      callback: {
        url: request.callback_url
      }
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/collection/v1/requesttopay', payload, {
        headers: { 'X-Country': 'KE', 'X-Currency': request.currency }
      })
    );

    const data = response.data.data || response.data;
    return this.mapTransactionResponse(data, reference);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/collection/v1/requesttopay/${reference}`)
    );
    return this.mapTransactionResponse(response.data.data || response.data, reference);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // DISBURSEMENTS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('airtel_t');
    const mobileMoneyRecipient = request.recipient as any;

    // TODO: Confirm exact endpoint and payload against Airtel docs
    // TODO: Disbursement may require encrypted PIN field — verify against docs before production
    const payload: any = {
      transaction: {
        amount: request.amount,
        currency: request.currency,
        reference,
        narration: request.narration
      },
      recipient: {
        msisdn: mobileMoneyRecipient?.mobile_money?.phone_number
      },
      callback: {
        url: request.callback_url
      }
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/disbursement/v1/payment', payload, {
        headers: { 'X-Country': 'KE', 'X-Currency': request.currency }
      })
    );

    const data = response.data.data || response.data;
    return this.mapTransferResponse(data, reference);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();
    const response = await this.withRetry(() =>
      this.httpClient.get(`/disbursement/v1/payment/${reference}`)
    );
    return this.mapTransferResponse(response.data.data || response.data, reference);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    throw new Error('Airtel Money does not support bulk transfers');
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS (Not supported)
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new Error('Airtel Money does not support virtual accounts');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Airtel Money does not support virtual accounts');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('Airtel Money does not support customer creation via API');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Airtel Money does not support customer lookup via API');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Airtel Money does not support customer update via API');
  }

  // ===========================================================================
  // BANKS (Not supported)
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    return [];
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    throw new Error('Airtel Money does not support bank resolution');
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    return [
      { id: 'airtime', name: 'Airtime', category: 'airtime' },
      { id: 'data', name: 'Data Bundle', category: 'data' }
    ];
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    return [];
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const reference = request.customer_reference || this.generateReference('airtel_bill');

    // TODO: Confirm exact endpoint against Airtel docs
    const payload = {
      transaction: {
        amount: request.amount,
        reference
      },
      biller: {
        biller_id: request.biller_id,
        item_id: request.item_id,
        customer_reference: request.customer_reference
      }
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/billpayment/v1/pay', payload)
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
      this.httpClient.post('/collection/v1/refund', payload)
    );

    const data = response.data.data || response.data;
    return this.mapTransactionResponse(data, transaction_id);
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck() {
    const start = Date.now();
    try {
      await this.refreshToken();
      return {
        provider: 'airtel_money' as ProviderName,
        is_healthy: true,
        latency: Date.now() - start,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'airtel_money' as ProviderName,
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
    if (!this.airtelConfig.webhook_secret) {
      console.error('[AirtelMoney] Webhook secret not configured — rejecting webhook');
      return false;
    }
    const computed = hmacSHA256(JSON.stringify(payload), this.airtelConfig.webhook_secret);
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
      provider: 'airtel_money',
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
      amount: data.amount || data.transaction?.amount || 0,
      currency: data.currency || data.transaction?.currency || 'NGN',
      provider: 'airtel_money',
      provider_reference: data.provider_reference || data.external_id,
      fees: data.fees || data.fee || 0,
      created_at: new Date(data.created_at || data.timestamp || Date.now()),
      updated_at: new Date(data.updated_at || data.timestamp || Date.now()),
      metadata: data.metadata
    };
  }

  private mapTransferResponse(data: any, reference: string): UnifiedTransferResponse {
    return {
      id: data.id || data.transfer_id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || data.state || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'airtel_money',
      provider_reference: data.provider_reference,
      fees: data.fees || data.fee || 0,
      created_at: new Date(data.created_at || data.timestamp || Date.now()),
      updated_at: new Date(data.updated_at || data.timestamp || Date.now())
    };
  }
}

export default AirtelMoneyAdapter;
