/**
 * Public Capabilities API
 * =======================
 *
 * Returns available capabilities for the current user/context.
 * Used by the frontend to dynamically generate menus and hide
 * unsupported features.
 *
 * GET /api/capabilities — returns available services grouped by category
 */

import { json } from "@/lib/turbopay/api";
import { capabilityRegistry, type CapabilityCategory, type CapabilityService } from "@/lib/turbocore/providers/capabilities";

interface ServiceGroup {
  category: CapabilityCategory;
  label: string;
  services: CapabilityService[];
  providers: string[];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = url.searchParams.get("country") ?? undefined;
  const currency = url.searchParams.get("currency") ?? undefined;

  // Get all providers that support each category
  const categories: CapabilityCategory[] = [
    "collection", "transfer", "bulk_transfer", "bill_payment",
    "airtime", "data", "electricity", "tv", "betting",
    "education", "insurance", "virtual_account", "dedicated_account",
    "refund", "reversal", "qr", "card_payments", "bank_transfer",
    "mobile_money", "papss", "fx", "merchant_collection", "kyc",
    "subscription", "dispute", "settlement", "payment_page",
    "split_payment", "terminal", "virtual_terminal", "apple_pay",
    "direct_debit", "invoice", "international", "payout", "wallet",
    "paycode", "agent_banking", "card_issuance", "virtual_card",
    "stablecoin", "transport",
  ];

  const groups: ServiceGroup[] = [];

  for (const cat of categories) {
    const providers = capabilityRegistry.findByCapability(cat, country ?? undefined, currency ?? undefined);
    if (providers.length === 0) continue;

    // Collect all services for this category from all providers
    const services: CapabilityService[] = [];
    const providerNames: string[] = [];

    for (const provider of providers) {
      const catServices = provider.services.filter((s) => s.category === cat);
      services.push(...catServices);
      providerNames.push(provider.providerId);
    }

    // Deduplicate services by id
    const seen = new Set<string>();
    const uniqueServices = services.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    groups.push({
      category: cat,
      label: formatCategoryLabel(cat),
      services: uniqueServices,
      providers: providerNames,
    });
  }

  return json({
    data: {
      groups,
      totalCategories: groups.length,
      totalServices: groups.reduce((sum, g) => sum + g.services.length, 0),
    },
  });
}

function formatCategoryLabel(cat: CapabilityCategory): string {
  const labels: Record<string, string> = {
    collection: "Collections",
    transfer: "Transfers",
    bulk_transfer: "Bulk Transfers",
    bill_payment: "Bill Payments",
    airtime: "Airtime",
    data: "Data",
    electricity: "Electricity",
    tv: "TV & Cable",
    betting: "Betting",
    education: "Education",
    insurance: "Insurance",
    virtual_account: "Virtual Accounts",
    dedicated_account: "Dedicated Accounts",
    refund: "Refunds",
    reversal: "Reversals",
    qr: "QR Payments",
    card_payments: "Card Payments",
    bank_transfer: "Bank Transfers",
    mobile_money: "Mobile Money",
    papss: "PAPSS",
    fx: "Foreign Exchange",
    merchant_collection: "Merchant Collections",
    kyc: "KYC",
    subscription: "Subscriptions",
    dispute: "Disputes",
    settlement: "Settlements",
    payment_page: "Payment Pages",
    split_payment: "Split Payments",
    terminal: "POS Terminals",
    virtual_terminal: "Virtual Terminals",
    apple_pay: "Apple Pay",
    direct_debit: "Direct Debit",
    invoice: "Invoices",
    international: "International",
    payout: "Payouts",
    wallet: "Wallet",
    paycode: "Offline Payouts",
    agent_banking: "Agent Banking",
    card_issuance: "Card Issuance",
    virtual_card: "Virtual Cards",
    stablecoin: "Stablecoins",
    transport: "Transport",
  };
  return labels[cat] ?? cat;
}
