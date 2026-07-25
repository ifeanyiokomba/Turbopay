// MTN MoMo Provider Adapter (Multi-country, includes Nigeria)
// Implements unified provider interface for MTN Mobile Money API
//
// Developer portal: momodeveloper.mtn.com
// Sandbox: https://sandbox.momodeveloper.mtn.com
// Three-legged auth: API User → API Key → Bearer token
// Collection: POST /collection/v1_0/requesttopay (202 accepted, poll for status)
// Disbursement: POST /disbursement/v1_0/transfer

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

// =============================================================================
// CONFIG
// =============================================================================

export interface MTNMoMoAdapterConfig extends BaseAdapterConfig {
  api_key: string;
  api_secret: string;
  subscription_key: string;
  disbursement_subscription_key?: string;
  api_user?: string;
  callback_url?: string;
  webhook_secret?: string; // Secret token for callback URL validation (e.g., embedded in callback URL path)
  target_environment?: string;
}

// =============================================================================
// MTN MOMO ADAPTER
// =============================================================================

export class MTNMoMoAdapter extends BaseAdapter {
  readonly name: ProviderName = 'mtn_momo';
  readonly displayName = 'MTN MoMo';
  readonly baseUrl = 'https://proxy.momoapi.mtn.com';
  readonly sandboxBaseUrl = 'https://sandbox.momodeveloper.mtn.com';

  private mtnConfig: MTNMoMoAdapterConfig;
  private collectionToken: string | null = null;
  private collectionTokenExpiry: Date | null = null;
  private disbursementToken: string | null = null;
  private disbursementTokenExpiry: Date | null = null;

