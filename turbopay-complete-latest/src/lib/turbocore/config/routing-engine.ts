/**
 * TurboCore — Multi-Factor Routing Decision Engine
 * =====================================================
 *
 * Evaluates every candidate provider through 9 sequential gates:
 *   Risk → Compliance → Availability → Fee → FX → Latency → Settlement → Capacity → Success Rate
 *
 * Hard gates (1-3) eliminate candidates. Soft gates (4-9) score them.
 * The highest-scoring remaining candidate is selected.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import { getRoutingWeights } from "@/lib/turbocore/config/routing-weights";
import { capabilityRegistry, type CapabilityCategory } from "@/lib/turbocore/providers/capabilities";
import type { Currency } from "@/lib/turbocore/types";

export interface RoutingDecisionInput {
  contract: string;
  userId: string;
  amountMinor: number;
  country?: string;
  currency?: string;
  fromCurrency?: Currency;
  toCurrency?: Currency;
  skipFxComparison?: boolean;
  correlationId?: string;
}

export interface FactorResult {
  factor: string;
  passed: boolean;
  score: number;
  reason: string;
}

export interface RoutingDecision {
  contract: string;
  selectedProviderConfigId: string;
  selectedProviderName: string;
  selectionReason: string;
  factors: FactorResult[];
  candidates: Array<{
    providerConfigId: string;
    providerName: string;
    eliminated: boolean;
    eliminationReason?: string;
    totalScore: number;
    factorScores: Record<string, number>;
  }>;
  totalCandidates: number;
  eliminatedCandidates: number;
  decisionTimeMs: number;
}

const FALLBACK_LOCAL_WEIGHTS: Record<string, number> = {
  fee: 0.25, latency: 0.20, settlementSpeed: 0.15, capacity: 0.10, successRate: 0.30,
};
const FALLBACK_FX_WEIGHTS: Record<string, number> = {
  fee: 0.15, fx: 0.35, latency: 0.15, settlementSpeed: 0.10, capacity: 0.05, successRate: 0.20,
};

interface RoutingCandidate {
  providerConfigId: string;
  providerName: string;
  mode: string | null;
  costBasisPoints: number;
  settlementSpeedMin: number;
  capacityPerMin: number;
  avgLatencyMs: number;
  lastHealthStatus: string | null;
  lastHealthLatencyMs: number | null;
}

class RoutingDecisionEngine {
  async decide(input: RoutingDecisionInput): Promise<RoutingDecision> {
    const startTime = Date.now();
    const configs = await db.providerConfig.findMany({
      where: { contract: input.contract, enabled: true },
      select: {
        id: true, providerName: true, mode: true,
        costBasisPoints: true, settlementSpeedMin: true,
        capacityPerMin: true, avgLatencyMs: true,
        lastHealthStatus: true, lastHealthLatencyMs: true,
      },
    });

    const candidates = configs.map((c) => ({
      providerConfigId: c.id, providerName: c.providerName, mode: c.mode,
      costBasisPoints: c.costBasisPoints ?? 0, settlementSpeedMin: c.settlementSpeedMin ?? 60,
      capacityPerMin: c.capacityPerMin ?? 0, avgLatencyMs: c.avgLatencyMs ?? 0,
      lastHealthStatus: c.lastHealthStatus, lastHealthLatencyMs: c.lastHealthLatencyMs,
    }));

    const allFactors: FactorResult[] = [];
    const candidateStates: RoutingDecision["candidates"] = candidates.map((c) => ({
      providerConfigId: c.providerConfigId, providerName: c.providerName,
      eliminated: false, eliminationReason: undefined as string | undefined,
      totalScore: 0, factorScores: {} as Record<string, number>,
    }));

    // Gate 1: Risk Engine
    const riskResult = await this.runRiskEngine(input);
    allFactors.push(riskResult);
    if (!riskResult.passed) {
      candidateStates.forEach((cs) => { cs.eliminated = true; cs.eliminationReason = "risk_blocked"; });
      return this.buildDecision(input, candidateStates, allFactors, "risk_blocked", startTime);
    }

    // Gate 2: Compliance
    const complianceResult = await this.runComplianceChecks(input);
    allFactors.push(complianceResult);
    if (!complianceResult.passed) {
      candidateStates.forEach((cs) => { cs.eliminated = true; cs.eliminationReason = "compliance_blocked"; });
      return this.buildDecision(input, candidateStates, allFactors, "compliance_blocked", startTime);
    }

    // Gate 3: Availability (hard gate per provider)
    const activeCandidates: typeof candidates = [];
    for (const candidate of candidates) {
      const breaker = getCircuitBreaker(candidate.providerName);
      const isBreakerOpen = await breaker.isOpen();
      if (isBreakerOpen || candidate.lastHealthStatus === "down") {
        const cs = candidateStates.find((c) => c.providerConfigId === candidate.providerConfigId)!;
        cs.eliminated = true;
        cs.eliminationReason = isBreakerOpen ? "circuit_breaker_open" : "health_down";
      } else {
        activeCandidates.push(candidate);
      }
    }
    allFactors.push({
      factor: "Provider Availability", passed: activeCandidates.length > 0, score: 100,
      reason: `${activeCandidates.length}/${candidates.length} available`,
    });

    if (activeCandidates.length === 0) {
      return this.buildDecision(input, candidateStates, allFactors, "no_available_providers", startTime);
    }

    // Gate 4: Capability Filter (hard gate per provider)
    // Filter candidates by the capability required for this contract,
    // AND by country/currency support.
    const requiredCapability = this.mapContractToCapability(input.contract);
    const capabilityCandidates: typeof activeCandidates = [];
    if (requiredCapability) {
      for (const candidate of activeCandidates) {
        const caps = capabilityRegistry.get(candidate.providerName);
        const hasCapability = caps && caps.categories.includes(requiredCapability);
        const supportsCountry = !input.country || !caps || caps.supportedCountries.includes(input.country) || caps.supportedCountries.includes("*");
        const supportsCurrency = !input.currency || !caps || caps.supportedCurrencies.includes(input.currency);

        if (!hasCapability || !supportsCountry || !supportsCurrency) {
          const cs = candidateStates.find((c) => c.providerConfigId === candidate.providerConfigId)!;
          cs.eliminated = true;
          if (!hasCapability) cs.eliminationReason = "capability_unavailable";
          else if (!supportsCountry) cs.eliminationReason = "country_unsupported";
          else cs.eliminationReason = "currency_unsupported";
        } else {
          capabilityCandidates.push(candidate);
        }
      }
      allFactors.push({
        factor: "Capability Match", passed: capabilityCandidates.length > 0, score: 100,
        reason: `${capabilityCandidates.length}/${activeCandidates.length} support ${requiredCapability}${input.country ? ` in ${input.country}` : ""}${input.currency ? ` (${input.currency})` : ""}`,
      });
    } else {
      // No specific capability required — pass all active candidates
      capabilityCandidates.push(...activeCandidates);
      allFactors.push({
        factor: "Capability Match", passed: true, score: 100,
        reason: "No specific capability required",
      });
    }

    if (capabilityCandidates.length === 0) {
      return this.buildDecision(input, candidateStates, allFactors, "no_capable_providers", startTime);
    }

    // Gates 5-10: Soft scoring
    const isFx = input.contract === "exchangeRate" || input.contract === "internationalTransfer";
    const weights = await getRoutingWeights(isFx ? "fx" : "local");

    const feeScores = this.scoreFees(activeCandidates);
    allFactors.push(this.buildFactorResult("Fee Comparison", feeScores));

    let fxScores: Map<string, number> | null = null;
    if (isFx && !input.skipFxComparison && input.fromCurrency && input.toCurrency) {
      fxScores = await this.scoreFxRates(activeCandidates, input);
      allFactors.push(this.buildFactorResult("FX Comparison", fxScores));
    }

    const latencyScores = this.scoreLatency(activeCandidates);
    allFactors.push(this.buildFactorResult("Latency Analysis", latencyScores));

    const settlementScores = this.scoreSettlementSpeed(activeCandidates);
    allFactors.push(this.buildFactorResult("Settlement Speed", settlementScores));

    const capacityScores = await this.scoreCapacity(activeCandidates);
    allFactors.push(this.buildFactorResult("Provider Capacity", capacityScores));

    const successScores = await this.scoreSuccessRate(activeCandidates);
    allFactors.push(this.buildFactorResult("Historical Success Rate", successScores));

    // Compute weighted scores
    for (const candidate of activeCandidates) {
      const cs = candidateStates.find((c) => c.providerConfigId === candidate.providerConfigId)!;
      cs.factorScores.fee = feeScores.get(candidate.providerConfigId) ?? 50;
      if (fxScores) cs.factorScores.fx = fxScores.get(candidate.providerConfigId) ?? 50;
      cs.factorScores.latency = latencyScores.get(candidate.providerConfigId) ?? 50;
      cs.factorScores.settlementSpeed = settlementScores.get(candidate.providerConfigId) ?? 50;
      cs.factorScores.capacity = capacityScores.get(candidate.providerConfigId) ?? 50;
      cs.factorScores.successRate = successScores.get(candidate.providerConfigId) ?? 50;

      let total = 0, weightSum = 0;
      for (const [factor, weight] of Object.entries(weights)) {
        total += (cs.factorScores[factor] ?? 50) * weight;
        weightSum += weight;
      }
      cs.totalScore = weightSum > 0 ? Math.round(total / weightSum) : 0;
    }

    const sorted = activeCandidates
      .map((c) => candidateStates.find((cs) => cs.providerConfigId === c.providerConfigId)!)
      .sort((a, b) => b.totalScore - a.totalScore);
    const best = sorted[0];

    return this.buildDecision(input, candidateStates, allFactors, `multi_factor_optimal:score_${best.totalScore}`, startTime, best.providerConfigId, best.providerName);
  }

  private async runRiskEngine(input: RoutingDecisionInput): Promise<FactorResult> {
    const flags = await db.amlFlag.count({ where: { userId: input.userId, resolved: false, severity: "HIGH" } });
    if (flags > 0) return { factor: "Risk Engine", passed: false, score: 0, reason: `${flags} unresolved HIGH AML flags` };
    return { factor: "Risk Engine", passed: true, score: 100, reason: "No HIGH AML flags" };
  }

  private async runComplianceChecks(input: RoutingDecisionInput): Promise<FactorResult> {
    const user = await db.user.findUnique({ where: { id: input.userId }, select: { kycTier: true, status: true } });
    if (!user) return { factor: "Compliance Checks", passed: false, score: 0, reason: "User not found" };
    if (user.status !== "ACTIVE") return { factor: "Compliance Checks", passed: false, score: 0, reason: `Status: ${user.status}` };
    const { KYC_LIMITS } = await import("@/lib/turbopay/types");
    const tier = (user.kycTier ?? 1) as 1 | 2 | 3;
    const limit = KYC_LIMITS[tier];
    if (limit && input.amountMinor > limit.singleTxKobo) {
      return { factor: "Compliance Checks", passed: false, score: 0, reason: `Exceeds Tier ${tier} limit` };
    }
    return { factor: "Compliance Checks", passed: true, score: 100, reason: `Tier ${tier}, within limits` };
  }

  /**
   * Map a contract name to the required capability category.
   * The capability filter uses this to determine which providers
   * can handle the requested operation.
   */
  private mapContractToCapability(contract: string): CapabilityCategory | null {
    const mapping: Record<string, CapabilityCategory> = {
      virtualAccount: "virtual_account",
      walletFunding: "collection",
      localTransfer: "transfer",
      internationalTransfer: "international",
      internationalReceiving: "international",
      crossBorderSettlement: "international",
      exchangeRate: "fx",
      billPayment: "bill_payment",
      kyc: "kyc",
      notification: "notification_sms",
      cardIssuer: "card_payments",
    };
    return mapping[contract] ?? null;
  }

  private scoreFees(candidates: RoutingCandidate[]): Map<string, number> {
    const scores = new Map<string, number>();
    const costs = candidates.map((c) => c.costBasisPoints);
    const min = Math.min(...costs), max = Math.max(...costs), range = max - min;
    for (const c of candidates) {
      scores.set(c.providerConfigId, range === 0 ? 100 : Math.round(100 - ((c.costBasisPoints - min) / range) * 100));
    }
    return scores;
  }

  private async scoreFxRates(candidates: RoutingCandidate[], input: RoutingDecisionInput): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    try {
      const { fxComparison } = await import("@/lib/turbocore/fx/comparison");
      const result = await fxComparison.compareRates(input.fromCurrency!, input.toCurrency!, input.amountMinor, { product: "turbopay" });
      const maxRate = Math.max(...result.compared.map((c) => c.quote.rate));
      for (const c of candidates) {
        const compared = result.compared.find((rc) => rc.providerConfigId === c.providerConfigId);
        scores.set(c.providerConfigId, compared ? Math.round((compared.quote.rate / maxRate) * 100) : 0);
      }
    } catch {
      candidates.forEach((c) => scores.set(c.providerConfigId, 50));
    }
    return scores;
  }

  private scoreLatency(candidates: RoutingCandidate[]): Map<string, number> {
    const scores = new Map<string, number>();
    const lats = candidates.map((c) => c.avgLatencyMs || c.lastHealthLatencyMs || 1000);
    const min = Math.min(...lats), max = Math.max(...lats), range = max - min;
    for (const c of candidates) {
      const lat = c.avgLatencyMs || c.lastHealthLatencyMs || 1000;
      scores.set(c.providerConfigId, range === 0 ? 100 : Math.round(100 - ((lat - min) / range) * 100));
    }
    return scores;
  }

  private scoreSettlementSpeed(candidates: RoutingCandidate[]): Map<string, number> {
    const scores = new Map<string, number>();
    const speeds = candidates.map((c) => c.settlementSpeedMin);
    const min = Math.min(...speeds), max = Math.max(...speeds), range = max - min;
    for (const c of candidates) {
      scores.set(c.providerConfigId, range === 0 ? 100 : Math.round(100 - ((c.settlementSpeedMin - min) / range) * 100));
    }
    return scores;
  }

  private async scoreCapacity(candidates: RoutingCandidate[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    const oneMinAgo = new Date(Date.now() - 60_000);
    const recentTx = await db.transaction.groupBy({ by: ["provider"], where: { createdAt: { gte: oneMinAgo } }, _count: { id: true } });
    const txCount = new Map(recentTx.map((r) => [r.provider, r._count.id]));
    for (const c of candidates) {
      const load = txCount.get(c.providerName) ?? 0;
      if (c.capacityPerMin === 0) scores.set(c.providerConfigId, 50);
      else scores.set(c.providerConfigId, Math.round((1 - Math.min(load / c.capacityPerMin, 1)) * 100));
    }
    return scores;
  }

  private async scoreSuccessRate(candidates: RoutingCandidate[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);

    // Batch: single GROUP BY query instead of N+1 per-candidate queries.
    const [totals, successes] = await Promise.all([
      db.transaction.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since24h } },
        _count: { id: true },
      }),
      db.transaction.groupBy({
        by: ["provider"],
        where: { status: "SUCCESS", createdAt: { gte: since24h } },
        _count: { id: true },
      }),
    ]);

    const totalMap = new Map(totals.map((r) => [r.provider, r._count.id]));
    const successMap = new Map(successes.map((r) => [r.provider, r._count.id]));

    for (const c of candidates) {
      const total = totalMap.get(c.providerName) ?? 0;
      const success = successMap.get(c.providerName) ?? 0;
      scores.set(c.providerConfigId, total === 0 ? 75 : Math.round((success / total) * 100));
    }
    return scores;
  }

  private buildFactorResult(factor: string, scores: Map<string, number>): FactorResult {
    const values = Array.from(scores.values());
    const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    return { factor, passed: true, score: avg, reason: `Avg: ${avg}/100` };
  }

  private buildDecision(input: RoutingDecisionInput, candidateStates: RoutingDecision["candidates"], factors: FactorResult[], reason: string, startTime: number, selectedId?: string, selectedName?: string): RoutingDecision {
    const eliminated = candidateStates.filter((c) => c.eliminated).length;
    const decision: RoutingDecision = {
      contract: input.contract,
      selectedProviderConfigId: selectedId ?? "",
      selectedProviderName: selectedName ?? "",
      selectionReason: reason,
      factors,
      candidates: candidateStates,
      totalCandidates: candidateStates.length,
      eliminatedCandidates: eliminated,
      decisionTimeMs: Date.now() - startTime,
    };
    audit({ userId: input.userId, action: "ROUTING_DECISION", category: "ADMIN", severity: "INFO", metadata: { contract: input.contract, selected: selectedName ?? "none", reason, decisionTimeMs: decision.decisionTimeMs } }).catch(() => {});
    return decision;
  }
}

export const routingEngine = new RoutingDecisionEngine();
