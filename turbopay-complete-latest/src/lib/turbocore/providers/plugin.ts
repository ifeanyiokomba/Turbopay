/**
 * TurboCore — Provider Plugin Framework
 * ======================================
 *
 * Enterprise-grade provider abstraction layer. Every external financial
 * provider (Monnify, Paystack, Wise, Stripe, etc.) is implemented as a
 * plugin that declares its capabilities, implements a standard interface,
 * and is registered with the platform's provider registry.
 *
 * Design principles (from the Enterprise Transformation spec):
 *   1. Business logic NEVER depends on providers directly.
 *   2. Providers are plugins — adding one requires no business code changes.
 *   3. Each plugin declares what it CAN do (capabilities) and the routing
 *      engine uses these declarations to select the right provider.
 *   4. Plugins are versioned, health-checked, and circuit-broken.
 *
 * The plugin system builds on the existing adapter pattern but adds:
 *   - Explicit capability declarations (replaces implicit interface checks)
 *   - Standard lifecycle hooks (init, healthCheck, shutdown)
 *   - Versioned contracts (breaking changes require a new version)
 *   - Cost and latency metadata for intelligent routing
 */

// ─── Capability Types ─────────────────────────────────────────

/**
 * Standard capabilities that a provider plugin can declare.
 * The routing engine uses these to match providers to operations.
 */
export type ProviderCapability =
  | "virtual_account:create"
  | "virtual_account:close"
  | "wallet_funding:initiate"
  | "wallet_funding:simulate"
  | "local_transfer:send"
  | "local_transfer:status"
  | "international_transfer:send"
  | "international_transfer:status"
  | "international_receiving:parse_webhook"
  | "cross_border_settlement:get"
  | "fx_rate:quote"
  | "bill_payment:validate"
  | "bill_payment:pay"
  | "bill_payment:catalog"
  | "kyc:verify"
  | "notification:sms"
  | "notification:email"
  | "notification:push"
  | "virtual_card:create"
  | "virtual_card:fund"
  | "virtual_card:withdraw"
  | "webhook:handle";

/**
 * Cost metadata for routing decisions. The orchestration engine uses
 * these to pick the cheapest provider for a given operation.
 */
export interface ProviderCostProfile {
  /** Basis points (100 = 1%) — percentage fee on transaction amount. */
  percentageFeeBps: number;
  /** Fixed fee in minor units (kobo). */
  fixedFeeMinor: number;
  /** Currency the fee is denominated in. */
  feeCurrency: string;
}

/**
 * Latency metadata for routing decisions. Updated dynamically by the
 * health tracking proxy.
 */
export interface ProviderLatencyProfile {
  /** Average response time in ms (rolling window). */
  avgLatencyMs: number;
  /** P95 response time in ms. */
  p95LatencyMs: number;
  /** Success rate (0-1). */
  successRate: number;
}

// ─── Plugin Interface ─────────────────────────────────────────

/**
 * The core interface every provider plugin must implement.
 * This is the "contract" that the Enterprise Transformation spec requires.
 *
 * Plugins are stateless — all configuration comes from ProviderConfig
 * rows in the database (credentials, mode, priority, etc.).
 */
export interface ProviderPlugin {
  /** Unique provider identifier (e.g., "monnify", "paystack", "wise"). */
  readonly id: string;

  /** Human-readable name for admin UI. */
  readonly displayName: string;

  /** Provider version (semver). Bump on breaking contract changes. */
  readonly version: string;

  /** Provider homepage URL (for admin reference). */
  readonly website?: string;

  /**
   * Capabilities this plugin supports. The routing engine uses this
   * list to determine which providers can handle a given operation.
   * Example: ["local_transfer:send", "local_transfer:status", "wallet_funding:initiate"]
   */
  readonly capabilities: ProviderCapability[];

  /**
   * Default cost profile. Can be overridden per-contract in the DB.
   * Used by the cost-aware routing engine.
   */
  readonly costProfile: ProviderCostProfile;

  // ── Lifecycle Hooks ───────────────────────────────────────

  /**
   * Initialize the plugin with decrypted credentials from the DB.
   * Called once when the plugin is first resolved for a request.
   * Throw to prevent the plugin from being used (it will be skipped).
   */
  initialize(credentials: Record<string, string>): Promise<void>;

