// TurboPay Funding Workflow Service
// Manages the complete wallet funding lifecycle:
// 1. Detect user's country and wallet currency
// 2. Query Provider Registry for supporting providers
// 3. Retrieve live health metrics and routing scores
// 4. Rank providers by cost, latency, reliability, availability
// 5. Present recommended funding methods
// 6. Initiate funding request
// 7. Handle async webhook confirmation
// 8. Verify callback and record ledger entries
// 9. Update wallet balances
// 10. Notify user

import {
  ProviderName,
  PaymentOperation,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  Wallet,
  LedgerEntry,
  ProviderUnavailableError
} from '../types';
import { ProviderSelectionEngine, ProviderScore } from './provider-selection-engine';
import { ProviderRegistry, ProviderWrapper } from './provider-wrapper';
import { LedgerService } from './ledger';
import { MobileMoneyOrchestrator } from './mobile-money-orchestrator';

// =============================================================================
// TYPES
// =============================================================================

export type FundingMethod =
  | 'card'
  | 'bank_transfer'
  | 'ussd'
  | 'mobile_money'
  | 'qr_code'
  | 'virtual_account';

export type FundingStatus =
  | 'initiated'
  | 'pending'
  | 'processing'
  | 'awaiting_webhook'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'reversed';

export interface FundingMethodOption {
  method: FundingMethod;
  name: string;
  description: string;
  provider: ProviderName;
  score: ProviderScore;
  estimated_fee: number;
  estimated_time: string;
  supported_networks?: string[];
  icon?: string;
}

export interface FundingRequest {
  user_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  country_code: string;
  method: FundingMethod;
  preferred_provider?: ProviderName;
  phone_number?: string;
  network?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
}

export interface FundingSession {
  id: string;
  user_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  country_code: string;
  method: FundingMethod;
  provider: ProviderName;
  status: FundingStatus;
  provider_reference?: string;
  reference: string;
  fee: number;
  webhook_received: boolean;
  ledger_entry_id?: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  metadata?: Record<string, any>;
}

export interface FundingResult {
  success: boolean;
  session?: FundingSession;
  authorization?: {
    redirect_url?: string;
    ussd_code?: string;
    otp_required?: boolean;
    [key: string]: any;
  };
  message: string;
  requires_action?: boolean;
}

export interface FundingMethodsResponse {
  country_code: string;
  currency: string;
  methods: FundingMethodOption[];
  recommended: FundingMethodOption;
}

// =============================================================================
// FUNDING WORKFLOW SERVICE
// =============================================================================

export class FundingWorkflowService {
  private selectionEngine: ProviderSelectionEngine;
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private mobileMoney: MobileMoneyOrchestrator;
  private sessions: Map<string, FundingSession> = new Map();

  // Default fee structures for funding methods
  private readonly FUNDING_FEES: Record<FundingMethod, { percent: number; flat: number; min: number; max: number }> = {
    card: { percent: 1.5, flat: 0, min: 50, max: 2000 },
    bank_transfer: { percent: 0, flat: 50, min: 50, max: 200 },
    ussd: { percent: 1.0, flat: 0, min: 50, max: 1000 },
    mobile_money: { percent: 2.0, flat: 0, min: 100, max: 3000 },
    qr_code: { percent: 1.0, flat: 0, min: 50, max: 1000 },
    virtual_account: { percent: 0, flat: 100, min: 100, max: 500 }
  };

  // Country-specific funding methods
  private readonly COUNTRY_METHODS: Record<string, FundingMethod[]> = {
    NG: ['card', 'bank_transfer', 'ussd', 'mobile_money', 'virtual_account'],
    GH: ['card', 'mobile_money', 'bank_transfer'],
    KE: ['card', 'mobile_money', 'bank_transfer'],
    TZ: ['card', 'mobile_money'],
    UG: ['card', 'mobile_money'],
    ZA: ['card', 'bank_transfer', 'mobile_money'],
    CI: ['card', 'mobile_money'],
    SN: ['card', 'mobile_money'],
    CM: ['card', 'mobile_money'],
    RW: ['card', 'mobile_money'],
  };

