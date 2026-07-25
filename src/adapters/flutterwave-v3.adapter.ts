// Flutterwave V3 Adapter
// Implements v3-specific features: split payments, payment plans, chargebacks, bill payments
// Flutterwave v3 is NOT deprecated — use this for features not available in v4

import { BaseAdapter, BaseAdapterConfig } from './base.adapter';
import { validateFlutterwaveSignature } from '../utils/crypto';
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
  ProviderFeatureUnavailableError
} from '../types';

// =============================================================================
// CONFIG
// =============================================================================

export interface FlutterwaveV3AdapterConfig extends BaseAdapterConfig {
  secret_key: string;
  public_key?: string;
  webhook_secret?: string;
}

// =============================================================================
// SPLIT PAYMENT TYPES
// =============================================================================

export interface SubAccount {
  id?: string;
  account_bank: string;
  account_number: string;
  country: string;
  business_name: string;
  business_mobile: string;
  split_type: 'percentage' | 'flat';
  split_value: number;
  business_email?: string;
  meta?: Record<string, any>;
}

export interface SubAccountResponse {
  id: string;
  subaccount_id: string;
  business_name: string;
  account_number: string;
  bank_code: string;
  split_type: string;
  split_value: number;
  status: string;
}

// =============================================================================
// PAYMENT PLAN TYPES
// =============================================================================

export interface PaymentPlan {
  id?: string;
  name: string;
  interval: string; // hourly, daily, weekly, monthly, yearly, quarterly, bi-annually, "every x y"
  amount?: number;
  currency?: string;
  duration?: number;
}

export interface PaymentPlanResponse {
  id: string;
  name: string;
  interval: string;
  amount: number;
  currency: string;
  duration: number;
  status: string;
  created_at: string;
}

// =============================================================================
// CHARGEBACK TYPES
// =============================================================================

export interface Chargeback {
  id: string;
  transaction_id: string;
  amount: number;
  status: string;
  stage: string;
  created_at: string;
}

// =============================================================================
// FLUTTERWAVE V3 ADAPTER
// =============================================================================

export class FlutterwaveV3Adapter extends BaseAdapter {
  readonly name: ProviderName = 'flutterwave';
  readonly displayName = 'Flutterwave V3';
  readonly baseUrl = 'https://api.flutterwave.com/v3';
  readonly sandboxBaseUrl = 'https://developersandbox-api.flutterwave.com/v3';

  private flwConfig: FlutterwaveV3AdapterConfig;

  constructor(config: FlutterwaveV3AdapterConfig) {
    super(config);
    this.flwConfig = config;
    this.setToken(config.secret_key);
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    this.setToken(this.flwConfig.secret_key);
  }

  async refreshToken(): Promise<void> {
    // V3 uses static secret key, no refresh needed
  }

