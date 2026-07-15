/**
 * Provider Registry — the dependency-injection container for provider adapters.
 *
 * The registry resolves the active provider for each contract by:
 *   1. Querying the ProviderRoutingService (DB-backed routing engine) and
 *      forwarding the caller's ProviderContext so canary bucketing + rule
 *      filters actually fire in production.
 *   2. If a route is configured, using the resolved provider's mode + configId
 *   3. If the mode is "production", the AdapterFactory instantiates the adapter
 *      using decrypted credentials from the DB. Production adapters are wrapped
 *      in a Proxy that records health on every call (recordSuccess/recordFailure).
 *   4. If no route is configured or the factory returns null, falling back to
 *      the env-var-based resolution (backward compat)
 *   5. Final fallback: the mock adapter (safe default)
 *
 * Because resolution is now async (DB queries), `providers` exports async
 * resolver functions instead of synchronous getters:
 *   const bp = await providers.billPayment();
 *   const result = await bp.pay(input);
 *
 * To exercise canary routing / rule-based filtering, pass a ProviderContext:
 *   const bp = await providers.billPayment({ product: "billswift", correlationId });
 */

import { env } from "@/lib/env";
import { db } from "@/lib/db";
import type {
  ProviderContract,
  ProviderContext,
} from "@/lib/turbocore/providers/interfaces";
import { adapterFactory } from "@/lib/turbocore/providers/adapter-factory";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import { CircuitBreakerOpenError } from "@/lib/turbopay/errors";
import {
  MockBillPaymentProvider,
  MockCrossBorderSettlementProvider,
  MockExchangeRateProvider,
  MockInternationalReceivingProvider,
  MockInternationalTransferProvider,
  MockKYCProvider,
  MockLocalTransferProvider,
  MockNotificationProvider,
  MockVirtualAccountProvider,
  MockWalletFundingProvider,
} from "@/lib/turbocore/providers/mock";

import type {
  IBillPaymentProvider,
  ICrossBorderSettlementProvider,
  IExchangeRateProvider,
  IInternationalReceivingProvider,
  IInternationalTransferProvider,
  IKYCProvider,
  ILocalTransferProvider,
  INotificationProvider,
  IVirtualAccountProvider,
  IWalletFundingProvider,
} from "@/lib/turbocore/providers/interfaces";

interface Registry {
  virtualAccount: IVirtualAccountProvider;
  walletFunding: IWalletFundingProvider;
  localTransfer: ILocalTransferProvider;
  internationalTransfer: IInternationalTransferProvider;
  internationalReceiving: IInternationalReceivingProvider;
  crossBorderSettlement: ICrossBorderSettlementProvider;
  exchangeRate: IExchangeRateProvider;
  billPayment: IBillPaymentProvider;
  kyc: IKYCProvider;
  notification: INotificationProvider;
}

const mocks: Registry = {
  virtualAccount: new MockVirtualAccountProvider(),
  walletFunding: new MockWalletFundingProvider(),
  localTransfer: new MockLocalTransferProvider(),
  internationalTransfer: new MockInternationalTransferProvider(),
  internationalReceiving: new MockInternationalReceivingProvider(),
  crossBorderSettlement: new MockCrossBorderSettlementProvider(),
  exchangeRate: new MockExchangeRateProvider(),
  billPayment: new MockBillPaymentProvider(),
  kyc: new MockKYCProvider(),
  notification: new MockNotificationProvider(),
};

// Production adapters are registered here when partnerships go live.
const productionAdapters: Partial<Registry> = {};
const sandboxAdapters: Partial<Registry> = {};

/** Convert camelCase to SCREAMING_SNAKE_CASE for env var names. */
function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

/**
 * Wrap an adapter in a Proxy that records health for every method call.
 *
 * - On resolution (method returned, even if ProviderResult.ok === false):
 *   calls `providerRouting.recordSuccess(providerConfigId, latencyMs)` —
 *   the call reached the provider and back.
 * - On rejection (method threw past the adapter's own try/catch — typically
 *   a coding bug or a Proxy trap failure): calls `providerRouting.recordFailure`
 *   and re-throws so the caller still sees the error.
 *
 * Both health writes are fire-and-forget — we must not block the request on
 * a DB write, and we must never mask the real error with a health-write error.
 *
 * Mock adapters are NOT wrapped — there is no ProviderConfig row for a mock
 * so there's nothing to record against.
 */
