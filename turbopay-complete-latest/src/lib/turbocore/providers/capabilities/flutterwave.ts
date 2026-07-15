/**
 * Flutterwave — Provider Capability Declaration
 * ================================================
 *
 * Capabilities derived from Flutterwave API v4 documentation (developer.flutterwave.com):
 * - Collections: card, bank transfer, USSD, mobile money, OPay
 * - Transfers: bank transfers, mobile money, wallet-to-wallet, stablecoins
 * - Virtual accounts: static and dynamic bank accounts
 * - Refunds: full and partial refunds
 * - Chargebacks: dispute management
 * - FX: real-time currency conversion
 * - Subscriptions: token-based recurring payments
 * - Customers: full CRUD
 * - Settlements: list and query
 *
 * NOT supported in v4: Bill Payments, QR Codes, Payment Pages, Split Payments,
 * Terminals/POS, Apple Pay, Google Pay, Bulk Transfers
 *
 * Documentation: https://developer.flutterwave.com/docs
 */

import type { ProviderCapabilities } from "../capabilities";

export const flutterwaveCapabilities: ProviderCapabilities = {
  providerId: "flutterwave",
  displayName: "Flutterwave",
  version: "4.0.0",

  categories: [
    "collection",
    "transfer",
    "virtual_account",
    "refund",
    "dispute",
    "settlement",
    "subscription",
    "customer",
    "card_payments",
    "bank_transfer",
    "mobile_money",
    "fx",
    "stablecoin",
    "merchant_collection",
  ],

  services: [
    // Collections
    { id: "fw_card", name: "Card Payment", category: "collection", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "USD", "GBP", "EUR"], countries: ["NG", "GH", "KE", "UG", "TZ", "US", "GB", "EU"] },
    { id: "fw_bank_transfer", name: "Bank Transfer", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "fw_ussd", name: "USSD Payment", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "fw_mobile_money", name: "Mobile Money Collection", category: "collection", currencies: ["GHS", "KES", "UGX", "TZS"], countries: ["GH", "KE", "UG", "TZ"] },
    { id: "fw_opay", name: "OPay Payment", category: "collection", currencies: ["NGN"], countries: ["NG"] },

    // Transfers
    { id: "fw_bank_transfer_out", name: "Bank Transfer Payout", category: "transfer", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "USD", "GBP", "EUR", "ZAR", "AUD", "EGP", "ETB", "MWK", "INR"], countries: ["NG", "GH", "KE", "UG", "TZ", "US", "GB", "EU", "ZA", "AU", "EG", "ET", "MW", "IN"] },
    { id: "fw_mobile_money_out", name: "Mobile Money Payout", category: "transfer", currencies: ["GHS", "KES", "UGX", "TZS"], countries: ["GH", "KE", "UG", "TZ"] },
    { id: "fw_wallet_to_wallet", name: "Wallet to Wallet", category: "transfer", currencies: ["NGN", "GHS", "KES", "USD"], countries: ["NG", "GH", "KE", "US"] },

    // Stablecoins
    { id: "fw_stablecoin", name: "Stablecoin Transfer", category: "stablecoin", currencies: ["USDC", "USDT", "RLUSD"], countries: ["*"] },

    // Virtual accounts
    { id: "fw_virtual_account_static", name: "Static Virtual Account", category: "virtual_account", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },
    { id: "fw_virtual_account_dynamic", name: "Dynamic Virtual Account", category: "virtual_account", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },

    // Subscriptions (token-based recurring)
    { id: "fw_subscription", name: "Tokenized Subscription", category: "subscription", currencies: ["NGN", "GHS", "KES", "USD"], countries: ["NG", "GH", "KE", "US"] },

    // Customers
    { id: "fw_customer", name: "Customer", category: "customer", currencies: ["NGN", "GHS", "KES", "UGX", "TZS", "USD"], countries: ["NG", "GH", "KE", "UG", "TZ", "US"] },

    // Refunds
    { id: "fw_refund", name: "Refund", category: "refund", currencies: ["NGN", "GHS", "KES", "USD", "GBP", "EUR"], countries: ["NG", "GH", "KE", "US", "GB", "EU"] },

    // Chargebacks
    { id: "fw_chargeback", name: "Chargeback", category: "dispute", currencies: ["NGN", "GHS", "KES", "USD"], countries: ["NG", "GH", "KE", "US"] },

    // Settlements
    { id: "fw_settlement", name: "Settlement", category: "settlement", currencies: ["NGN", "GHS", "KES", "USD"], countries: ["NG", "GH", "KE", "US"] },

    // FX
    { id: "fw_fx", name: "FX Conversion", category: "fx", currencies: ["NGN", "GHS", "KES", "USD", "GBP", "EUR"], countries: ["NG", "GH", "KE", "US", "GB", "EU"] },

    // Merchant
    { id: "fw_merchant", name: "Merchant Collection", category: "merchant_collection", currencies: ["NGN", "GHS", "KES"], countries: ["NG", "GH", "KE"] },
  ],

  supportedCountries: ["NG", "GH", "KE", "UG", "TZ", "US", "GB", "EU", "ZA", "AU", "EG", "ET", "MW", "IN"],
  supportedCurrencies: ["NGN", "GHS", "KES", "UGX", "TZS", "USD", "GBP", "EUR", "ZAR", "AUD", "EGP", "ETB", "MWK", "INR", "USDC", "USDT", "RLUSD"],

  supportsWebhooks: true,
  supportsSettlement: true,

  costProfile: {
    percentageFeeBps: 140, // 1.4%
    fixedFeeMinor: 0,
    feeCurrency: "NGN",
  },

  rateLimits: {
    requestsPerMinute: 500,
    maxTransferAmount: 5_000_000_00, // 50M NGN in kobo
    // maxBulkItems not applicable - v4 has no bulk transfer endpoint
  },

  // ─── Capability Query Methods ────────────────────────────────
  supportsCollection: () => true,
  supportsTransfer: () => true,
  supportsBulkTransfer: () => false, // Not in v4 API
  supportsVirtualAccount: () => true,
  supportsDedicatedAccount: () => false, // Use static/dynamic virtual accounts instead
  supportsRefund: () => true,
  supportsReversal: () => true, // Chargebacks
  supportsMerchantCollection: () => true,
  supportsBillPayment: () => false, // Not in v4 API
  supportsAirtime: () => false, // Not in v4 API
  supportsData: () => false, // Not in v4 API
  supportsElectricity: () => false, // Not in v4 API
  supportsTV: () => false, // Not in v4 API
  supportsBetting: () => false, // Not in v4 API
  supportsEducation: () => false,
  supportsInsurance: () => false,
  supportsQR: () => false, // Not in v4 API
  supportsCards: () => true,
  supportsMobileMoney: () => true,
  supportsInternational: () => true,
  supportsFX: () => true,
  supportsPAPSS: () => false,
  supportsWebhook: () => true,
  supportsSettlementMethod: () => true,
  supportsBankResolution: () => true,
  supportsBVN: () => true,
  supportsKYC: () => true,
  supportsSubscription: () => true, // Token-based recurring
  supportsCustomer: () => true,
  supportsDispute: () => true, // Chargebacks
  supportsPaymentPage: () => false, // Removed in v4
  supportsPaymentRequest: () => false,
  supportsSplitPayment: () => false, // Not in v4
  supportsSubaccount: () => false,
  supportsTerminal: () => false, // Not in v4
  supportsVirtualTerminal: () => false,
  supportsApplePay: () => false, // Not documented
  supportsGooglePay: () => false, // Not documented
  supportsDirectDebit: () => false,
  supportsStablecoin: () => true,
};
