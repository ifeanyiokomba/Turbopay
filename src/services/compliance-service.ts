// TurboPay Trust, Security & Compliance Center
// Database-driven compliance system with admin management
// PCI DSS badge logic, security badges, provider logos, trust messages
// All data comes from the database — nothing is hardcoded

import { PersistenceManager } from '../utils/persistence';

// =============================================================================
// TYPES
// =============================================================================

export type ComplianceStatus = 'pending' | 'verified' | 'expired' | 'inactive';
export type BadgeStatus = 'active' | 'inactive';

export interface ComplianceCertification {
  id: string;
  name: string;
  description: string;
  status: ComplianceStatus;
  logo_url?: string;
  verification_url?: string;
  certificate_number?: string;
  date_issued?: Date;
  expiry_date?: Date;
  display_on_homepage: boolean;
  display_priority: number;
  internal_notes?: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

export interface SecurityBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: BadgeStatus;
  display_priority: number;
  category?: string;
  learn_more_url?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderLogo {
  id: string;
  provider_name: string;
  logo_url: string;
  display_name: string;
  website_url?: string;
  display_priority: number;
  status: BadgeStatus;
  created_at: Date;
  updated_at: Date;
}

export interface TrustMessage {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'security' | 'compliance' | 'notice';
  display_priority: number;
  status: BadgeStatus;
  created_at: Date;
  updated_at: Date;
}

export interface TrustIndicator {
  id: string;
  icon: string;
  title: string;
  description: string;
  learn_more_url?: string;
  display_priority: number;
  status: BadgeStatus;
  created_at: Date;
  updated_at: Date;
}

export interface ComplianceAuditLog {
  id: string;
  entity_type: 'compliance' | 'badge' | 'provider_logo' | 'trust_message' | 'trust_indicator';
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  admin_id: string;
  admin_email?: string;
  changes: Record<string, { before: any; after: any }>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export interface HomepageTrustData {
  indicators: TrustIndicator[];
  compliance: ComplianceCertification[];
  security_badges: SecurityBadge[];
  provider_logos: ProviderLogo[];
  trust_messages: TrustMessage[];
  pci_compliant: boolean;
  pci_badge?: ComplianceCertification;
  payment_security_notice: string;
}

// =============================================================================
// COMPLIANCE SERVICE
// =============================================================================

export class ComplianceService {
  private certifications: Map<string, ComplianceCertification> = new Map();
  private securityBadges: Map<string, SecurityBadge> = new Map();
  private providerLogos: Map<string, ProviderLogo> = new Map();
  private trustMessages: Map<string, TrustMessage> = new Map();
  private trustIndicators: Map<string, TrustIndicator> = new Map();
  private auditLogs: Map<string, ComplianceAuditLog> = new Map();
  private persistence: PersistenceManager | null = null;

  constructor() {
    this.seedDefaultData();
  }

  registerPersistence(pm: PersistenceManager): void {
    this.persistence = pm;
    pm.register('compliance_certifications', this.certifications);
    pm.register('compliance_security_badges', this.securityBadges);
    pm.register('compliance_provider_logos', this.providerLogos);
    pm.register('compliance_trust_messages', this.trustMessages);
    pm.register('compliance_trust_indicators', this.trustIndicators);
    pm.register('compliance_audit_logs', this.auditLogs);
  }

  // ===========================================================================
  // HOMEPAY TRUST DATA (aggregated for frontend)
  // ===========================================================================

  getHomepageTrustData(): HomepageTrustData {
    const allCompliance = this.getActiveCertifications();
    const pciBadge = allCompliance.find(c =>
      c.name.toLowerCase().includes('pci') && c.status === 'verified' && c.display_on_homepage
    );

    return {
      indicators: this.getActiveTrustIndicators(),
      compliance: allCompliance,
      security_badges: this.getActiveSecurityBadges(),
      provider_logos: this.getActiveProviderLogos(),
      trust_messages: this.getActiveTrustMessages(),
      pci_compliant: !!pciBadge,
      pci_badge: pciBadge,
      payment_security_notice: pciBadge
        ? ''
        : 'Payments are securely processed through PCI DSS compliant payment partners where applicable.'
    };
  }

  // ===========================================================================
  // COMPLIANCE CERTIFICATIONS CRUD
  // ===========================================================================

