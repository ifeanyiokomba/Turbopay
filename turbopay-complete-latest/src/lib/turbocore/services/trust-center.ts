/**
 * TurboCore — Trust Center Service
 * =================================
 *
 * Central service for the Trust, Security & Compliance module.
 * All data comes from the database — nothing is hardcoded.
 *
 * Provides:
 * - Compliance certificate management
 * - Security badge management
 * - Provider logo management
 * - Trust message management
 * - Homepage trust data aggregation
 * - PCI DSS badge logic
 */

import { db } from "@/lib/db";
import { cache } from "@/lib/turbocore/cache";
import { audit } from "@/lib/turbopay/audit";

// ─── Cache Keys ─────────────────────────────────────────────

const CACHE_KEYS = {
  homepage: "trust:homepage",
  certificates: "trust:certificates",
  badges: "trust:badges",
  logos: "trust:logos",
  messages: "trust:messages",
} as const;

const CACHE_TTL = 300; // 5 minutes

// ─── Types ──────────────────────────────────────────────────

export interface ComplianceCertificateData {
  id: string;
  name: string;
  description: string | null;
  status: "PENDING" | "VERIFIED" | "EXPIRED" | "INACTIVE";
  logoUrl: string | null;
  verificationUrl: string | null;
  certificateNumber: string | null;
  dateIssued: Date | null;
  expiryDate: Date | null;
  displayOnHomepage: boolean;
  displayPriority: number;
  internalNotes: string | null;
}

export interface SecurityBadgeData {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  enabled: boolean;
  displayPriority: number;
}

export interface ProviderLogoData {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  category: string | null;
  enabled: boolean;
  displayPriority: number;
}

export interface TrustMessageData {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "success";
  enabled: boolean;
  displayPriority: number;
}

export interface HomepageTrustData {
  /** PCI DSS compliant (only if verified + display enabled) */
  pciDssCompliant: boolean;
  pciDssCertificate: ComplianceCertificateData | null;
  /** Fallback message when PCI DSS is not displayed */
  pciDssFallback: string;
  /** Active compliance certificates displayed on homepage */
  certificates: ComplianceCertificateData[];
  /** Enabled security badges */
  badges: SecurityBadgeData[];
  /** Enabled provider logos */
  logos: ProviderLogoData[];
  /** Enabled trust messages */
  messages: TrustMessageData[];
}

// ─── Trust Center Service ───────────────────────────────────

class TrustCenterServiceImpl {
  /**
   * Get homepage trust data (cached for 5 minutes).
   * This is the main data source for the homepage trust section.
   */
  async getHomepageData(): Promise<HomepageTrustData> {
    const cached = await cache.get<HomepageTrustData>(CACHE_KEYS.homepage);
    if (cached) return cached;

    // Fetch all data in parallel
    const [certificates, badges, logos, messages] = await Promise.all([
      this.getCertificates({ displayOnHomepage: true }),
      this.getBadges({ enabled: true }),
      this.getLogos({ enabled: true }),
      this.getMessages({ enabled: true }),
    ]);

    // PCI DSS logic: only show if status === VERIFIED && displayOnHomepage === true
    const pciCert = certificates.find(
      (c) => c.name.toLowerCase().includes("pci") && c.status === "VERIFIED" && c.displayOnHomepage
    );

    const data: HomepageTrustData = {
      pciDssCompliant: !!pciCert,
      pciDssCertificate: pciCert ?? null,
      pciDssFallback: "Payments are securely processed through PCI DSS compliant payment partners where applicable.",
      certificates: certificates.filter((c) => !c.name.toLowerCase().includes("pci")),
      badges,
      logos,
      messages,
    };

    await cache.set(CACHE_KEYS.homepage, data, CACHE_TTL);
    return data;
  }

  /**
   * Get all compliance certificates.
   */
  async getCertificates(filters?: { displayOnHomepage?: boolean; status?: string }): Promise<ComplianceCertificateData[]> {
    const where: any = {};
    if (filters?.displayOnHomepage !== undefined) where.displayOnHomepage = filters.displayOnHomepage;
    if (filters?.status) where.status = filters.status;

    return db.complianceCertificate.findMany({
      where,
      orderBy: { displayPriority: "asc" },
    }) as any;
  }

  /**
   * Get a single certificate by ID.
   */
  async getCertificate(id: string): Promise<ComplianceCertificateData | null> {
    return db.complianceCertificate.findUnique({ where: { id } }) as any;
  }

  /**
   * Create a compliance certificate.
   */
  async createCertificate(data: Omit<ComplianceCertificateData, "id" | "createdAt" | "updatedAt">, actor?: { id: string; name: string }): Promise<ComplianceCertificateData> {
    const cert = await db.complianceCertificate.create({ data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "COMPLIANCE_CERTIFICATE_CREATED", category: "ADMIN", metadata: { id: cert.id, name: cert.name } });
    return cert as any;
  }

  /**
   * Update a compliance certificate.
   */
  async updateCertificate(id: string, data: Partial<ComplianceCertificateData>, actor?: { id: string; name: string }): Promise<ComplianceCertificateData> {
    const old = await this.getCertificate(id);
    const cert = await db.complianceCertificate.update({ where: { id }, data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "COMPLIANCE_CERTIFICATE_UPDATED", category: "ADMIN", metadata: { id, old, new: cert } });
    return cert as any;
  }

