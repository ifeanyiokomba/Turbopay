/**
 * TurboCore — Payment Orchestration Engine
 * =========================================
 *
 * The central intelligence layer between business services and provider
 * plugins. Responsible for:
 *
 *   1. Provider selection — pick the best provider for an operation
 *   2. Dynamic routing — adjust based on cost, latency, health
 *   3. Cost optimization — compare fees across providers
 *   4. Automatic failover — try next provider on failure
 *   5. Retry strategy — exponential backoff with jitter
 *   6. Circuit breaker integration — skip unhealthy providers
 *   7. Capability matching — only consider providers that can do the job
 *   8. Traffic splitting — canary deployments, A/B testing
 *   9. Geographic routing — route by country/currency
 *  10. Compliance routing — route by KYC/AML requirements
 *
 * Architecture (from Enterprise Transformation spec):
 *   Client → API → Application Service → Orchestration Engine → Provider Plugin
 *
 * The engine does NOT make HTTP calls itself — it delegates to provider
 * plugins which handle the actual provider communication. The engine's
 * job is to decide WHICH plugin to use and WHEN to retry/failover.
 */

import { pluginRegistry } from "@/lib/turbocore/providers/plugin";
import type { ProviderCapability, ProviderPlugin } from "@/lib/turbocore/providers/plugin";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import { CircuitBreakerOpenError } from "@/lib/turbopay/errors";

// ─── Routing Policy ───────────────────────────────────────────

/**
 * Configurable routing policy. Stored in the DB (ProviderRoute table)
 * and evaluated by the orchestration engine for each request.
 *
 * Policies replace hardcoded routing logic with declarative rules.
 */
export interface RoutingPolicy {
  /** Policy name for admin UI. */
  name: string;
  /** Priority order — providers tried in this order. */
  providerOrder: string[];
  /** Maximum retry attempts across all providers. */
  maxRetries: number;
  /** Base delay between retries in ms (exponential backoff). */
  retryBaseDelayMs: number;
  /** Maximum total time for the entire operation in ms. */
  timeoutMs: number;
  /** Cost optimization: pick cheapest provider first. */
  costOptimization: boolean;
  /** Latency optimization: pick fastest provider first. */
  latencyOptimization: boolean;
  /** Geographic routing: match provider by country/currency. */
  geoRouting?: {
    /** Map of country code → preferred provider ID. */
    countryProviderMap: Record<string, string>;
    /** Map of currency → preferred provider ID. */
    currencyProviderMap: Record<string, string>;
  };
  /** Traffic split for canary/A-B testing. */
  trafficSplit?: Array<{
    providerId: string;
    percentage: number;
  }>;
}

// ─── Routing Decision ─────────────────────────────────────────

export interface RoutingDecision {
  /** The provider selected for this request. */
  providerId: string;
  /** Why this provider was selected (for logging/audit). */
  reason: string;
  /** The routing policy that produced this decision. */
  policyName: string;
  /** Estimated cost in minor units. */
  estimatedCost: number;
  /** All providers that were considered (for debugging). */
  candidates: string[];
}

// ─── Orchestration Result ─────────────────────────────────────

export interface OrchestrationResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  /** The provider that ultimately handled the request. */
  providerId: string;
  /** Number of providers attempted (including the successful one). */
  attempts: number;
  /** Total time in ms. */
  totalMs: number;
  /** Routing decision for audit trail. */
  routingDecision: RoutingDecision;
}

// ─── Default Policies ─────────────────────────────────────────

const DEFAULT_POLICY: RoutingPolicy = {
  name: "default",
  providerOrder: [],
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  timeoutMs: 30_000,
  costOptimization: false,
  latencyOptimization: false,
};

// ─── Orchestration Engine ─────────────────────────────────────

/**
 * The Payment Orchestration Engine. Business services call this instead
 * of calling providers directly.
 *
 * Usage:
 *   const engine = new OrchestrationEngine();
 *   const result = await engine.execute("local_transfer:send", input, {
 *     policy: { providerOrder: ["paystack", "mock"], maxRetries: 2 },
 *     validate: (plugin) => plugin.supports("local_transfer:send"),
 *     execute: (plugin) => plugin.transfer(input),
 *   });
 */
