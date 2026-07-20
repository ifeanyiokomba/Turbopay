// TurboPay Unified Bills Service
// Combines Remita, Quickteller, and other bill providers into one interface
// Users never need to know which provider powers a bill payment
//
// Architecture per restructure.txt:
// - Bills: Electricity, Internet, Cable TV, Airtime, Data, Education, Insurance, Government, Transport, Gaming, Others
// - System determines which underlying provider fulfills the request
// - Users should never need to select a provider unless multiple options offer meaningful differences

import {
  ProviderName,
  Biller,
  BillerItem,
  BillPaymentRequest,
  UnifiedTransactionResponse,
  ProviderUnavailableError
} from '../types';
import { ProviderSelectionEngine } from './provider-selection-engine';
import { ProviderRegistry } from './provider-wrapper';
import { LedgerService } from './ledger';

// =============================================================================
// TYPES
// =============================================================================

export type BillCategory =
  | 'electricity'
  | 'internet'
  | 'cable_tv'
  | 'airtime'
  | 'data'
  | 'education'
  | 'insurance'
  | 'government'
  | 'transport'
  | 'gaming'
  | 'water'
  | 'waste'
  | 'others';

export interface UnifiedBiller {
  id: string;
  name: string;
  category: BillCategory;
  provider: ProviderName;
  description?: string;
  icon?: string;
  supported_amounts?: number[];
  is_fixed_amount: boolean;
  min_amount?: number;
  max_amount?: number;
  metadata?: Record<string, any>;
}

export interface UnifiedBillerItem {
  id: string;
  biller_id: string;
  name: string;
  amount?: number;
  code?: string;
  description?: string;
}

export interface BillCategoryInfo {
  id: BillCategory;
  name: string;
  description: string;
  icon: string;
  biller_count: number;
}

export interface BillPaymentResult {
  success: boolean;
  transaction?: UnifiedTransactionResponse;
  provider: ProviderName;
  biller_name: string;
  category: BillCategory;
  amount: number;
  reference: string;
  error?: string;
}

// =============================================================================
// UNIFIED BILLS SERVICE
// =============================================================================

export class UnifiedBillsService {
  private selectionEngine: ProviderSelectionEngine;
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private billers: Map<string, UnifiedBiller> = new Map();
  private categoryBillers: Map<BillCategory, string[]> = new Map();

  constructor(
    selectionEngine: ProviderSelectionEngine,
    registry: ProviderRegistry,
    ledger: LedgerService
  ) {
    this.selectionEngine = selectionEngine;
    this.registry = registry;
    this.ledger = ledger;
    this.initializeCategories();
    this.seedDefaultBillers();
  }

  // ===========================================================================
  // CATEGORY MANAGEMENT
  // ===========================================================================

  getCategories(): BillCategoryInfo[] {
    return [
      { id: 'electricity', name: 'Electricity', description: 'Pay your electricity bills', icon: 'lightning-bolt', biller_count: this.getBillersByCategory('electricity').length },
      { id: 'internet', name: 'Internet', description: 'Internet service providers', icon: 'globe', biller_count: this.getBillersByCategory('internet').length },
      { id: 'cable_tv', name: 'Cable TV', description: 'Cable TV subscriptions', icon: 'tv', biller_count: this.getBillersByCategory('cable_tv').length },
      { id: 'airtime', name: 'Airtime', description: 'Buy airtime for any network', icon: 'phone', biller_count: this.getBillersByCategory('airtime').length },
      { id: 'data', name: 'Data', description: 'Buy data bundles', icon: 'signal', biller_count: this.getBillersByCategory('data').length },
      { id: 'education', name: 'Education', description: 'Education payments', icon: 'academic-cap', biller_count: this.getBillersByCategory('education').length },
      { id: 'insurance', name: 'Insurance', description: 'Insurance premiums', icon: 'shield-check', biller_count: this.getBillersByCategory('insurance').length },
      { id: 'government', name: 'Government', description: 'Government payments', icon: 'building-office', biller_count: this.getBillersByCategory('government').length },
      { id: 'transport', name: 'Transport', description: 'Transport and toll payments', icon: 'truck', biller_count: this.getBillersByCategory('transport').length },
      { id: 'gaming', name: 'Gaming', description: 'Gaming top-ups', icon: 'puzzle-piece', biller_count: this.getBillersByCategory('gaming').length },
      { id: 'water', name: 'Water', description: 'Water utility bills', icon: 'droplet', biller_count: this.getBillersByCategory('water').length },
      { id: 'waste', name: 'Waste', description: 'Waste management', icon: 'trash', biller_count: this.getBillersByCategory('waste').length },
      { id: 'others', name: 'Others', description: 'Other bill payments', icon: 'ellipsis-horizontal', biller_count: this.getBillersByCategory('others').length },
    ];
  }

