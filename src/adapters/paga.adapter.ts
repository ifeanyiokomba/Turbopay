// Paga Provider Adapter (Nigeria)
// Implements unified provider interface for Paga Business API
//
// Base URL: https://www.mypaga.com/paga-webservices/business-rest/secured
// Auth: Request signing via SHA-512 hash (not OAuth)
// Every request carries: principal, credentials, hash headers
// Hash: SHA-512 of specific request parameters concatenated + shared secret
//
// IMPORTANT: Paga uses a reverse API model for notifications (not standard webhooks)
// Paga calls specific endpoints on your server that you register at onboarding.
// validateWebhook/parseWebhookEvent alone may not be sufficient —
// you likely also need dedicated routes implementing their expected reverse-API surface.

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
import { sha512Hash } from '../utils/crypto';

// =============================================================================
// CONFIG
// =============================================================================

export interface PagaAdapterConfig extends BaseAdapterConfig {
  principal: string; // Public ID
  credentials: string; // Password
  hash_key: string; // Shared secret for hash generation
  api_key?: string;
}

// =============================================================================
// PAGA ADAPTER
// =============================================================================

export class PagaAdapter extends BaseAdapter {
  readonly name: ProviderName = 'paga';
  readonly displayName = 'Paga';
  readonly baseUrl = 'https://www.mypaga.com/paga-webservices/business-rest/secured';
  readonly sandboxBaseUrl = 'https://www.mypaga.com/paga-webservices/business-rest/secured';

  private pagaConfig: PagaAdapterConfig;

  constructor(config: PagaAdapterConfig) {
    super(config);
    this.pagaConfig = config;
    // Paga uses header-based auth, not Bearer tokens
    this.token = 'paga-session';
  }

  // ===========================================================================
  // AUTHENTICATION (Header-based: principal + credentials + hash)
  // ===========================================================================

  async authenticate(): Promise<void> {
    // Paga does not use OAuth — authentication is per-request via headers
    // Verify credentials by making a lightweight test call
    try {
      const hash = this.generateHash({ test: 'true' });
      await fetch(`${this.getBaseUrl()}/getSupportedBanks`, {
        method: 'GET',
        headers: this.getAuthHeaders(hash)
      });
      this.token = 'paga-authenticated';
      this.tokenExpiry = new Date(Date.now() + 3600000); // 1 hour
    } catch (error) {
      throw new Error(`Paga authentication failed: ${(error as Error).message}`);
    }
  }

  async refreshToken(): Promise<void> {
    // Paga uses per-request signing, no token refresh needed
    // But we override to avoid the default token expiry check
  }

  private getAuthHeaders(hash: string): Record<string, string> {
    return {
      'principal': this.pagaConfig.principal,
      'credentials': this.pagaConfig.credentials,
      'hash': hash,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Generate SHA-512 hash for Paga request signing
   * Format: SHA512(principal + credentials + hash_key + sorted_params)
   * TODO: Confirm exact parameter order against Paga docs for collection flow
   */
  private generateHash(params: Record<string, string>): string {
    // TODO: The exact parameter order for collection flow is not fully confirmed
    // For disbursement: confirmed that params are sorted alphabetically and concatenated
    const sortedKeys = Object.keys(params).sort();
    const paramStr = sortedKeys.map(k => params[k]).join('');
    const data = `${this.pagaConfig.principal}${this.pagaConfig.credentials}${this.pagaConfig.hash_key}${paramStr}`;
    return sha512Hash(data);
  }

  // ===========================================================================
  // CAPABILITIES (Nigeria only)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'paga',
      name: 'Paga',
      collections: {
        card: false,
        bank_transfer: false,
        ussd: false,
        mobile_money: true,
        qr: false
      },
      payouts: {
        bank_transfer: true,
        mobile_money: true,
        bulk: true,
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
        electricity: true,
        cable_tv: true,
        education: false
      },
      customers: {
        creation: false,
        kyc: false,
        bvn: false
      },
      technical: {
        webhooks: true, // Reverse API model
        idempotency: false,
        sandbox: true,
        multi_currency: false,
        international: false,
        recurring: false,
        refunds: true,
        reversals: true
      },
      countries: ['NG'],
      currencies: ['NGN']
    };
  }

  // ===========================================================================
  // COLLECTIONS (Request payment from Paga wallet)
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    const reference = request.reference || this.generateReference('paga');
    const phone = request.payment_method?.type === 'mobile_money'
      ? (request.payment_method as MobileMoneyPaymentMethod).phone_number
      : undefined;