  createCertification(
    data: Omit<ComplianceCertification, 'id' | 'created_at' | 'updated_at'>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): ComplianceCertification {
    const cert: ComplianceCertification = {
      ...data,
      id: this.generateId('cert'),
      created_at: new Date(),
      updated_at: new Date()
    };

    this.certifications.set(cert.id, cert);
    this.dirty();
    this.logAudit('compliance', cert.id, 'create', adminId, {}, ipAddress, userAgent);
    return cert;
  }

  updateCertification(
    id: string,
    updates: Partial<ComplianceCertification>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): ComplianceCertification | null {
    const cert = this.certifications.get(id);
    if (!cert) return null;

    const changes: Record<string, { before: any; after: any }> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'created_at' && (cert as any)[key] !== value) {
        changes[key] = { before: (cert as any)[key], after: value };
      }
    }

    const updated = { ...cert, ...updates, updated_at: new Date() };
    this.certifications.set(id, updated);
    this.dirty();
    this.logAudit('compliance', id, 'update', adminId, changes, ipAddress, userAgent);
    return updated;
  }

  deleteCertification(
    id: string,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): boolean {
    const cert = this.certifications.get(id);
    if (!cert) return false;

    this.certifications.delete(id);
    this.dirty();
    this.logAudit('compliance', id, 'delete', adminId, { name: { before: cert.name, after: null } }, ipAddress, userAgent);
    return true;
  }

  getCertification(id: string): ComplianceCertification | undefined {
    return this.certifications.get(id);
  }

  getAllCertifications(): ComplianceCertification[] {
    return Array.from(this.certifications.values())
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  getActiveCertifications(): ComplianceCertification[] {
    return this.getAllCertifications().filter(c => c.display_on_homepage && c.status !== 'inactive');
  }

  // ===========================================================================
  // PCI DSS BADGE LOGIC
  // ===========================================================================

  isPCICompliant(): boolean {
    for (const cert of this.certifications.values()) {
      if (
        cert.name.toLowerCase().includes('pci') &&
        cert.status === 'verified' &&
        cert.display_on_homepage
      ) {
        return true;
      }
    }
    return false;
  }

  getPCIBadge(): ComplianceCertification | undefined {
    for (const cert of this.certifications.values()) {
      if (cert.name.toLowerCase().includes('pci') && cert.status === 'verified' && cert.display_on_homepage) {
        return cert;
      }
    }
    return undefined;
  }

  getPaymentSecurityNotice(): string {
    return this.isPCICompliant()
      ? ''
      : 'Payments are securely processed through PCI DSS compliant payment partners where applicable.';
  }

  // ===========================================================================
  // SECURITY BADGES CRUD
  // ===========================================================================

  createSecurityBadge(
    data: Omit<SecurityBadge, 'id' | 'created_at' | 'updated_at'>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): SecurityBadge {
    const badge: SecurityBadge = {
      ...data,
      id: this.generateId('badge'),
      created_at: new Date(),
      updated_at: new Date()
    };

    this.securityBadges.set(badge.id, badge);
    this.dirty();
    this.logAudit('badge', badge.id, 'create', adminId, {}, ipAddress, userAgent);
    return badge;
  }

  updateSecurityBadge(
    id: string,
    updates: Partial<SecurityBadge>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): SecurityBadge | null {
    const badge = this.securityBadges.get(id);
    if (!badge) return null;

    const changes: Record<string, { before: any; after: any }> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'created_at' && (badge as any)[key] !== value) {
        changes[key] = { before: (badge as any)[key], after: value };
      }
    }

