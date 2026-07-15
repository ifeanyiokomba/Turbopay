/**
 * TurboCore — Provider Capability Engine
 * =======================================
 *
 * Every provider declares what it CAN do via a ProviderCapabilities object.
 * TurboPay queries capabilities instead of guessing — the routing engine,
 * admin UI, and dynamic frontend all read from this single source of truth.
 *
 * Design principles:
 *   1. Capabilities are declared per-provider, not inferred from interfaces.
 *   2. The capability matrix is generated from documentation, not assumptions.
 *   3. Adding a new provider requires only a capability declaration — no
 *      business code changes.
 *   4. The frontend discovers services dynamically from capabilities.
 */

// ─── Capability Types ─────────────────────────────────────────

/**
 * Standard capability categories. Each provider declares which categories
 * it supports and the specific services within each category.
 */
export type CapabilityCategory =
  | "collection"
  | "transfer"
  | "bulk_transfer"
  | "bill_payment"
  | "airtime"
  | "data"
  | "electricity"
  | "tv"
  | "betting"
  | "education"
  | "insurance"
  | "transport"
  | "virtual_account"
  | "dedicated_account"
  | "reserved_account"
  | "refund"
  | "reversal"
  | "qr"
  | "card_payments"
  | "card_issuance"
  | "virtual_card"
  | "card_tokenization"
  | "bank_transfer"
  | "mobile_money"
  | "papss"
  | "fx"
  | "stablecoin"
  | "kyc"
  | "notification_sms"
  | "notification_email"
  | "notification_push"
  | "webhook"
  | "settlement"
  | "bank_resolution"
  | "bvn"
  | "merchant_collection"
  | "subscription"
  | "plan"
  | "customer"
  | "dispute"
  | "payment_page"
  | "payment_request"
  | "split_payment"
  | "subaccount"
  | "terminal"
  | "virtual_terminal"
  | "apple_pay"
  | "direct_debit"
  | "invoice"
  | "international"
  | "payout"
  | "wallet"
  | "paycode"
  | "agent_banking";

/**
 * A specific service within a capability category.
 * Example: Under "bill_payment", services might be "electricity", "airtime", "data".
 */
export interface CapabilityService {
  /** Unique service identifier (e.g., "ikedc_prepaid", "mtn_airtime"). */
  id: string;
  /** Human-readable name (e.g., "IKEDC Prepaid", "MTN Airtime"). */
  name: string;
  /** Service category (e.g., "electricity", "airtime"). */
  category: CapabilityCategory;
  /** Product codes this service supports (provider-specific). */
  productCodes?: string[];
  /** Supported currencies for this service. */
  currencies?: string[];
  /** Supported countries for this service. */
  countries?: string[];
  /** Whether this service requires validation before payment. */
  requiresValidation?: boolean;
  /** Fixed amount (if applicable, in minor units). */
  fixedAmountMinor?: number;
  /** Whether this service supports variable amounts. */
  variableAmount?: boolean;
}

/**
 * Provider capabilities — the complete set of what a provider can do.
 * Each provider publishes this object; the routing engine queries it.
 *
 * Every capability has a corresponding `supports*()` method that returns
 * a boolean. The routing engine uses these methods to filter providers.
 */
export interface ProviderCapabilities {
  /** Provider identifier (e.g., "paystack", "flutterwave"). */
  providerId: string;
  /** Human-readable name. */
  displayName: string;
  /** Provider version. */
  version: string;

  /** Set of capability categories this provider supports. */
  categories: CapabilityCategory[];

  /** Detailed services within each category. */
  services: CapabilityService[];

  /** Supported countries (ISO 3166-1 alpha-2). */
  supportedCountries: string[];

  /** Supported currencies (ISO 4217). */
  supportedCurrencies: string[];

  /** Whether this provider supports webhooks. */
  supportsWebhooks: boolean;

  /** Whether this provider supports settlement tracking. */
  supportsSettlement: boolean;

  /** Cost profile for routing decisions. */
  costProfile: {
    /** Basis points (100 = 1%). */
    percentageFeeBps: number;
    /** Fixed fee in minor units. */
    fixedFeeMinor: number;
    /** Fee currency. */
    feeCurrency: string;
  };

  /** Rate limits (requests per minute). */
  rateLimits?: {
    /** Maximum requests per minute. */
    requestsPerMinute: number;
    /** Maximum transfer amount per request (in minor units). */
    maxTransferAmount?: number;
    /** Maximum number of bulk items per request. */
    maxBulkItems?: number;
  };

  // ─── Capability Query Methods ────────────────────────────────
  // Every provider MUST implement these methods. They return true/false
  // based on the provider's documented capabilities.

  supportsCollection(): boolean;
  supportsTransfer(): boolean;
  supportsBulkTransfer(): boolean;
  supportsVirtualAccount(): boolean;
  supportsDedicatedAccount(): boolean;
  supportsRefund(): boolean;
  supportsReversal(): boolean;
  supportsMerchantCollection(): boolean;
  supportsBillPayment(): boolean;
  supportsAirtime(): boolean;
  supportsData(): boolean;
  supportsElectricity(): boolean;
  supportsTV(): boolean;
  supportsBetting(): boolean;
  supportsEducation(): boolean;
  supportsInsurance(): boolean;
  supportsQR(): boolean;
  supportsCards(): boolean;
  supportsMobileMoney(): boolean;
  supportsInternational(): boolean;
  supportsFX(): boolean;
  supportsPAPSS(): boolean;
  supportsWebhook(): boolean;
  supportsSettlementMethod(): boolean;
  supportsBankResolution(): boolean;
  supportsBVN(): boolean;
  supportsKYC(): boolean;

