// TurboPay Payment Links Service
// Generate shareable payment links for collections
// Merchants can create links that customers click to pay

import crypto from 'crypto';
import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export type PaymentLinkStatus = 'active' | 'inactive' | 'expired' | 'archived';
export type PaymentLinkType = 'fixed' | 'flexible' | 'subscription';

export interface PaymentLink {
  id: string;
  merchant_id: string;
  title: string;
  description?: string;
  type: PaymentLinkType;
  status: PaymentLinkStatus;

  // Amount (for fixed type)
  amount?: number;
  currency: string;

  // Allow custom amount (for flexible type)
  allow_custom_amount: boolean;
  min_amount?: number;
  max_amount?: number;

  // Recurring (for subscription type)
  interval?: 'daily' | 'weekly' | 'monthly' | 'yearly';

  // Settings
  collect_customer_email: boolean;
  collect_customer_name: boolean;
  collect_customer_phone: boolean;
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, any>;

  // Stats
  total_uses: number;
  total_amount_collected: number;

  // Expiry
  expires_at?: Date;
  max_uses?: number;

  // Tracking
  reference_prefix?: string;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

export interface PaymentLinkTransaction {
  id: string;
  link_id: string;
  reference: string;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed';
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  provider?: string;
  provider_reference?: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

export interface CreatePaymentLinkRequest {
  merchant_id: string;
  title: string;
  description?: string;
  type: PaymentLinkType;
  amount?: number;
  currency: string;
  allow_custom_amount?: boolean;
  min_amount?: number;
  max_amount?: number;
  interval?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  collect_customer_email?: boolean;
  collect_customer_name?: boolean;
  collect_customer_phone?: boolean;
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, any>;
  expires_at?: Date;
  max_uses?: number;
}

// =============================================================================
// PAYMENT LINKS SERVICE
// =============================================================================

export class PaymentLinksService {
  private links: Map<string, PaymentLink> = new Map();
  private transactions: Map<string, PaymentLinkTransaction> = new Map();
  private linkBySlug: Map<string, string> = new Map(); // slug -> link_id
  private persistence: PersistenceManager | null = null;

  constructor() {}

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('payment_links', this.links);
    pm.register('payment_link_transactions', this.transactions);
  }

  // ===========================================================================
  // LINK MANAGEMENT
  // ===========================================================================

