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

// Reference & account-number generators live in reference.ts (crypto-secure,
// isolated to avoid circular deps). Re-exported here for backward compat.
export { generateReference, generateAccountNumber } from "@/lib/turbopay/reference";