  // Mobile money networks per country
  private readonly MOBILE_NETWORKS: Record<string, string[]> = {
    NG: ['MTN', 'Airtel', 'Glo', '9mobile'],
    GH: ['MTN', 'Vodafone', 'AirtelTigo'],
    KE: ['Safaricom', 'Airtel'],
    TZ: ['Vodacom', 'Airtel', 'Tigo'],
    UG: ['MTN', 'Airtel'],
    ZA: ['Vodacom', 'MTN'],
    CI: ['MTN', 'Orange', 'Moov'],
    SN: ['Orange', 'Free'],
    CM: ['MTN', 'Orange'],
    RW: ['MTN', 'Airtel'],
  };

  constructor(
    selectionEngine: ProviderSelectionEngine,
    registry: ProviderRegistry,
    ledger: LedgerService,
    mobileMoney: MobileMoneyOrchestrator
  ) {
    this.selectionEngine = selectionEngine;
    this.registry = registry;
    this.ledger = ledger;
    this.mobileMoney = mobileMoney;
  }

  // ===========================================================================
  // GET AVAILABLE FUNDING METHODS
  // ===========================================================================

  getAvailableMethods(countryCode: string, currency: string): FundingMethodsResponse {
    const methods = this.COUNTRY_METHODS[countryCode] || ['card', 'bank_transfer'];
    const methodOptions: FundingMethodOption[] = [];

    for (const method of methods) {
      // Get best provider for this method
      const operation = this.getMethodOperation(method);
      const scoredProviders = this.selectionEngine.getFailoverChain(operation, countryCode, currency, 1000);

      if (scoredProviders.length > 0) {
        const best = scoredProviders[0];
        const fee = this.calculateFee(method, 1000);

        methodOptions.push({
          method,
          name: this.getMethodName(method),
          description: this.getMethodDescription(method),
          provider: best.provider,
          score: best,
          estimated_fee: fee,
          estimated_time: this.getMethodTime(method),
          supported_networks: method === 'mobile_money' ? this.MOBILE_NETWORKS[countryCode] : undefined,
          icon: this.getMethodIcon(method)
        });
      }
    }

    // Sort by score
    methodOptions.sort((a, b) => b.score.total_score - a.score.total_score);

    return {
      country_code: countryCode,
      currency,
      methods: methodOptions,
      recommended: methodOptions[0]
    };
  }

  // ===========================================================================
  // INITIATE FUNDING
  // ===========================================================================

  async initiateFunding(request: FundingRequest): Promise<FundingResult> {
    // Validate request
    const wallet = this.ledger.getWallet(request.wallet_id);
    if (!wallet) {
      return { success: false, message: 'Wallet not found' };
    }

    if (wallet.user_id !== request.user_id) {
      return { success: false, message: 'Wallet does not belong to user' };
    }

    if (wallet.status !== 'active') {
      return { success: false, message: 'Wallet is not active' };
    }

    // Create funding session
    const session = this.createSession(request);

    try {
      switch (request.method) {
        case 'card':
          return await this.initiateCardFunding(session);
        case 'bank_transfer':
          return await this.initiateBankTransferFunding(session);
        case 'ussd':
          return await this.initiateUSSDFunding(session);
        case 'mobile_money':
          return await this.initiateMobileMoneyFunding(session);
        case 'qr_code':
          return await this.initiateQRFunding(session);
        case 'virtual_account':
          return await this.initiateVirtualAccountFunding(session);
        default:
          return { success: false, message: 'Unsupported funding method' };
      }
    } catch (error) {
      session.status = 'failed';
      session.updated_at = new Date();
      return {
        success: false,
        session,
        message: (error as Error).message
      };
    }
  }

  // ===========================================================================
  // CARD FUNDING
  // ===========================================================================

  private async initiateCardFunding(session: FundingSession): Promise<FundingResult> {
    const wrapper = this.getProvider(session.provider);
    if (!wrapper) {
      return { success: false, message: 'Provider not available' };
    }

    const request: UnifiedPaymentRequest = {
      amount: session.amount,
      currency: session.currency,
      reference: session.reference,
      description: `Wallet funding via card`,
      metadata: {
        session_id: session.id,
        user_id: session.user_id,
        wallet_id: session.wallet_id,
        funding_method: 'card'
      },
      callback_url: session.metadata?.callback_url
    };

    const result = await wrapper.initializePayment(request);

    session.provider_reference = result.id;
    session.status = result.authorization?.redirect_url ? 'pending' : 'processing';
    session.updated_at = new Date();

    return {
      success: true,
      session,
      authorization: result.authorization,
      message: 'Payment initialization successful',
      requires_action: !!result.authorization?.redirect_url
    };
  }