  constructor(config: MTNMoMoAdapterConfig) {
    super(config);
    this.mtnConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION (Three-legged: API User → API Key → Bearer token)
  // ===========================================================================

  async authenticate(): Promise<void> {
    await this.authenticateCollection();
    await this.authenticateDisbursement();
  }

  private async authenticateCollection(): Promise<void> {
    const baseUrl = this.getBaseUrl();

    // Step 1: Create API User (if not provided)
    let apiUser = this.mtnConfig.api_user;
    if (!apiUser) {
      const userRes = await fetch(`${baseUrl}/collection/v1_0/apiuser`, {
        method: 'POST',
        headers: {
          'X-Reference-Id': this.generateUUID(),
          'Ocp-Apim-Subscription-Key': this.mtnConfig.subscription_key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ providerCallbackHost: this.mtnConfig.callback_url || 'https://turbopay.ng/webhooks/mtn' })
      });
      if (userRes.ok) {
        apiUser = userRes.headers.get('x-reference-id') || undefined;
      }
    }

    // Step 2: Generate API Key for the user
    if (apiUser) {
      const keyRes = await fetch(`${baseUrl}/collection/v1_0/apiuser/${apiUser}/apikey`, {
        method: 'POST',
        headers: {
          'X-Reference-Id': this.generateUUID(),
          'Ocp-Apim-Subscription-Key': this.mtnConfig.subscription_key
        }
      });
      if (keyRes.ok) {
        const keyData = await keyRes.json() as any;
        // Use provided credentials for token exchange
      }
    }

    // Step 3: Exchange API User + API Key for Bearer token
    const credentials = Buffer.from(`${this.mtnConfig.api_user || this.mtnConfig.api_key}:${this.mtnConfig.api_secret}`).toString('base64');

    const tokenRes = await fetch(`${baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': this.mtnConfig.subscription_key
      }
    });

    if (!tokenRes.ok) {
      throw new Error(`MTN MoMo collection auth failed: ${tokenRes.statusText}`);
    }

    const tokenData = await tokenRes.json() as any;
    this.collectionToken = tokenData.access_token;
    this.collectionTokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));
    this.setToken(tokenData.access_token, tokenData.expires_in);
  }

  private async authenticateDisbursement(): Promise<void> {
    const baseUrl = this.getBaseUrl();
    const credentials = Buffer.from(`${this.mtnConfig.api_user || this.mtnConfig.api_key}:${this.mtnConfig.api_secret}`).toString('base64');

    const tokenRes = await fetch(`${baseUrl}/disbursement/token/`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': this.mtnConfig.disbursement_subscription_key || this.mtnConfig.subscription_key
      }
    });

    if (!tokenRes.ok) {
      console.warn(`[MTNMoMo] Disbursement auth failed: ${tokenRes.statusText}`);
      return;
    }

    const tokenData = await tokenRes.json() as any;
    this.disbursementToken = tokenData.access_token;
    this.disbursementTokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));
  }

  async refreshToken(): Promise<void> {
    if (this.collectionTokenExpiry && this.collectionTokenExpiry <= new Date()) {
      await this.authenticateCollection();
    }
    if (this.disbursementTokenExpiry && this.disbursementTokenExpiry <= new Date()) {
      await this.authenticateDisbursement();
    }
  }

  private getCollectionHeaders(): Record<string, string> {
    return {
      'X-Target-Environment': this.mtnConfig.target_environment || 'mtnnigeria',
      'Ocp-Apim-Subscription-Key': this.mtnConfig.subscription_key,
      'Authorization': `Bearer ${this.collectionToken}`
    };
  }

  private getDisbursementHeaders(): Record<string, string> {
    return {
      'X-Target-Environment': this.mtnConfig.target_environment || 'mtnnigeria',
      'Ocp-Apim-Subscription-Key': this.mtnConfig.disbursement_subscription_key || this.mtnConfig.subscription_key,
      'Authorization': `Bearer ${this.disbursementToken}`
    };
  }

  // ===========================================================================
  // CAPABILITIES (Multi-country)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'mtn_momo',
      name: 'MTN MoMo',
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
        reversals: false
      },
      countries: ['NG', 'GH', 'UG', 'RW', 'ZM', 'CM', 'CI'],
      currencies: ['NGN', 'GHS', 'UGX', 'RWF', 'ZMW', 'XAF', 'XOF']
    };
  }

  // ===========================================================================
  // COLLECTIONS (Request-to-Pay)
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('mtn');
    const xRefId = this.generateUUID();
    const phone = request.payment_method?.type === 'mobile_money'
      ? (request.payment_method as MobileMoneyPaymentMethod).phone_number
      : undefined;

    const payload: any = {
      amount: String(request.amount),
      currency: request.currency,
      externalId: reference,
      payer: {
        partyIdType: 'MSISDN',
        partyId: phone
      },
      payerMessage: request.description || 'Payment',
      payeeNote: reference
    };

    const response = await fetch(
      `${this.getBaseUrl()}/collection/v1_0/requesttopay`,
      {
        method: 'POST',
        headers: {
          ...this.getCollectionHeaders(),
          'X-Reference-Id': xRefId,
          'X-Callback-Url': request.callback_url || '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok && response.status !== 202) {
      throw new Error(`MTN MoMo collection failed: ${response.statusText}`);
    }

    // MTN returns 202 Accepted — poll for status
    return this.mapTransactionResponse({
      id: xRefId,
      reference,
      status: 'PENDING',
      amount: request.amount,
      currency: request.currency
    }, reference);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const response = await fetch(
      `${this.getBaseUrl()}/collection/v1_0/requesttopay/${reference}`,
      {
        headers: this.getCollectionHeaders()
      }
    );

    if (!response.ok) {
      throw new Error(`MTN MoMo verify failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return this.mapTransactionResponse({
      id: reference,
      reference: data.externalId || reference,
      status: data.status,
      amount: parseFloat(data.amount),
      currency: data.currency,
      reason: data.reason,
      financialTransactionId: data.financialTransactionId
    }, reference);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // DISBURSEMENTS (Transfer)
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('mtn_t');
    const xRefId = this.generateUUID();
    const mobileMoneyRecipient = request.recipient as any;

    const payload: any = {
      amount: String(request.amount),
      currency: request.currency,
      externalId: reference,
      payee: {
        partyIdType: 'MSISDN',
        partyId: mobileMoneyRecipient?.mobile_money?.phone_number
      },
      payerMessage: request.narration || 'Transfer',
      payeeNote: reference
    };

    const response = await fetch(
      `${this.getBaseUrl()}/disbursement/v1_0/transfer`,
      {
        method: 'POST',
        headers: {
          ...this.getDisbursementHeaders(),
          'X-Reference-Id': xRefId,
          'X-Callback-Url': request.callback_url || '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok && response.status !== 202) {
      throw new Error(`MTN MoMo disbursement failed: ${response.statusText}`);
    }

    return this.mapTransferResponse({
      id: xRefId,
      reference,
      status: 'PENDING',
      amount: request.amount,
      currency: request.currency
    }, reference);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const response = await fetch(
      `${this.getBaseUrl()}/disbursement/v1_0/transfer/${reference}`,
      {
        headers: this.getDisbursementHeaders()
      }
    );

    if (!response.ok) {
      throw new Error(`MTN MoMo transfer verify failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return this.mapTransferResponse({
      id: reference,
      reference: data.externalId || reference,
      status: data.status,
      amount: parseFloat(data.amount),
      currency: data.currency,
      reason: data.reason,
      financialTransactionId: data.financialTransactionId
    }, reference);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    throw new Error('MTN MoMo does not support bulk transfers via this adapter');
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS (Not supported)
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new Error('MTN MoMo does not support virtual accounts');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('MTN MoMo does not support virtual accounts');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('MTN MoMo does not support customer creation via API');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('MTN MoMo does not support customer lookup via API');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('MTN MoMo does not support customer update via API');
  }

  // ===========================================================================
  // BANKS (Not supported)
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    return [];
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    throw new Error('MTN MoMo does not support bank resolution');
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
    // MTN MoMo bill payments go through the collection flow
    return this.initializePayment({
      amount: request.amount,
      currency: 'NGN',
      reference: request.customer_reference || this.generateReference('mtn_bill'),
      description: `Bill payment: ${request.biller_id}`,
      metadata: {
        biller_id: request.biller_id,
        item_id: request.item_id,
        ...request.metadata
      }
    });
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    // MTN MoMo does not have a direct refund API — use reversal
    await this.refreshToken();

    const xRefId = this.generateUUID();
    const response = await fetch(
      `${this.getBaseUrl()}/collection/v1_0/requesttopay/${transaction_id}/refund`,
      {
        method: 'POST',
        headers: {
          ...this.getCollectionHeaders(),
          'X-Reference-Id': xRefId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: reason || 'Refund requested' })
      }
    );

    if (!response.ok) {
      throw new Error(`MTN MoMo refund failed: ${response.statusText}`);
    }

    return {
      id: xRefId,
      reference: transaction_id,
      status: 'pending',
      amount: amount || 0,
      currency: 'NGN',
      provider: 'mtn_momo',
      created_at: new Date(),
      updated_at: new Date(),
      metadata: { reason, refund_reference: xRefId }
    };
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
      await this.authenticateCollection();
      return {
        provider: 'mtn_momo' as ProviderName,
        is_healthy: true,
        latency: Date.now() - start,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'mtn_momo' as ProviderName,
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
    // MTN MoMo does not use header-based HMAC signatures.
    // Security relies on: (1) HTTPS callback URL, (2) unguessable URL path with
    // a secret token, and optionally (3) IP whitelisting of MTN callback IPs.
    //
    // The webhook_secret should be a random token embedded in the callback URL.
    // For example, if callback_url = "https://app.com/api/webhooks/mtn_momo/a1b2c3",
    // then webhook_secret = "a1b2c3" and the incoming request path must contain it.
    if (!this.mtnConfig.webhook_secret) {
      console.error('[MTN MoMo] Webhook secret not configured — rejecting webhook. Set MTN_MOMO_WEBHOOK_SECRET to a random token embedded in your callback URL path.');
      return false;
    }
    // Validate that the signature parameter matches the configured secret.
    // For MTN MoMo, the webhook handler should extract the URL path token
    // and pass it as the signature parameter.
    if (signature !== this.mtnConfig.webhook_secret) {
      console.error('[MTN MoMo] Webhook signature mismatch — rejecting webhook');
      return false;
    }
    return true;
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'success': 'payment.success',
      'FAILED': 'payment.failed',
      'REJECTED': 'payment.failed'
    };

    return {
      event: eventMap[payload.status] || payload.event || 'payment.pending',
      data: this.mapTransactionResponse({
        id: payload.externalId || payload.financialTransactionId,
        reference: payload.externalId,
        status: payload.status,
        amount: parseFloat(payload.amount || '0'),
        currency: payload.currency,
        reason: payload.reason,
        financialTransactionId: payload.financialTransactionId
      }, payload.externalId || ''),
      provider: 'mtn_momo',
      signature: '',
      timestamp: new Date(),
      raw_payload: payload
    };
  }

  // ===========================================================================
  // MAPPING HELPERS
  // ===========================================================================

  private mapTransactionResponse(data: any, reference: string): UnifiedTransactionResponse {
    return {
      id: data.id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'mtn_momo',
      provider_reference: data.financialTransactionId,
      fees: 0,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: data.reason ? { reason: data.reason } : undefined
    };
  }

  private mapTransferResponse(data: any, reference: string): UnifiedTransferResponse {
    return {
      id: data.id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'mtn_momo',
      provider_reference: data.financialTransactionId,
      fees: 0,
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

export default MTNMoMoAdapter;
