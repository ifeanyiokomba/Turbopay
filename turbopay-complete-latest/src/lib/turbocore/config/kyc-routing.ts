/**
 * Country → KYC Provider Routing
 * ===============================
 *
 * Maps ISO 3166-1 alpha-2 country codes to their preferred KYC provider.
 * Used by the KYC service to select the right verification path.
 *
 * - NG, GH → Paystack Identity (NIN/BVN/phone verification)
 * - Everyone else → Stripe Identity (document-based verification)
 *
 * The actual provider resolution goes through the provider registry
 * (DB-backed routing), but this utility provides the default hint.
 */

const KYC_PROVIDER_MAP: Record<string, string> = {
  NG: "paystack",
  GH: "paystack",
};

const DEFAULT_KYC_PROVIDER = "stripe";

/**
 * Get the default KYC provider for a country code.
 * Returns "paystack" for NG/GH, "stripe" for everything else.
 */
export function getKycProvider(country: string): string {
  return KYC_PROVIDER_MAP[country.toUpperCase()] ?? DEFAULT_KYC_PROVIDER;
}

/** Whether the country uses Paystack Identity (NG/GH). */
export function usesPaystackIdentity(country: string): boolean {
  return getKycProvider(country) === "paystack";
}

/** Whether the country uses Stripe Identity (rest of world). */
export function usesStripeIdentity(country: string): boolean {
  return getKycProvider(country) === "stripe";
}
