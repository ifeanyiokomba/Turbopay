/** Provider Health — with SSRF protection + N+1 query fix. */
import { db } from "@/lib/db";
import { assertSafeHealthCheckUrl } from "@/lib/turbocore/config/provider-config";

export interface ProviderHealthSummary {
  providerConfigId: string; contract: string; providerName: string; displayName: string;
  status: string; latencyMs: number | null; lastCheckAt: string | null;
  recentFailures: number; recentChecks: number; enabled: boolean; tier: string | null;
}

class ProviderHealthService {
  /** N+1 fix: single grouped query instead of per-provider findMany. */
  async listSummaries(): Promise<ProviderHealthSummary[]> {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const [configs, healthAgg] = await Promise.all([
      db.providerConfig.findMany({ orderBy: [{ contract: "asc" }, { priority: "asc" }], include: { routes: { take: 1, orderBy: { tier: "asc" } } } }),
      db.providerHealthCheck.groupBy({ by: ["providerConfigId", "status"], _count: { status: true }, where: { checkedAt: { gte: since24h } } }),
    ]);
    const counts = new Map<string, Record<string, number>>();
    for (const row of healthAgg) {
      if (!counts.has(row.providerConfigId)) counts.set(row.providerConfigId, {});
      counts.get(row.providerConfigId)![row.status] = row._count.status;
    }
    return configs.map((c) => {
      const c24 = counts.get(c.id) ?? {};
      return {
        providerConfigId: c.id, contract: c.contract, providerName: c.providerName, displayName: c.displayName,
        status: c.lastHealthStatus ?? "unknown", latencyMs: c.lastHealthLatencyMs,
        lastCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
        recentFailures: (c24["degraded"] ?? 0) + (c24["down"] ?? 0),
        recentChecks: Object.values(c24).reduce((a, b) => a + b, 0),
        enabled: c.enabled, tier: c.routes[0]?.tier ?? null,
      };
    });
  }

  async getHistory(providerConfigId: string, limit = 50) {
    return db.providerHealthCheck.findMany({ where: { providerConfigId }, orderBy: { checkedAt: "desc" }, take: limit });
  }

  async runCheck(providerConfigId: string): Promise<{ status: string; latencyMs: number | null; error?: string }> {
    const config = await db.providerConfig.findUnique({ where: { id: providerConfigId } });
    if (!config?.healthCheckUrl) return { status: "unknown", latencyMs: null, error: "No health check URL configured" };
    // SSRF protection — validate before fetching.
    assertSafeHealthCheckUrl(config.healthCheckUrl);
    const start = Date.now();
    try {
      const res = await fetch(config.healthCheckUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
      const latencyMs = Date.now() - start;
      const status = res.ok ? "healthy" : "degraded";
      await db.providerHealthCheck.create({ data: { providerConfigId, status, latencyMs, errorMessage: res.ok ? null : `HTTP ${res.status}` } });
      await db.providerConfig.update({ where: { id: providerConfigId }, data: { lastHealthStatus: status, lastHealthLatencyMs: latencyMs, lastHealthCheckAt: new Date() } });
      return { status, latencyMs };
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      await db.providerHealthCheck.create({ data: { providerConfigId, status: "down", latencyMs, errorMessage: e?.message ?? "fetch failed" } });
      await db.providerConfig.update({ where: { id: providerConfigId }, data: { lastHealthStatus: "down", lastHealthLatencyMs: latencyMs, lastHealthCheckAt: new Date() } });
      return { status: "down", latencyMs, error: e?.message };
    }
  }
}

export const providerHealth = new ProviderHealthService();
