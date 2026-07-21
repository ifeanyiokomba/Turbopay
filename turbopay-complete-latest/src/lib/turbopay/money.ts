/**
 * Money utilities. All amounts are stored as Int kobo (1 NGN = 100 kobo).
 * This avoids floating-point errors — the industry-standard "minor units" pattern.
 */

export const KOBOS_PER_NAIRA = 100;

/** Naira → kobo. */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBOS_PER_NAIRA);
}

/** Kobo → Naira (float). Use only for display. */
export function koboToNaira(kobo: number): number {
  return kobo / KOBOS_PER_NAIRA;
}

/** Format kobo as a Naira string: ₦1,250.00 */
export function formatNaira(kobo: number, opts?: { sign?: boolean; decimals?: number }): string {
  const naira = koboToNaira(kobo);
  const decimals = opts?.decimals ?? 2;
  const formatted = naira.toLocaleString("en-NG", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = opts?.sign ? (kobo >= 0 ? "+" : "-") : "";
  return `${prefix}₦${formatted.replace("-", "")}`;
}

/** Compact format for tight UI: ₦1.2k, ₦3.4M */
export function formatNairaCompact(kobo: number): string {
  const naira = koboToNaira(kobo);
  const abs = Math.abs(naira);
  const sign = naira < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}₦${(abs / 1_000).toFixed(1)}k`;
  return `${sign}₦${abs.toFixed(0)}`;
}

/** Parse a user-typed Naira string ("1,250.50", "1250") into kobo. */
export function parseNairaToKobo(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const naira = parseFloat(cleaned);
  if (isNaN(naira)) return 0;
  return nairaToKobo(naira);
}

// ─── Multi-Currency Minor Units ──────────────────────────────────────────

/**
 * Decimal places per currency code. Uses `?? 2` (not `||`) so that
 * currencies with 0 decimal places (UGX, TZS, RWF) are not falsy-mistaken
 * for "missing".
 */
const DECIMAL_PLACES: Record<string, number> = {
  NGN: 2, GHS: 2, KES: 2, USD: 2, EUR: 2, GBP: 2, ZAR: 2,
  UGX: 0, TZS: 0, RWF: 0,
  ETB: 2, MWK: 2, EGP: 2, ZMW: 2,
};

/** Convert a major-unit amount to minor units (e.g. 100 NGN → 10000 kobo). */
export function toMinorUnits(amount: number, currency: string): number {
  const decimals = DECIMAL_PLACES[currency] ?? 2;
  return Math.round(amount * 10 ** decimals);
}

/** Convert minor units back to major units (e.g. 10000 kobo → 100 NGN). */
export function fromMinorUnits(amount: number, currency: string): number {
  const decimals = DECIMAL_PLACES[currency] ?? 2;
  return amount / 10 ** decimals;
}

/** Format a major-unit amount with the currency's Intl style. */
export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

// ─── Reference & Account Number Generators ───────────────────────────────

// Re-exported for backward compat.
export { generateReference, generateAccountNumber } from "@/lib/turbopay/reference";