    const updated = { ...badge, ...updates, updated_at: new Date() };
    this.securityBadges.set(id, updated);
    this.dirty();
    this.logAudit('badge', id, 'update', adminId, changes, ipAddress, userAgent);
    return updated;
  }

  deleteSecurityBadge(id: string, adminId: string, ipAddress?: string, userAgent?: string): boolean {
    const badge = this.securityBadges.get(id);
    if (!badge) return false;

    this.securityBadges.delete(id);
    this.dirty();
    this.logAudit('badge', id, 'delete', adminId, { name: { before: badge.name, after: null } }, ipAddress, userAgent);
    return true;
  }

  reorderSecurityBadge(id: string, newPriority: number, adminId: string): boolean {
    const badge = this.securityBadges.get(id);
    if (!badge) return false;

    badge.display_priority = newPriority;
    badge.updated_at = new Date();
    this.dirty();
    return true;
  }

  getActiveSecurityBadges(): SecurityBadge[] {
    return Array.from(this.securityBadges.values())
      .filter(b => b.status === 'active')
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  getAllSecurityBadges(): SecurityBadge[] {
    return Array.from(this.securityBadges.values())
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  // ===========================================================================
  // PROVIDER LOGOS CRUD
  // ===========================================================================

  createProviderLogo(
    data: Omit<ProviderLogo, 'id' | 'created_at' | 'updated_at'>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): ProviderLogo {
    const logo: ProviderLogo = {
      ...data,
      id: this.generateId('logo'),
      created_at: new Date(),
      updated_at: new Date()
    };

    this.providerLogos.set(logo.id, logo);
    this.dirty();
    this.logAudit('provider_logo', logo.id, 'create', adminId, {}, ipAddress, userAgent);
    return logo;
  }

  updateProviderLogo(
    id: string,
    updates: Partial<ProviderLogo>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): ProviderLogo | null {
    const logo = this.providerLogos.get(id);
    if (!logo) return null;

    const changes: Record<string, { before: any; after: any }> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'created_at' && (logo as any)[key] !== value) {
        changes[key] = { before: (logo as any)[key], after: value };
      }
    }

    const updated = { ...logo, ...updates, updated_at: new Date() };
    this.providerLogos.set(id, updated);
    this.dirty();
    this.logAudit('provider_logo', id, 'update', adminId, changes, ipAddress, userAgent);
    return updated;
  }

  deleteProviderLogo(id: string, adminId: string, ipAddress?: string, userAgent?: string): boolean {
    const logo = this.providerLogos.get(id);
    if (!logo) return false;

    this.providerLogos.delete(id);
    this.dirty();
    this.logAudit('provider_logo', id, 'delete', adminId, { provider_name: { before: logo.provider_name, after: null } }, ipAddress, userAgent);
    return true;
  }

  reorderProviderLogo(id: string, newPriority: number, adminId: string): boolean {
    const logo = this.providerLogos.get(id);
    if (!logo) return false;

    logo.display_priority = newPriority;
    logo.updated_at = new Date();
    this.dirty();
    return true;
  }

  getActiveProviderLogos(): ProviderLogo[] {
    return Array.from(this.providerLogos.values())
      .filter(l => l.status === 'active')
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  getAllProviderLogos(): ProviderLogo[] {
    return Array.from(this.providerLogos.values())
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  // ===========================================================================
  // TRUST MESSAGES CRUD
  // ===========================================================================

  createTrustMessage(
    data: Omit<TrustMessage, 'id' | 'created_at' | 'updated_at'>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): TrustMessage {
    const msg: TrustMessage = {
      ...data,
      id: this.generateId('msg'),
      created_at: new Date(),
      updated_at: new Date()
    };

    this.trustMessages.set(msg.id, msg);
    this.dirty();
    this.logAudit('trust_message', msg.id, 'create', adminId, {}, ipAddress, userAgent);
    return msg;
  }

  updateTrustMessage(
    id: string,
    updates: Partial<TrustMessage>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): TrustMessage | null {
    const msg = this.trustMessages.get(id);
    if (!msg) return null;

    const updated = { ...msg, ...updates, updated_at: new Date() };
    this.trustMessages.set(id, updated);
    this.dirty();
    return msg;
  }

  deleteTrustMessage(id: string, adminId: string, ipAddress?: string, userAgent?: string): boolean {
    const msg = this.trustMessages.get(id);
    if (!msg) return false;

    this.trustMessages.delete(id);
    this.dirty();
    return true;
  }

  getActiveTrustMessages(): TrustMessage[] {
    return Array.from(this.trustMessages.values())
      .filter(m => m.status === 'active')
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  // ===========================================================================
  // TRUST INDICATORS CRUD
  // ===========================================================================

  createTrustIndicator(
    data: Omit<TrustIndicator, 'id' | 'created_at' | 'updated_at'>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): TrustIndicator {
    const indicator: TrustIndicator = {
      ...data,
      id: this.generateId('indicator'),
      created_at: new Date(),
      updated_at: new Date()
    };

    this.trustIndicators.set(indicator.id, indicator);
    this.dirty();
    this.logAudit('trust_indicator', indicator.id, 'create', adminId, {}, ipAddress, userAgent);
    return indicator;
  }

  updateTrustIndicator(
    id: string,
    updates: Partial<TrustIndicator>,
    adminId: string,
    ipAddress?: string,
    userAgent?: string
  ): TrustIndicator | null {
    const indicator = this.trustIndicators.get(id);
    if (!indicator) return null;

    const updated = { ...indicator, ...updates, updated_at: new Date() };
    this.trustIndicators.set(id, updated);
    this.dirty();
    return indicator;
  }

  deleteTrustIndicator(id: string, adminId: string, ipAddress?: string, userAgent?: string): boolean {
    const indicator = this.trustIndicators.get(id);
    if (!indicator) return false;

    this.trustIndicators.delete(id);
    this.dirty();
    return true;
  }

  getActiveTrustIndicators(): TrustIndicator[] {
    return Array.from(this.trustIndicators.values())
      .filter(i => i.status === 'active')
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  getAllTrustIndicators(): TrustIndicator[] {
    return Array.from(this.trustIndicators.values())
      .sort((a, b) => a.display_priority - b.display_priority);
  }

  // ===========================================================================
  // AUDIT LOG
  // ===========================================================================

  getAuditLogs(filters?: {
    entity_type?: string;
    admin_id?: string;
    start_date?: Date;
    end_date?: Date;
    limit?: number;
    offset?: number;
  }): ComplianceAuditLog[] {
    let logs = Array.from(this.auditLogs.values());

    if (filters?.entity_type) {
      logs = logs.filter(l => l.entity_type === filters.entity_type);
    }
    if (filters?.admin_id) {
      logs = logs.filter(l => l.admin_id === filters.admin_id);
    }
    if (filters?.start_date) {
      logs = logs.filter(l => l.created_at >= filters.start_date!);
    }
    if (filters?.end_date) {
      logs = logs.filter(l => l.created_at <= filters.end_date!);
    }

    logs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;
    return logs.slice(offset, offset + limit);
  }

  private logAudit(
    entityType: string,
    entityId: string,
    action: 'create' | 'update' | 'delete',
    adminId: string,
    changes: Record<string, { before: any; after: any }>,
    ipAddress?: string,
    userAgent?: string
  ): void {
    const log: ComplianceAuditLog = {
      id: this.generateId('audit'),
      entity_type: entityType as any,
      entity_id: entityId,
      action,
      admin_id: adminId,
      changes,
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: new Date()
    };

    this.auditLogs.set(log.id, log);
  }

  // ===========================================================================
  // SEED DEFAULT DATA
  // ===========================================================================

  private seedDefaultData(): void {
    // Default trust indicators
    const defaultIndicators: Omit<TrustIndicator, 'id' | 'created_at' | 'updated_at'>[] = [
      { icon: 'shield', title: 'SSL/TLS Secured', description: 'All data transmitted between your browser and our servers is encrypted using industry-standard TLS.', display_priority: 1, status: 'active' },
      { icon: 'lock', title: 'End-to-End Encryption', description: 'Your sensitive financial data is encrypted from end to end using AES-256 encryption.', display_priority: 2, status: 'active' },
      { icon: 'key', title: 'Multi-Factor Authentication', description: 'We support MFA to add an extra layer of security to your account.', display_priority: 3, status: 'active' },
      { icon: 'eye', title: 'Fraud Detection', description: 'Our AI-powered fraud detection system monitors transactions in real-time.', display_priority: 4, status: 'active' },
      { icon: 'code', title: 'Secure API Infrastructure', description: 'Our APIs are built with security-first architecture and undergo regular penetration testing.', display_priority: 5, status: 'active' },
      { icon: 'id-card', title: 'KYC & AML Verification', description: 'We comply with Know Your Customer and Anti-Money Laundering regulations.', display_priority: 6, status: 'active' },
      { icon: 'clock', title: '24/7 Transaction Monitoring', description: 'Our systems monitor all transactions around the clock for suspicious activity.', display_priority: 7, status: 'active' },
      { icon: 'cloud', title: 'Secure Cloud Infrastructure', description: 'Your data is hosted on enterprise-grade cloud infrastructure with 99.99% uptime.', display_priority: 8, status: 'active' },
    ];

    for (const indicator of defaultIndicators) {
      this.createTrustIndicator(indicator, 'system');
    }

    // Default security badges
    const defaultBadges: Omit<SecurityBadge, 'id' | 'created_at' | 'updated_at'>[] = [
      { name: 'SSL Secured', description: 'TLS 1.3 encryption', icon: 'shield-check', status: 'active', display_priority: 1 },
      { name: 'AES-256 Encryption', description: 'Military-grade encryption', icon: 'lock-closed', status: 'active', display_priority: 2 },
      { name: 'Fraud Protection', description: 'AI-powered fraud detection', icon: 'shield-exclamation', status: 'active', display_priority: 3 },
      { name: 'Secure APIs', description: 'Penetration tested', icon: 'code-bracket', status: 'active', display_priority: 4 },
      { name: 'KYC Verified', description: 'Identity verification', icon: 'identification', status: 'active', display_priority: 5 },
      { name: 'AML Monitoring', description: 'Anti-money laundering', icon: 'magnifying-glass', status: 'active', display_priority: 6 },
      { name: 'Real-Time Risk Engine', description: 'Continuous risk assessment', icon: 'bolt', status: 'active', display_priority: 7 },
    ];

    for (const badge of defaultBadges) {
      this.createSecurityBadge(badge, 'system');
    }

    // Default provider logos
    const defaultProviders: Omit<ProviderLogo, 'id' | 'created_at' | 'updated_at'>[] = [
      { provider_name: 'mtn_momo', logo_url: '/logos/mtn-momo.svg', display_name: 'MTN MoMo', display_priority: 1, status: 'active' },
      { provider_name: 'airtel_money', logo_url: '/logos/airtel-money.svg', display_name: 'Airtel Money', display_priority: 2, status: 'active' },
      { provider_name: 'mpesa', logo_url: '/logos/mpesa.svg', display_name: 'M-Pesa', display_priority: 3, status: 'active' },
      { provider_name: 'paga', logo_url: '/logos/paga.svg', display_name: 'Paga', display_priority: 4, status: 'active' },
      { provider_name: 'paystack', logo_url: '/logos/paystack.svg', display_name: 'Paystack', display_priority: 5, status: 'active' },
      { provider_name: 'flutterwave', logo_url: '/logos/flutterwave.svg', display_name: 'Flutterwave', display_priority: 6, status: 'active' },
      { provider_name: 'fincra', logo_url: '/logos/fincra.svg', display_name: 'Fincra', display_priority: 7, status: 'active' },
      { provider_name: 'stripe', logo_url: '/logos/stripe.svg', display_name: 'Stripe', display_priority: 8, status: 'active' },
      { provider_name: 'remita', logo_url: '/logos/remita.svg', display_name: 'Remita', display_priority: 9, status: 'active' },
      { provider_name: 'quickteller', logo_url: '/logos/quickteller.svg', display_name: 'Quickteller', display_priority: 10, status: 'active' },
    ];

    for (const provider of defaultProviders) {
      this.createProviderLogo(provider, 'system');
    }

    // Default trust messages
    const defaultMessages: Omit<TrustMessage, 'id' | 'created_at' | 'updated_at'>[] = [
      { title: 'Your Money is Safe', message: 'TurboPay uses bank-grade security to protect your funds and personal information.', type: 'security', display_priority: 1, status: 'active' },
      { title: 'Regulated & Compliant', message: 'We operate in compliance with financial regulations across all supported countries.', type: 'compliance', display_priority: 2, status: 'active' },
    ];

    for (const msg of defaultMessages) {
      this.createTrustMessage(msg, 'system');
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

  private dirty(): void {
    this.persistence?.markDirty('compliance_certifications');
    this.persistence?.markDirty('compliance_security_badges');
    this.persistence?.markDirty('compliance_provider_logos');
    this.persistence?.markDirty('compliance_trust_messages');
    this.persistence?.markDirty('compliance_trust_indicators');
  }
}

export default ComplianceService;
