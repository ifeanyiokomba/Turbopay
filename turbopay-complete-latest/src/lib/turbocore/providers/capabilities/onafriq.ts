/**
 * Onafriq — Provider Capability Declaration
 * ===========================================
 *
 * Capabilities derived from Onafriq API documentation (onafriq.com, developers.onafriq.com):
 * - Collections: cards, cash, mobile wallets
 * - Disbursements: bank transfers, mobile money, bulk payouts
 * - Mobile Money: M-Pesa, Airtel Money, Orange Money, MTN MoMo, EcoCash
 * - Virtual Accounts: Baxi agent wallet accounts
 * - Card Issuance: physical/virtual prepaid cards (Visa, Mastercard, Verve)
 * - Agent Banking: 460,000+ agents in Nigeria (via Baxi)
 * - Treasury Services: multi-currency FX
 * - PAPSS: Pan-African Payment and Settlement System
 * - Bill Payments: via Baxi agent banking (electricity, TV, airtime, data)
 * - Stablecoins: where regulation permits
 * - Cross-border: 2,000+ corridors across 43 African countries
 *
 * Coverage: 43 African markets, 1 billion connected mobile wallets
 *
 * Documentation: https://onafriq.com, https://apidocs.beyonic.com
 */

import type { ProviderCapabilities } from "../capabilities";

export const onafriqCapabilities: ProviderCapabilities = {
  providerId: "onafriq",
  displayName: "Onafriq",
  version: "1.0.0",

  categories: [
    "collection",
    "transfer",
    "bulk_transfer",
    "mobile_money",
    "bank_transfer",
    "virtual_account",
    "card_issuance",
    "bill_payment",
    "airtime",
    "data",
    "electricity",
    "tv",
    "agent_banking",
    "papss",
    "fx",
    "stablecoin",
    "settlement",
    "international",
    "merchant_collection",
  ],

  services: [
    // Collections
    { id: "onafriq_card", name: "Card Collection", category: "collection", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },
    { id: "onafriq_cash", name: "Cash Collection", category: "collection", currencies: ["NGN", "GHS", "KES"], countries: ["NG", "GH", "KE"] },

    // Mobile Money
    { id: "onafriq_momo_collection", name: "Mobile Money Collection", category: "mobile_money", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },
    { id: "onafriq_momo_payout", name: "Mobile Money Payout", category: "mobile_money", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },

    // Bank Transfers
    { id: "onafriq_bank_transfer_in", name: "Bank Transfer Collection", category: "bank_transfer", currencies: ["NGN", "GHS", "KES"], countries: ["NG", "GH", "KE"] },
    { id: "onafriq_bank_transfer_out", name: "Bank Transfer Payout", category: "bank_transfer", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },

    // Transfers
    { id: "onafriq_single_transfer", name: "Single Transfer", category: "transfer", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },
    { id: "onafriq_bulk_transfer", name: "Bulk Transfer", category: "bulk_transfer", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },

    // Virtual Accounts
    { id: "onafriq_virtual_account", name: "Virtual Account", category: "virtual_account", currencies: ["NGN"], countries: ["NG"] },

    // Card Issuance
    { id: "onafriq_card_issuance", name: "Card Issuance", category: "card_issuance", currencies: ["NGN", "GHS", "KES", "USD"], countries: ["NG", "GH", "KE", "US"] },

    // Bill Payments (via Baxi)
    { id: "onafriq_bill_electricity", name: "Electricity", category: "electricity", currencies: ["NGN"], countries: ["NG"] },
    { id: "onafriq_bill_tv", name: "TV Subscription", category: "tv", currencies: ["NGN"], countries: ["NG"] },
    { id: "onafriq_airtime", name: "Airtime", category: "airtime", currencies: ["NGN"], countries: ["NG"] },
    { id: "onafriq_data", name: "Data", category: "data", currencies: ["NGN"], countries: ["NG"] },

    // Agent Banking (Baxi)
    { id: "onafriq_agent_banking", name: "Agent Banking", category: "agent_banking", currencies: ["NGN"], countries: ["NG"] },

    // PAPSS
    { id: "onafriq_papss", name: "PAPSS Cross-Border Payment", category: "papss", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM"] },

    // FX
    { id: "onafriq_fx", name: "Treasury FX Services", category: "fx", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "USD", "GBP", "EUR", "XOF", "XAF"], countries: ["NG", "GH", "KE", "UG", "TZ", "ZA", "US", "GB", "EU", "SN", "CM"] },

    // Stablecoins
    { id: "onafriq_stablecoin", name: "Stablecoin Settlement", category: "stablecoin", currencies: ["USDC", "USDT"], countries: ["*"] },

    // Settlements
    { id: "onafriq_settlement", name: "Settlement", category: "settlement", currencies: ["USD"], countries: ["*"] },

    // Merchant
    { id: "onafriq_merchant", name: "Merchant Collection", category: "merchant_collection", currencies: ["NGN", "GHS", "KES"], countries: ["NG", "GH", "KE"] },
  ],

  supportedCountries: [
    "NG", "GH", "KE", "UG", "TZ", "ZA", "SN", "CM", "CI", "RW",
    "ZM", "MW", "MZ", "MG", "MU", "BW", "NA", "SZ", "LS", "AO",
    "CD", "CG", "GA", "GQ", "ST", "CV", "GM", "GN", "SL", "LR",
    "BJ", "TG", "BF", "ML", "NE", "TD", "CF", "SS", "ET", "SO",
    "DJ", "ER", "BI", "US", "GB", "CN",
  ],
  supportedCurrencies: [
    "NGN", "GHS", "KES", "UGX", "TZS", "ZAR", "XOF", "XAF",
    "USD", "GBP", "EUR", "CNY", "RWF", "ZMW", "MWK", "MZN",
    "BWP", "MAD", "ETB",
  ],

  supportsWebhooks: true,
  supportsSettlement: true,

  costProfile: {
    percentageFeeBps: 200, // 2.0% — estimated, needs documentation
    fixedFeeMinor: 0,
    feeCurrency: "NGN",
  },

  rateLimits: {
    requestsPerMinute: 100,
    maxTransferAmount: 50_000_000_00, // 500M NGN estimated
  },

  // ─── Capability Query Methods ────────────────────────────────
  supportsCollection: () => true,
  supportsTransfer: () => true,
  supportsBulkTransfer: () => true,
  supportsVirtualAccount: () => true,
  supportsDedicatedAccount: () => false,
  supportsRefund: () => false, // Not documented as standalone API
  supportsReversal: () => false,
  supportsMerchantCollection: () => true,
  supportsBillPayment: () => true, // Via Baxi agent banking
  supportsAirtime: () => true, // Via Baxi
  supportsData: () => true, // Via Baxi
  supportsElectricity: () => true, // Via Baxi
  supportsTV: () => true, // Via Baxi
  supportsBetting: () => false,
  supportsEducation: () => false,
  supportsInsurance: () => false,
  supportsQR: () => false,
  supportsCards: () => true, // Card collection + issuance
  supportsMobileMoney: () => true,
  supportsInternational: () => true,
  supportsFX: () => true,
  supportsPAPSS: () => true,
  supportsWebhook: () => true,
  supportsSettlementMethod: () => true,
  supportsBankResolution: () => true,
  supportsBVN: () => false,
  supportsKYC: () => false, // Handled via onboarding
  supportsCardIssuance: () => true,
  supportsAgentBanking: () => true, // Baxi network
  supportsStablecoin: () => true,
};
