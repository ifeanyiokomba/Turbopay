/** Provider Routing Engine — primary/secondary/fallback + canary + health + failover. */
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { recordConfigVersion } from "@/lib/turbocore/config/versioning";
import * as crypto from "node:crypto";

export type RouteTier = "PRIMARY" | "SECONDARY" | "FALLBACK" | "CANARY";

export interface RoutingContext {
  amountMinor?: number; product?: string; currency?: string; country?: string;
  skipHealthCheck?: boolean; correlationId?: string;
}

export interface ResolvedProvider {
  providerConfigId: string; contract: string; providerName: string;
  tier: RouteTier; mode: string; selectionReason: string;
}

export interface RouteConfig {
  contract: string;
  tiers: Array<{ tier: RouteTier; providerConfigId: string; providerName: string; enabled: boolean; failoverThreshold: number; canaryPercent: number; rules?: Record<string, unknown> | null; }>;
  manualOverride: string | null;
}

class ProviderRoutingService {
  async resolve(contract: string, ctx?: RoutingContext): Promise<ResolvedProvider> {
    const route = await this.getRouteConfig(contract);

    // 1. Manual override — if set, always use this provider. An admin-set
    //    override MUST win regardless of cost — this is the "support agent
    //    force-routes to a specific provider" escape hatch.
    if (route.manualOverride) {
      const override = await db.providerConfig.findUnique({ where: { id: route.manualOverride } });
      if (override && override.enabled && (ctx?.skipHealthCheck || override.lastHealthStatus !== "down")) {
        return { providerConfigId: override.id, contract, providerName: override.providerName, tier: "PRIMARY", mode: override.mode, selectionReason: "manual_override" };
      }
    }

    // 2. Canary routing — a percentage of traffic goes to the CANARY tier.
    const canaryTier = route.tiers.find((t) => t.tier === "CANARY" && t.enabled && t.canaryPercent > 0);
    if (canaryTier && ctx?.correlationId) {
      const hash = crypto.createHash("sha256").update(ctx.correlationId).digest();
      const bucket = hash.readUInt32BE(0) % 100;
      if (bucket < canaryTier.canaryPercent) {
        const config = await db.providerConfig.findUnique({ where: { id: canaryTier.providerConfigId } });
        if (config && config.enabled && (ctx.skipHealthCheck || config.lastHealthStatus !== "down")) {
          return { providerConfigId: config.id, contract, providerName: config.providerName, tier: "CANARY", mode: config.mode, selectionReason: "canary_routing" };
        }
      }
    }

    // 3. Cost-optimal routing — when more than one enabled, healthy provider
    //    exists for this contract and no manual override is active, pick the
    //    cheapest. Commission rates are static per provider-contract (unlike
    //    FX rates), so there's no need for a live comparison — just read
    //    costBasisPoints from the DB. This saves the admin from manually
    //    re-ordering tiers whenever a provider changes their rate.
    //
    //    We only apply this when there are 2+ healthy candidates. If only one
    //    provider is configured/healthy, the tier chain below handles it.
    const allConfigs = await db.providerConfig.findMany({
      where: { contract, enabled: true },
      select: { id: true, providerName: true, mode: true, costBasisPoints: true, lastHealthStatus: true },
    });
    const healthy = allConfigs.filter(
      (c) => ctx?.skipHealthCheck || c.lastHealthStatus !== "down",
    );
    if (healthy.length >= 2) {
      // Sort by cost ascending (cheapest first). Ties broken by providerName for determinism.
      healthy.sort((a, b) => (a.costBasisPoints ?? 0) - (b.costBasisPoints ?? 0) || a.providerName.localeCompare(b.providerName));
      const cheapest = healthy[0];
      return {
        providerConfigId: cheapest.id,
        contract,
        providerName: cheapest.providerName,
        tier: "PRIMARY",
        mode: cheapest.mode,
        selectionReason: "cost_optimal",
      };
    }

    // 4. Walk the tier chain: PRIMARY → SECONDARY → FALLBACK.
    //    This is the fallback when there's only one provider (or none healthy
    //    enough for cost comparison to matter) — just use the tier order the
    //    admin configured.
    for (const tier of route.tiers.filter((t) => t.tier !== "CANARY")) {
      if (!tier.enabled) continue;
      if (tier.rules && !this.matchesRules(tier.rules, ctx)) continue;
      const config = await db.providerConfig.findUnique({ where: { id: tier.providerConfigId } });
      if (!config || !config.enabled) continue;
      if (!ctx?.skipHealthCheck && config.lastHealthStatus === "down") continue;
      return { providerConfigId: config.id, contract, providerName: config.providerName, tier: tier.tier, mode: config.mode, selectionReason: tier.tier === "PRIMARY" ? "primary" : `failover_${tier.tier.toLowerCase()}` };
    }

    await audit({ action: "PROVIDER_ROUTE_EXHAUSTED", category: "ADMIN", severity: "CRITICAL", metadata: { contract } });
    throw new Error(`ROUTE_EXHAUSTED: no healthy provider available for ${contract}`);
  }

