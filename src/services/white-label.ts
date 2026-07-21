// TurboPay White-Label Service
// Partner branding and customization support

import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export interface PartnerConfig {
  id: string;
  name: string;
  slug: string; // URL-friendly identifier
  status: 'active' | 'inactive' | 'suspended';
  
  // Branding
  branding: {
    logo_url: string;
    favicon_url?: string;
    primary_color: string;
    secondary_color: string;
    accent_color: string;
    font_family: string;
    border_radius: string; // 'none' | 'small' | 'medium' | 'large'
  };
  
  // Custom domain
  custom_domain?: string;
  subdomain: string; // partner.turbopay.ng
  
  // Features
  features: {
    enabled_providers: string[];
    enabled_countries: string[];
    enabled_currencies: string[];
    enabled_features: string[];
  };
  
  // Limits
  limits: {
    max_users: number;
    max_transactions_per_day: number;
    max_amount_per_transaction: number;
    custom_limits?: Record<string, number>;
  };
  
  // Contact
  contact: {
    email: string;
    phone?: string;
    address?: string;
    support_url?: string;
  };
  
  // Technical
  webhook_url?: string;
  api_rate_limit: number;
  
  // Timestamps
  created_at: Date;
  updated_at: Date;
}

export interface PartnerTheme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  border: string;
}

// =============================================================================
// WHITE-LABEL SERVICE
// =============================================================================

export class WhiteLabelService {
  private partners: Map<string, PartnerConfig> = new Map();
  private partnerBySlug: Map<string, string> = new Map();
  private partnerByDomain: Map<string, string> = new Map();
  private persistence: PersistenceManager | null = null;

  constructor() {
    this.seedDefaultThemes();
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('partner_configs', this.partners);
  }

  // ===========================================================================
  // PARTNER MANAGEMENT
  // ===========================================================================