function wrapWithHealthTracking<T extends object>(adapter: T, providerConfigId: string): T {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async function (...args: unknown[]) {
        const start = Date.now();
        try {
          const result = await value.apply(target, args);
          void import("@/lib/turbocore/config/provider-routing")
            .then(({ providerRouting }) =>
              providerRouting.recordSuccess(providerConfigId, Date.now() - start).catch(() => {}),
            )
            .catch(() => {});
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : "provider failure";
          void import("@/lib/turbocore/config/provider-routing")
            .then(({ providerRouting }) =>
              providerRouting.recordFailure(providerConfigId, message).catch(() => {}),
            )
            .catch(() => {});
          throw err;
        }
      };
    },
  });
}

/**
 * Wrap an adapter in a Proxy that runs every method call through the per-
 * provider CircuitBreaker. The breaker:
 *   - fails fast with `CircuitBreakerOpenError` when OPEN and the cooldown
 *     hasn't elapsed (the underlying adapter method is NOT invoked)
 *   - increments / resets the failure counter based on whether the method
 *     threw or returned (a returned `ProviderResult.ok === false` counts as
 *     success from the breaker's perspective — that's a domain-level error,
 *     not a provider outage)
 *   - HALF_OPEN probes are limited to one in-flight at a time per provider
 *
 * The wrapper re-throws `CircuitBreakerOpenError` unchanged so the caller
 * (e.g. the pipeline) can catch it and failover to the next tier.
 */
function wrapWithCircuitBreaker<T extends object>(adapter: T, providerName: string): T {
  const breaker = getCircuitBreaker(providerName);
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async function (...args: unknown[]) {
        // breaker.execute throws CircuitBreakerOpenError if OPEN + cooldown
        // hasn't elapsed. The error carries the provider name for logging.
        if (await breaker.isOpen()) {
          throw new CircuitBreakerOpenError(providerName);
        }
        return breaker.execute(() => value.apply(target, args));
      };
    },
  });
}

/**
 * Async resolver — queries the routing engine first (forwarding the caller's
 * ProviderContext so canary + rule-based routing actually fire), then falls
 * back to env-var-based resolution, then to mock.
 *
 * Circuit-breaker integration: when a production adapter is resolved, the
 * registry checks the per-provider breaker. If OPEN (and the cooldown hasn't
 * elapsed), the resolver falls through to the next tier / mock — so a tripped
 * breaker triggers immediate failover without waiting for the DB-backed
 * `lastHealthStatus` to flip.
 */
async function resolveAsync<T>(
  contract: ProviderContract,
  mock: T,
  ctx?: ProviderContext,
): Promise<T> {
  // 1. Try the DB-backed routing engine. Forward the correlationId + product
  //    from the caller's ProviderContext so canary bucketing + tier rules
  //    actually fire in production (audit: previously dead).
  try {
    const { providerRouting } = await import("@/lib/turbocore/config/provider-routing");
    const route = await providerRouting.resolve(contract, {
      skipHealthCheck: false,
      correlationId: ctx?.correlationId,
      product: ctx?.product,
      country: ctx?.country,
    });
    if (route.mode === "mock") return mock;
    if (route.mode === "sandbox") {
      const sb = sandboxAdapters[contract as keyof Registry] as T | undefined;
      if (sb) return sb;
    }
    if (route.mode === "production") {
      // ── Circuit breaker fast-path ────────────────────────────────────
      // If the breaker for this provider is OPEN and the cooldown hasn't
      // elapsed, failover immediately. The routing engine's
      // `lastHealthStatus` will catch up on the next tick (the wrapper
      // fires `recordFailure` on every breaker trip), but the in-memory
      // breaker gives us instant failover without a DB read.
      const breaker = getCircuitBreaker(route.providerName);
      if (await breaker.isOpen()) {
        // Don't even instantiate the adapter — just fall through to the
        // env-var / mock fallback. The caller sees the mock (or the next
        // tier if `providerRouting.resolve` already skipped the down
        // provider based on `lastHealthStatus`).
      } else {
        const adapter = await adapterFactory.create(contract, route.providerConfigId);
        if (adapter) {
          // Wrap with health tracking FIRST (inner), then circuit breaker
          // (outer). The breaker runs before the health tracker — so when
          // the breaker is OPEN, the underlying adapter method (and the
          // health-tracker's success/failure write) is skipped entirely.
          const healthWrapped = wrapWithHealthTracking(
            adapter as object,
            route.providerConfigId,
          );
          const breakerWrapped = wrapWithCircuitBreaker(
            healthWrapped,
            route.providerName,
          ) as T;
          return breakerWrapped;
        }
      }
    }
  } catch {
    // No route configured, or ROUTE_EXHAUSTED — fall through to env-var fallback.
  }

  // 2. Env-var-based resolution (backward compat).
  const envKey = `TURBOCORE_PROVIDER_${toSnake(contract)}`;
  const envMode = process.env[envKey] ?? "mock";
  if (envMode === "production") {
    const prod = productionAdapters[contract as keyof Registry] as T | undefined;
    if (prod) return prod;
    if (env.NODE_ENV === "production") {
      throw new Error(`No production adapter registered for ${contract} but ${envKey}=production`);
    }
  }
  if (envMode === "sandbox") {
    const sb = sandboxAdapters[contract as keyof Registry] as T | undefined;
    if (sb) return sb;
  }

  // 3. Safe default: mock.
  return mock;
}

