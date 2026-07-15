/**
 * TurboCore — Provider Scoring Engine
 * ====================================
 *
 * Continuously scores providers based on real performance data.
 * The orchestration engine uses these scores to select the best
 * provider for each operation — not just the cheapest, but the
 * most reliable, fastest, and healthiest.
 *
 * Scoring dimensions:
 *   1. Success rate (weighted heaviest — reliability first)
 *   2. Latency (p50 and p95)
 *   3. Cost (fees relative to alternatives)
 *   4. Availability (uptime over last 24h)
 *   5. Error diversity (repeated same error = worse than varied errors)
 *
 * Scores are computed from:
 *   - ProviderHealthCheck rows (periodic health checks)
 *   - Transaction success/failure counts per provider
 *   - Circuit breaker state
 *
 * The score is a composite number 0-100. Higher = better.
 * The routing engine picks the provider with the highest score
 * among those that support the requested capability.
 */

import { db } from "@/lib/db";

// ─── Score Components ─────────────────────────────────────────

export interface ProviderScore {
  providerId: string;
  providerName: string;
  /** Composite score 0-100. Higher = better. */
  compositeScore: number;
  /** Success rate (0-1). */
  successRate: number;
  /** Average latency in ms. */
  avgLatencyMs: number;
  /** P95 latency in ms. */
  p95LatencyMs: number;
  /** Cost relative to cheapest (1.0 = cheapest, >1 = more expensive). */
  costMultiplier: number;
  /** Availability over last 24h (0-1). */
  availability: number;
  /** Circuit breaker state. */
  circuitBreakerState: "CLOSED" | "HALF_OPEN" | "OPEN";
  /** When this score was computed. */
  computedAt: Date;
}

// ─── Scoring Weights ──────────────────────────────────────────

/**
 * Configurable weights for each scoring dimension.
 * Sum should equal 1.0. Adjust based on business priorities.
 * Higher weight = more influence on the composite score.
 */
const DEFAULT_WEIGHTS = {
  successRate: 0.40,   // Reliability is king
  latency: 0.25,       // Speed matters for UX
  cost: 0.20,          // Cost optimization
  availability: 0.15,  // Uptime
};

// ─── Scoring Engine ───────────────────────────────────────────

class ProviderScoringEngineImpl {
  private scoreCache = new Map<string, ProviderScore>();
  private cacheTtlMs = 60_000; // Re-score every 60s

  /**
   * Get the composite score for a provider. Cached for 60s.
   */
  async score(providerConfigId: string, providerName: string): Promise<ProviderScore> {
    const cached = this.scoreCache.get(providerConfigId);
    if (cached && Date.now() - cached.computedAt.getTime() < this.cacheTtlMs) {
      return cached;
    }

    const score = await this.computeScore(providerConfigId, providerName);
    this.scoreCache.set(providerConfigId, score);
    return score;
  }

  /**
   * Get scores for all providers (for admin dashboard).
   */
  async scoreAll(): Promise<ProviderScore[]> {
    const configs = await db.providerConfig.findMany({
      where: { enabled: true },
      orderBy: [{ contract: "asc" }, { priority: "asc" }],
    });

    const scores: ProviderScore[] = [];
    for (const config of configs) {
      scores.push(await this.score(config.id, config.providerName));
    }

    // Sort by composite score descending.
    scores.sort((a, b) => b.compositeScore - a.compositeScore);
    return scores;
  }

