/**
 * Encrypted provider config storage — credentials AES-256-GCM encrypted, masked in UI.
 *
 * Includes a short-lived in-memory cache for decrypted credentials so the
 * adapter factory doesn't hit the DB + run AES-GCM decryption on every single
 * outbound provider call. The cache is invalidated on every write (create /
 * update / delete) for the affected config id, and entries expire after
 * `CRED_CACHE_TTL_MS` regardless, so a stale value can never live longer than
 * one minute even if an invalidation is somehow missed.
 */
import { db } from "@/lib/db";
import { encryptPii, decryptPii } from "@/lib/turbopay/crypto";
import { audit } from "@/lib/turbopay/audit";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";
import { URL } from "node:url";

/** TTL for the decrypted-credentials cache. Short enough to pick up admin
 * edits within a minute, long enough to avoid DB+decrypt on every provider call. */
const CRED_CACHE_TTL_MS = 60 * 1000;

interface CachedCred {
  value: Record<string, string> | null;
  expiresAt: number;
}

export interface ProviderConfigInput {
  contract: string; providerName: string; displayName: string;
  mode?: "mock" | "sandbox" | "production";
  credentials?: Record<string, string>;
  config?: Record<string, unknown>;
  priority?: number; enabled?: boolean;
  healthCheckUrl?: string | null; healthCheckIntervalSec?: number;
  costBasisPoints?: number;
  expiresAt?: Date | string | null;
}

export interface ProviderConfigView {
  id: string; contract: string; providerName: string; displayName: string; mode: string;
  credentialsConfigured: boolean; credentialKeys: string[];
  config: Record<string, unknown> | null;
  priority: number; enabled: boolean;
  costBasisPoints: number;
  healthCheckUrl: string | null; healthCheckIntervalSec: number;
  lastHealthStatus: string | null; lastHealthLatencyMs: number | null; lastHealthCheckAt: string | null;
  createdAt: string; updatedAt: string;
}

/** SSRF protection — block private/internal IPs for health check URLs. */
const BLOCKED_HOSTNAMES = [
  /^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^0\.0\.0\.0$/,
];
export function assertSafeHealthCheckUrl(raw: string): void {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Only HTTP/HTTPS allowed for health checks");
  if (BLOCKED_HOSTNAMES.some((r) => r.test(parsed.hostname))) {
    throw new Error("Private/internal URLs are not allowed for health checks");
  }
}

class ProviderConfigService {
  /** Decrypted-credentials cache: configId → { value, expiresAt }. */
  private credCache = new Map<string, CachedCred>();

  /** Invalidate the cached credentials for a single config id. */
  private invalidateCredCache(id: string): void {
    this.credCache.delete(id);
  }

  /** Flush the entire credential cache (e.g. on bulk operations / tests). */
  clearCache(): void {
    this.credCache.clear();
  }

  async create(input: ProviderConfigInput, actor?: { id: string; name: string }): Promise<ProviderConfigView> {
    if (input.healthCheckUrl) assertSafeHealthCheckUrl(input.healthCheckUrl);
    const credentialsEnc = input.credentials ? encryptPii(JSON.stringify(input.credentials)) : null;
    const credentialKeys = input.credentials ? JSON.stringify(Object.keys(input.credentials)) : null;
    const created = await db.providerConfig.create({
      data: {
        contract: input.contract, providerName: input.providerName, displayName: input.displayName,
        mode: input.mode ?? "mock", credentialsEnc, credentialKeys,
        config: input.config ? JSON.stringify(input.config) : null,
        priority: input.priority ?? 100, enabled: input.enabled ?? true,
        healthCheckUrl: input.healthCheckUrl ?? null, healthCheckIntervalSec: input.healthCheckIntervalSec ?? 300,
        costBasisPoints: input.costBasisPoints ?? 0,
      },
    });
    this.invalidateCredCache(created.id);
    await recordConfigVersion("providerConfig", created.id, "CREATE", null, { ...created, credentialsEnc: created.credentialsEnc ? "[REDACTED]" : null }, undefined, actor);
    await audit({ userId: actor?.id, action: "PROVIDER_CONFIG_CREATED", category: "ADMIN", severity: "INFO", metadata: { contract: input.contract, providerName: input.providerName } });
    return this.toView(created);
  }

