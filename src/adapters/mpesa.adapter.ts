// M-Pesa (Safaricom Daraja) Provider Adapter (Kenya primarily)
// Implements unified provider interface for M-Pesa Daraja API
//
// Sandbox: https://sandbox.safaricom.co.ke
// Production: https://api.safaricom.co.ke
// Auth: GET /oauth/v1/generate?grant_type=client_credentials (Basic auth)
// Collection (STK Push): POST /mpesa/stkpush/v1/processrequest
// Status: POST /mpesa/stkpushquery/v1/query
// Disbursement (B2C): POST /mpesa/b2c/v1/paymentrequest (requires RSA-encrypted SecurityCredential)
// Webhook: No header-based signature — relies on unguessable callback URL over HTTPS

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

export interface MPesaAdapterConfig extends BaseAdapterConfig {
  consumer_key: string;
  consumer_secret: string;
  shortcode: string;
  passkey: string;
  callback_url?: string;
  webhook_secret?: string; // Secret token for callback URL validation (e.g., embedded in callback URL path)
  initiator_name?: string;
  security_credential?: string;
  // B2C requires RSA-encrypted security credential with Safaricom's public certificate
  // TODO: Implement proper RSA encryption using Safaricom's published certificate before production
}

// =============================================================================
// M-PESA ADAPTER
// =============================================================================

export class MPesaAdapter extends BaseAdapter {
  readonly name: ProviderName = 'mpesa';
  readonly displayName = 'M-Pesa';
  readonly baseUrl = 'https://api.safaricom.co.ke';
  readonly sandboxBaseUrl = 'https://sandbox.safaricom.co.ke';

  private mpesaConfig: MPesaAdapterConfig;

  constructor(config: MPesaAdapterConfig) {
    super(config);
    this.mpesaConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION (Basic auth → Bearer token)
  // ===========================================================================

  async authenticate(): Promise<void> {
    const credentials = Buffer.from(
      `${this.mpesaConfig.consumer_key}:${this.mpesaConfig.consumer_secret}`
    ).toString('base64');

    const response = await fetch(
      `${this.getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${credentials}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`M-Pesa authentication failed: ${response.statusText}`);
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
  // CAPABILITIES (Kenya primarily)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'mpesa',
      name: 'M-Pesa',
      collections: {
        card: false,
        bank_transfer: false,
        ussd: false,
        mobile_money: true,
        qr: false
      },
      payouts: {
        bank_transfer: false,
        mobile_money: true, // B2C
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
        refunds: false,
        reversals: false
      },
      countries: ['KE'],
      currencies: ['KES']
    };
  }

  // ===========================================================================
  // COLLECTIONS (STK Push)
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('mpesa');
    const phone = request.payment_method?.type === 'mobile_money'
      ? (request.payment_method as MobileMoneyPaymentMethod).phone_number
      : undefined;

    // Generate STK Push password: base64(shortcode + passkey + timestamp)
    const timestamp = this.generateTimestamp();
    const password = Buffer.from(
      `${this.mpesaConfig.shortcode}${this.mpesaConfig.passkey}${timestamp}`
    ).toString('base64');

    const payload: any = {
      BusinessShortCode: this.mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(request.amount),
      PartyA: phone,
      PartyB: this.mpesaConfig.shortcode,
      PhoneNumber: phone,
      CallBackURL: request.callback_url || this.mpesaConfig.callback_url || '',
      AccountReference: reference,
      TransactionDesc: request.description || 'Payment'
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/mpesa/stkpush/v1/processrequest', payload, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      })
    );

    const data = response.data;
    return this.mapTransactionResponse({
      id: data.CheckoutRequestID || reference,
      reference,
      status: data.ResponseCode === '0' ? 'PROCESSING' : 'FAILED',
      amount: request.amount,
      currency: request.currency,
      merchant_request_id: data.MerchantRequestID,
      checkout_request_id: data.CheckoutRequestID,
      response_code: data.ResponseCode,
      response_description: data.ResponseDescription
    }, reference);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    // STK Push query
    const timestamp = this.generateTimestamp();
    const password = Buffer.from(
      `${this.mpesaConfig.shortcode}${this.mpesaConfig.passkey}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: this.mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: reference
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/mpesa/stkpushquery/v1/query', payload, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      })
    );

    const data = response.data;
    return this.mapTransactionResponse({
      id: reference,
      reference,
      status: data.ResultCode === '0' ? 'SUCCESS' : 'FAILED',
      amount: 0,
      currency: 'KES',
      response_code: data.ResultCode,
      result_desc: data.ResultDesc
    }, reference);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // DISBURSEMENTS (B2C)
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    await this.refreshToken();

    const reference = request.reference || this.generateReference('mpesa_t');
    const mobileMoneyRecipient = request.recipient as any;

    // TODO: SecurityCredential must be RSA-encrypted with Safaricom's public certificate
    // Do NOT use plain text credentials in production — this will be rejected
    const securityCredential = this.mpesaConfig.security_credential || '';

    const payload: any = {
      InitiatorName: this.mpesaConfig.initiator_name || 'turbopay',
      SecurityCredential: securityCredential,
      CommandID: 'BusinessPayment',
      Amount: Math.round(request.amount),
      PartyA: this.mpesaConfig.shortcode,
      PartyB: mobileMoneyRecipient?.mobile_money?.phone_number,
      ReceiverIdentifierType: '1',
      ResultURL: request.callback_url || '',
      QueueTimeOutURL: '',
      Remarks: request.narration || 'Transfer',
      Occasion: 'Transfer'
    };

    const response = await this.withRetry(() =>
      this.httpClient.post('/mpesa/b2c/v1/paymentrequest', payload, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      })
    );

    const data = response.data;
    return this.mapTransferResponse({
      id: data.ConversationID || reference,
      reference,
      status: data.ResponseCode === '0' ? 'PROCESSING' : 'FAILED',
      amount: request.amount,
      currency: 'KES',
      conversation_id: data.ConversationID,
      response_code: data.ResponseCode,
      response_description: data.ResponseDescription
    }, reference);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    // M-Pesa B2C does not have a direct query API — status comes via callback
    return this.mapTransferResponse({
      id: reference,
      reference,
      status: 'PENDING',
      amount: 0,
      currency: 'KES'
    }, reference);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    throw new Error('M-Pesa does not support bulk transfers via this adapter');
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS (Not supported)
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new Error('M-Pesa does not support virtual accounts');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('M-Pesa does not support virtual accounts');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('M-Pesa does not support customer creation via API');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('M-Pesa does not support customer lookup via API');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('M-Pesa does not support customer update via API');
  }