  /**
   * Health check — called periodically by the health monitoring system.
   * Should make a lightweight API call to verify the provider is reachable.
   * Return ok:true if healthy, ok:false with an error message if not.
   */
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;

  /**
   * Graceful shutdown. Called when the platform is shutting down.
   * Close connections, flush buffers, etc.
   */
  shutdown?(): Promise<void>;

  // ── Cost Estimation ──────────────────────────────────────

  /**
   * Estimate the fee for a specific operation. The routing engine
   * calls this to compare costs across providers before selecting one.
   * Return null if the provider can't estimate (e.g., unknown amount).
   */
  estimateFee(
    operation: string,
    amountMinor: number,
    currency: string
  ): Promise<number | null>;
}

// ─── Plugin Base Class ────────────────────────────────────────

/**
 * Abstract base class for provider plugins. Provides sensible defaults
 * and reduces boilerplate for common patterns.
 *
 * Usage:
 *   class MonnifyPlugin extends BaseProviderPlugin { ... }
 */
export abstract class BaseProviderPlugin implements ProviderPlugin {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly version: string;
  readonly website?: string;
  abstract readonly capabilities: ProviderCapability[];
  abstract readonly costProfile: ProviderCostProfile;

  protected credentials: Record<string, string> = {};
  private initialized = false;

  async initialize(credentials: Record<string, string>): Promise<void> {
    this.credentials = credentials;
    this.initialized = true;
    await this.onInitialize(credentials);
  }

  /**
   * Override in subclasses to perform provider-specific initialization
   * (e.g., create an HTTP client, validate credentials).
   */
  protected abstract onInitialize(credentials: Record<string, string>): Promise<void>;

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (!this.initialized) {
      return { ok: false, latencyMs: 0, error: "Plugin not initialized" };
    }
    const start = Date.now();
    try {
      await this.onHealthCheck();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "Health check failed",
      };
    }
  }

  /**
   * Override in subclasses to perform provider-specific health checks.
   */
  protected abstract onHealthCheck(): Promise<void>;

  async estimateFee(
    _operation: string,
    amountMinor: number,
    _currency: string
  ): Promise<number | null> {
    const fixed = this.costProfile.fixedFeeMinor;
    const percent = Math.round(amountMinor * this.costProfile.percentageFeeBps / 10000);
    return fixed + percent;
  }

  /**
   * Check if this plugin supports a given capability.
   */
  supports(capability: ProviderCapability): boolean {
    return this.capabilities.includes(capability);
  }
}

// ─── Plugin Registry ──────────────────────────────────────────

/**
 * Central registry for all provider plugins. Plugins register themselves
 * at startup; the orchestration engine queries this registry to find
 * providers that can handle a given operation.
 */
class PluginRegistryImpl {
  private plugins = new Map<string, ProviderPlugin>();
  private byCapability = new Map<ProviderCapability, Set<string>>();

  /**
   * Register a provider plugin. Called once per provider at startup.
   */
  register(plugin: ProviderPlugin): void {
    this.plugins.set(plugin.id, plugin);
    for (const cap of plugin.capabilities) {
      if (!this.byCapability.has(cap)) {
        this.byCapability.set(cap, new Set());
      }
      this.byCapability.get(cap)!.add(plugin.id);
    }
  }

  /**
   * Get a plugin by ID.
   */
  get(id: string): ProviderPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Find all plugins that support a given capability.
   * Results are ordered by priority (lower = higher priority).
   */
  findByCapability(capability: ProviderCapability): ProviderPlugin[] {
    const ids = this.byCapability.get(capability) ?? new Set();
    return Array.from(ids)
      .map((id) => this.plugins.get(id)!)
      .filter(Boolean);
  }

  /**
   * List all registered plugins.
   */
  list(): ProviderPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a summary of all plugins and their capabilities (for admin UI).
   */
  summary(): Array<{
    id: string;
    displayName: string;
    version: string;
    capabilities: ProviderCapability[];
    initialized: boolean;
  }> {
    return this.list().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      version: p.version,
      capabilities: p.capabilities,
      initialized: true, // TODO: track initialization state
    }));
  }
}

/** Singleton plugin registry. */
export const pluginRegistry = new PluginRegistryImpl();
