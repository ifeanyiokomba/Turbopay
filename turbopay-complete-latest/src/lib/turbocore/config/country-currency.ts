/**
 * Country → Currency Mapping
 * ==========================
 *
 * Maps ISO 3166-1 alpha-2 country codes to their default currency.
 * Used at signup to derive the user's primary wallet currency, and
 * throughout the routing engine for country-based provider selection.
 *
 * The initial set covers TurboPay's launch markets. Unknown countries
 * fall back to USD — a sane global default.
 */

/** ISO country code → ISO currency code. */
export const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  NG: "NGN",
  GH: "GHS",
  US: "USD",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  IE: "EUR",
  KE: "KES",
  ZA: "ZAR",
  CA: "CAD",
  AU: "AUD",
};

/** ISO country code → phone dial code (without + prefix). */
export const COUNTRY_PHONE_CODES: Record<string, string> = {
  NG: "234",  // Nigeria
  GH: "233",  // Ghana
  US: "1",    // United States
  GB: "44",   // United Kingdom
  DE: "49",   // Germany
  FR: "33",   // France
  ES: "34",   // Spain
  IT: "39",   // Italy
  NL: "31",   // Netherlands
  IE: "353",  // Ireland
  KE: "254",  // Kenya
  ZA: "27",   // South Africa
  CA: "1",    // Canada
  AU: "61",   // Australia
};

/**
 * Normalize a phone number to international format based on country.
 * If the phone already starts with '+', return as-is.
 * Otherwise, prepend the country dial code.
 */
export function normalizePhone(phone: string, country: string): string {
  // Already in international format
  if (phone.startsWith("+")) return phone;
  
  // Get country dial code
  const dialCode = COUNTRY_PHONE_CODES[country.toUpperCase()];
  if (!dialCode) return phone; // Unknown country, return as-is
  
  // Remove leading zeros (local format often has them)
  const cleaned = phone.replace(/^0+/, "");
  
  return `+${dialCode}${cleaned}`;
}

/** Country display metadata. */
interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
}

const COUNTRY_DISPLAY: Record<string, Omit<CountryInfo, "code">> = {
  NG: { name: "Nigeria", currency: "NGN", currencySymbol: "₦" },
  GH: { name: "Ghana", currency: "GHS", currencySymbol: "GH₵" },
  US: { name: "United States", currency: "USD", currencySymbol: "$" },
  GB: { name: "United Kingdom", currency: "GBP", currencySymbol: "£" },
  DE: { name: "Germany", currency: "EUR", currencySymbol: "€" },
  FR: { name: "France", currency: "EUR", currencySymbol: "€" },
  ES: { name: "Spain", currency: "EUR", currencySymbol: "€" },
  IT: { name: "Italy", currency: "EUR", currencySymbol: "€" },
  NL: { name: "Netherlands", currency: "EUR", currencySymbol: "€" },
  IE: { name: "Ireland", currency: "EUR", currencySymbol: "€" },
  KE: { name: "Kenya", currency: "KES", currencySymbol: "KSh" },
  ZA: { name: "South Africa", currency: "ZAR", currencySymbol: "R" },
  CA: { name: "Canada", currency: "CAD", currencySymbol: "CA$" },
  AU: { name: "Australia", currency: "AUD", currencySymbol: "A$" },
};

/** Fallback currency for countries not in the mapping. */
const FALLBACK_CURRENCY = "USD";

/**
 * Get the default currency for a country code.
 * Falls back to USD for unknown countries.
 */
export function getDefaultCurrency(country: string): string {
  return COUNTRY_CURRENCY_MAP[country.toUpperCase()] ?? FALLBACK_CURRENCY;
}

/**
 * Get display info for a country code.
 * Returns a basic object for unknown countries (no display name, fallback currency).
 */
export function getCountryDisplay(country: string): CountryInfo {
  const code = country.toUpperCase();
  const display = COUNTRY_DISPLAY[code];
  return {
    code,
    name: display?.name ?? code,
    currency: display?.currency ?? FALLBACK_CURRENCY,
    currencySymbol: display?.currencySymbol ?? "",
  };
}

/** All country codes in the mapping. */
export function getSupportedCountries(): string[] {
  return Object.keys(COUNTRY_CURRENCY_MAP);
}

/** All unique currencies across the mapping. */
export function getSupportedCurrencies(): string[] {
  return [...new Set(Object.values(COUNTRY_CURRENCY_MAP))];
}

/** Currency symbol lookup. */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  GHS: "GH₵",
  USD: "$",
  GBP: "£",
  EUR: "€",
  KES: "KSh",
  ZAR: "R",
  CAD: "CA$",
  AUD: "A$",
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency;
}
