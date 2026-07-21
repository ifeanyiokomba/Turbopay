// Stripe Provider Adapter (PARKED — not active, built for future use)
// Implements unified provider interface for Stripe API
//
// STATUS: PARKED — This adapter is built and ready but not registered by default.
// To activate: Set STRIPE_SECRET_KEY in environment and enable in adapter-factory.
//
// Stripe Docs: https://stripe.com/docs/api
// This adapter follows the same pattern as other providers but is not wired into
// the provider selection engine until needed.

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
  MobileMoneyPaymentMethod
} from '../types';

// =============================================================================
// CONFIG
// =============================================================================

export interface StripeAdapterConfig extends BaseAdapterConfig {
  secret_key: string;
  public_key?: string;
  webhook_secret?: string;
}

// =============================================================================
// STRIPE ADAPTER (PARKED)
// =============================================================================

export class StripeAdapter extends BaseAdapter {
  readonly name: ProviderName = 'paystack'; // Reuses paystack slot temporarily — change when active
  readonly displayName = 'Stripe';
  readonly baseUrl = 'https://api.stripe.com/v1';
  readonly sandboxBaseUrl = 'https://api.stripe.com/v1'; // Stripe uses same URL with test keys

  private stripeConfig: StripeAdapterConfig;

  constructor(config: StripeAdapterConfig) {
    super(config);
    this.stripeConfig = config;
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  async authenticate(): Promise<void> {
    // Stripe uses API key directly in headers, no OAuth
    this.setToken(this.stripeConfig.secret_key);
  }

  async refreshToken(): Promise<void> {
    // Stripe tokens don't expire — no-op
  }

  // ===========================================================================
  // CAPABILITIES (limited — Stripe is parked)
  // ===========================================================================

  getCapabilities(): ProviderCapabilities {
    return {
      provider: 'paystack' as ProviderName, // Placeholder
      name: 'Stripe (Parked)',
      collections: {
        card: true,
        bank_transfer: false,
        ussd: false,
        mobile_money: false,
        qr: false
      },
      payouts: {
        bank_transfer: false, // Stripe Connect required
        mobile_money: false,
        bulk: false,
        scheduled: false,
        instant: false
      },
      virtual_accounts: {
        dedicated: false,
        dynamic: false,
        static: false
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
        kyc: false,
        bvn: false,
        nin: false
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
      countries: ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NG', 'KE', 'ZA'],
      currencies: ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR']
    };
  }

  // ===========================================================================
  // PAYMENTS
  // ===========================================================================

  async initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    // TODO: Implement when Stripe is activated
    // Stripe: POST /payment_intents
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async verifyPayment(reference: string): Promise<UnifiedTransactionResponse> {
    // TODO: Implement when Stripe is activated
    // Stripe: GET /payment_intents/:id
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async getPaymentStatus(id: string): Promise<UnifiedTransactionResponse> {
    // TODO: Implement when Stripe is activated
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  // ===========================================================================
  // TRANSFERS
  // ===========================================================================

  async createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse> {
    // TODO: Implement when Stripe is activated
    // Stripe: POST /transfers (requires Connect)
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async verifyTransfer(reference: string): Promise<UnifiedTransferResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async getTransferStatus(id: string): Promise<UnifiedTransferResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  // ===========================================================================
  // VIRTUAL ACCOUNTS
  // ===========================================================================

  async createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async getVirtualAccount(id: string): Promise<VirtualAccountResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  // ===========================================================================
  // CUSTOMERS
  // ===========================================================================

  async createCustomer(customer: CustomerInfo): Promise<CustomerResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async getCustomer(id: string): Promise<CustomerResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  // ===========================================================================
  // BANKS
  // ===========================================================================

  async listBanks(country?: string): Promise<Bank[]> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async resolveBank(code: string, account_number: string): Promise<BankAccountResolution> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  // ===========================================================================
  // BILL PAYMENTS
  // ===========================================================================

  async listBillers(): Promise<Biller[]> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async getBillerItems(biller_id: string): Promise<BillerItem[]> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  async payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse> {
    throw new Error('Stripe adapter is parked. Set STRIPE_SECRET_KEY to activate.');
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  validateWebhook(payload: any, signature: string): boolean {
    // TODO: Implement Stripe webhook signature verification
    // Stripe uses HMAC-SHA256 with timestamp
    return true; // Placeholder
  }

  parseWebhookEvent(payload: any): UnifiedWebhookEvent {
    // TODO: Implement when Stripe is activated
    return {
      event: payload.type || 'unknown',
      data: {} as any,
      provider: 'paystack' as ProviderName,
      signature: '',
      timestamp: new Date(),
      raw_payload: payload
    };
  }
}

export default StripeAdapter;
