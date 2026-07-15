/**
 * Monnify — Provider Capability Declaration
 * ===========================================
 *
 * Capabilities derived from Monnify API documentation (developers.monnify.com):
 * - Collections: bank transfer, card payments, USSD, phone number
 * - Transfers: single and bulk disbursements
 * - Virtual/Reserved Accounts: persistent and dynamic accounts
 * - Refunds: full and partial refunds
 * - Reversals: transfer reversals
 * - Settlements: same-day T+0, express settlement
 * - Invoices: static and dynamic invoicing
 * - Payment Pages/Checkout: hosted checkout, SDK
 * - Split Payments: up to 5 sub-accounts
 * - Subscriptions: reserved accounts, direct debit, card tokenization
 * - Bill Payments: airtime, data, electricity, TV, education
 * - International: USD card payments from 150+ countries
 * - Direct Debit: bank account mandates
 * - Card Tokenization: recurring card payments
 * - KYC: BVN, NIN verification
 * - Wallet: management and statements
 * - Paycode: offline payouts via Moniepoint agents
 *
 * NOT supported: QR Codes, POS Terminals
 *
 * Documentation: https://developers.monnify.com/
 */

import type { ProviderCapabilities } from "../capabilities";

export const monnifyCapabilities: ProviderCapabilities = {
  providerId: "monnify",
  displayName: "Monnify",
  version: "1.0.0",

  categories: [
    "collection",
    "transfer",
    "bulk_transfer",
    "virtual_account",
    "dedicated_account",
    "reserved_account",
    "refund",
    "reversal",
    "settlement",
    "invoice",
    "payment_page",
    "split_payment",
    "subscription",
    "direct_debit",
    "card_tokenization",
    "bill_payment",
    "airtime",
    "data",
    "electricity",
    "tv",
    "education",
    "international",
    "kyc",
    "wallet",
    "paycode",
    "bank_transfer",
    "card_payments",
    "merchant_collection",
  ],

  services: [
    // Collections
    { id: "monnify_bank_transfer", name: "Bank Transfer", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_card", name: "Card Payment", category: "collection", currencies: ["NGN", "USD"], countries: ["NG", "*"] },
    { id: "monnify_ussd", name: "USSD Payment", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_phone", name: "Phone Number Payment", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_international_card", name: "International Card", category: "international", currencies: ["USD"], countries: ["*"] },

    // Transfers
    { id: "monnify_transfer", name: "Single Transfer", category: "transfer", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_bulk_transfer", name: "Bulk Transfer", category: "bulk_transfer", currencies: ["NGN"], countries: ["NG"] },

    // Virtual/Reserved Accounts
    { id: "monnify_va", name: "Virtual Account", category: "virtual_account", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_reserved_account", name: "Reserved Account", category: "reserved_account", currencies: ["NGN"], countries: ["NG"] },

    // Refunds
    { id: "monnify_refund", name: "Refund", category: "refund", currencies: ["NGN"], countries: ["NG"] },

    // Reversals
    { id: "monnify_reversal", name: "Reversal", category: "reversal", currencies: ["NGN"], countries: ["NG"] },

    // Settlements
    { id: "monnify_settlement", name: "Settlement", category: "settlement", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_express_settlement", name: "Express Settlement", category: "settlement", currencies: ["NGN"], countries: ["NG"] },

    // Invoices
    { id: "monnify_static_invoice", name: "Static Invoice", category: "invoice", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_dynamic_invoice", name: "Dynamic Invoice", category: "invoice", currencies: ["NGN"], countries: ["NG"] },

    // Payment Pages
    { id: "monnify_checkout", name: "Checkout Page", category: "payment_page", currencies: ["NGN", "USD"], countries: ["NG", "*"] },
    { id: "monnify_payment_link", name: "Payment Link", category: "payment_page", currencies: ["NGN"], countries: ["NG"] },

    // Split Payments
    { id: "monnify_split", name: "Split Payment", category: "split_payment", currencies: ["NGN"], countries: ["NG"] },

    // Subscriptions
    { id: "monnify_subscription_reserved", name: "Reserved Account Subscription", category: "subscription", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_subscription_direct_debit", name: "Direct Debit Subscription", category: "subscription", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_subscription_card", name: "Card Tokenization Subscription", category: "subscription", currencies: ["NGN"], countries: ["NG"] },

    // Bill Payments
    { id: "monnify_airtime", name: "Airtime", category: "airtime", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_data", name: "Data", category: "data", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_electricity", name: "Electricity", category: "electricity", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_tv", name: "TV Subscription", category: "tv", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_education", name: "Education", category: "education", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_betting", name: "Betting", category: "bill_payment", currencies: ["NGN"], countries: ["NG"] },

    // KYC
    { id: "monnify_bvn", name: "BVN Verification", category: "kyc", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_nin", name: "NIN Verification", category: "kyc", currencies: ["NGN"], countries: ["NG"] },
    { id: "monnify_bank_resolution", name: "Bank Resolution", category: "kyc", currencies: ["NGN"], countries: ["NG"] },

    // Wallet
    { id: "monnify_wallet", name: "Wallet Management", category: "wallet", currencies: ["NGN"], countries: ["NG"] },

    // Paycode (Offline)
    { id: "monnify_paycode", name: "Paycode Offline Payout", category: "paycode", currencies: ["NGN"], countries: ["NG"] },

    // Merchant
    { id: "monnify_merchant", name: "Merchant Collection", category: "merchant_collection", currencies: ["NGN"], countries: ["NG"] },
  ],

  supportedCountries: ["NG", "*"], // NG primary, USD international from 150+ countries
  supportedCurrencies: ["NGN", "USD"],

  supportsWebhooks: true,
  supportsSettlement: true,

  costProfile: {
    percentageFeeBps: 150,
    fixedFeeMinor: 0,
    feeCurrency: "NGN",
  },

  rateLimits: {
    requestsPerMinute: 100,
    maxTransferAmount: 10_000_000_00,
  },

  // ─── Capability Query Methods ────────────────────────────────
  supportsCollection: () => true,
  supportsTransfer: () => true,
  supportsBulkTransfer: () => true,
  supportsVirtualAccount: () => true,
  supportsDedicatedAccount: () => true, // Reserved accounts
  supportsRefund: () => true,
  supportsReversal: () => true,
  supportsMerchantCollection: () => true,
  supportsBillPayment: () => true,
  supportsAirtime: () => true,
  supportsData: () => true,
  supportsElectricity: () => true,
  supportsTV: () => true,
  supportsBetting: () => true,
  supportsEducation: () => true,
  supportsInsurance: () => false,
  supportsQR: () => false, // Not supported
  supportsCards: () => true,
  supportsMobileMoney: () => false, // Phone number method exists but not full MoMo
  supportsInternational: () => true, // USD card payments
  supportsFX: () => false,
  supportsPAPSS: () => false,
  supportsWebhook: () => true,
  supportsSettlementMethod: () => true,
  supportsBankResolution: () => true,
  supportsBVN: () => true,
  supportsNIN: () => true,
  supportsKYC: () => true,
  supportsSubscription: () => true,
  supportsInvoice: () => true,
  supportsPaymentPage: () => true,
  supportsSplitPayment: () => true,
  supportsDirectDebit: () => true,
  supportsCardTokenization: () => true,
  supportsWallet: () => true,
  supportsPaycode: () => true, // Offline payouts
};