  getBillersByCategory(category: BillCategory): UnifiedBiller[] {
    const ids = this.categoryBillers.get(category) || [];
    return ids.map(id => this.billers.get(id)).filter((b): b is UnifiedBiller => !!b);
  }

  getAllBillers(): UnifiedBiller[] {
    return Array.from(this.billers.values());
  }

  getBiller(id: string): UnifiedBiller | undefined {
    return this.billers.get(id);
  }

  // ===========================================================================
  // BILL PAYMENT
  // ===========================================================================

  /**
   * Pay a bill — automatically selects the best provider
   */
  async payBill(
    request: BillPaymentRequest & { category: BillCategory; country?: string; currency?: string },
    userId?: string
  ): Promise<BillPaymentResult> {
    const { category, country, currency, ...billRequest } = request;

    // Find the best provider for this category and country
    const provider = await this.selectProviderForCategory(category, country, currency);

    if (!provider) {
      return {
        success: false,
        provider: 'remita',
        biller_name: billRequest.biller_id,
        category,
        amount: billRequest.amount,
        reference: billRequest.customer_reference,
        error: `No providers available for ${category} bills in ${country || 'default region'}`
      };
    }

    try {
      const adapter = this.registry.get(provider);
      if (!adapter) throw new ProviderUnavailableError(`Provider ${provider} not registered`);

      const result = await adapter.payBill(billRequest);

      // Record in ledger if userId provided
      if (userId) {
        const wallet = this.ledger.getUserWallets(userId)[0];
        if (wallet) {
          this.ledger.debit(
            wallet.id,
            billRequest.amount,
            wallet.currency,
            billRequest.customer_reference,
            provider,
            undefined,
            `Bill payment: ${category}`
          );
        }
      }

      // Find biller name
      const biller = this.billers.get(billRequest.biller_id);

      return {
        success: true,
        transaction: result,
        provider,
        biller_name: biller?.name || billRequest.biller_id,
        category,
        amount: billRequest.amount,
        reference: billRequest.customer_reference
      };
    } catch (error) {
      return {
        success: false,
        provider,
        biller_name: billRequest.biller_id,
        category,
        amount: billRequest.amount,
        reference: billRequest.customer_reference,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get billers across all providers for a category
   * Merges results from Remita, Quickteller, and others
   */
  async getBillersForCategory(
    category: BillCategory,
    country?: string
  ): Promise<UnifiedBiller[]> {
    // First check our cached billers
    const cached = this.getBillersByCategory(category);
    if (cached.length > 0) return cached;

    // Otherwise query all registered providers
    const allBillers: UnifiedBiller[] = [];
    const providers = this.registry.getHealthy();

    for (const provider of providers) {
      try {
        const billers = await provider.listBillers();
        for (const biller of billers) {
          const unified: UnifiedBiller = {
            id: `${provider.name}_${biller.id}`,
            name: biller.name,
            category,
            provider: provider.name,
            description: biller.description,
            is_fixed_amount: false
          };
          allBillers.push(unified);
          this.billers.set(unified.id, unified);
        }
      } catch (error) {
        // Provider doesn't support billers or errored — skip
      }
    }

    return allBillers;
  }

  // ===========================================================================
  // PROVIDER SELECTION
  // ===========================================================================

  private async selectProviderForCategory(
    category: BillCategory,
    country?: string,
    currency?: string
  ): Promise<ProviderName | null> {
    // Map category to operation
    const operationMap: Record<BillCategory, string> = {
      electricity: 'electricity',
      internet: 'bill_payment',
      cable_tv: 'cable_tv',
      airtime: 'airtime',
      data: 'data',
      education: 'education',
      insurance: 'bill_payment',
      government: 'bill_payment',
      transport: 'bill_payment',
      gaming: 'bill_payment',
      water: 'bill_payment',
      waste: 'bill_payment',
      others: 'bill_payment'
    };

    const operation = operationMap[category] as any;

    // Get providers that support this operation in this country
    const providers = this.selectionEngine.getFailoverChain(
      operation,
      country || 'NG',
      currency || 'NGN'
    );

    // Filter to registered providers
    const registered = providers.filter(p =>
      this.registry.get(p.provider)
    );

    if (registered.length === 0) return null;
    return registered[0].provider;
  }

  // ===========================================================================
  // SEED DEFAULT BILLERS
  // ===========================================================================

  private initializeCategories(): void {
    const categories: BillCategory[] = [
      'electricity', 'internet', 'cable_tv', 'airtime', 'data',
      'education', 'insurance', 'government', 'transport', 'gaming',
      'water', 'waste', 'others'
    ];
    for (const cat of categories) {
      this.categoryBillers.set(cat, []);
    }
  }

  private seedDefaultBillers(): void {
    const billers: Omit<UnifiedBiller, 'id'>[] = [
      // Electricity
      { name: 'IKEDC (Ikeja Electric)', category: 'electricity', provider: 'remita', description: 'Ikeja Electricity Distribution Company', is_fixed_amount: false },
      { name: 'EKEDC (Eko Electric)', category: 'electricity', provider: 'remita', description: 'Eko Electricity Distribution Company', is_fixed_amount: false },
      { name: 'AEDC (Abuja Electric)', category: 'electricity', provider: 'remita', description: 'Abuja Electricity Distribution Company', is_fixed_amount: false },
      { name: 'EEDC (Enugu Electric)', category: 'electricity', provider: 'remita', description: 'Enugu Electricity Distribution Company', is_fixed_amount: false },
      { name: 'PHED (Port Harcourt Electric)', category: 'electricity', provider: 'remita', description: 'Port Harcourt Electricity Distribution Company', is_fixed_amount: false },
      { name: 'IBEDC (Ibadan Electric)', category: 'electricity', provider: 'remita', description: 'Ibadan Electricity Distribution Company', is_fixed_amount: false },
      { name: 'JOS Electric', category: 'electricity', provider: 'quickteller', description: 'Jos Electricity Distribution Company', is_fixed_amount: false },
      { name: 'KANO Electric', category: 'electricity', provider: 'quickteller', description: 'Kano Electricity Distribution Company', is_fixed_amount: false },

      // Internet
      { name: 'Smile Communications', category: 'internet', provider: 'remita', description: 'Smile broadband internet', is_fixed_amount: false },
      { name: 'Spectranet', category: 'internet', provider: 'remita', description: 'Spectranet broadband internet', is_fixed_amount: false },
      { name: 'FiberOne', category: 'internet', provider: 'quickteller', description: 'FiberOne fiber internet', is_fixed_amount: false },
      { name: 'Airtel Broadband', category: 'internet', provider: 'quickteller', description: 'Airtel broadband internet', is_fixed_amount: false },
      { name: 'MTN Broadband', category: 'internet', provider: 'quickteller', description: 'MTN broadband internet', is_fixed_amount: false },

      // Cable TV
      { name: 'DSTV', category: 'cable_tv', provider: 'remita', description: 'DSTV satellite TV subscription', is_fixed_amount: false },
      { name: 'GOtv', category: 'cable_tv', provider: 'remita', description: 'GOtv digital TV subscription', is_fixed_amount: false },
      { name: 'Startimes', category: 'cable_tv', provider: 'quickteller', description: 'Startimes digital TV', is_fixed_amount: false },
      { name: 'Showmax', category: 'cable_tv', provider: 'quickteller', description: 'Showmax streaming subscription', is_fixed_amount: false },

      // Airtime
      { name: 'MTN Airtime', category: 'airtime', provider: 'remita', description: 'MTN airtime top-up', is_fixed_amount: false, min_amount: 50, max_amount: 50000 },
      { name: 'Airtel Airtime', category: 'airtime', provider: 'remita', description: 'Airtel airtime top-up', is_fixed_amount: false, min_amount: 50, max_amount: 50000 },
      { name: 'Glo Airtime', category: 'airtime', provider: 'quickteller', description: 'Glo airtime top-up', is_fixed_amount: false, min_amount: 50, max_amount: 50000 },
      { name: '9mobile Airtime', category: 'airtime', provider: 'quickteller', description: '9mobile airtime top-up', is_fixed_amount: false, min_amount: 50, max_amount: 50000 },

      // Data
      { name: 'MTN Data', category: 'data', provider: 'remita', description: 'MTN data bundle', is_fixed_amount: false },
      { name: 'Airtel Data', category: 'data', provider: 'remita', description: 'Airtel data bundle', is_fixed_amount: false },
      { name: 'Glo Data', category: 'data', provider: 'quickteller', description: 'Glo data bundle', is_fixed_amount: false },
      { name: '9mobile Data', category: 'data', provider: 'quickteller', description: '9mobile data bundle', is_fixed_amount: false },

      // Education
      { name: 'WAEC', category: 'education', provider: 'remita', description: 'WAEC examination fees', is_fixed_amount: false },
      { name: 'NECO', category: 'education', provider: 'remita', description: 'NECO examination fees', is_fixed_amount: false },
      { name: 'JAMB', category: 'education', provider: 'quickteller', description: 'JAMB registration fees', is_fixed_amount: false },
      { name: 'NABTEB', category: 'education', provider: 'quickteller', description: 'NABTEB examination fees', is_fixed_amount: false },
    ];

    for (const biller of billers) {
      const id = this.generateId('biller');
      const full: UnifiedBiller = { ...biller, id };
      this.billers.set(id, full);

      const categoryIds = this.categoryBillers.get(biller.category) || [];
      categoryIds.push(id);
      this.categoryBillers.set(biller.category, categoryIds);
    }
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

export default UnifiedBillsService;