  /**
   * Create a new partner configuration
   */
  createPartner(data: Omit<PartnerConfig, 'id' | 'created_at' | 'updated_at'>): PartnerConfig {
    const id = this.generateId('partner');
    
    const partner: PartnerConfig = {
      ...data,
      id,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.partners.set(id, partner);
    this.partnerBySlug.set(partner.slug, id);
    
    if (partner.custom_domain) {
      this.partnerByDomain.set(partner.custom_domain, id);
    }

    this.dirty();
    return partner;
  }

  /**
   * Get partner by ID
   */
  getPartner(id: string): PartnerConfig | undefined {
    return this.partners.get(id);
  }

  /**
   * Get partner by slug
   */
  getPartnerBySlug(slug: string): PartnerConfig | undefined {
    const id = this.partnerBySlug.get(slug);
    return id ? this.partners.get(id) : undefined;
  }

  /**
   * Get partner by custom domain
   */
  getPartnerByDomain(domain: string): PartnerConfig | undefined {
    const id = this.partnerByDomain.get(domain);
    return id ? this.partners.get(id) : undefined;
  }

  /**
   * Update partner configuration
   */
  updatePartner(id: string, updates: Partial<PartnerConfig>): PartnerConfig | null {
    const partner = this.partners.get(id);
    if (!partner) return null;

    const updated = { ...partner, ...updates, updated_at: new Date() };
    this.partners.set(id, updated);
    this.dirty();
    return updated;
  }

  /**
   * Delete partner
   */
  deletePartner(id: string): boolean {
    const partner = this.partners.get(id);
    if (!partner) return false;

    this.partnerBySlug.delete(partner.slug);
    if (partner.custom_domain) {
      this.partnerByDomain.delete(partner.custom_domain);
    }

    this.partners.delete(id);
    this.dirty();
    return true;
  }

  // ===========================================================================
  // BRANDING
  // ===========================================================================

  /**
   * Get partner branding for frontend
   */
  getPartnerBranding(slug: string): PartnerConfig['branding'] | null {
    const partner = this.getPartnerBySlug(slug);
    return partner?.branding || null;
  }

  /**
   * Generate CSS variables from partner branding
   */
  generateCSSVariables(branding: PartnerConfig['branding']): Record<string, string> {
    return {
      '--brand-primary': branding.primary_color,
      '--brand-secondary': branding.secondary_color,
      '--brand-accent': branding.accent_color,
      '--brand-font': branding.font_family,
      '--brand-radius': this.getBorderRadius(branding.border_radius)
    };
  }

  private getBorderRadius(size: string): string {
    const radiusMap: Record<string, string> = {
      'none': '0',
      'small': '4px',
      'medium': '8px',
      'large': '16px'
    };
    return radiusMap[size] || '8px';
  }

  // ===========================================================================
  // THEMES
  // ===========================================================================

  private defaultThemes: PartnerTheme[] = [];

  private seedDefaultThemes(): void {
    this.defaultThemes = [
      {
        name: 'Default',
        primary: '#6366f1',
        secondary: '#4f46e5',
        accent: '#8b5cf6',
        background: '#ffffff',
        text: '#1f2937',
        border: '#e5e7eb'
      },
      {
        name: 'Ocean',
        primary: '#0ea5e9',
        secondary: '#0284c7',
        accent: '#38bdf8',
        background: '#f0f9ff',
        text: '#0c4a6e',
        border: '#bae6fd'
      },
      {
        name: 'Forest',
        primary: '#22c55e',
        secondary: '#16a34a',
        accent: '#4ade80',
        background: '#f0fdf4',
        text: '#14532d',
        border: '#bbf7d0'
      },
      {
        name: 'Sunset',
        primary: '#f97316',
        secondary: '#ea580c',
        accent: '#fb923c',
        background: '#fff7ed',
        text: '#7c2d12',
        border: '#fed7aa'
      },
      {
        name: 'Royal',
        primary: '#8b5cf6',
        secondary: '#7c3aed',
        accent: '#a78bfa',
        background: '#faf5ff',
        text: '#3b0764',
        border: '#ddd6fe'
      }
    ];
  }

  /**
   * Get available themes
   */
  getThemes(): PartnerTheme[] {
    return [...this.defaultThemes];
  }

  /**
   * Apply theme to partner
   */
  applyTheme(partnerId: string, themeName: string): boolean {
    const partner = this.partners.get(partnerId);
    if (!partner) return false;

    const theme = this.defaultThemes.find(t => t.name === themeName);
    if (!theme) return false;

    partner.branding.primary_color = theme.primary;
    partner.branding.secondary_color = theme.secondary;
    partner.branding.accent_color = theme.accent;
    partner.updated_at = new Date();

    this.partners.set(partnerId, partner);
    this.dirty();
    return true;
  }

  // ===========================================================================
  // FEATURES & LIMITS
  // ===========================================================================

  /**
   * Check if feature is enabled for partner
   */
  isFeatureEnabled(slug: string, feature: string): boolean {
    const partner = this.getPartnerBySlug(slug);
    if (!partner) return false;
    return partner.features.enabled_features.includes(feature);
  }

  /**
   * Check if provider is enabled for partner
   */
  isProviderEnabled(slug: string, provider: string): boolean {
    const partner = this.getPartnerBySlug(slug);
    if (!partner) return false;
    return partner.features.enabled_providers.includes(provider);
  }

  /**
   * Check if country is enabled for partner
   */
  isCountryEnabled(slug: string, country: string): boolean {
    const partner = this.getPartnerBySlug(slug);
    if (!partner) return false;
    return partner.features.enabled_countries.includes(country);
  }

  /**
   * Check if transaction is within limits
   */
  checkLimits(slug: string, amount: number): { allowed: boolean; reason?: string } {
    const partner = this.getPartnerBySlug(slug);
    if (!partner) return { allowed: false, reason: 'Partner not found' };

    if (amount > partner.limits.max_amount_per_transaction) {
      return { 
        allowed: false, 
        reason: `Amount exceeds maximum of ${partner.limits.max_amount_per_transaction}` 
      };
    }

    return { allowed: true };
  }

  // ===========================================================================
  // RESOLUTION
  // ===========================================================================

  /**
   * Resolve partner from request
   * Checks custom domain, then subdomain, then slug
   */
  resolvePartner(request: { host?: string; query?: { partner?: string } }): PartnerConfig | null {
    // Check custom domain
    if (request.host) {
      const domainPartner = this.getPartnerByDomain(request.host);
      if (domainPartner) return domainPartner;
    }

    // Check subdomain
    if (request.host) {
      const subdomain = request.host.split('.')[0];
      const subdomainPartner = this.getPartnerBySlug(subdomain);
      if (subdomainPartner) return subdomainPartner;
    }

    // Check query parameter
    if (request.query?.partner) {
      const partner = this.getPartnerBySlug(request.query.partner);
      return partner || null;
    }

    return null;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private dirty(): void {
    this.persistence?.markDirty('partner_configs');
  }
}

export default WhiteLabelService;
