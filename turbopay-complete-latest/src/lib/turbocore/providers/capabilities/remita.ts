/**
 * Remita — Provider Capability Declaration
 * ==========================================
 *
 * Capabilities derived from Remita API documentation (remita.net/developers):
 * - Bill Payments: electricity, cable TV, airtime, data, education
 * - Government Payments: TSA, MDA payments, taxes
 * - Collections: RRR-based invoice payments
 * - Transfers: RITs (Remita Interbank Transfer Service) - single and bulk
 * - Settlements: merchant/biller settlement to bank accounts
 * - Split Payments: multiple beneficiaries per RRR
 * - Direct Debit: mandate-based recurring collections
 * - Bank Resolution: account name inquiry
 *
 * NOT supported: Cards, QR Codes, International, FX, Refunds, Reversals
 * Nigeria-only, NGN-only
 *
 * Documentation: https://remita.net/developers
 */

import type { ProviderCapabilities } from "../capabilities";

export const remitaCapabilities: ProviderCapabilities = {
  providerId: "remita",
  displayName: "Remita",
  version: "1.0.0",

  categories: [
    "bill_payment",
    "electricity",
    "tv",
    "airtime",
    "data",
    "education",
    "collection",
    "transfer",
    "bulk_transfer",
    "settlement",
    "split_payment",
    "direct_debit",
    "bank_resolution",
    "merchant_collection",
  ],

  services: [
    // Bill Payments
    { id: "remita_electricity", name: "Electricity", category: "electricity", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_tv", name: "Cable TV", category: "tv", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_airtime", name: "Airtime", category: "airtime", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_data", name: "Data", category: "data", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_education", name: "Education", category: "education", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_govt", name: "Government Payments (TSA)", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_tax", name: "Tax Payments", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },

    // Collections (RRR-based)
    { id: "remita_invoice", name: "Invoice Collection (RRR)", category: "collection", currencies: ["NGN"], countries: ["NG"] },

    // Transfers (RITs)
    { id: "remita_single_transfer", name: "Single Transfer (RITs)", category: "transfer", currencies: ["NGN"], countries: ["NG"] },
    { id: "remita_bulk_transfer", name: "Bulk Transfer (RITs)", category: "bulk_transfer", currencies: ["NGN"], countries: ["NG"] },

    // Settlements
    { id: "remita_settlement", name: "Settlement", category: "settlement", currencies: ["NGN"], countries: ["NG"] },

    // Split Payments
    { id: "remita_split", name: "Split Payment", category: "split_payment", currencies: ["NGN"], countries: ["NG"] },

    // Direct Debit
    { id: "remita_direct_debit", name: "Direct Debit", category: "direct_debit", currencies: ["NGN"], countries: ["NG"] },

    // Bank Resolution
    { id: "remita_bank_resolution", name: "Bank Resolution", category: "bank_resolution", currencies: ["NGN"], countries: ["NG"] },

    // Merchant
    { id: "remita_merchant", name: "Merchant Collection", category: "merchant_collection", currencies: ["NGN"], countries: ["NG"] },
  ],

  supportedCountries: ["NG"],
  supportedCurrencies: ["NGN"],

  supportsWebhooks: true,
  supportsSettlement: true,

  costProfile: {
    percentageFeeBps: 100, // 1.0%
    fixedFeeMinor: 0,
    feeCurrency: "NGN",
  },

  rateLimits: {
    requestsPerMinute: 100,
  },

  // ─── Capability Query Methods ────────────────────────────────
  supportsCollection: () => true,
  supportsTransfer: () => true, // Via RITs
  supportsBulkTransfer: () => true, // Via RITs
  supportsVirtualAccount: () => false,
  supportsDedicatedAccount: () => false,
  supportsRefund: () => false, // Not supported via API
  supportsReversal: () => false, // Not supported via API
  supportsMerchantCollection: () => true,
  supportsBillPayment: () => true,
  supportsAirtime: () => true,
  supportsData: () => true,
  supportsElectricity: () => true,
  supportsTV: () => true,
  supportsBetting: () => false,
  supportsEducation: () => true,
  supportsInsurance: () => false,
  supportsQR: () => false,
  supportsCards: () => false,
  supportsMobileMoney: () => false,
  supportsInternational: () => false,
  supportsFX: () => false,
  supportsPAPSS: () => false,
  supportsWebhook: () => true,
  supportsSettlementMethod: () => true,
  supportsBankResolution: () => true,
  supportsBVN: () => false,
  supportsKYC: () => false,
  supportsSplitPayment: () => true,
  supportsDirectDebit: () => true,
};
