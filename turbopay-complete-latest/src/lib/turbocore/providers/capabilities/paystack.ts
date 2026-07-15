/**
 * Paystack — Provider Capability Declaration
 * ============================================
 *
 * Capabilities derived from Paystack API documentation (paystack.com/docs/api):
 * - Collections: card, bank transfer, USSD, mobile money (Ghana)
 * - Transfers: bank transfers (NIP/GhIPSS), bulk transfers, recipients
 * - Virtual/Dedicated Accounts: dedicated virtual accounts for collections
 * - Subscriptions: plans, subscriptions, direct debit
 * - Customers: full CRUD, validation, whitelist/blacklist
 * - Refunds: full and partial refunds
 * - Disputes: chargeback management
 * - Settlements: list and query settlements
 * - Payment Pages: hosted checkout pages
 * - Payment Requests: invoices with send/verify
 * - Split Payments: configurable split rules
 * - Subaccounts: merchant sub-accounts
 * - Terminals: POS terminal management
 * - Virtual Terminals: assign destinations
 * - KYC: BVN, NIN, identity verification, bank resolution
 * - Apple Pay: domain registration
 * - Direct Debit: bank account mandates
 *
 * NOT supported: Bill Payments, QR Codes, FX, PAPSS
 *
 * Documentation: https://paystack.com/docs/api/
 */

import type { ProviderCapabilities } from "../capabilities";

export const paystackCapabilities: ProviderCapabilities = {
  providerId: "paystack",
  displayName: "Paystack",
  version: "2024-01",

  categories: [
    "collection",
    "transfer",
    "bulk_transfer",
    "virtual_account",
    "dedicated_account",
    "refund",
    "dispute",
    "settlement",
    "subscription",
    "plan",
    "customer",
    "payment_page",
    "payment_request",
    "split_payment",
    "subaccount",
    "terminal",
    "virtual_terminal",
    "card_payments",
    "bank_transfer",
    "mobile_money",
    "apple_pay",
    "direct_debit",
    "kyc",
    "merchant_collection",
  ],

  services: [
    // Collections
    { id: "paystack_card", name: "Card Payment", category: "collection", currencies: ["NGN", "GHS", "ZAR", "USD", "KES", "XOF"], countries: ["NG", "GH", "ZA", "US", "KE", "CI"] },
    { id: "paystack_bank_transfer", name: "Bank Transfer", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_ussd", name: "USSD Payment", category: "collection", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_mobile_money", name: "Mobile Money", category: "collection", currencies: ["GHS"], countries: ["GH"] },

    // Transfers
    { id: "paystack_nip", name: "NIP Bank Transfer", category: "transfer", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_ghipss", name: "GhIPSS Transfer", category: "transfer", currencies: ["GHS"], countries: ["GH"] },
    { id: "paystack_recipient", name: "Transfer Recipient", category: "transfer", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },

    // Bulk
    { id: "paystack_bulk_transfer", name: "Bulk Transfer", category: "bulk_transfer", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },

    // Virtual accounts
    { id: "paystack_dva", name: "Dedicated Virtual Account", category: "virtual_account", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_dedicated", name: "Dedicated Account", category: "dedicated_account", currencies: ["NGN"], countries: ["NG"] },

    // Subscriptions
    { id: "paystack_plan", name: "Subscription Plan", category: "plan", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },
    { id: "paystack_subscription", name: "Subscription", category: "subscription", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },
    { id: "paystack_direct_debit", name: "Direct Debit", category: "direct_debit", currencies: ["NGN"], countries: ["NG"] },

    // Customers
    { id: "paystack_customer", name: "Customer", category: "customer", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // Refunds
    { id: "paystack_refund", name: "Refund", category: "refund", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // Disputes
    { id: "paystack_dispute", name: "Dispute", category: "dispute", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // Settlements
    { id: "paystack_settlement", name: "Settlement", category: "settlement", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // Payment Pages
    { id: "paystack_page", name: "Payment Page", category: "payment_page", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // Payment Requests / Invoices
    { id: "paystack_payment_request", name: "Payment Request", category: "payment_request", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // Split Payments
    { id: "paystack_split", name: "Split Payment", category: "split_payment", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },

    // Subaccounts
    { id: "paystack_subaccount", name: "Subaccount", category: "subaccount", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },

    // Terminals
    { id: "paystack_terminal", name: "POS Terminal", category: "terminal", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_virtual_terminal", name: "Virtual Terminal", category: "virtual_terminal", currencies: ["NGN"], countries: ["NG"] },

    // Apple Pay
    { id: "paystack_apple_pay", name: "Apple Pay", category: "apple_pay", currencies: ["NGN", "GHS", "ZAR", "USD", "KES"], countries: ["NG", "GH", "ZA", "US", "KE"] },

    // KYC
    { id: "paystack_bvn", name: "BVN Verification", category: "kyc", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_nin", name: "NIN Verification", category: "kyc", currencies: ["NGN"], countries: ["NG"] },
    { id: "paystack_identity", name: "Identity Verification", category: "kyc", currencies: ["NGN", "GHS"], countries: ["NG", "GH"] },
    { id: "paystack_bank_resolution", name: "Bank Resolution", category: "kyc", currencies: ["NGN"], countries: ["NG"] },

    // Merchant
    { id: "paystack_merchant", name: "Merchant Collection", category: "merchant_collection", currencies: ["NGN", "GHS", "ZAR"], countries: ["NG", "GH", "ZA"] },
  ],

  supportedCountries: ["NG", "GH", "ZA", "US", "KE", "CI"],
  supportedCurrencies: ["NGN", "GHS", "ZAR", "USD", "KES", "XOF"],

  supportsWebhooks: true,
  supportsSettlement: true,

  costProfile: {
    percentageFeeBps: 150, // 1.5%
    fixedFeeMinor: 0,
    feeCurrency: "NGN",
  },

  rateLimits: {
    requestsPerMinute: 500,
    maxTransferAmount: 10_000_000_00, // 100M NGN in kobo
    maxBulkItems: 1000,
  },

  // ─── Capability Query Methods ────────────────────────────────
  supportsCollection: () => true,
  supportsTransfer: () => true,
  supportsBulkTransfer: () => true,
  supportsVirtualAccount: () => true,
  supportsDedicatedAccount: () => true,
  supportsRefund: () => true,
  supportsReversal: () => true, // Disputes/chargebacks
  supportsMerchantCollection: () => true,
  supportsBillPayment: () => false, // Not supported by Paystack
  supportsAirtime: () => false,
  supportsData: () => false,
  supportsElectricity: () => false,
  supportsTV: () => false,
  supportsBetting: () => false,
  supportsEducation: () => false,
  supportsInsurance: () => false,
  supportsQR: () => false, // Not supported by Paystack
  supportsCards: () => true,
  supportsMobileMoney: () => true, // Ghana only
  supportsInternational: () => true,
  supportsFX: () => false, // Not supported
  supportsPAPSS: () => false,
  supportsWebhook: () => true,
  supportsSettlementMethod: () => true,
  supportsBankResolution: () => true,
  supportsBVN: () => true,
  supportsKYC: () => true,
  supportsSubscription: () => true,
  supportsPlan: () => true,
  supportsCustomer: () => true,
  supportsDispute: () => true,
  supportsPaymentPage: () => true,
  supportsPaymentRequest: () => true,
  supportsSplitPayment: () => true,
  supportsSubaccount: () => true,
  supportsTerminal: () => true,
  supportsVirtualTerminal: () => true,
  supportsApplePay: () => true,
  supportsDirectDebit: () => true,
};