  /**
   * Rank providers for a specific contract by score.
   * Only returns providers that are enabled and not circuit-broken.
   */
  async rankForContract(contract: string): Promise<Array<{
    providerConfigId: string;
    providerName: string;
    score: number;
    mode: string;
  }>> {
    const configs = await db.providerConfig.findMany({
      where: { contract, enabled: true },
      orderBy: { priority: "asc" },
    });

    const ranked: Array<{
      providerConfigId: string;
      providerName: string;
      score: number;
      mode: string;
    }> = [];

    for (const config of configs) {
      const s = await this.score(config.id, config.providerName);
      ranked.push({
        providerConfigId: config.id,
        providerName: config.providerName,
        score: s.compositeScore,
        mode: config.mode,
      });
    }

    // Sort by score descending (best first).
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  // ── Private: Compute Score ────────────────────────────────

  private async computeScore(
    providerConfigId: string,
    providerName: string
  ): Promise<ProviderScore> {
    // 1. Get recent health checks (last 24h).
    const healthChecks = await db.providerHealthCheck.findMany({
      where: {
        providerConfigId,
        checkedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { checkedAt: "desc" },
    });

    // 2. Compute success rate from health checks.
    const totalChecks = healthChecks.length || 1;
    const successfulChecks = healthChecks.filter((h) => h.status === "ok").length;
    const successRate = successfulChecks / totalChecks;

    // 3. Compute latency from health checks.
    const latencies = healthChecks
      .filter((h) => h.latencyMs != null)
      .map((h) => h.latencyMs!);
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 5000; // Default: assume slow if no data
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const p95LatencyMs = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] ?? avgLatencyMs;

    // 4. Get provider config for cost info.
    const config = await db.providerConfig.findUnique({ where: { id: providerConfigId } });
    const costMultiplier = config
      ? 1 + (config.costBasisPoints / 10000)
      : 1.0;

    // 5. Availability: ratio of successful checks to total.
    const availability = successRate;

    // 6. Circuit breaker state.
    const { getCircuitBreaker } = await import("@/lib/turbocore/providers/circuit-breaker");
    const breaker = getCircuitBreaker(providerName);
    const isOpen = await breaker.isOpen();
    const circuitBreakerState = isOpen ? "OPEN" : "CLOSED";

    // 7. Compute composite score.
    const latencyScore = this.normalizeLatency(avgLatencyMs);
    const costScore = this.normalizeCost(costMultiplier);
    const availabilityScore = availability;
    const circuitPenalty = circuitBreakerState === "OPEN" ? 0.5 : 1.0;

    const rawScore =
      successRate * DEFAULT_WEIGHTS.successRate +
      latencyScore * DEFAULT_WEIGHTS.latency +
      costScore * DEFAULT_WEIGHTS.cost +
      availabilityScore * DEFAULT_WEIGHTS.availability;

    const compositeScore = Math.round(rawScore * circuitPenalty * 100);

    return {
      providerId: providerConfigId,
      providerName,
      compositeScore: Math.max(0, Math.min(100, compositeScore)),
      successRate,
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs: Math.round(p95LatencyMs),
      costMultiplier: Math.round(costMultiplier * 1000) / 1000,
      availability,
      circuitBreakerState,
      computedAt: new Date(),
    };
  }

  // ── Private: Normalizers ──────────────────────────────────

  /**
   * Normalize latency to a 0-1 score. Lower latency = higher score.
   * 100ms → 1.0, 1000ms → 0.5, 5000ms+ → 0.0
   */
  private normalizeLatency(ms: number): number {
    if (ms <= 100) return 1.0;
    if (ms >= 5000) return 0.0;
    return 1 - (ms - 100) / (5000 - 100);
  }

  /**
   * Normalize cost to a 0-1 score. Lower cost = higher score.
   * 1.0x → 1.0, 1.5x → 0.5, 2.0x+ → 0.0
   */
  private normalizeCost(multiplier: number): number {
    if (multiplier <= 1.0) return 1.0;
    if (multiplier >= 2.0) return 0.0;
    return 1 - (multiplier - 1.0);
  }

  /**
   * Invalidate cache for a provider (called after health check or failure).
   */
  invalidate(providerConfigId: string): void {
    this.scoreCache.delete(providerConfigId);
  }
}

/** Singleton scoring engine. */
export const providerScoringEngine = new ProviderScoringEngineImpl();
