/**
 * Admin Capability Matrix API
 * ============================
 *
 * Returns the full capability matrix for all providers.
 * Used by the admin UI to display provider capabilities comparison.
 *
 * GET /api/admin/capability-matrix — returns the full matrix
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { capabilityRegistry, type CapabilityCategory } from "@/lib/turbocore/providers/capabilities";
import { requireAdmin } from "@/lib/turbopay/auth";

export async function GET() {
  try {
    await requireAdmin();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const providers = capabilityRegistry.list();
  const categories: CapabilityCategory[] = [
    "collection", "transfer", "bulk_transfer", "bill_payment",
    "airtime", "data", "electricity", "tv", "betting",
    "education", "insurance", "virtual_account", "dedicated_account",
    "refund", "reversal", "qr", "card_payments", "bank_transfer",
    "mobile_money", "papss", "fx", "merchant_collection", "kyc",
  ];

  // Build matrix: rows = categories, columns = providers
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const cat of categories) {
    matrix[cat] = {};
    for (const provider of providers) {
      matrix[cat][provider.providerId] = provider.categories.includes(cat);
    }
  }

  return json({
    data: {
      providers: providers.map((p) => ({
        id: p.providerId,
        name: p.displayName,
        version: p.version,
        countryCount: p.supportedCountries.length,
        currencyCount: p.supportedCurrencies.length,
        serviceCount: p.services.length,
      })),
      categories,
      matrix,
    },
  });
}