  // ===========================================================================
  // BANK TRANSFER FUNDING
  // ===========================================================================

  private async initiateBankTransferFunding(session: FundingSession): Promise<FundingResult> {
    const wrapper = this.getProvider(session.provider);
    if (!wrapper) {
      return { success: false, message: 'Provider not available' };
    }

    const request: UnifiedPaymentRequest = {
      amount: session.amount,
      currency: session.currency,
      reference: session.reference,
      description: `Wallet funding via bank transfer`,
      metadata: {
        session_id: session.id,
        user_id: session.user_id,
        wallet_id: session.wallet_id,
        funding_method: 'bank_transfer'
      }
    };

    const result = await wrapper.initializePayment(request);

    session.provider_reference = result.id;
    session.status = 'awaiting_webhook';
    session.updated_at = new Date();

    return {
      success: true,
      session,
      authorization: result.authorization,
      message: 'Bank transfer initiated. Please complete the transfer.',
      requires_action: false
    };
  }

  // ===========================================================================
  // USSD FUNDING
  // ===========================================================================

  private async initiateUSSDFunding(session: FundingSession): Promise<FundingResult> {
    const wrapper = this.getProvider(session.provider);
    if (!wrapper) {
      return { success: false, message: 'Provider not available' };
    }

    const request: UnifiedPaymentRequest = {
      amount: session.amount,
      currency: session.currency,
      reference: session.reference,
      description: `Wallet funding via USSD`,
      payment_method: { type: 'ussd' },
      metadata: {
        session_id: session.id,
        user_id: session.user_id,
        wallet_id: session.wallet_id,
        funding_method: 'ussd'
      }
    };

    const result = await wrapper.initializePayment(request);

    session.provider_reference = result.id;
    session.status = 'awaiting_webhook';
    session.updated_at = new Date();

    return {
      success: true,
      session,
      authorization: result.authorization,
      message: 'USSD session initiated. Please complete on your phone.',
      requires_action: true
    };
  }

  // ===========================================================================
  // MOBILE MONEY FUNDING
  // ===========================================================================

  private async initiateMobileMoneyFunding(session: FundingSession): Promise<FundingResult> {
    if (!session.metadata?.phone_number || !session.metadata?.network) {
      return { success: false, message: 'Phone number and network are required for mobile money funding' };
    }

    const result = await this.mobileMoney.collect({
      amount: session.amount,
      currency: session.currency,
      phone_number: session.metadata.phone_number,
      country_code: session.country_code,
      network: session.metadata.network,
      reference: session.reference,
      description: 'Wallet funding via mobile money',
      callback_url: session.metadata?.callback_url,
      preferred_provider: session.provider
    });

    if (!result.success) {
      session.status = 'failed';
      session.updated_at = new Date();
      return { success: false, session, message: result.error || 'Mobile money collection failed' };
    }

    session.provider_reference = result.data?.id;
    session.status = result.requires_webhook ? 'awaiting_webhook' : 'processing';
    session.updated_at = new Date();

    return {
      success: true,
      session,
      message: 'Mobile money collection initiated',
      requires_action: false
    };
  }

  // ===========================================================================
  // QR CODE FUNDING
  // ===========================================================================

  private async initiateQRFunding(session: FundingSession): Promise<FundingResult> {
    const wrapper = this.getProvider(session.provider);
    if (!wrapper) {
      return { success: false, message: 'Provider not available' };
    }

    const request: UnifiedPaymentRequest = {
      amount: session.amount,
      currency: session.currency,
      reference: session.reference,
      description: `Wallet funding via QR code`,
      payment_method: { type: 'qr' },
      metadata: {
        session_id: session.id,
        user_id: session.user_id,
        wallet_id: session.wallet_id,
        funding_method: 'qr_code'
      }
    };

    const result = await wrapper.initializePayment(request);

    session.provider_reference = result.id;
    session.status = 'awaiting_webhook';
    session.updated_at = new Date();

    return {
      success: true,
      session,
      authorization: result.authorization,
      message: 'QR code generated. Scan to complete payment.',
      requires_action: true
    };
  }

  // ===========================================================================
  // VIRTUAL ACCOUNT FUNDING
  // ===========================================================================

