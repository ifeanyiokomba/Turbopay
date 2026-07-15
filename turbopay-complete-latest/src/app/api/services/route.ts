/**
 * Dynamic Service Discovery API
 * ==============================
 *
 * Returns available services from provider capabilities.
 * The frontend uses this to generate menus dynamically —
 * no hardcoded bill categories.
 *
 * GET /api/services — returns all available services grouped by category
 * GET /api/services?category=bill_payment — returns services for a specific category
 * GET /api/services?country=NG — returns services available in a specific country
 * GET /api/services?currency=NGN — returns services for a specific currency
 */

import { json } from "@/lib/turbopay/api";
import { capabilityRegistry, type CapabilityCategory, type CapabilityService } from "@/lib/turbocore/providers/capabilities";

interface ServiceResponse {
  category: CapabilityCategory;
  services: Array<{
    id: string;
    name: string;
    providers: string[];
    currencies: string[];
    countries: string[];
  }>;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") as CapabilityCategory | null;
  const country = url.searchParams.get("country");
  const currency = url.searchParams.get("currency");

  if (category) {
    // Return services for a specific category
    const providers = capabilityRegistry.findByCapability(category, country ?? undefined, currency ?? undefined);
    const services = aggregateServices(providers, category);
    return json({ data: { category, services } });
  }

  // Return all services grouped by category
  const allCategories: CapabilityCategory[] = [
    "bill_payment", "airtime", "data", "electricity", "tv", "betting",
    "education", "insurance", "collection", "transfer", "bulk_transfer",
    "virtual_account", "dedicated_account", "refund", "qr", "card_payments",
    "mobile_money", "papss", "fx", "merchant_collection",
  ];

  const result: ServiceResponse[] = [];

  for (const cat of allCategories) {
    const providers = capabilityRegistry.findByCapability(cat, country ?? undefined, currency ?? undefined);
    if (providers.length === 0) continue;

    const services = aggregateServices(providers, cat);
    if (services.length > 0) {
      result.push({ category: cat, services });
    }
  }

  return json({ data: result });
}

/**
 * Aggregate services from multiple providers into a unified list.
 * Merges services with the same name across providers.
 */
function aggregateServices(
  providers: Array<{ providerId: string; services: CapabilityService[] }>,
  category: CapabilityCategory
): ServiceResponse["services"] {
  const serviceMap = new Map<string, {
    id: string;
    name: string;
    providers: Set<string>;
    currencies: Set<string>;
    countries: Set<string>;
  }>();

  for (const provider of providers) {
    const categoryServices = provider.services.filter((s) => s.category === category);

    for (const service of categoryServices) {
      const existing = serviceMap.get(service.id);
      if (existing) {
        existing.providers.add(provider.providerId);
        service.currencies?.forEach((c) => existing.currencies.add(c));
        service.countries?.forEach((c) => existing.countries.add(c));
      } else {
        serviceMap.set(service.id, {
          id: service.id,
          name: service.name,
          providers: new Set([provider.providerId]),
          currencies: new Set(service.currencies ?? []),
          countries: new Set(service.countries ?? []),
        });
      }
    }
  }

  return Array.from(serviceMap.values()).map((s) => ({
    id: s.id,
    name: s.name,
    providers: Array.from(s.providers),
    currencies: Array.from(s.currencies),
    countries: Array.from(s.countries),
  }));
}
