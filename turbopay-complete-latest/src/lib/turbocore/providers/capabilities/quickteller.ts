/**
 * Quickteller — Provider Capability Declaration
 * ================================================
 *
 * Capabilities derived from Quickteller API documentation (docs.interswitchgroup.com):
 * - Collections: card payments, transaction verification
 * - Transfers: single and bulk transfers
 * - Bill Payments: 271+ billers across all categories
 * - Electricity: prepaid & postpaid
 * - TV/Cable: DSTV, GOTV, DAARSAT
 * - Airtime/Data: all major telcos
 * - Education: school fees, exam payments
 * - Insurance: insurance premiums
 * - Transport: transport payments
 * - Subscriptions: card tokenization + recurring
 * - Refunds: full and partial
 * - Cards: payment processing, Card 360, virtual cards
 * - QR Codes: via POS Till Integration
 * - PIPEChain: Pan-African cross-border payments
 * - Payouts: bank transfer and push-to-card
 * - Settlements: T+1 with split reports
 * - KYC: customer validation
 * - Bank Resolution: account name inquiry
 *
 * NOT supported: FX (use PIPEChain), PAPSS
 *
 * Documentation: https://docs.interswitchgroup.com
 */

import type { ProviderCapabilities } from "../capabilities";

export const quicktellerCapabilities: ProviderCapabilities = {
  providerId: "quickteller",
  displayName: "Quickteller",
  version: "1.0.0",

  categories: [
    "collection",
    "transfer",
    "bulk_transfer",
    "bill_payment",
    "airtime",
    "data",
    "electricity",
    "tv",
    "education",
    "insurance",
    "transport",
    "subscription",
    "refund",
    "card_payments",
    "card_issuance",
    "virtual_card",
    "qr",
    "international",
    "payout",
    "settlement",
    "virtual_account",
    "bank_resolution",
    "kyc",
    "merchant_collection",
  ],

  services: [
    // Collections
    { id: "qt_card_payment", name: "Card Payment", category: "collection", currencies: ["NGN", "KES"], countries: ["NG", "KE"] },

    // Transfers
    { id: "qt_single_transfer", name: "Single Transfer", category: "transfer", currencies: ["NGN", "KES", "USD"], countries: ["NG", "KE", "CD"] },
    { id: "qt_bulk_transfer", name: "Bulk Transfer", category: "bulk_transfer", currencies: ["NGN"], countries: ["NG"] },

    // Bill Payments
    { id: "qt_utilities", name: "Utilities", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_state_payments", name: "State Payments", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_donations", name: "Donations", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_phone_bills", name: "Phone Bills", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_subscriptions", name: "Subscriptions (ISP)", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_tax", name: "Tax Payments", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_airlines", name: "Airlines", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_microfinance", name: "Microfinance", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },

    // Electricity
    { id: "qt_electricity_prepaid", name: "Electricity Prepaid", category: "electricity", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_electricity_postpaid", name: "Electricity Postpaid", category: "electricity", currencies: ["NGN"], countries: ["NG"] },

    // TV/Cable
    { id: "qt_dstv", name: "DSTV", category: "tv", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_gotv", name: "GOTV", category: "tv", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_daarsat", name: "DAARSAT", category: "tv", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_startimes", name: "StarTimes", category: "tv", currencies: ["NGN"], countries: ["NG"] },

    // Airtime/Data
    { id: "qt_airtime", name: "Airtime", category: "airtime", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_data", name: "Data", category: "data", currencies: ["NGN"], countries: ["NG"] },

    // Education
    { id: "qt_education", name: "Education", category: "education", currencies: ["NGN"], countries: ["NG"] },

    // Insurance
    { id: "qt_insurance", name: "Insurance", category: "insurance", currencies: ["NGN"], countries: ["NG"] },

    // Transport
    { id: "qt_transport", name: "Transport", category: "transport", currencies: ["NGN"], countries: ["NG"] },

    // Subscriptions (Recurring)
    { id: "qt_subscription", name: "Recurring Subscription", category: "subscription", currencies: ["NGN"], countries: ["NG"] },

    // Refunds
    { id: "qt_refund", name: "Refund", category: "refund", currencies: ["NGN"], countries: ["NG"] },

    // Cards
    { id: "qt_card_processing", name: "Card Processing", category: "card_payments", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_card_360", name: "Card 360 Service", category: "card_issuance", currencies: ["NGN"], countries: ["NG"] },
    { id: "qt_virtual_card", name: "Virtual Card", category: "virtual_card", currencies: ["NGN"], countries: ["NG"] },

    // QR
    { id: "qt_qr", name: "QR Payment", category: "qr", currencies: ["NGN"], countries: ["NG"] },

    // International (PIPEChain)
    { id: "qt_pipechain", name: "PIPEChain Cross-border", category: "international", currencies: ["NGN", "KES", "USD"], countries: ["NG", "KE", "CD"] },

    // Payouts
    { id: "qt_payout_bank", name: "Bank Payout", category: "payout", currencies: ["NGN", "KES", "USD"], countries: ["NG", "KE", "CD"] },

    // Settlements
    { id: "qt_settlement", name: "Settlement", category: "settlement", currencies: ["NGN"], countries: ["NG"] },

    // Virtual Accounts
    { id: "qt_virtual_account", name: "Virtual Account", category: "virtual_account", currencies: ["NGN"], countries: ["NG"] },

    // Bank Resolution
    { id: "qt_bank_resolution", name: "Bank Resolution", category: "bank_resolution", currencies: ["NGN"], countries: ["NG"] },

    // KYC
    { id: "qt_customer_validation", name: "Customer Validation", category: "kyc", currencies: ["NGN"], countries: ["NG"] },

    // Mobile Money
    { id: "qt_mobile_money", name: "Mobile Money", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },

    // Merchant
    { id: "qt_merchant", name: "Merchant Collection", category: "merchant_collection", currencies: ["NGN"], countries: ["NG"] },
  ],

  supportedCountries: ["NG", "KE", "CD"],
  supportedCurrencies: ["NGN", "KES", "USD"],

  supportsWebhooks: true,
  supportsSettlement: true,

  costProfile: {
    percentageFeeBps: 120, // 1.2%
    fixedFeeMinor: 0,
    feeCurrency: "NGN",
  },

  rateLimits: {
    requestsPerMinute: 100,
  },

  // ─── Capability Query Methods ────────────────────────────────
  supportsCollection: () => true,
  supportsTransfer: () => true,
  supportsBulkTransfer: () => true,
  supportsVirtualAccount: () => true,
  supportsDedicatedAccount: () => false,
  supportsRefund: () => true,
  supportsReversal: () => true,
  supportsMerchantCollection: () => true,
  supportsBillPayment: () => true,
  supportsAirtime: () => true,
  supportsData: () => true,
  supportsElectricity: () => true,
  supportsTV: () => true,
  supportsBetting: () => false,
  supportsEducation: () => true,
  supportsInsurance: () => true,
  supportsQR: () => true,
  supportsCards: () => true,
  supportsMobileMoney: () => true,
  supportsInternational: () => true, // PIPEChain
  supportsFX: () => false, // Use PIPEChain for cross-border
  supportsPAPSS: () => false,
  supportsWebhook: () => true,
  supportsSettlementMethod: () => true,
  supportsBankResolution: () => true,
  supportsBVN: () => false,
  supportsKYC: () => true,
  supportsSubscription: () => true,
  supportsCardIssuance: () => true, // Card 360
  supportsVirtualCard: () => true,
  supportsPayout: () => true,
  supportsTransport: () => true,
};
