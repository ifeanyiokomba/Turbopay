/**
 * Routing weights configuration — DB-backed with fallback to hardcoded defaults.
 *
 * Stores weight configurations in the ConfigVersion table (reuse of existing
 * versioning primitive). Falls back to hardcoded defaults when no DB row exists,
 * preserving identical behavior to today until an admin changes a weight.
 */

import { recordConfigVersion, getConfigHistory } from "@/lib/turbocore/config/versioning";
import type { ConfigVersionActor } from "@/lib/turbocore/config/versioning";

/** Hardcoded defaults — used when no DB config exists. */
const HARDCODED_DEFAULTS: Record<string, Record<string, number>> = {
  local: { fee: 0.25, latency: 0.20, settlementSpeed: 0.15, capacity: 0.10, successRate: 0.30 },
  fx: { fee: 0.15, fx: 0.35, latency: 0.15, settlementSpeed: 0.10, capacity: 0.05, successRate: 0.20 },
};

/** In-memory cache with 60s TTL to avoid DB hit on every routing decision. */
let cache: { weights: Record<string, Record<string, number>>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Get the current routing weights for a rule-set ("local" or "fx").
 * Returns DB-stored weights if available, otherwise hardcoded defaults.
 */
export async function getRoutingWeights(ruleSet: string): Promise<Record<string, number>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.weights[ruleSet] ?? HARDCODED_DEFAULTS[ruleSet] ?? {};
  }

  // Load both rule-sets from ConfigVersion (latest version each).
  const [localHistory, fxHistory] = await Promise.all([
    getConfigHistory("routingWeights", "local", 1),
    getConfigHistory("routingWeights", "fx", 1),
  ]);

  const weights: Record<string, Record<string, number>> = { ...HARDCODED_DEFAULTS };

  if (localHistory.length > 0 && localHistory[0].after) {
    try { weights.local = { ...weights.local, ...JSON.parse(localHistory[0].after) }; } catch { /* ignore */ }
  }
  if (fxHistory.length > 0 && fxHistory[0].after) {
    try { weights.fx = { ...weights.fx, ...JSON.parse(fxHistory[0].after) }; } catch { /* ignore */ }
  }

  cache = { weights, expiresAt: now + CACHE_TTL_MS };
  return weights[ruleSet] ?? HARDCODED_DEFAULTS[ruleSet] ?? {};
}

/**
 * Update routing weights for a rule-set. Records the change in ConfigVersion
 * for audit trail and rollback capability.
 */
export async function updateRoutingWeights(
  ruleSet: string,
  newWeights: Record<string, number>,
  actor?: ConfigVersionActor,
): Promise<void> {
  const before = HARDCODED_DEFAULTS[ruleSet] ?? {};
  await recordConfigVersion("routingWeights", ruleSet, "UPDATE", before, newWeights, undefined, actor);
  // Invalidate cache so next read picks up the new values.
  cache = null;
}

/** Clear the in-memory cache (useful for tests). */
export function clearRoutingWeightsCache(): void {
  cache = null;
}
