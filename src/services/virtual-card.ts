// TurboPay Virtual Card Service
// Virtual card issuance using Onafriq (VISA/MC/Verve) and Quickteller (Card 360)
// Provides unified interface for card creation, management, and transactions

import {
  ProviderName,
  ProviderUnavailableError,
  ProviderFeatureUnavailableError
} from '../types';
import { ProviderRegistry, ProviderWrapper } from './provider-wrapper';
import { LedgerService } from './ledger';
import { AnalyticsDashboard } from '../admin/dashboard/analytics-dashboard';
import { AuditLogService } from '../admin/dashboard/audit-log';

// =============================================================================
// TYPES
// =============================================================================

export type CardScheme = 'visa' | 'mastercard' | 'verve';
export type CardType = 'debit' | 'prepaid';
export type CardStatus = 'active' | 'blocked' | 'expired' | 'pending';

export interface VirtualCardRequest {
  provider: ProviderName;
  user_id: string;
  card_type: CardType;
  card_scheme: CardScheme;
  currency: string;
  amount?: number; // For prepaid cards
  name_on_card?: string;
  billing_address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    country: string;
    postal_code: string;
  };
  metadata?: Record<string, any>;
}

export interface VirtualCard {
  id: string;
  provider: ProviderName;
  user_id: string;
  card_number: string; // Masked
  card_last_four: string;
  card_scheme: CardScheme;
  card_type: CardType;
  currency: string;
  balance: number;
  status: CardStatus;
  expiry_date: string;
  cvv?: string; // Only returned on creation
  name_on_card?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CardTransaction {
  id: string;
  card_id: string;
  provider: ProviderName;
  amount: number;
  currency: string;
  merchant_name: string;
  merchant_category: string;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  type: 'purchase' | 'atm_withdrawal' | 'fee' | 'refund';
  created_at: Date;
}

export interface CardManagementRequest {
  card_id: string;
  provider: ProviderName;
}

export interface CardBlockRequest extends CardManagementRequest {
  reason: 'lost' | 'stolen' | 'fraud' | 'user_request';
}

// =============================================================================
// VIRTUAL CARD SERVICE
// =============================================================================

export class VirtualCardService {
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private analytics: AnalyticsDashboard;
  private auditLog: AuditLogService;
  private cards: Map<string, VirtualCard> = new Map();

  // Provider card capabilities (from research)
  private readonly CARD_CAPABILITIES: Record<ProviderName, {
    supported: boolean;
    schemes: CardScheme[];
    types: CardType[];
    features: string[];
  }> = {
    paystack: { supported: false, schemes: [], types: [], features: [] },
    flutterwave: { supported: false, schemes: [], types: [], features: [] },
    monnify: { supported: false, schemes: [], types: [], features: [] },
    onafriq: {
      supported: true,
      schemes: ['visa', 'mastercard', 'verve'],
      types: ['prepaid'],
      features: ['virtual', 'physical', 'multi_currency', 'mobile_money_funding', 'cross_border']
    },
    remita: { supported: false, schemes: [], types: [], features: [] },
    quickteller: {
      supported: true,
      schemes: ['verve'],
      types: ['debit', 'prepaid'],
      features: ['virtual', 'bulk_production', 'pin_management', 'block_unblock', 'balance_inquiry']
    },
    // Mobile Money Providers (no virtual card support)
    smartcash: { supported: false, schemes: [], types: [], features: [] },
    airtel_money: { supported: false, schemes: [], types: [], features: [] },
    mtn_momo: { supported: false, schemes: [], types: [], features: [] },
    mpesa: { supported: false, schemes: [], types: [], features: [] },
    paga: { supported: false, schemes: [], types: [], features: [] }
  };

  constructor(
    registry: ProviderRegistry,
    ledger: LedgerService,
    analytics: AnalyticsDashboard,
    auditLog: AuditLogService
  ) {
    this.registry = registry;
    this.ledger = ledger;
    this.analytics = analytics;
    this.auditLog = auditLog;
  }

  // ===========================================================================
  // CARD CREATION
  // ===========================================================================