  private async initiateVirtualAccountFunding(session: FundingSession): Promise<FundingResult> {
    const wrapper = this.getProvider(session.provider);
    if (!wrapper) {
      return { success: false, message: 'Provider not available' };
    }

    const request = {
      reference: session.reference,
      amount: session.amount,
      currency: session.currency,
      account_type: 'dynamic' as const,
      narration: 'Wallet funding via virtual account',
      metadata: {
        session_id: session.id,
        user_id: session.user_id,
        wallet_id: session.wallet_id,
        funding_method: 'virtual_account'
      }
    };

    const result = await wrapper.createVirtualAccount(request);

    session.provider_reference = result.id;
    session.status = 'awaiting_webhook';
    session.updated_at = new Date();

    return {
      success: true,
      session,
      authorization: {
        account_number: result.account_number,
        bank_code: result.bank_code,
        bank_name: result.bank_name,
        expires_at: result.expires_at
      },
      message: 'Virtual account created. Transfer to fund your wallet.',
      requires_action: false
    };
  }

  // ===========================================================================
  // HANDLE WEBHOOK CALLBACK
  // ===========================================================================

  async handleWebhookCallback(
    provider: ProviderName,
    payload: any,
    headers: Record<string, string>
  ): Promise<{ success: boolean; session_id?: string; message: string }> {
    // Validate webhook signature
    const wrapper = this.registry.get(provider);
    if (!wrapper) {
      return { success: false, message: 'Unknown provider' };
    }

    const isValid = wrapper.validateWebhook(payload, headers['x-webhook-signature'] || '');
    if (!isValid) {
      return { success: false, message: 'Invalid webhook signature' };
    }

    // Parse webhook event
    const event = wrapper.parseWebhookEvent(payload);
    const reference = event.data.reference;

    // Find session by reference
    const session = this.findSessionByReference(reference);
    if (!session) {
      return { success: false, message: 'Session not found' };
    }

    // Update session based on event
    session.webhook_received = true;
    session.updated_at = new Date();

    if (event.event === 'charge.success' || event.event === 'transfer.success') {
      // Payment successful - complete the funding
      return await this.completeFunding(session, event.data);
    } else if (event.event === 'charge.failed' || event.event === 'transfer.failed') {
      // Payment failed
      session.status = 'failed';
      session.updated_at = new Date();
      return { success: false, session_id: session.id, message: 'Payment failed' };
    }

    return { success: true, session_id: session.id, message: 'Webhook processed' };
  }

  // ===========================================================================
  // COMPLETE FUNDING
  // ===========================================================================

  private async completeFunding(
    session: FundingSession,
    transactionData: UnifiedTransactionResponse
  ): Promise<{ success: boolean; session_id?: string; message: string }> {
    try {
      // Create ledger credit entry
      const ledgerEntry = await this.ledger.credit(
        session.wallet_id,
        session.amount - session.fee, // Net amount after fees
        session.currency,
        session.reference,
        session.provider,
        transactionData.provider_reference,
        `Wallet funding via ${session.method}`,
        {
          session_id: session.id,
          gross_amount: session.amount,
          fee: session.fee,
          net_amount: session.amount - session.fee,
          provider: session.provider,
          method: session.method
        }
      );

      // Record fee separately
      if (session.fee > 0) {
        this.ledger.recordFee(
          session.wallet_id,
          session.fee,
          session.currency,
          `${session.reference}_fee`,
          session.provider,
          `Fee for ${session.method} funding`
        );
      }

      // Update session
      session.status = 'completed';
      session.ledger_entry_id = ledgerEntry.id;
      session.updated_at = new Date();

      return {
        success: true,
        session_id: session.id,
        message: `Wallet funded successfully with ${session.currency} ${session.amount - session.fee}`
      };
    } catch (error) {
      console.error(`[FundingWorkflow] Failed to complete funding:`, error);
      session.status = 'failed';
      session.updated_at = new Date();
      return { success: false, session_id: session.id, message: 'Failed to complete funding' };
    }
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  getSession(sessionId: string): FundingSession | undefined {
    return this.sessions.get(sessionId);
  }

  getUserSessions(userId: string, limit: number = 50): FundingSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.user_id === userId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
  }