  // Extended capability methods (Phase 1 sync)
  supportsSubscription?: () => boolean;
  supportsPlan?: () => boolean;
  supportsCustomer?: () => boolean;
  supportsDispute?: () => boolean;
  supportsPaymentPage?: () => boolean;
  supportsPaymentRequest?: () => boolean;
  supportsSplitPayment?: () => boolean;
  supportsSubaccount?: () => boolean;
  supportsTerminal?: () => boolean;
  supportsVirtualTerminal?: () => boolean;
  supportsApplePay?: () => boolean;
  supportsGooglePay?: () => boolean;
  supportsDirectDebit?: () => boolean;
  supportsInvoice?: () => boolean;
  supportsCardTokenization?: () => boolean;
  supportsCardIssuance?: () => boolean;
  supportsVirtualCard?: () => boolean;
  supportsStablecoin?: () => boolean;
  supportsNIN?: () => boolean;
  supportsWallet?: () => boolean;
  supportsPaycode?: () => boolean;
  supportsAgentBanking?: () => boolean;
  supportsPayout?: () => boolean;
  supportsTransport?: () => boolean;
}

// ─── Capability Registry ──────────────────────────────────────

/**
 * Central registry for all provider capabilities. Providers register
 * their capabilities at startup; the routing engine and admin UI
 * query this registry.
 */
class CapabilityRegistryImpl {
  private capabilities = new Map<string, ProviderCapabilities>();
  private byCategory = new Map<CapabilityCategory, Set<string>>();
  private byCountry = new Map<string, Set<string>>();
  private byCurrency = new Map<string, Set<string>>();

  /**
   * Register a provider's capabilities.
   */
  register(capabilities: ProviderCapabilities): void {
    this.capabilities.set(capabilities.providerId, capabilities);

    // Index by category
    for (const cat of capabilities.categories) {
      if (!this.byCategory.has(cat)) {
        this.byCategory.set(cat, new Set());
      }
      this.byCategory.get(cat)!.add(capabilities.providerId);
    }

    // Index by country
    for (const country of capabilities.supportedCountries) {
      if (!this.byCountry.has(country)) {
        this.byCountry.set(country, new Set());
      }
      this.byCountry.get(country)!.add(capabilities.providerId);
    }

    // Index by currency
    for (const currency of capabilities.supportedCurrencies) {
      if (!this.byCurrency.has(currency)) {
        this.byCurrency.set(currency, new Set());
      }
      this.byCurrency.get(currency)!.add(capabilities.providerId);
    }
  }

  /**
   * Get capabilities for a specific provider.
   */
  get(providerId: string): ProviderCapabilities | undefined {
    return this.capabilities.get(providerId);
  }

  /**
   * Find all providers that support a given capability category.
   * Optionally filter by country and currency.
   */
  findByCapability(
    category: CapabilityCategory,
    country?: string,
    currency?: string
  ): ProviderCapabilities[] {
    let candidates = this.byCategory.get(category) ?? new Set();

    if (country) {
      const countryProviders = this.byCountry.get(country) ?? new Set();
      candidates = new Set([...candidates].filter((id) => countryProviders.has(id)));
    }

    if (currency) {
      const currencyProviders = this.byCurrency.get(currency) ?? new Set();
      candidates = new Set([...candidates].filter((id) => currencyProviders.has(id)));
    }

    return [...candidates]
      .map((id) => this.capabilities.get(id)!)
      .filter(Boolean);
  }

  /**
   * Find providers that support a specific service within a category.
   */
  findByService(
    category: CapabilityCategory,
    serviceId: string,
    country?: string,
    currency?: string
  ): ProviderCapabilities[] {
    return this.findByCapability(category, country, currency).filter((p) =>
      p.services.some((s) => s.id === serviceId && s.category === category)
    );
  }

  /**
   * List all registered providers.
   */
  list(): ProviderCapabilities[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Get a summary for the admin UI.
   */
  summary(): Array<{
    providerId: string;
    displayName: string;
    version: string;
    categories: CapabilityCategory[];
    countryCount: number;
    currencyCount: number;
    serviceCount: number;
  }> {
    return this.list().map((p) => ({
      providerId: p.providerId,
      displayName: p.displayName,
      version: p.version,
      categories: p.categories,
      countryCount: p.supportedCountries.length,
      currencyCount: p.supportedCurrencies.length,
      serviceCount: p.services.length,
    }));
  }

  /**
   * Get the full capability matrix (for admin export).
   */
  matrix(): Record<CapabilityCategory, string[]> {
    const matrix: Record<CapabilityCategory, string[]> = {} as any;
    for (const [category, providers] of this.byCategory) {
      matrix[category] = [...providers];
    }
    return matrix;
  }
}

/** Singleton capability registry. */
export const capabilityRegistry = new CapabilityRegistryImpl();