  async createCard(params: VirtualCardRequest): Promise<VirtualCard> {
    // Check if provider supports virtual cards
    const capabilities = this.CARD_CAPABILITIES[params.provider];
    if (!capabilities.supported) {
      throw new ProviderFeatureUnavailableError(params.provider, 'virtual_card');
    }

    // Check if card scheme is supported
    if (!capabilities.schemes.includes(params.card_scheme)) {
      throw new Error(`Provider ${params.provider} does not support ${params.card_scheme} cards`);
    }

    // Check if card type is supported
    if (!capabilities.types.includes(params.card_type)) {
      throw new Error(`Provider ${params.provider} does not support ${params.card_type} cards`);
    }

    // Get provider wrapper
    const wrapper = this.registry.get(params.provider);
    if (!wrapper) {
      throw new ProviderUnavailableError(`Provider ${params.provider} is not registered`);
    }

    // Create card via provider API
    let cardData: any;

    if (params.provider === 'onafriq') {
      cardData = await this.createOnafriqCard(wrapper, params);
    } else if (params.provider === 'quickteller') {
      cardData = await this.createQuicktellerCard(wrapper, params);
    } else {
      throw new ProviderFeatureUnavailableError(params.provider, 'virtual_card');
    }

    // Create virtual card record
    const card: VirtualCard = {
      id: cardData.id || this.generateId('card'),
      provider: params.provider,
      user_id: params.user_id,
      card_number: cardData.card_number || cardData.pan || '****' + (cardData.last_four || '0000'),
      card_last_four: cardData.last_four || cardData.card_number?.slice(-4) || '0000',
      card_scheme: params.card_scheme,
      card_type: params.card_type,
      currency: params.currency,
      balance: params.amount || 0,
      status: 'active',
      expiry_date: cardData.expiry_date || cardData.expiryDate || '',
      cvv: cardData.cvv || cardData.cvv2,
      name_on_card: params.name_on_card,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.cards.set(card.id, card);

    // Record in ledger
    if (params.amount) {
      this.ledger.debit(
        params.user_id,
        params.amount,
        params.currency,
        `card_${card.id}`,
        params.provider,
        `Virtual card creation - ${params.card_scheme}`
      );
    }

    // Audit log
    this.auditLog.log({
      event: 'transaction.initiated',
      entity_type: 'virtual_card',
      entity_id: card.id,
      metadata: {
        provider: params.provider,
        user_id: params.user_id,
        card_scheme: params.card_scheme,
        card_type: params.card_type,
        currency: params.currency,
        amount: params.amount
      },
      severity: 'info'
    });

    return card;
  }

  private async createOnafriqCard(wrapper: ProviderWrapper, params: VirtualCardRequest): Promise<any> {
    // Onafriq card issuance API
    // POST /cards/virtual with Bearer token auth
    // Requires enterprise partner access
    const response = await wrapper.getAdapter().authenticate().then(() => {
      // Simulate API call - in production, call actual Onafriq card API
      return {
        id: this.generateId('onafriq_card'),
        card_number: '4' + Math.random().toString().slice(2, 15),
        last_four: Math.random().toString().slice(2, 6),
        cvv: Math.floor(Math.random() * 900 + 100).toString(),
        expiry_date: `${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${(new Date().getFullYear() + 3).toString().slice(-2)}`,
        status: 'active'
      };
    });

    return response;
  }

  private async createQuicktellerCard(wrapper: ProviderWrapper, params: VirtualCardRequest): Promise<any> {
    // Quickteller Card 360 API
    // POST /card-management/api/v1/card/request
    // Card types: DEBIT_NEW_ACCOUNT, PREPAID_NEW, etc.
    const cardTypeMap: Record<string, string> = {
      'debit': 'DEBIT_NEW_ACCOUNT',
      'prepaid': 'PREPAID_NEW'
    };

    const response = await wrapper.getAdapter().authenticate().then(() => {
      // Simulate API call - in production, call actual Interswitch card API
      return {
        id: this.generateId('isw_card'),
        pan: '506' + Math.random().toString().slice(2, 16),
        last_four: Math.random().toString().slice(2, 6),
        cvv: Math.floor(Math.random() * 900 + 100).toString(),
        cvv2: Math.floor(Math.random() * 900 + 100).toString(),
        expiryDate: `${(new Date().getMonth() + 1).toString().padStart(2, '0')}${(new Date().getFullYear() + 3).toString().slice(-2)}`,
        track2: '506' + Math.random().toString().slice(2, 16) + '=' + (new Date().getFullYear() + 3).toString().slice(-2) + (new Date().getMonth() + 1).toString().padStart(2, '0'),
        status: 'active'
      };
    });

    return response;
  }

  // ===========================================================================
  // CARD MANAGEMENT
  // ===========================================================================

  async blockCard(params: CardBlockRequest): Promise<VirtualCard> {
    const card = this.cards.get(params.card_id);
    if (!card) {
      throw new Error(`Card ${params.card_id} not found`);
    }

    if (card.provider !== params.provider) {
      throw new Error(`Card ${params.card_id} does not belong to provider ${params.provider}`);
    }

    // Block via provider API
    if (params.provider === 'quickteller') {
      // Quickteller block codes: 41=Lost, 43=Stolen, 45=Closed, 01=Refer
      const blockCodeMap: Record<string, string> = {
        'lost': '41',
        'stolen': '43',
        'fraud': '45',
        'user_request': '01'
      };
      // In production: POST /card-management/api/v1/card/{cardId}/block with blockCode
    }

    card.status = 'blocked';
    card.updated_at = new Date();
    this.cards.set(params.card_id, card);

    // Audit log
    this.auditLog.log({
      event: 'provider.service.disable',
      entity_type: 'virtual_card',
      entity_id: params.card_id,
      metadata: {
        provider: params.provider,
        reason: params.reason
      },
      severity: 'warning'
    });

    return card;
  }

  async unblockCard(params: CardManagementRequest): Promise<VirtualCard> {
    const card = this.cards.get(params.card_id);
    if (!card) {
      throw new Error(`Card ${params.card_id} not found`);
    }

    if (card.provider !== params.provider) {
      throw new Error(`Card ${params.card_id} does not belong to provider ${params.provider}`);
    }

    // Unblock via provider API
    // In production: POST /card-management/api/v1/card/{cardId}/unblock

    card.status = 'active';
    card.updated_at = new Date();
    this.cards.set(params.card_id, card);

    // Audit log
    this.auditLog.log({
      event: 'provider.service.enable',
      entity_type: 'virtual_card',
      entity_id: params.card_id,
      metadata: { provider: params.provider },
      severity: 'info'
    });

    return card;
  }

  async getCardBalance(params: CardManagementRequest): Promise<{ balance: number; currency: string }> {
    const card = this.cards.get(params.card_id);
    if (!card) {
      throw new Error(`Card ${params.card_id} not found`);
    }

    // In production, call provider API to get real balance
    return {
      balance: card.balance,
      currency: card.currency
    };
  }

  async getCardTransactions(params: CardManagementRequest & { limit?: number; offset?: number }): Promise<CardTransaction[]> {
    // In production, call provider API to get transaction history
    return [];
  }

  // ===========================================================================
  // CARD QUERIES
  // ===========================================================================

  getCard(cardId: string): VirtualCard | undefined {
    return this.cards.get(cardId);
  }

  getUserCards(userId: string): VirtualCard[] {
    return Array.from(this.cards.values()).filter(c => c.user_id === userId);
  }

  getProviderCards(provider: ProviderName): VirtualCard[] {
    return Array.from(this.cards.values()).filter(c => c.provider === provider);
  }

  getSupportedProviders(): ProviderName[] {
    return Object.entries(this.CARD_CAPABILITIES)
      .filter(([_, cap]) => cap.supported)
      .map(([provider, _]) => provider as ProviderName);
  }

  getCardCapabilities(provider: ProviderName): {
    supported: boolean;
    schemes: CardScheme[];
    types: CardType[];
    features: string[];
  } {
    return this.CARD_CAPABILITIES[provider] || { supported: false, schemes: [], types: [], features: [] };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }
}

export default VirtualCardService;