  getPendingSessions(): FundingSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'pending' || s.status === 'processing' || s.status === 'awaiting_webhook');
  }

  expireOldSessions(): number {
    let expired = 0;
    const now = new Date();

    for (const session of this.sessions.values()) {
      if (session.expires_at < now && session.status !== 'completed' && session.status !== 'failed') {
        session.status = 'expired';
        session.updated_at = now;
        expired++;
      }
    }

    return expired;
  }

  // ===========================================================================
  // FEE CALCULATION
  // ===========================================================================

  calculateFee(method: FundingMethod, amount: number): number {
    const feeStructure = this.FUNDING_FEES[method];
    const fee = (amount * feeStructure.percent / 100) + feeStructure.flat;
    return Math.max(feeStructure.min, Math.min(fee, feeStructure.max));
  }

  getFeeBreakdown(method: FundingMethod, amount: number): {
    amount: number;
    fee: number;
    fee_percent: number;
    fee_flat: number;
    net_amount: number;
  } {
    const feeStructure = this.FUNDING_FEES[method];
    const fee = this.calculateFee(method, amount);

    return {
      amount,
      fee,
      fee_percent: feeStructure.percent,
      fee_flat: feeStructure.flat,
      net_amount: amount - fee
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private createSession(request: FundingRequest): FundingSession {
    const fee = this.calculateFee(request.method, request.amount);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

    const session: FundingSession = {
      id: this.generateId(),
      user_id: request.user_id,
      wallet_id: request.wallet_id,
      amount: request.amount,
      currency: request.currency,
      country_code: request.country_code,
      method: request.method,
      provider: request.preferred_provider || this.getBestProvider(request.method, request.country_code, request.currency),
      status: 'initiated',
      reference: `funding_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      fee,
      webhook_received: false,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
      metadata: request.metadata
    };

    this.sessions.set(session.id, session);
    return session;
  }

  private findSessionByReference(reference: string): FundingSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.reference === reference || session.provider_reference === reference) {
        return session;
      }
    }
    return undefined;
  }

  private getProvider(name: ProviderName): ProviderWrapper | undefined {
    return this.registry.get(name);
  }

  private getBestProvider(method: FundingMethod, countryCode: string, currency: string): ProviderName {
    const operation = this.getMethodOperation(method);
    const scores = this.selectionEngine.getFailoverChain(operation, countryCode, currency, 1000);
    return scores.length > 0 ? scores[0].provider : 'paystack';
  }

  private getMethodOperation(method: FundingMethod): PaymentOperation {
    const operationMap: Record<FundingMethod, PaymentOperation> = {
      card: 'card_collection',
      bank_transfer: 'bank_transfer_collection',
      ussd: 'ussd_collection',
      mobile_money: 'mobile_money_collection',
      qr_code: 'qr_collection',
      virtual_account: 'virtual_account'
    };
    return operationMap[method];
  }

  private getMethodName(method: FundingMethod): string {
    const nameMap: Record<FundingMethod, string> = {
      card: 'Debit/Credit Card',
      bank_transfer: 'Bank Transfer',
      ussd: 'USSD',
      mobile_money: 'Mobile Money',
      qr_code: 'QR Code',
      virtual_account: 'Virtual Account'
    };
    return nameMap[method];
  }

  private getMethodDescription(method: FundingMethod): string {
    const descMap: Record<FundingMethod, string> = {
      card: 'Fund your wallet instantly using your debit or credit card',
      bank_transfer: 'Transfer from your bank account to fund your wallet',
      ussd: 'Dial a USSD code on your phone to complete payment',
      mobile_money: 'Use your mobile money wallet to fund your TurboPay wallet',
      qr_code: 'Scan a QR code to complete payment',
      virtual_account: 'Get a virtual account number to transfer funds'
    };
    return descMap[method];
  }

  private getMethodTime(method: FundingMethod): string {
    const timeMap: Record<FundingMethod, string> = {
      card: 'Instant',
      bank_transfer: '1-30 minutes',
      ussd: 'Instant',
      mobile_money: 'Instant',
      qr_code: 'Instant',
      virtual_account: '1-30 minutes'
    };
    return timeMap[method];
  }

  private getMethodIcon(method: FundingMethod): string {
    const iconMap: Record<FundingMethod, string> = {
      card: 'credit-card',
      bank_transfer: 'building-library',
      ussd: 'device-phone-mobile',
      mobile_money: 'signal',
      qr_code: 'qr-code',
      virtual_account: 'banknotes'
    };
    return iconMap[method];
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `funding_${timestamp}_${random}`;
  }
}

export default FundingWorkflowService;