  async update(id: string, input: Partial<ProviderConfigInput>, actor?: { id: string; name: string }): Promise<ProviderConfigView> {
    const existing = await db.providerConfig.findUnique({ where: { id } });
    if (!existing) throw new Error("Provider config not found");
    if (input.healthCheckUrl) assertSafeHealthCheckUrl(input.healthCheckUrl);
    const data: Record<string, unknown> = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.mode !== undefined) data.mode = input.mode;
    if (input.credentials !== undefined) {
      // Retain the old encrypted credentials in a version row before overwriting.
      if (existing.credentialsEnc) {
        await db.providerCredentialVersion.create({
          data: {
            providerConfigId: id,
            credentialsEnc: existing.credentialsEnc,
            credentialKeys: existing.credentialKeys ?? "[]",
            changedBy: actor?.id ?? null,
            changedByName: actor?.name ?? null,
          },
        });
      }
      data.credentialsEnc = encryptPii(JSON.stringify(input.credentials));
      data.credentialKeys = JSON.stringify(Object.keys(input.credentials));
    }
    if (input.config !== undefined) data.config = JSON.stringify(input.config);
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.healthCheckUrl !== undefined) data.healthCheckUrl = input.healthCheckUrl;
    if (input.healthCheckIntervalSec !== undefined) data.healthCheckIntervalSec = input.healthCheckIntervalSec;
    if (input.costBasisPoints !== undefined) data.costBasisPoints = input.costBasisPoints;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    const updated = await db.providerConfig.update({ where: { id }, data });
    this.invalidateCredCache(id);
    await recordConfigVersion("providerConfig", id, "UPDATE", { ...existing, credentialsEnc: existing.credentialsEnc ? "[REDACTED]" : null }, { ...updated, credentialsEnc: updated.credentialsEnc ? "[REDACTED]" : null }, undefined, actor);
    await audit({ userId: actor?.id, action: "PROVIDER_CONFIG_UPDATED", category: "ADMIN", severity: "INFO", metadata: { id, contract: existing.contract, providerName: existing.providerName } });
    return this.toView(updated);
  }

  async delete(id: string, actor?: { id: string; name: string }): Promise<void> {
    const existing = await db.providerConfig.findUnique({ where: { id } });
    if (!existing) throw new Error("Provider config not found");
    await db.providerConfig.delete({ where: { id } });
    this.invalidateCredCache(id);
    await recordConfigVersion("providerConfig", id, "DELETE", { ...existing, credentialsEnc: "[REDACTED]" }, null, undefined, actor);
    await audit({ userId: actor?.id, action: "PROVIDER_CONFIG_DELETED", category: "ADMIN", severity: "WARN", metadata: { id, contract: existing.contract, providerName: existing.providerName } });
  }

  async list(contract?: string): Promise<ProviderConfigView[]> {
    const configs = await db.providerConfig.findMany({ where: contract ? { contract } : undefined, orderBy: [{ contract: "asc" }, { priority: "asc" }] });
    return configs.map((c) => this.toView(c));
  }

  async get(id: string): Promise<ProviderConfigView | null> {
    const config = await db.providerConfig.findUnique({ where: { id } });
    return config ? this.toView(config) : null;
  }

  async getDecryptedCredentials(id: string): Promise<Record<string, string> | null> {
    // 1. Check the in-memory cache first.
    const cached = this.credCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    // 2. Cache miss / expired — read from DB + decrypt.
    const config = await db.providerConfig.findUnique({ where: { id }, select: { credentialsEnc: true } });
    if (!config?.credentialsEnc) {
      // Cache the null too so we don't repeatedly hit the DB for configs with no creds.
      this.credCache.set(id, { value: null, expiresAt: Date.now() + CRED_CACHE_TTL_MS });
      return null;
    }
    try {
      const value = JSON.parse(decryptPii(config.credentialsEnc));
      this.credCache.set(id, { value, expiresAt: Date.now() + CRED_CACHE_TTL_MS });
      return value;
    } catch {
      return null;
    }
  }

  /** toView — reads credentialKeys from the dedicated column (no decryption needed). */
  private toView(c: any): ProviderConfigView {
    return {
      id: c.id, contract: c.contract, providerName: c.providerName, displayName: c.displayName, mode: c.mode,
      credentialsConfigured: !!c.credentialsEnc,
      credentialKeys: c.credentialKeys ? JSON.parse(c.credentialKeys) : [],
      config: c.config ? JSON.parse(c.config) : null,
      priority: c.priority, enabled: c.enabled,
      costBasisPoints: c.costBasisPoints ?? 0,
      healthCheckUrl: c.healthCheckUrl, healthCheckIntervalSec: c.healthCheckIntervalSec,
      lastHealthStatus: c.lastHealthStatus, lastHealthLatencyMs: c.lastHealthLatencyMs,
      lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    };
  }
}

export const providerConfig = new ProviderConfigService();