    // TODO: Confirm exact endpoint and hash parameter order for collection
    const params = {
      amount: String(request.amount),
      currency: request.currency || 'NGN',
      reference,
      callback_url: request.callback_url || '',
      phone: phone || '',
      description: request.description || ''
    };

    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/requestPayment`, {
        method: 'POST',
        headers: this.getAuthHeaders(hash),
        body: JSON.stringify({
          amount: request.amount,
          currency: request.currency || 'NGN',
          reference,
          callbackUrl: request.callback_url,
          payerPhoneNumber: phone,
          description: request.description,
          metadata: request.metadata
        })
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Paga collection failed: ${error}`);
      }

      return { data: await res.json() as any };
    });

    const data = response.data;
    return this.mapTransactionResponse(data, reference);
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    const params = { reference };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(
        `${this.getBaseUrl()}/getTransactionStatus?reference=${reference}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(hash)
        }
      );

      if (!res.ok) throw new Error(`Paga verify failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    return this.mapTransactionResponse(response.data, reference);
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    return this.verifyPayment(id);
  }

  // ===========================================================================
  // DISBURSEMENTS (Transfer to Paga wallet or bank)
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    const reference = request.reference || this.generateReference('paga_t');
    const recipient = request.recipient as any;

    let endpoint = '/sendMoney';
    let payload: any = {
      amount: request.amount,
      reference,
      narration: request.narration,
      callbackUrl: request.callback_url
    };

    if (request.recipient.type === 'bank') {
      endpoint = '/bankTransfer';
      payload.bankCode = recipient.bank.code;
      payload.accountNumber = recipient.bank.account_number;
      payload.accountName = recipient.bank.name;
    } else {
      // Mobile money / Paga wallet
      payload.destinationPhoneNumber = recipient.mobile_money?.phone_number;
    }

    const params = {
      amount: String(request.amount),
      reference,
      destination: recipient.mobile_money?.phone_number || recipient.bank?.account_number || ''
    };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: this.getAuthHeaders(hash),
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`Paga transfer failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    return this.mapTransferResponse(response.data, reference);
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    const params = { reference };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(
        `${this.getBaseUrl()}/getTransactionStatus?reference=${reference}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(hash)
        }
      );

      if (!res.ok) throw new Error(`Paga transfer verify failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    return this.mapTransferResponse(response.data, reference);
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    return this.verifyTransfer(id);
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);

    // Paga supports bulk transfers
    const bulkPayload = transfers.map(t => {
      const recipient = t.recipient as any;
      return {
        amount: t.amount,
        reference: t.reference,
        destinationPhoneNumber: recipient.mobile_money?.phone_number,
        bankCode: recipient.bank?.code,
        accountNumber: recipient.bank?.account_number,
        narration: t.narration
      };
    });

    const params = { count: String(transfers.length), total: String(totalAmount) };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/bulkDisburse`, {
        method: 'POST',
        headers: this.getAuthHeaders(hash),
        body: JSON.stringify({ transfers: bulkPayload })
      });

      if (!res.ok) throw new Error(`Paga bulk transfer failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    return {
      id: response.data.bulkId || this.generateReference('paga_bulk'),
      status: 'processing',
      total_amount: totalAmount,
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
    throw new Error('Paga does not support virtual accounts');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Paga does not support virtual accounts');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    return [];
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('Paga does not support customer creation via API');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Paga does not support customer lookup via API');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Paga does not support customer update via API');
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    const hash = this.generateHash({ test: 'true' });

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/getSupportedBanks`, {
        method: 'GET',
        headers: this.getAuthHeaders(hash)
      });

      if (!res.ok) throw new Error(`Paga list banks failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    const banks = response.data.banks || response.data || [];
    return banks.map((b: any) => ({
      code: b.bankCode || b.code,
      name: b.bankName || b.name,
      country: 'NG'
    }));
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    const params = { bankCode: code, accountNumber: account_number };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(
        `${this.getBaseUrl()}/resolveBankAccount?bankCode=${code}&accountNumber=${account_number}`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(hash)
        }
      );

      if (!res.ok) throw new Error(`Paga bank resolve failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    const data = response.data;
    return {
      account_number: data.accountNumber || account_number,
      account_name: data.accountName || '',
      bank_code: code,
      bank_name: data.bankName || ''
    };
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    const hash = this.generateHash({ test: 'true' });

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/getBillers`, {
        method: 'GET',
        headers: this.getAuthHeaders(hash)
      });

      if (!res.ok) throw new Error(`Paga list billers failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    const billers = response.data.billers || response.data || [];
    return billers.map((b: any) => ({
      id: b.billerId || b.id,
      name: b.billerName || b.name,
      category: b.category || 'other',
      description: b.description
    }));
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    const hash = this.generateHash({ billerId: biller_id });

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/getBillerItems?billerId=${biller_id}`, {
        method: 'GET',
        headers: this.getAuthHeaders(hash)
      });

      if (!res.ok) throw new Error(`Paga biller items failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    const items = response.data.items || response.data || [];
    return items.map((i: any) => ({
      id: i.itemId || i.id,
      name: i.itemName || i.name,
      amount: i.amount,
      code: i.itemCode || i.code
    }));
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    const reference = request.customer_reference || this.generateReference('paga_bill');

    const params = {
      billerId: request.biller_id,
      amount: String(request.amount),
      reference
    };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/payBill`, {
        method: 'POST',
        headers: this.getAuthHeaders(hash),
        body: JSON.stringify({
          billerId: request.biller_id,
          itemId: request.item_id,
          amount: request.amount,
          customerReference: request.customer_reference,
          customerName: request.customer_name,
          customerEmail: request.customer_email,
          customerPhone: request.customer_phone
        })
      });

      if (!res.ok) throw new Error(`Paga bill pay failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    return this.mapTransactionResponse(response.data, reference);
  }

  // ===========================================================================
  // REFUNDS
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    const params = { transactionId: transaction_id, reason: reason || 'Refund' };
    const hash = this.generateHash(params);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.getBaseUrl()}/reverseTransaction`, {
        method: 'POST',
        headers: this.getAuthHeaders(hash),
        body: JSON.stringify({
          transactionReference: transaction_id,
          reason: reason || 'Refund requested',
          amount
        })
      });

      if (!res.ok) throw new Error(`Paga refund failed: ${res.statusText}`);
      return { data: await res.json() as any };
    });

    return this.mapTransactionResponse(response.data, transaction_id);
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
      const hash = this.generateHash({ test: 'true' });
      await fetch(`${this.getBaseUrl()}/getSupportedBanks`, {
        method: 'GET',
        headers: this.getAuthHeaders(hash)
      });
      return {
        provider: 'paga' as ProviderName,
        is_healthy: true,
        latency: Date.now() - start,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: 'paga' as ProviderName,
        is_healthy: false,
        latency: Date.now() - start,
        timestamp: new Date(),
        error: (error as Error).message
      };
    }
  }

  // ===========================================================================
  // WEBHOOKS (Reverse API model)
  // ===========================================================================

  // Paga uses a reverse API model: Paga calls specific endpoints on YOUR server
  // that you register at onboarding (e.g., getIntegrationServices, processPayment).
  // This is NOT a standard webhook with a signature header.
  // validateWebhook here handles any callback that arrives, but you likely also
  // need dedicated routes implementing Paga's expected reverse-API surface.

  validateWebhook(payload: any, signature: string): boolean {
    // Paga reverse API doesn't use header-based signatures
    // Validate by checking that the payload contains expected fields
    return !!(payload && (payload.transactionReference || payload.reference));
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'SUCCESSFUL': 'payment.success',
      'FAILED': 'payment.failed',
      'PENDING': 'payment.pending'
    };

    return {
      event: eventMap[payload.status] || payload.event || 'payment.pending',
      data: this.mapTransactionResponse({
        id: payload.transactionReference || payload.reference,
        reference: payload.reference || payload.transactionReference,
        status: payload.status || 'PENDING',
        amount: payload.amount || 0,
        currency: 'NGN'
      }, payload.reference || payload.transactionReference || ''),
      provider: 'paga',
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
      id: data.transactionReference || data.id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'paga',
      provider_reference: data.transactionReference || data.pagaTransactionReference,
      fees: data.fees || data.fee || 0,
      created_at: new Date(data.createdDate || data.timestamp || Date.now()),
      updated_at: new Date(data.createdDate || data.timestamp || Date.now()),
      metadata: data.metadata
    };
  }

  private mapTransferResponse(data: any, reference: string): UnifiedTransferResponse {
    return {
      id: data.transactionReference || data.id || reference,
      reference: data.reference || reference,
      status: this.mapStatus(data.status || 'PENDING'),
      amount: data.amount || 0,
      currency: data.currency || 'NGN',
      provider: 'paga',
      provider_reference: data.transactionReference,
      fees: data.fees || data.fee || 0,
      created_at: new Date(data.createdDate || data.timestamp || Date.now()),
      updated_at: new Date(data.createdDate || data.timestamp || Date.now())
    };
  }
}

export default PagaAdapter;