  async getRouteConfig(contract: string): Promise<RouteConfig> {
    const routes = await db.providerRoute.findMany({ where: { contract, enabled: true }, include: { providerConfig: true }, orderBy: [{ tier: "asc" }] });
    // manualOverride is read from the PRIMARY tier's manualOverrideId field.
    const primaryRoute = routes.find((r) => r.tier === "PRIMARY");
    return {
      contract,
      tiers: routes.map((r) => ({ tier: r.tier as RouteTier, providerConfigId: r.providerConfigId, providerName: r.providerConfig?.providerName ?? "unknown", enabled: r.enabled, failoverThreshold: r.failoverThreshold, canaryPercent: r.canaryPercent, rules: r.rules ? JSON.parse(r.rules) : null })),
      manualOverride: primaryRoute?.manualOverrideId ?? null,
    };
  }

  async setRoute(contract: string, tier: RouteTier, providerConfigId: string, opts?: { rules?: Record<string, unknown>; failoverThreshold?: number; enabled?: boolean; canaryPercent?: number }, actor?: { id: string; name: string }) {
    const existing = await db.providerRoute.findUnique({ where: { contract_tier: { contract, tier } } });
    const data = { contract, tier, providerConfigId, rules: opts?.rules ? JSON.stringify(opts.rules) : null, failoverThreshold: opts?.failoverThreshold ?? 3, enabled: opts?.enabled ?? true, canaryPercent: opts?.canaryPercent ?? 0 };
    const result = existing ? await db.providerRoute.update({ where: { id: existing.id }, data }) : await db.providerRoute.create({ data });
    await audit({ userId: actor?.id, action: "PROVIDER_ROUTE_SET", category: "ADMIN", severity: "INFO", metadata: { contract, tier, providerConfigId } });
    await recordConfigVersion("providerRoute", result.id, existing ? "UPDATE" : "CREATE", existing, result, undefined, actor);
    return result;
  }

  async setManualOverride(contract: string, providerConfigId: string | null, actor?: { id: string; name: string }) {
    const primary = await db.providerRoute.findUnique({ where: { contract_tier: { contract, tier: "PRIMARY" } } });
    if (!primary) throw new Error("No PRIMARY route for this contract");
    const updated = await db.providerRoute.update({ where: { id: primary.id }, data: { manualOverrideId: providerConfigId } });
    await audit({ userId: actor?.id, action: "PROVIDER_MANUAL_OVERRIDE_SET", category: "ADMIN", severity: "INFO", metadata: { contract, providerConfigId } });
    return updated;
  }

  async recordFailure(providerConfigId: string, errorMessage?: string) {
    await db.providerHealthCheck.create({ data: { providerConfigId, status: "degraded", errorMessage: errorMessage ?? "provider failure" } });
    const recent = await db.providerHealthCheck.findMany({ where: { providerConfigId }, orderBy: { checkedAt: "desc" }, take: 5, select: { status: true } });
    const consecutiveFailures = recent.filter((r) => r.status !== "healthy").length;
    const status = consecutiveFailures >= 5 ? "down" : "degraded";
    await db.providerConfig.update({ where: { id: providerConfigId }, data: { lastHealthStatus: status, lastHealthCheckAt: new Date() } });
  }

  async recordSuccess(providerConfigId: string, latencyMs?: number) {
    await db.providerHealthCheck.create({ data: { providerConfigId, status: "healthy", latencyMs } });
    await db.providerConfig.update({ where: { id: providerConfigId }, data: { lastHealthStatus: "healthy", lastHealthLatencyMs: latencyMs ?? null, lastHealthCheckAt: new Date() } });
  }

  private matchesRules(rules: Record<string, unknown>, ctx?: RoutingContext): boolean {
    if (!ctx) return true;
    if (rules.minAmount && ctx.amountMinor !== undefined && ctx.amountMinor < Number(rules.minAmount)) return false;
    if (rules.maxAmount && ctx.amountMinor !== undefined && ctx.amountMinor > Number(rules.maxAmount)) return false;
    if (rules.product && ctx.product && rules.product !== ctx.product) return false;
    if (rules.currency && ctx.currency && rules.currency !== ctx.currency) return false;
    if (rules.country && ctx.country && rules.country !== ctx.country) return false;
    return true;
  }
}

export const providerRouting = new ProviderRoutingService();