  /**
   * Delete a compliance certificate.
   */
  async deleteCertificate(id: string, actor?: { id: string; name: string }): Promise<void> {
    const old = await this.getCertificate(id);
    await db.complianceCertificate.delete({ where: { id } });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "COMPLIANCE_CERTIFICATE_DELETED", category: "ADMIN", metadata: { id, deleted: old } });
  }

  // ─── Security Badges ──────────────────────────────────────

  async getBadges(filters?: { enabled?: boolean }): Promise<SecurityBadgeData[]> {
    const where: any = {};
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;
    return db.securityBadge.findMany({ where, orderBy: { displayPriority: "asc" } }) as any;
  }

  async getBadge(id: string): Promise<SecurityBadgeData | null> {
    return db.securityBadge.findUnique({ where: { id } }) as any;
  }

  async createBadge(data: Omit<SecurityBadgeData, "id" | "createdAt" | "updatedAt">, actor?: { id: string; name: string }): Promise<SecurityBadgeData> {
    const badge = await db.securityBadge.create({ data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "SECURITY_BADGE_CREATED", category: "ADMIN", metadata: { id: badge.id, name: badge.name } });
    return badge as any;
  }

  async updateBadge(id: string, data: Partial<SecurityBadgeData>, actor?: { id: string; name: string }): Promise<SecurityBadgeData> {
    const badge = await db.securityBadge.update({ where: { id }, data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "SECURITY_BADGE_UPDATED", category: "ADMIN", metadata: { id } });
    return badge as any;
  }

  async deleteBadge(id: string, actor?: { id: string; name: string }): Promise<void> {
    await db.securityBadge.delete({ where: { id } });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "SECURITY_BADGE_DELETED", category: "ADMIN", metadata: { id } });
  }

  // ─── Provider Logos ───────────────────────────────────────

  async getLogos(filters?: { enabled?: boolean; category?: string }): Promise<ProviderLogoData[]> {
    const where: any = {};
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;
    if (filters?.category) where.category = filters.category;
    return db.providerLogo.findMany({ where, orderBy: { displayPriority: "asc" } }) as any;
  }

  async getLogo(id: string): Promise<ProviderLogoData | null> {
    return db.providerLogo.findUnique({ where: { id } }) as any;
  }

  async createLogo(data: Omit<ProviderLogoData, "id" | "createdAt" | "updatedAt">, actor?: { id: string; name: string }): Promise<ProviderLogoData> {
    const logo = await db.providerLogo.create({ data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "PROVIDER_LOGO_CREATED", category: "ADMIN", metadata: { id: logo.id, name: logo.name } });
    return logo as any;
  }

  async updateLogo(id: string, data: Partial<ProviderLogoData>, actor?: { id: string; name: string }): Promise<ProviderLogoData> {
    const logo = await db.providerLogo.update({ where: { id }, data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "PROVIDER_LOGO_UPDATED", category: "ADMIN", metadata: { id } });
    return logo as any;
  }

  async deleteLogo(id: string, actor?: { id: string; name: string }): Promise<void> {
    await db.providerLogo.delete({ where: { id } });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "PROVIDER_LOGO_DELETED", category: "ADMIN", metadata: { id } });
  }

  // ─── Trust Messages ───────────────────────────────────────

  async getMessages(filters?: { enabled?: boolean }): Promise<TrustMessageData[]> {
    const where: any = {};
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;
    return db.trustMessage.findMany({ where, orderBy: { displayPriority: "asc" } }) as any;
  }

  async getMessage(id: string): Promise<TrustMessageData | null> {
    return db.trustMessage.findUnique({ where: { id } }) as any;
  }

  async createMessage(data: Omit<TrustMessageData, "id" | "createdAt" | "updatedAt">, actor?: { id: string; name: string }): Promise<TrustMessageData> {
    const msg = await db.trustMessage.create({ data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "TRUST_MESSAGE_CREATED", category: "ADMIN", metadata: { id: msg.id, title: msg.title } });
    return msg as any;
  }

  async updateMessage(id: string, data: Partial<TrustMessageData>, actor?: { id: string; name: string }): Promise<TrustMessageData> {
    const msg = await db.trustMessage.update({ where: { id }, data });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "TRUST_MESSAGE_UPDATED", category: "ADMIN", metadata: { id } });
    return msg as any;
  }

  async deleteMessage(id: string, actor?: { id: string; name: string }): Promise<void> {
    await db.trustMessage.delete({ where: { id } });
    await this.invalidateCache();
    await audit({ userId: actor?.id, action: "TRUST_MESSAGE_DELETED", category: "ADMIN", metadata: { id } });
  }

  // ─── Cache ────────────────────────────────────────────────

  async invalidateCache(): Promise<void> {
    await Promise.all([
      cache.del(CACHE_KEYS.homepage),
      cache.del(CACHE_KEYS.certificates),
      cache.del(CACHE_KEYS.badges),
      cache.del(CACHE_KEYS.logos),
      cache.del(CACHE_KEYS.messages),
    ]);
  }
}

/** Singleton trust center service. */
export const trustCenter = new TrustCenterServiceImpl();
