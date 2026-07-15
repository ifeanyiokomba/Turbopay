/**
 * TurboCore — Feature Flags
 * ==========================
 *
 * DB-backed feature flags with per-user override + percentage rollout +
 * country/group targeting. Product-scoped (e.g. "billswift.bulk", "turbopay.intl").
 *
 * Usage:
 *   if (await features.isEnabled("billswift.bulk", userId)) { ... }
 *   if (await features.isEnabled("turbopay.intl", userId, { country: "NG" })) { ... }
 */

import { db } from "@/lib/db";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";
import * as crypto from "node:crypto";

interface FeatureFlagContext {
  /** ISO 3166-1 alpha-2 country code (e.g. "NG", "GH", "US"). */
  country?: string;
  /** User group (e.g. "beta", "internal", "merchant"). */
  userGroup?: string;
}

class FeatureFlagService {
  async isEnabled(key: string, userId?: string, ctx?: FeatureFlagContext): Promise<boolean> {
    const flag = await db.featureFlag.findUnique({ where: { key }, include: { overrides: true } });
    if (!flag) return false;
    if (!flag.enabled) return false;

    // Per-user override takes precedence.
    if (userId) {
      const override = flag.overrides.find((o) => o.userId === userId);
      if (override) return override.enabled;
    }

    // Country targeting — stored in metadata as JSON.
    // If the flag has a countries list and the user's country is not in it, deny.
    if (ctx?.country) {
      const metadata = parseMetadata(flag.metadata);
      if (Array.isArray(metadata.countries) && metadata.countries.length > 0) {
        if (!metadata.countries.includes(ctx.country)) return false;
      }
    }

    // User group targeting — stored in metadata as JSON.
    if (ctx?.userGroup) {
      const metadata = parseMetadata(flag.metadata);
      if (Array.isArray(metadata.userGroups) && metadata.userGroups.length > 0) {
        if (!metadata.userGroups.includes(ctx.userGroup)) return false;
      }
    }

    // Percentage rollout (deterministic per user if provided).
    if (flag.rollout >= 100) return true;
    if (flag.rollout <= 0) return false;
    if (!userId) return false;
    const hash = rolloutHash(userId + key);
    return hash < flag.rollout;
  }

  async setFlag(key: string, enabled: boolean, opts?: { description?: string; rollout?: number; product?: string; metadata?: Record<string, unknown> }, actor?: { id: string; name: string }) {
    const existing = await db.featureFlag.findUnique({ where: { key } }).catch(() => null);
    const metadata = opts?.metadata ? JSON.stringify(opts.metadata) : existing?.metadata ?? undefined;
    const result = await db.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description: opts?.description, rollout: opts?.rollout ?? (enabled ? 100 : 0), product: opts?.product, metadata },
      update: {
        enabled,
        ...(opts?.description !== undefined ? { description: opts.description } : {}),
        ...(opts?.rollout !== undefined ? { rollout: opts.rollout } : {}),
        ...(opts?.product !== undefined ? { product: opts.product } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });
    await recordConfigVersion("featureFlag", result.id, existing ? "UPDATE" : "CREATE", existing, result, undefined, actor);
    return result;
  }

  async setOverride(key: string, userId: string, enabled: boolean) {
    const flag = await db.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new Error("Flag not found");
    return db.featureFlagOverride.upsert({
      where: { flagId_userId: { flagId: flag.id, userId } },
      create: { flagId: flag.id, userId, enabled },
      update: { enabled },
    });
  }

  async list() {
    return db.featureFlag.findMany({ include: { overrides: true }, orderBy: { key: "asc" } });
  }
}

/** Parse a JSON metadata string safely. */
function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Cryptographically uniform hash for percentage rollout.
 *  Uses SHA-256 and reads 4 bytes as a uint32 for a uniform [0, 100) range.
 *  This ensures a 10% rollout actually reaches ~10% of users, not 5% or 15%. */
function rolloutHash(s: string): number {
  const hash = crypto.createHash("sha256").update(s).digest();
  return hash.readUInt32BE(0) % 100;
}

export const features = new FeatureFlagService();
