/**
 * TurboCore — Live FX Rate Comparison
 * ======================================
 *
 * For the `exchangeRate` contract specifically, exchange rates genuinely move
 * minute-to-minute — unlike domestic commission rates which are static. This
 * service queries live rates from EVERY enabled, non-circuit-broken provider
 * configured for the exchangeRate contract, with a short timeout. If a
 * provider doesn't respond in time, it's excluded from the comparison rather
 * than blocking the user.
 *
 * The best rate among providers that responded in time is selected, and the
 * result — including all compared rates — is recorded on the transaction for
 * dispute handling ("why did I get this rate") and auditing.
 *
 * If only one provider is configured (which is true initially), this
 * degrades gracefully to "use the one available provider" — no error.
 */

import { db } from "@/lib/db";
import { audit } from "@/lib/turbopay/audit";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import type { IExchangeRateProvider, FxQuote, ProviderContext } from "@/lib/turbocore/providers/interfaces";
import type { Currency } from "@/lib/turbocore/types";

/** Max time to wait for any single provider to respond. */
const FX_QUOTE_TIMEOUT_MS = 2_000;

export interface ProviderRateQuote {
  providerConfigId: string;
  providerName: string;
  quote: FxQuote;
  latencyMs: number;
}

export interface RateComparisonResult {
  /** The best rate (highest destination amount for the user). */
  best: ProviderRateQuote;
  /** All providers that responded in time, including the winner. */
  compared: ProviderRateQuote[];
  /** Providers that were excluded (timeout, circuit-broken, or error). */
  excluded: Array<{ providerName: string; reason: string }>;
}

class FxComparisonService {
  /**
   * Query all enabled, non-circuit-broken providers for the exchangeRate
   * contract in parallel, pick the best rate, and return the comparison.
   *
   * This does NOT use the provider router — it deliberately queries ALL
   * providers because FX rates move in real time and the cheapest provider
   * for bills may not have the best FX rate.
   */
  async compareRates(
    from: Currency,
    to: Currency,
    amountMinor: number,
    ctx?: ProviderContext,
  ): Promise<RateComparisonResult> {
    // Load all enabled ProviderConfig rows for the exchangeRate contract.
    const configs = await db.providerConfig.findMany({
      where: { contract: "exchangeRate", enabled: true },
      select: { id: true, providerName: true, mode: true, lastHealthStatus: true },
    });

    const excluded: Array<{ providerName: string; reason: string }> = [];

    // Filter out providers whose circuit breaker is OPEN — a slightly better
    // rate from a provider whose breaker is OPEN is not a real option.
    const candidates: typeof configs = [];
    for (const c of configs) {
      const breaker = getCircuitBreaker(c.providerName);
      if (await breaker.isOpen()) {
        excluded.push({ providerName: c.providerName, reason: "circuit_breaker_open" });
        continue;
      }
      if (c.lastHealthStatus === "down") {
        excluded.push({ providerName: c.providerName, reason: "health_down" });
        continue;
      }
      candidates.push(c);
    }

    // If no candidates, fall back to the mock provider (the registry's default).
    if (candidates.length === 0) {
      const { MockExchangeRateProvider } = await import("@/lib/turbocore/providers/mock");
      const mock = new MockExchangeRateProvider();
      const t0 = Date.now();
      const result = await mock.getQuote(from, to, amountMinor);
      const latencyMs = Date.now() - t0;
      if (result.ok && result.data) {
        return {
          best: { providerConfigId: "mock", providerName: "mock", quote: result.data, latencyMs },
          compared: [{ providerConfigId: "mock", providerName: "mock", quote: result.data, latencyMs }],
          excluded,
        };
      }
      throw new Error("No FX providers available and mock failed");
    }

    // Query all candidates in parallel with a timeout.
    const quotes = await Promise.allSettled(
      candidates.map(async (c) => {
        const adapter = await adapterFactory.create("exchangeRate", c.id);
        if (!adapter) {
          throw new Error(`No adapter for ${c.providerName}`);
        }
        const t0 = Date.now();
        const result = await this.withTimeout(
          (adapter as IExchangeRateProvider).getQuote(from, to, amountMinor, ctx),
          FX_QUOTE_TIMEOUT_MS,
        );
        const latencyMs = Date.now() - t0;
        if (!result.ok || !result.data) {
          throw new Error(result.error?.message ?? "provider returned no quote");
        }
        return {
          providerConfigId: c.id,
          providerName: c.providerName,
          quote: result.data,
          latencyMs,
        } as ProviderRateQuote;
      }),
    );

    const compared: ProviderRateQuote[] = [];
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i];
      if (q.status === "fulfilled") {
        compared.push(q.value);
      } else {
        excluded.push({
          providerName: candidates[i].providerName,
          reason: q.reason instanceof Error ? q.reason.message : "unknown_error",
        });
      }
    }

    if (compared.length === 0) {
      throw new Error("All FX providers failed or timed out");
    }

    // Pick the best rate: the one that gives the user the MOST destination
    // currency for their source amount. Ties broken by lowest latency.
    compared.sort((a, b) => {
      const aDest = Math.round(amountMinor * a.quote.rate);
      const bDest = Math.round(amountMinor * b.quote.rate);
      if (bDest !== aDest) return bDest - aDest; // higher destination = better
      return a.latencyMs - b.latencyMs; // faster = better
    });

    const best = compared[0];

    await audit({
      action: "FX_RATE_COMPARISON",
      category: "FX",
      severity: "INFO",
      metadata: {
        from,
        to,
        amountMinor,
        bestProvider: best.providerName,
        bestRate: best.quote.rate,
        comparedProviders: compared.map((c) => ({
          provider: c.providerName,
          rate: c.quote.rate,
          latencyMs: c.latencyMs,
        })),
        excludedProviders: excluded,
      },
    });

    return { best, compared, excluded };
  }

  /**
   * Run a promise with a timeout. If the timeout fires, reject with a
   * clear error message so the caller knows the provider was too slow.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`FX provider timed out after ${ms}ms`));
      }, ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}

export const fxComparison = new FxComparisonService();