  // ===========================================================================
  // BANKS (Not supported)
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    return [];
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    throw new Error('M-Pesa does not support bank resolution');
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
    // M-Pesa bill payments go through STK Push collection flow
    return this.initializePayment({
      amount: request.amount,
      currency: 'KES',
      reference: request.customer_reference || this.generateReference('mpesa_bill'),
      description: `Bill payment: ${request.biller_id}`,
      metadata: {
        biller_id: request.biller_id,
        item_id: request.item_id,
        ...request.metadata
      }
    });
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async healthCheck() {
    const start = Date.now();
    try {
      await this.authenticate();
      return {
        provider: 'mpesa' as ProviderName,
        is_healthy: true,
        latency: Date.now() - start,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'mpesa' as ProviderName,
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

  // M-Pesa Daraja does NOT sign callbacks with a header-based signature.
  // Security relies on the callback URL being unguessable and served over HTTPS.
  // Do NOT add a fake signature check — there is nothing to check.

  validateWebhook(payload: any, signature: string): boolean {
    // M-Pesa Daraja does NOT provide header-based HMAC signatures.
    // Security relies on: (1) HTTPS callback URL, (2) unguessable URL path with
    // a secret token, and (3) validating the request body structure.
    //
    // The webhook_secret should be a random token embedded in the callback URL.
    // For example, if callback_url = "https://app.com/api/webhooks/mpesa/x9y8z7",
    // then webhook_secret = "x9y8z7" and the incoming request path must contain it.
    if (!this.mpesaConfig.webhook_secret) {
      console.error('[M-Pesa] Webhook secret not configured — rejecting webhook. Set MPESA_WEBHOOK_SECRET to a random token embedded in your callback URL path.');
      return false;
    }
    // Validate that the signature parameter matches the configured secret.
    // For M-Pesa, the webhook handler should extract the URL path token
    // and pass it as the signature parameter.
    if (signature !== this.mpesaConfig.webhook_secret) {
      console.error('[M-Pesa] Webhook signature mismatch — rejecting webhook');
      return false;
    }
    return true;
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    // STK Push callback format: Body.stkCallback
    const stkCallback = payload.Body?.stkCallback || payload;

    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    // Extract metadata from CallbackMetadata.Item[]
    const items = stkCallback.CallbackMetadata?.Item || [];
    const metadataMap: Record<string, any> = {};
    for (const item of items) {
      metadataMap[item.Name] = item.Value;
    }

    return {
      event: resultCode === 0 ? 'payment.success' : 'payment.failed',
      data: this.mapTransactionResponse({
        id: stkCallback.MerchantRequestID || '',
        reference: metadataMap['AccountReference'] || stkCallback.MerchantRequestID || '',
        status: resultCode === 0 ? 'SUCCESS' : 'FAILED',
        amount: metadataMap['Amount'] || 0,
        currency: 'KES',
        mpesa_receipt: metadataMap['MpesaReceiptNumber'],
        transaction_date: metadataMap['TransactionDate'],
        phone_number: metadataMap['PhoneNumber'],
        result_code: resultCode,
        result_desc: resultDesc
      }, metadataMap['AccountReference'] || ''),
      provider: 'mpesa',
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
      currency: data.currency || 'KES',
      provider: 'mpesa',
      provider_reference: data.mpesa_receipt || data.checkout_request_id,
      fees: 0,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: data.mpesa_receipt ? {
        mpesa_receipt: data.mpesa_receipt,
        transaction_date: data.transaction_date,
        phone_number: data.phone_number
      } : undefined
    };
  }

  private mapTransferResponse(data: any, reference: string): UnifiedTransferResponse {
    return {
      id: data.id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'KES',
      provider: 'mpesa',
      provider_reference: data.conversation_id,
      fees: 0,
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }
}

export default MPesaAdapter;