/**
 * Providers — async resolver functions. Each returns a Promise that resolves
 * to the provider adapter for that contract. Pass an optional ProviderContext
 * to enable canary bucketing + rule-based routing.
 *
 * Usage:
 *   const bp = await providers.billPayment();
 *   const result = await bp.pay(input);
 *
 * With routing context (enables canary + rules):
 *   const bp = await providers.billPayment({ product: "billswift", correlationId });
 */
export const providers = {
  virtualAccount: (ctx?: ProviderContext) => resolveAsync<IVirtualAccountProvider>("virtualAccount", mocks.virtualAccount, ctx),
  walletFunding: (ctx?: ProviderContext) => resolveAsync<IWalletFundingProvider>("walletFunding", mocks.walletFunding, ctx),
  localTransfer: (ctx?: ProviderContext) => resolveAsync<ILocalTransferProvider>("localTransfer", mocks.localTransfer, ctx),
  internationalTransfer: (ctx?: ProviderContext) => resolveAsync<IInternationalTransferProvider>("internationalTransfer", mocks.internationalTransfer, ctx),
  internationalReceiving: (ctx?: ProviderContext) => resolveAsync<IInternationalReceivingProvider>("internationalReceiving", mocks.internationalReceiving, ctx),
  crossBorderSettlement: (ctx?: ProviderContext) => resolveAsync<ICrossBorderSettlementProvider>("crossBorderSettlement", mocks.crossBorderSettlement, ctx),
  exchangeRate: (ctx?: ProviderContext) => resolveAsync<IExchangeRateProvider>("exchangeRate", mocks.exchangeRate, ctx),
  billPayment: (ctx?: ProviderContext) => resolveAsync<IBillPaymentProvider>("billPayment", mocks.billPayment, ctx),
  kyc: (ctx?: ProviderContext) => resolveAsync<IKYCProvider>("kyc", mocks.kyc, ctx),
  notification: (ctx?: ProviderContext) => resolveAsync<INotificationProvider>("notification", mocks.notification, ctx),
};

/** Register a production adapter for a contract (called at app boot). */
export function registerProvider<K extends keyof Registry>(contract: K, adapter: Registry[K], mode: "sandbox" | "production" = "production") {
  if (mode === "production") productionAdapters[contract] = adapter;
  else sandboxAdapters[contract] = adapter;
}

/**
 * Introspection — list the active adapter for each contract (admin/debug).
 *
 * Reads from the DB (providerConfig table) so the System Health view shows
 * the real configured state, not just env-var mode. For each contract we
 * surface the highest-priority enabled ProviderConfig's name + mode. If no
 * DB rows exist for a contract, falls back to env-var mode + mock name.
 */
export async function listProviders(): Promise<
  { contract: ProviderContract; name: string; mode: string }[]
> {
  const configs = await db.providerConfig.findMany({
    where: { enabled: true },
    orderBy: [{ contract: "asc" }, { priority: "asc" }],
  });
  const byContract = new Map<string, (typeof configs)[number]>();
  for (const c of configs) {
    if (!byContract.has(c.contract)) byContract.set(c.contract, c);
  }
  const out: { contract: ProviderContract; name: string; mode: string }[] = [];
  for (const key of Object.keys(mocks) as (keyof Registry)[]) {
    const dbConfig = byContract.get(key as string);
    if (dbConfig) {
      out.push({
        contract: key as ProviderContract,
        name: dbConfig.providerName,
        mode: dbConfig.mode,
      });
    } else {
      const envMode = process.env[`TURBOCORE_PROVIDER_${toSnake(key)}`] ?? "mock";
      out.push({
        contract: key as ProviderContract,
        name: mocks[key]?.name ?? "unknown",
        mode: envMode,
      });
    }
  }
  return out;
}