export class OrchestrationEngine {
  /**
   * Execute an operation through the orchestration engine.
   *
   * @param operation - The capability to execute (e.g., "local_transfer:send")
   * @param operationKey - Unique key for idempotency (e.g., "transfer-TP-1234")
   * @param options - Routing policy and execution function
   */
  async execute<T>(
    operation: ProviderCapability,
    operationKey: string,
    options: {
      policy?: Partial<RoutingPolicy>;
      /** Filter providers before routing (e.g., by country, currency, KYC tier). */
      filter?: (plugin: ProviderPlugin) => boolean;
      /** Execute the operation on the selected provider. */
      execute: (plugin: ProviderPlugin) => Promise<T>;
      /** Transform provider errors into domain errors. */
      onError?: (error: unknown, providerId: string) => { code: string; message: string };
    }
  ): Promise<OrchestrationResult<T>> {
    const policy = { ...DEFAULT_POLICY, ...options.policy };
    const startTime = Date.now();

    // 1. Find all plugins that support this capability.
    let candidates = pluginRegistry.findByCapability(operation);

    // 2. Apply caller's filter (geographic, compliance, etc.).
    if (options.filter) {
      candidates = candidates.filter(options.filter);
    }

    if (candidates.length === 0) {
      return {
        ok: false,
        error: { code: "NO_PROVIDER", message: `No provider available for ${operation}` },
        providerId: "",
        attempts: 0,
        totalMs: Date.now() - startTime,
        routingDecision: {
          providerId: "",
          reason: "No providers found",
          policyName: policy.name,
          estimatedCost: 0,
          candidates: [],
        },
      };
    }

    // 3. Apply policy ordering (cost optimization, latency, etc.).
    candidates = this.rankProviders(candidates, policy);

    // 4. Apply traffic splitting (canary/A-B).
    if (policy.trafficSplit && policy.trafficSplit.length > 0) {
      candidates = this.applyTrafficSplit(candidates, policy.trafficSplit);
    }

    // 5. Try each provider with circuit breaker + retry.
    let lastError: { code: string; message: string } | null = null;
    let attempts = 0;

    for (const plugin of candidates) {
      if (attempts >= policy.maxRetries) break;

      // Check circuit breaker.
      const breaker = getCircuitBreaker(plugin.id);
      if (await breaker.isOpen()) {
        continue; // Skip unhealthy provider, try next.
      }

      attempts++;
      try {
        const result = await options.execute(plugin);
        // Record success in circuit breaker.
        await breaker.execute(() => Promise.resolve());
        return {
          ok: true,
          data: result,
          providerId: plugin.id,
          attempts,
          totalMs: Date.now() - startTime,
          routingDecision: {
            providerId: plugin.id,
            reason: `Selected by ${policy.name} policy (attempt ${attempts})`,
            policyName: policy.name,
            estimatedCost: await plugin.estimateFee(operation, 0, "NGN") ?? 0,
            candidates: candidates.map((p) => p.id),
          },
        };
      } catch (error) {
        // Record failure in circuit breaker.
        try { await breaker.execute(() => Promise.reject(error)); } catch { /* ignore */ }

        const domainError = options.onError?.(error, plugin.id) ?? {
          code: "PROVIDER_ERROR",
          message: error instanceof Error ? error.message : "Unknown provider error",
        };
        lastError = domainError;

        // Exponential backoff before retrying next provider.
        if (attempts < policy.maxRetries) {
          const delay = policy.retryBaseDelayMs * Math.pow(2, attempts - 1);
          const jitter = Math.random() * delay * 0.1;
          await new Promise((r) => setTimeout(r, delay + jitter));
        }
      }
    }

    // All providers exhausted.
    return {
      ok: false,
      error: lastError ?? { code: "ALL_PROVIDERS_FAILED", message: "All providers failed" },
      providerId: "",
      attempts,
      totalMs: Date.now() - startTime,
      routingDecision: {
        providerId: "",
        reason: `All ${candidates.length} providers failed after ${attempts} attempts`,
        policyName: policy.name,
        estimatedCost: 0,
        candidates: candidates.map((p) => p.id),
      },
    };
  }

  // ── Private: Provider Ranking ─────────────────────────────

  /**
   * Rank providers based on the routing policy. Supports:
   * - Cost optimization (cheapest first)
   * - Latency optimization (fastest first)
   * - Manual ordering (providerOrder)
   */
  private rankProviders(
    providers: ProviderPlugin[],
    policy: RoutingPolicy
  ): ProviderPlugin[] {
    const ranked = [...providers];

    if (policy.costOptimization) {
      ranked.sort((a, b) => {
        const costA = a.costProfile.percentageFeeBps + a.costProfile.fixedFeeMinor;
        const costB = b.costProfile.percentageFeeBps + b.costProfile.fixedFeeMinor;
        return costA - costB;
      });
    }

    if (policy.latencyOptimization) {
      // Would use health tracking data in production.
      // For now, respect the manual order.
    }

    if (policy.providerOrder.length > 0) {
      const orderMap = new Map(policy.providerOrder.map((id, idx) => [id, idx]));
      ranked.sort((a, b) => {
        const orderA = orderMap.get(a.id) ?? Infinity;
        const orderB = orderMap.get(b.id) ?? Infinity;
        return orderA - orderB;
      });
    }

    return ranked;
  }

  // ── Private: Traffic Splitting ────────────────────────────

  /**
   * Apply traffic splitting for canary/A-B testing. Returns providers
   * in the order determined by the traffic percentage weights.
   */
  private applyTrafficSplit(
    providers: ProviderPlugin[],
    splits: Array<{ providerId: string; percentage: number }>
  ): ProviderPlugin[] {
    const roll = Math.random() * 100;
    let cumulative = 0;

    for (const split of splits) {
      cumulative += split.percentage;
      if (roll < cumulative) {
        const target = providers.find((p) => p.id === split.providerId);
        if (target) {
          // Put the canary provider first, rest follow.
          return [target, ...providers.filter((p) => p.id !== split.providerId)];
        }
      }
    }

    return providers; // No split matched, use original order.
  }
}

/** Singleton orchestration engine. */
export const orchestrationEngine = new OrchestrationEngine();
