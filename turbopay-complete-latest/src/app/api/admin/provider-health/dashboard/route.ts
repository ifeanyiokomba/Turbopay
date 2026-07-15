import { requireAdmin } from "@/lib/turbopay/auth";
import { errorJson, json } from "@/lib/turbopay/api";
import { db } from "@/lib/db";
import { listCircuitBreakers, CircuitBreakerState } from "@/lib/turbocore/providers/circuit-breaker";

/**
 * GET /api/admin/provider-health/dashboard — Aggregated provider health metrics.
 *
 * Returns comprehensive provider health data including:
 * - Per-provider status (DB-backed + circuit breaker)
 * - Success rates and latency from health checks
 * - Circuit breaker states across all instances
 * - Recent health check history
 */
export async function GET() {
  let admin;
  try { admin = await requireAdmin(); } catch (e: any) { return errorJson(e.message, e.status ?? 401, e.code); }

  // Get all provider configs
  const configs = await db.providerConfig.findMany({
    where: { enabled: true },
    orderBy: [{ contract: "asc" }, { priority: "asc" }],
    select: {
      id: true,
      contract: true,
      providerName: true,
      displayName: true,
      mode: true,
      priority: true,
      lastHealthStatus: true,
      lastHealthCheckAt: true,
      lastHealthLatencyMs: true,
      avgLatencyMs: true,
      costBasisPoints: true,
      settlementSpeedMin: true,
    },
  });

  // Get recent health checks (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentChecks = await db.providerHealthCheck.findMany({
    where: { checkedAt: { gte: oneDayAgo } },
    orderBy: { checkedAt: "desc" },
    take: 100,
    select: {
      providerConfigId: true,
      status: true,
      latencyMs: true,
      errorMessage: true,
      checkedAt: true,
    },
  });

  // Get circuit breaker states (distributed via Redis)
  const breakers = await listCircuitBreakers();
  const breakerMap = new Map(breakers.map((b) => [b.providerName, b]));

  // Aggregate metrics per provider
  const providerMetrics = configs.map((config) => {
    const breaker = breakerMap.get(config.providerName);
    const providerChecks = recentChecks.filter((c) => c.providerConfigId === config.id);
    const successCount = providerChecks.filter((c) => c.status === "ok").length;
    const totalChecks = providerChecks.length;

    return {
      ...config,
      circuitBreaker: breaker
        ? {
            state: CircuitBreakerState[breaker.state],
            failureCount: breaker.failureCount,
            successCount: breaker.successCount,
          }
        : null,
      recentChecks: totalChecks,
      successRate: totalChecks > 0 ? Math.round((successCount / totalChecks) * 100) : null,
      avgLatencyRecent: providerChecks.length > 0
        ? Math.round(providerChecks.reduce((sum, c) => sum + (c.latencyMs ?? 0), 0) / providerChecks.length)
        : null,
    };
  });

  // Overall summary
  const totalProviders = configs.length;
  const healthyProviders = configs.filter((c) => c.lastHealthStatus === "ok").length;
  const degradedProviders = configs.filter((c) => c.lastHealthStatus === "degraded").length;
  const downProviders = configs.filter((c) => c.lastHealthStatus === "down").length;
  const unknownProviders = totalProviders - healthyProviders - degradedProviders - downProviders;

  return json({
    data: {
      summary: {
        total: totalProviders,
        healthy: healthyProviders,
        degraded: degradedProviders,
        down: downProviders,
        unknown: unknownProviders,
        healthRate: totalProviders > 0 ? Math.round((healthyProviders / totalProviders) * 100) : 0,
      },
      providers: providerMetrics,
      recentChecksCount: recentChecks.length,
      circuitBreakers: breakers.map((b) => ({
        provider: b.providerName,
        state: CircuitBreakerState[b.state],
        failures: b.failureCount,
        successes: b.successCount,
      })),
    },
    meta: { timestamp: new Date().toISOString() },
  });
}
