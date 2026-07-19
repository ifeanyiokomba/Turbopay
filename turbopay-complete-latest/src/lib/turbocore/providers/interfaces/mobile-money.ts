/**
 * TurboCore — Mobile Money Provider Interface
 * ============================================
 *
 * Unified interface for Mobile Money providers (MTN MoMo, Airtel Money, M-Pesa, Paga).
 * All providers implement this interface for consistent integration.
 */

import type { Currency } from "@/lib/turbocore/types";

// ─── Mobile Money Provider Types ─────────────────────────────

export type MobileMoneyProvider = "mtn-momo" | "airtel-money" | "m-pesa" | "paga";

export type MobileMoneyOperation = 
  | "collection"      // Receive money from mobile money
  | "disbursement"    // Send money to mobile money
  | "balance"         // Check account balance
  | "transfer";       // Transfer between accounts

export interface MobileMoneyConfig {
  apiKey?: string;
  apiUser?: string;
  subscriptionKey?: string;
  clientId?: string;
  clientSecret?: string;
  consumerKey?: string;
  consumerSecret?: string;
  passKey?: string;
  businessShortCode?: string;
  merchantId?: string;
  secretKey?: string;
  environment: "sandbox" | "production";
  country: string;
  currency: Currency;
  webhookUrl?: string;
}

export interface MobileMoneyCollectionInput {
  /** Phone number in international format (e.g., "+2348012345678"). */
  phoneNumber: string;
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency: Currency;
  /** Unique reference for this transaction. */
  reference: string;
  /** Description/purpose of the collection. */
  description?: string;
  /** Country code (ISO 3166-1 alpha-2). */
  country: string;
}

export interface MobileMoneyDisbursementInput {
  /** Phone number in international format. */
  phoneNumber: string;
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency: Currency;
  /** Unique reference for this transaction. */
  reference: string;
  /** Description/purpose of the disbursement. */
  description?: string;
  /** Country code (ISO 3166-1 alpha-2). */
  country: string;
}

export interface MobileMoneyResult {
  /** Provider's transaction reference. */
  providerRef: string;
  /** Transaction status. */
  status: "PENDING" | "SUCCESS" | "FAILED" | "REJECTED";
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency: Currency;
  /** Phone number. */
  phoneNumber: string;
  /** Transaction date. */
  transactionDate: Date;
  /** Provider fee in minor units. */
  feeMinor?: number;
  /** External transaction reference (for reconciliation). */
  externalRef?: string;
}

export interface MobileMoneyBalanceResult {
  /** Available balance in minor units. */
  balance: number;
  /** Currency code. */
  currency: Currency;
  /** Account status. */
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

// ─── Mobile Money Provider Interface ─────────────────────────

export interface IMobileMoneyProvider {
  /** Provider name. */
  readonly name: MobileMoneyProvider;
  
  /** Provider display name. */
  readonly displayName: string;
  
  /** Supported countries. */
  readonly supportedCountries: string[];
  
  /** Supported currencies. */
  readonly supportedCurrencies: Currency[];

  /** Initialize the provider with credentials. */
  initialize(config: MobileMoneyConfig): Promise<void>;
  
  /** Check if provider is healthy. */
  healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }>;
  
  /** Initiate a collection (receive money). */
  collect(input: MobileMoneyCollectionInput): Promise<ProviderResult<MobileMoneyResult>>;
  
  /** Initiate a disbursement (send money). */
  disburse(input: MobileMoneyDisbursementInput): Promise<ProviderResult<MobileMoneyResult>>;
  
  /** Check transaction status. */
  checkStatus(providerRef: string): Promise<ProviderResult<MobileMoneyResult>>;
  
  /** Get account balance. */
  getBalance(): Promise<ProviderResult<MobileMoneyBalanceResult>>;
  
  /** Validate phone number format for this provider. */
  validatePhoneNumber(phone: string): boolean;
}

// ─── Mobile Money Country Configuration ──────────────────────

