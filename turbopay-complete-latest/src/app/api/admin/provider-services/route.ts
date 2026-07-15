/**
 * Admin Provider Services API
 * ============================
 *
 * Lists all available services from provider capabilities.
 * Used by the admin UI to display provider capabilities,
 * service catalogs, and capability matrices.
 *
 * GET /api/admin/provider-services — returns all provider services
 * GET /api/admin/provider-services?provider=flutterwave — returns services for a specific provider
 */

import { json, errorJson } from "@/lib/turbopay/api";
import { capabilityRegistry, type CapabilityCategory } from "@/lib/turbocore/providers/capabilities";
import { requireAdmin } from "@/lib/turbopay/auth";

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return errorJson(e.message, e.status ?? 401, e.code);
  }

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");

  if (provider) {
    const caps = capabilityRegistry.get(provider);
    if (!caps) {
      return errorJson(`Provider ${provider} not found`, 404, "NOT_FOUND");
    }
    return json({
      data: {
        providerId: caps.providerId,
        displayName: caps.displayName,
        version: caps.version,
        categories: caps.categories,
        services: caps.services,
        supportedCountries: caps.supportedCountries,
        supportedCurrencies: caps.supportedCurrencies,
        supportsWebhooks: caps.supportsWebhooks,
        supportsSettlement: caps.supportsSettlement,
        costProfile: caps.costProfile,
        rateLimits: caps.rateLimits,
        capabilities: {
          collection: caps.supportsCollection(),
          transfer: caps.supportsTransfer(),
          bulkTransfer: caps.supportsBulkTransfer(),
          virtualAccount: caps.supportsVirtualAccount(),
          dedicatedAccount: caps.supportsDedicatedAccount(),
          refund: caps.supportsRefund(),
          reversal: caps.supportsReversal(),
          merchantCollection: caps.supportsMerchantCollection(),
          billPayment: caps.supportsBillPayment(),
          airtime: caps.supportsAirtime(),
          data: caps.supportsData(),
          electricity: caps.supportsElectricity(),
          tv: caps.supportsTV(),
          betting: caps.supportsBetting(),
          education: caps.supportsEducation(),
          insurance: caps.supportsInsurance(),
          qr: caps.supportsQR(),
          cards: caps.supportsCards(),
          mobileMoney: caps.supportsMobileMoney(),
          international: caps.supportsInternational(),
          fx: caps.supportsFX(),
          papss: caps.supportsPAPSS(),
          webhook: caps.supportsWebhook(),
          settlement: caps.supportsSettlementMethod(),
          bankResolution: caps.supportsBankResolution(),
          bvn: caps.supportsBVN(),
          kyc: caps.supportsKYC(),
        },
      },
    });
  }

  // Return summary of all providers
  const summary = capabilityRegistry.summary();
  return json({ data: summary });
}