  /**
   * Create a payment link
   */
  createLink(request: CreatePaymentLinkRequest): PaymentLink {
    const id = this.generateId('link');
    const slug = this.generateSlug();

    const link: PaymentLink = {
      id,
      merchant_id: request.merchant_id,
      title: request.title,
      description: request.description,
      type: request.type,
      status: 'active',
      amount: request.amount,
      currency: request.currency,
      allow_custom_amount: request.allow_custom_amount || false,
      min_amount: request.min_amount,
      max_amount: request.max_amount,
      interval: request.interval,
      collect_customer_email: request.collect_customer_email ?? true,
      collect_customer_name: request.collect_customer_name ?? false,
      collect_customer_phone: request.collect_customer_phone ?? false,
      success_url: request.success_url,
      cancel_url: request.cancel_url,
      metadata: request.metadata,
      total_uses: 0,
      total_amount_collected: 0,
      expires_at: request.expires_at,
      max_uses: request.max_uses,
      reference_prefix: `link_${slug}`,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.links.set(id, link);
    this.linkBySlug.set(slug, id);
    this.dirty();

    return link;
  }

  /**
   * Get payment link by ID
   */
  getLink(id: string): PaymentLink | undefined {
    return this.links.get(id);
  }

  /**
   * Get payment link by slug (for public access)
   */
  getLinkBySlug(slug: string): PaymentLink | undefined {
    const linkId = this.linkBySlug.get(slug);
    if (!linkId) return undefined;
    return this.links.get(linkId);
  }

  /**
   * Get all links for a merchant
   */
  getMerchantLinks(merchantId: string): PaymentLink[] {
    return Array.from(this.links.values())
      .filter(l => l.merchant_id === merchantId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  /**
   * Update a payment link
   */
  updateLink(id: string, updates: Partial<PaymentLink>): PaymentLink | null {
    const link = this.links.get(id);
    if (!link) return null;

    const updated = { ...link, ...updates, updated_at: new Date() };
    this.links.set(id, updated);
    this.dirty();
    return updated;
  }

  /**
   * Archive a payment link
   */
  archiveLink(id: string): boolean {
    const link = this.links.get(id);
    if (!link) return false;

    link.status = 'archived';
    link.updated_at = new Date();
    this.links.set(id, link);
    this.dirty();
    return true;
  }

  /**
   * Delete a payment link
   */
  deleteLink(id: string): boolean {
    const link = this.links.get(id);
    if (!link) return false;

    // Remove slug mapping
    const slug = this.getSlugFromLink(link);
    if (slug) {
      this.linkBySlug.delete(slug);
    }

    this.links.delete(id);
    this.dirty();
    return true;
  }

  // ===========================================================================
  // TRANSACTION HANDLING
  // ===========================================================================

  /**
   * Record a payment attempt for a link
   */
  recordTransaction(
    linkId: string,
    data: {
      reference: string;
      amount: number;
      currency: string;
      customer_email?: string;
      customer_name?: string;
      customer_phone?: string;
      metadata?: Record<string, any>;
    }
  ): PaymentLinkTransaction | null {
    const link = this.links.get(linkId);
    if (!link || link.status !== 'active') return null;

    // Check expiry
    if (link.expires_at && link.expires_at < new Date()) {
      link.status = 'expired';
      this.links.set(linkId, link);
      this.dirty();
      return null;
    }

    // Check max uses
    if (link.max_uses && link.total_uses >= link.max_uses) {
      link.status = 'inactive';
      this.links.set(linkId, link);
      this.dirty();
      return null;
    }

    const transaction: PaymentLinkTransaction = {
      id: this.generateId('txn'),
      link_id: linkId,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      status: 'pending',
      customer_email: data.customer_email,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      metadata: data.metadata,
      created_at: new Date()
    };

    this.transactions.set(transaction.id, transaction);

    // Update link stats
    link.total_uses++;
    link.updated_at = new Date();
    this.links.set(linkId, link);
    this.dirty();

    return transaction;
  }

  /**
   * Complete a payment transaction
   */
  completeTransaction(
    transactionId: string,
    data: {
      status: 'success' | 'failed';
      provider?: string;
      provider_reference?: string;
    }
  ): PaymentLinkTransaction | null {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return null;

    transaction.status = data.status;
    transaction.provider = data.provider;
    transaction.provider_reference = data.provider_reference;

    // Update link stats on success
    if (data.status === 'success') {
      const link = this.links.get(transaction.link_id);
      if (link) {
        link.total_amount_collected += transaction.amount;
        link.updated_at = new Date();
        this.links.set(link.id, link);
      }
    }

    this.transactions.set(transactionId, transaction);
    this.dirty();
    return transaction;
  }

  /**
   * Get transactions for a link
   */
  getLinkTransactions(linkId: string): PaymentLinkTransaction[] {
    return Array.from(this.transactions.values())
      .filter(t => t.link_id === linkId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  /**
   * Get transaction by reference
   */
  getTransactionByReference(reference: string): PaymentLinkTransaction | undefined {
    for (const txn of this.transactions.values()) {
      if (txn.reference === reference) return txn;
    }
    return undefined;
  }

  // ===========================================================================
  // PUBLIC API (for checkout page)
  // ===========================================================================

  /**
   * Get public link data (no merchant secrets)
   */
  getPublicLinkData(slug: string): {
    id: string;
    title: string;
    description?: string;
    type: PaymentLinkType;
    amount?: number;
    currency: string;
    allow_custom_amount: boolean;
    min_amount?: number;
    max_amount?: number;
    collect_customer_email: boolean;
    collect_customer_name: boolean;
    collect_customer_phone: boolean;
  } | null {
    const link = this.getLinkBySlug(slug);
    if (!link || link.status !== 'active') return null;

    return {
      id: link.id,
      title: link.title,
      description: link.description,
      type: link.type,
      amount: link.amount,
      currency: link.currency,
      allow_custom_amount: link.allow_custom_amount,
      min_amount: link.min_amount,
      max_amount: link.max_amount,
      collect_customer_email: link.collect_customer_email,
      collect_customer_name: link.collect_customer_name,
      collect_customer_phone: link.collect_customer_phone
    };
  }

  /**
   * Validate payment data before processing
   */
  validatePayment(slug: string, data: {
    amount?: number;
    email?: string;
    name?: string;
    phone?: string;
  }): { valid: boolean; error?: string } {
    const link = this.getLinkBySlug(slug);
    if (!link) return { valid: false, error: 'Payment link not found' };
    if (link.status !== 'active') return { valid: false, error: 'Payment link is no longer active' };

    // Validate amount
    if (link.type === 'fixed' && !link.amount) {
      return { valid: false, error: 'No amount configured for this link' };
    }
    if (link.allow_custom_amount) {
      if (!data.amount) return { valid: false, error: 'Amount is required' };
      if (link.min_amount && data.amount < link.min_amount) {
        return { valid: false, error: `Minimum amount is ${link.min_amount}` };
      }
      if (link.max_amount && data.amount > link.max_amount) {
        return { valid: false, error: `Maximum amount is ${link.max_amount}` };
      }
    }

    // Validate required fields
    if (link.collect_customer_email && !data.email) {
      return { valid: false, error: 'Email is required' };
    }
    if (link.collect_customer_name && !data.name) {
      return { valid: false, error: 'Name is required' };
    }
    if (link.collect_customer_phone && !data.phone) {
      return { valid: false, error: 'Phone number is required' };
    }

    return { valid: true };
  }

  // ===========================================================================
  // ANALYTICS
  // ===========================================================================

  /**
   * Get link analytics
   */
  getLinkAnalytics(linkId: string): {
    total_uses: number;
    successful_payments: number;
    failed_payments: number;
    total_amount_collected: number;
    conversion_rate: number;
  } | null {
    const link = this.links.get(linkId);
    if (!link) return null;

    const transactions = this.getLinkTransactions(linkId);
    const successful = transactions.filter(t => t.status === 'success').length;
    const failed = transactions.filter(t => t.status === 'failed').length;

    return {
      total_uses: link.total_uses,
      successful_payments: successful,
      failed_payments: failed,
      total_amount_collected: link.total_amount_collected,
      conversion_rate: link.total_uses > 0 ? (successful / link.total_uses) * 100 : 0
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private generateSlug(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private getSlugFromLink(link: PaymentLink): string | undefined {
    for (const [slug, linkId] of this.linkBySlug.entries()) {
      if (linkId === link.id) return slug;
    }
    return undefined;
  }

  private dirty(): void {
    this.persistence?.markDirty('payment_links');
    this.persistence?.markDirty('payment_link_transactions');
  }
}

export default PaymentLinksService;