  // ===========================================================================
  // CAPABILITIES (V3-specific)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'flutterwave',
      name: 'Flutterwave V3',
      collections: {
        card: true,
        bank_transfer: true,
        ussd: true,
        mobile_money: true,
        qr: false
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
        airtime: true, // V3 has bill payments
        data: true,
        electricity: true,
        cable_tv: true,
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
        reversals: false
      },
      countries: ['NG', 'GH', 'KE', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'MW', 'EG', 'GB', 'US'],
      currencies: ['NGN', 'GHS', 'KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'MWK', 'EGP', 'USD', 'EUR', 'GBP']
    };
  }

  // ===========================================================================
  // SPLIT PAYMENTS (V3-only)
  // ===========================================================================

  async createSubAccount(subAccount: SubAccount): Promise<SubAccountResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/subaccounts', {
        account_bank: subAccount.account_bank,
        account_number: subAccount.account_number,
        country: subAccount.country,
        business_name: subAccount.business_name,
        business_mobile: subAccount.business_mobile,
        split_type: subAccount.split_type,
        split_value: subAccount.split_value,
        business_email: subAccount.business_email,
        meta: subAccount.meta
      })
    );

    return response.data.data;
  }

  async getSubAccounts(): Promise<SubAccountResponse[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/subaccounts');
    return response.data.data || [];
  }

  async getSubAccount(id: string): Promise<SubAccountResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/subaccounts/${id}`);
    return response.data.data;
  }

  async updateSubAccount(id: string, updates: Partial<SubAccount>): Promise<SubAccountResponse> {
    await this.refreshToken();
    const response = await this.httpClient.put(`/subaccounts/${id}`, updates);
    return response.data.data;
  }

  async deleteSubAccount(id: string): Promise<void> {
    await this.refreshToken();
    await this.httpClient.delete(`/subaccounts/${id}`);
  }

  // ===========================================================================
  // PAYMENT PLANS / SUBSCRIPTIONS (V3-only)
  // ===========================================================================

  async createPaymentPlan(plan: PaymentPlan): Promise<PaymentPlanResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/payment-plans', {
        name: plan.name,
        interval: plan.interval,
        amount: plan.amount,
        currency: plan.currency || 'NGN',
        duration: plan.duration
      })
    );

    return response.data.data;
  }

  async getPaymentPlans(): Promise<PaymentPlanResponse[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/payment-plans');
    return response.data.data || [];
  }

  async getPaymentPlan(id: string): Promise<PaymentPlanResponse> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/payment-plans/${id}`);
    return response.data.data;
  }

  async cancelPaymentPlan(id: string): Promise<void> {
    await this.refreshToken();
    await this.httpClient.put(`/payment-plans/${id}`, { status: 'inactive' });
  }

  // ===========================================================================
  // CHARGEBACKS (V3-only)
  // ===========================================================================

  async getChargebacks(): Promise<Chargeback[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/chargebacks');
    return response.data.data || [];
  }

  async getChargeback(id: string): Promise<Chargeback> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/chargebacks/${id}`);
    return response.data.data;
  }

  async respondToChargeback(id: string, action: 'accept' | 'decline', comment: string, prooflink?: string): Promise<void> {
    await this.refreshToken();
    await this.httpClient.put(`/chargebacks/${id}`, {
      action,
      comment,
      prooflink
    });
  }

  async uploadChargebackEvidence(id: string, imageUrl: string): Promise<void> {
    await this.refreshToken();
    await this.httpClient.post('/upload_image', {
      image: imageUrl,
      chargeback_id: id
    });
  }

  // ===========================================================================
  // BILL PAYMENTS (V3-only)
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    await this.refreshToken();
    const response = await this.httpClient.get('/bill-categories');
    return (response.data.data || []).map((cat: any) => ({
      id: cat.id?.toString(),
      name: cat.name,
      category: 'general',
      description: cat.name
    }));
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    await this.refreshToken();
    const response = await this.httpClient.get(`/bill-items?bill_category_id=${biller_id}`);
    return (response.data.data || []).map((item: any) => ({
      id: item.id?.toString(),
      name: item.name,
      amount: item.amount,
      code: item.code
    }));
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    await this.refreshToken();

    const response = await this.withRetry(() =>
      this.httpClient.post('/bills', {
        biller_code: request.biller_id,
        item_code: request.item_id,
        amount: request.amount,
        customer_reference: request.customer_reference,
        customer_name: request.customer_name,
        customer_email: request.customer_email
      })
    );

    return {
      id: response.data.data?.transaction_id || request.customer_reference,
      reference: request.customer_reference,
      status: response.data.data?.status === 'successful' ? 'success' : 'pending',
      amount: request.amount,
      currency: 'NGN',
      provider: 'flutterwave',
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  // ===========================================================================
  // STANDARD COLLECTIONS (Delegated to v4 adapter)
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'initializePayment_v3');
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'verifyPayment_v3');
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'getPaymentStatus_v3');
  }

  // ===========================================================================
  // TRANSFERS (Delegated to v4 adapter)
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'createTransfer_v3');
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'verifyTransfer_v3');
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'getTransferStatus_v3');
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'createBulkTransfers_v3');
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS (Delegated to v4 adapter)
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'createVirtualAccount_v3');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'getVirtualAccount_v3');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'listVirtualAccounts_v3');
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'createCustomer_v3');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'getCustomer_v3');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'updateCustomer_v3');
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'listBanks_v3');
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    throw new ProviderFeatureUnavailableError('flutterwave', 'resolveBank_v3');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    if (!this.flwConfig.webhook_secret) {
      console.error('[FlutterwaveV3] Webhook secret not configured — rejecting webhook');
      return false;
    }
    return validateFlutterwaveSignature(payload, signature, this.flwConfig.webhook_secret);
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    const eventMap: Record<string, string> = {
      'charge.completed': 'payment.success',
      'charge.failed': 'payment.failed',
      'transfer.completed': 'transfer.success',
      'transfer.failed': 'transfer.failed',
      'subscription.cancelled': 'subscription.cancelled',
      'chargeback.initiated': 'chargeback.initiated',
      'chargeback.accepted': 'chargeback.accepted',
      'chargeback.declined': 'chargeback.declined'
    };

    return {
      event: eventMap[payload.event] || payload.event,
      data: {
        id: payload.data?.id,
        reference: payload.data?.tx_ref || payload.data?.reference,
        status: payload.data?.status === 'successful' ? 'success' : 'failed',
        amount: payload.data?.amount,
        currency: payload.data?.currency,
        provider: 'flutterwave',
        created_at: new Date(payload.created_at || Date.now()),
        updated_at: new Date()
      },
      provider: 'flutterwave',
      signature: '',
      timestamp: new Date(payload.created_at || Date.now()),
      raw_payload: payload
    };
  }
}

export default FlutterwaveV3Adapter;
