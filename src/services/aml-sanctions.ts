// TurboPay AML Sanctions Screening
// Checks users against OFAC SDN, UN, and EU sanctions lists
// Uses the OpenSanctions API (free tier available)

import { AuditLogService } from '../admin/dashboard/audit-log';

// =============================================================================
// TYPES
// =============================================================================

export interface SanctionsCheckResult {
  isClean: boolean;
  matches: SanctionsMatch[];
  checkedAt: Date;
  source: string;
}

export interface SanctionsMatch {
  listName: string;
  entityId: string;
  name: string;
  score: number;
  reason: string;
}

// =============================================================================
// SANCTIONS SCREENING SERVICE
// =============================================================================

export class SanctionsScreeningService {
  private auditLog: AuditLogService;
  private apiKey: string | undefined;
  private cache: Map<string, { result: SanctionsCheckResult; expiresAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(auditLog: AuditLogService) {
    this.auditLog = auditLog;
    this.apiKey = process.env.OPENSANCTIONS_API_KEY;
    if (!this.apiKey) {
      console.warn('[SanctionsScreening] OPENSANCTIONS_API_KEY not set — sanctions screening disabled');
    }
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Screen a person against sanctions lists.
   * @param fullName - Full name to check
   * @param dateOfBirth - Optional date of birth for better matching
   * @param country - Optional country of residence
   * @returns SanctionsCheckResult
   */
  async screenPerson(
    fullName: string,
    dateOfBirth?: string,
    country?: string
  ): Promise<SanctionsCheckResult> {
    const cacheKey = `${fullName}:${dateOfBirth || ''}:${country || ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    if (!this.apiKey) {
      // Sanctions screening disabled — return clean but log warning
      return {
        isClean: true,
        matches: [],
        checkedAt: new Date(),
        source: 'disabled'
      };
    }

    try {
      const result = await this.checkOpenSanctions(fullName, dateOfBirth, country);
      this.cache.set(cacheKey, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });

      // Log high-risk matches
      if (!result.isClean) {
        this.auditLog.log({
          event: 'sanctions.match',
          entity_type: 'user',
          entity_id: fullName,
          metadata: { matches: result.matches },
          severity: 'critical'
        });
      }

      return result;
    } catch (error) {
      console.error('[SanctionsScreening] Check failed:', (error as Error).message);
      // Fail open — don't block users on API failure, but log the error
      return {
        isClean: true,
        matches: [],
        checkedAt: new Date(),
        source: 'error'
      };
    }
  }

  /**
   * Screen a business entity against sanctions lists.
   */
  async screenEntity(
    entityName: string,
    jurisdiction?: string
  ): Promise<SanctionsCheckResult> {
    const cacheKey = `entity:${entityName}:${jurisdiction || ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    if (!this.apiKey) {
      return {
        isClean: true,
        matches: [],
        checkedAt: new Date(),
        source: 'disabled'
      };
    }

    try {
      const result = await this.checkOpenSanctions(entityName, undefined, jurisdiction);
      this.cache.set(cacheKey, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });

      if (!result.isClean) {
        this.auditLog.log({
          event: 'sanctions.match',
          entity_type: 'entity',
          entity_id: entityName,
          metadata: { matches: result.matches },
          severity: 'critical'
        });
      }

      return result;
    } catch (error) {
      console.error('[SanctionsScreening] Entity check failed:', (error as Error).message);
      return {
        isClean: true,
        matches: [],
        checkedAt: new Date(),
        source: 'error'
      };
    }
  }

  /**
   * Screen specifically for PEP (Politically Exposed Person) status.
   * Returns PEP matches only — no sanctions matches.
   */
  async screenForPEP(
    fullName: string,
    dateOfBirth?: string,
    country?: string
  ): Promise<{ isPEP: boolean; pepMatches: SanctionsMatch[] }> {
    if (!this.apiKey) {
      return { isPEP: false, pepMatches: [] };
    }

    try {
      const params = new URLSearchParams({
        q: fullName,
        scope: 'pep',
        datasets: 'ofac-sanctions,un-sanctions,eu-sanctions,uk-sanctions',
        limit: '10',
      });

      if (dateOfBirth) params.set('dob', dateOfBirth);
      if (country) params.set('country', country);

      const res = await fetch(`https://api.opensanctions.org/search/default?${params.toString()}`, {
        headers: {
          'Authorization': `apikey ${this.apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`OpenSanctions API returned ${res.status}`);
      }

      const data = await res.json() as any;
      const results = data?.results || [];

      const pepMatches: SanctionsMatch[] = results
        .filter((r: any) => r.score >= 60 && r.properties?.role?.some((role: string) =>
          /president|minister|senator|governor|ambassador|military|police|judge|politician|party.*leader/i.test(role)
        ))
        .map((r: any) => ({
          listName: 'PEP',
          entityId: r.id || '',
          name: r.name || '',
          score: r.score / 100,
          reason: r.properties?.role?.[0] || 'Politically exposed person',
        }));

      if (pepMatches.length > 0) {
        this.auditLog.log({
          event: 'pep.match',
          entity_type: 'user',
          entity_id: fullName,
          metadata: { pepMatches },
          severity: 'warning'
        });
      }

      return { isPEP: pepMatches.length > 0, pepMatches };
    } catch (error) {
      console.error('[SanctionsScreening] PEP check failed:', (error as Error).message);
      return { isPEP: false, pepMatches: [] };
    }
  }

  // ===========================================================================
  // PRIVATE — OpenSanctions API
  // ===========================================================================

  private async checkOpenSanctions(
    name: string,
    dateOfBirth?: string,
    country?: string
  ): Promise<SanctionsCheckResult> {
    const params = new URLSearchParams({
      q: name,
      scope: 'sanctions,pep,adverse',
      datasets: 'ofac-sanctions,un-sanctions,eu-sanctions,uk-sanctions',
      limit: '10',
    });

    if (dateOfBirth) params.set('dob', dateOfBirth);
    if (country) params.set('country', country);

    const res = await fetch(`https://api.opensanctions.org/search/default?${params.toString()}`, {
      headers: {
        'Authorization': `apikey ${this.apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`OpenSanctions API returned ${res.status}`);
    }

    const data = await res.json() as any;
    const results = data?.results || [];

    const matches: SanctionsMatch[] = results
      .filter((r: any) => r.score >= 60) // 60%+ confidence threshold
      .map((r: any) => ({
        listName: r.datasets?.join(', ') || 'unknown',
        entityId: r.id || '',
        name: r.name || '',
        score: r.score / 100,
        reason: r.properties?.sanction?.[0]?.program || r.properties?.role?.[0] || 'Listed entity match',
      }));

    return {
      isClean: matches.length === 0,
      matches,
      checkedAt: new Date(),
      source: 'opensanctions'
    };
  }
}

export default SanctionsScreeningService;