export interface MobileMoneyCountryConfig {
  /** Country code (ISO 3166-1 alpha-2). */
  country: string;
  /** Country name. */
  countryName: string;
  /** Default currency. */
  defaultCurrency: Currency;
  /** Available providers for this country. */
  providers: MobileMoneyProvider[];
  /** Provider priority order (first = preferred). */
  priorityOrder: MobileMoneyProvider[];
  /** Phone format regex. */
  phoneFormat: RegExp;
  /** Phone prefix (without +). */
  phonePrefix: string;
}

// ─── Mobile Money Country Registry ───────────────────────────

export const MOBILE_MONEY_COUNTRIES: Record<string, MobileMoneyCountryConfig> = {
  NG: {
    country: "NG",
    countryName: "Nigeria",
    defaultCurrency: "NGN",
    providers: ["paga", "airtel-money", "mtn-momo"],
    priorityOrder: ["paga", "airtel-money", "mtn-momo"],
    phoneFormat: /^(\+234|234|0)[789][01]\d{8}$/,
    phonePrefix: "234",
  },
  GH: {
    country: "GH",
    countryName: "Ghana",
    defaultCurrency: "GHS",
    providers: ["mtn-momo", "airtel-money"],
    priorityOrder: ["mtn-momo", "airtel-money"],
    phoneFormat: /^(\+233|233|0)[235]\d{8}$/,
    phonePrefix: "233",
  },
  KE: {
    country: "KE",
    countryName: "Kenya",
    defaultCurrency: "KES",
    providers: ["m-pesa", "airtel-money"],
    priorityOrder: ["m-pesa", "airtel-money"],
    phoneFormat: /^(\+254|254|0)[17]\d{8}$/,
    phonePrefix: "254",
  },
  UG: {
    country: "UG",
    countryName: "Uganda",
    defaultCurrency: "UGX",
    providers: ["mtn-momo", "airtel-money"],
    priorityOrder: ["mtn-momo", "airtel-money"],
    phoneFormat: /^(\+256|256|0)[7]\d{8}$/,
    phonePrefix: "256",
  },
  TZ: {
    country: "TZ",
    countryName: "Tanzania",
    defaultCurrency: "TZS",
    providers: ["m-pesa", "airtel-money"],
    priorityOrder: ["m-pesa", "airtel-money"],
    phoneFormat: /^(\+255|255|0)[67]\d{8}$/,
    phonePrefix: "255",
  },
  ZA: {
    country: "ZA",
    countryName: "South Africa",
    defaultCurrency: "ZAR",
    providers: ["mtn-momo", "airtel-money"],
    priorityOrder: ["mtn-momo", "airtel-money"],
    phoneFormat: /^(\+27|27|0)[678]\d{8}$/,
    phonePrefix: "27",
  },
  CM: {
    country: "CM",
    countryName: "Cameroon",
    defaultCurrency: "XAF",
    providers: ["mtn-momo", "airtel-money"],
    priorityOrder: ["mtn-momo", "airtel-money"],
    phoneFormat: /^(\+237|237)[26]\d{8}$/,
    phonePrefix: "237",
  },
  CI: {
    country: "CI",
    countryName: "Côte d'Ivoire",
    defaultCurrency: "XOF",
    providers: ["mtn-momo", "airtel-money"],
    priorityOrder: ["mtn-momo", "airtel-money"],
    phoneFormat: /^(\+225|225)[07]\d{8}$/,
    phonePrefix: "225",
  },
};

/**
 * Get country configuration for mobile money.
 */
export function getMobileMoneyCountryConfig(country: string): MobileMoneyCountryConfig | null {
  return MOBILE_MONEY_COUNTRIES[country.toUpperCase()] || null;
}

/**
 * Get available providers for a country.
 */
export function getAvailableProviders(country: string): MobileMoneyProvider[] {
  const config = getMobileMoneyCountryConfig(country);
  return config?.providers || [];
}

/**
 * Get provider priority order for a country.
 */
export function getProviderPriority(country: string): MobileMoneyProvider[] {
  const config = getMobileMoneyCountryConfig(country);
  return config?.priorityOrder || [];
}
