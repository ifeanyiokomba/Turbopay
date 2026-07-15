# TurboPay Provider Capability Matrix

**Generated:** July 12, 2026
**Sources:** Official API documentation from each provider
**Status:** Phase 1 - Documentation Discovery & Capability Analysis

---

## MASTER CAPABILITY MATRIX

| Capability | Paystack | Flutterwave | Monnify | Onafriq | Remita | Quickteller |
|---|---|---|---|---|---|---|
| **Collections** | YES | YES | YES | YES | YES (RRR) | YES |
| **Transactions (Initialize)** | YES | YES | YES | YES | YES (RRR) | YES |
| **Transactions (Verify)** | YES | YES | YES | YES | YES | YES |
| **Transfers (Single)** | YES | YES | YES | YES | YES (RITs) | YES |
| **Transfers (Bulk)** | YES | NO | YES | YES | YES (RITs) | YES |
| **Transfer Recipients** | YES | YES | NO | YES | YES | NO |
| **Virtual Accounts** | YES | YES | YES | YES | NO | NO |
| **Dedicated Accounts** | YES | YES | YES (Reserved) | YES | NO | NO |
| **Subscriptions/Recurring** | YES | YES | YES | NO | PARTIAL | YES |
| **Customers** | YES | YES | PARTIAL | YES | PARTIAL | YES |
| **Refunds** | YES | YES | YES | NO | NO | YES |
| **Reversals/Chargebacks** | YES | YES | YES | PARTIAL | NO | YES |
| **Settlements** | YES | YES | YES | YES | YES | YES |
| **Invoices/Payment Requests** | YES | PARTIAL | YES | YES | YES (RRR) | YES |
| **Payment Pages** | YES | NO | YES | NO | NO | YES |
| **Split Payments** | YES | NO | YES | NO | YES | NO |
| **Subaccounts** | YES | NO | YES | NO | NO | NO |
| **Terminals/POS** | YES | NO | NO | NO | NO | YES |
| **Virtual Terminals** | YES | NO | NO | NO | NO | NO |
| **Cards (Payments)** | YES | YES | YES | YES | NO | YES |
| **Card Issuance** | NO | NO | NO | YES | NO | YES |
| **Mobile Money (Collection)** | PARTIAL | YES | PARTIAL | YES | NO | YES |
| **Mobile Money (Payout)** | NO | YES | NO | YES | NO | NO |
| **Bank Transfers (Collection)** | YES | YES | YES | YES | YES | YES |
| **Bank Transfers (Payout)** | YES | YES | YES | YES | YES | YES |
| **Bill Payments** | NO | NO | YES | YES | YES | YES |
| **Airtime** | NO | NO | YES | YES | YES | YES |
| **Data** | NO | NO | YES | YES | YES | YES |
| **Electricity** | NO | NO | YES | YES | YES | YES |
| **TV/Cable** | NO | NO | YES | NO | YES | YES |
| **Betting** | NO | NO | YES | NO | NO | NO |
| **Education** | NO | NO | YES | NO | YES | YES |
| **Insurance** | NO | NO | NO | NO | NO | YES |
| **QR Codes** | NO | NO | NO | NO | NO | YES |
| **International Payments** | YES | YES | YES | YES | NO | YES |
| **PAPSS** | NO | NO | NO | YES | NO | NO |
| **FX (Foreign Exchange)** | NO | YES | NO | YES | NO | NO |
| **Stablecoins** | NO | YES | NO | YES | NO | NO |
| **Direct Debit/Mandates** | YES | NO | YES | NO | NO | NO |
| **USSD Payments** | NO | YES | YES | NO | NO | NO |
| **Apple Pay** | YES | NO | NO | NO | NO | NO |
| **OPay** | NO | YES | NO | NO | NO | NO |
| **Webhooks** | YES | YES | YES | YES | YES | YES |
| **Verification (Bank/Account)** | YES | YES | YES | YES | NO | YES |
| **BVN Verification** | YES | NO | YES | NO | NO | NO |
| **NIN Verification** | NO | NO | YES | NO | NO | NO |
| **KYC** | YES | YES | YES | YES | NO | YES |
| **Wallet Management** | YES | YES | YES | YES | NO | YES |
| **Offline Payouts (Paycode)** | NO | NO | YES | YES | NO | NO |
| **Agent Banking** | NO | NO | NO | YES | NO | NO |

---

## AUTHENTICATION METHODS

| Provider | Auth Type | Token Lifetime | Security |
|---|---|---|---|
| **Paystack** | Bearer Token (Secret Key) | Static key | HTTPS required |
| **Flutterwave** | OAuth 2.0 (Client Credentials) | 10 minutes | HMAC-SHA256 webhooks |
| **Monnify** | Bearer Token (API Key + Secret) | 1 hour | HMAC-SHA512 webhooks |
| **Onafriq** | API Key (Bearer) | API key based | ISO 27001, PCI DSS |
| **Remita** | SHA-512 Hash Signature | Static key | Hash-based auth |
| **Quickteller** | OAuth 2.0 (Client Credentials) | ~12 hours | HMAC-SHA512 webhooks |

---

## SUPPORTED COUNTRIES

| Provider | Countries | Primary Market |
|---|---|---|
| **Paystack** | Nigeria, Ghana, South Africa, Kenya, Cote d'Ivoire (5) | West Africa |
| **Flutterwave** | Nigeria, Ghana, Kenya, Uganda, Tanzania, South Africa + 20+ payout countries | Pan-Africa |
| **Monnify** | Nigeria (+ USD international card payments from 150+ countries) | Nigeria |
| **Onafriq** | 43 African countries | Pan-Africa (43 countries) |
| **Remita** | Nigeria only | Nigeria |
| **Quickteller** | Nigeria, Kenya, DRC + Africa-wide via PIPEChain | Nigeria |

---

## SUPPORTED CURRENCIES

| Provider | Currencies | Multi-Currency |
|---|---|---|
| **Paystack** | NGN, USD, GHS, ZAR, KES, XOF (6) | YES |
| **Flutterwave** | NGN, GHS, USD, EUR, GBP, KES, ZAR, UGX, TZS, INR, AUD, EGP, ETB, MWK, USDT, USDC, RLUSD (17+) | YES |
| **Monnify** | NGN, USD (2) | Limited |
| **Onafriq** | 40+ African currencies + USD, EUR, GBP | YES |
| **Remita** | NGN only (1) | NO |
| **Quickteller** | NGN, USD, KES + PIPEChain currencies | YES |

---

## SETTLEMENT MODELS

| Provider | Settlement Type | Frequency | Express/Instant |
|---|---|---|---|
| **Paystack** | Automatic to bank account | Configurable (daily/weekly) | NO |
| **Flutterwave** | Bank account or F4B wallet | Varies by method | NO |
| **Monnify** | Same-day T+0 (10 PM) | Daily + Express (3x/day, min ₦5,000) | YES (Express) |
| **Onafriq** | Single currency (USD default) | Per corridor | NO |
| **Remita** | Merchant/biller bank account | Configured settlement cycle | NO |
| **Quickteller** | T+1 (next business day) | Daily | NO |

---

## WEBHOOK EVENTS

| Provider | Key Events | Signature |
|---|---|---|
| **Paystack** | charge.success, charge.failure, transfer.success, transfer.failed, transfer.reversed, subscription.*, dispute.*, refund.*, settlement.* | HMAC (undocumented) |
| **Flutterwave** | charge.completed, charge.failed, transfer.disburse, transfer.failed, refund.completed | HMAC-SHA256 |
| **Monnify** | SUCCESSFUL_COLLECTION, SUCCESSFUL_DISBURSEMENT, FAILED_DISBURSEMENT, REVERSED_DISBURSEMENT, SUCCESSFUL_REFUND, SETTLEMENT_COMPLETION | HMAC-SHA512 |
| **Onafriq** | collection.*, payment.*, charge.*, card.*, account.*, settlement.* | API key based |
| **Remita** | BILL_PAYMENT_COMPLETED, BILL_PAYMENT_FAILED | HMAC (limited docs) |
| **Quickteller** | TRANSACTION (CREATED/UPDATED/COMPLETED), SUBSCRIPTION (CREATED/TRANSACTION_SUCCESSFUL/TRANSACTION_FAILURE/CANCELLED), LINK.*, INVOICE.* | HMAC-SHA512 |

---

## RATE LIMITS

| Provider | Requests/Minute | Notes |
|---|---|---|
| **Paystack** | Not publicly documented | HTTP 429 on exceed |
| **Flutterwave** | Not publicly documented | 10-min OAuth tokens impose implicit limits |
| **Monnify** | Not publicly documented | Contact integrations@monnify.com |
| **Onafriq** | Not publicly documented | Negotiated per partner |
| **Remita** | ~100 RPM (estimated) | From project config |
| **Quickteller** | ~100 RPM (estimated) | From project config |

---

## PROVIDER STRENGTHS & GAPS

### Paystack
**Strengths:** Transactions, Transfers, Virtual Accounts, Split Payments, Subscriptions, POS Terminals, Refunds/Disputes
**Gaps:** No Bill Payments, No QR Codes, Limited Mobile Money

### Flutterwave
**Strengths:** Mobile Money, FX, Stablecoins, Orchestration Flow, International Payouts, Wallet-to-Wallet
**Gaps:** No Bulk Transfers, No Bill Payments, No QR Codes, No POS Terminals

### Monnify
**Strengths:** Bill Payments (all categories), Express Settlement, Paycode Offline Payouts, Direct Debit, Reserved Accounts
**Gaps:** No POS/QR, Limited International (USD only), No Multi-currency Payouts

### Onafriq
**Strengths:** 43 African Countries, Mobile Money Network, PAPSS, FX, Card Issuance, Agent Banking, Stablecoins
**Gaps:** Limited Public API Documentation, No Refund API (documented), Enterprise-focused

### Remita
**Strengths:** Government Payments (TSA), School Fees, Bill Payments, RITs Bulk Transfers, Nigerian Institutions
**Gaps:** Nigeria-only, NGN-only, No Refund/Reversal API, No QR/Cards, Limited Public Docs

### Quickteller
**Strengths:** 271+ Billers, Card Processing, Virtual Cards, PIPEChain Cross-border, QR Codes, Insurance
**Gaps:** Limited International Coverage, Complex Multi-Auth (Legacy + OAuth), Nigeria-primary

---

## CAPABILITY COVERAGE BY FEATURE

### Payment Collection
| Feature | Providers |
|---|---|
| Card Payments | Paystack, Flutterwave, Monnify, Onafriq, Quickteller |
| Bank Transfer (Collection) | Paystack, Flutterwave, Monnify, Onafriq, Remita, Quickteller |
| Mobile Money (Collection) | Flutterwave, Onafriq, Quickteller |
| USSD | Flutterwave, Monnify |
| Apple Pay | Paystack |
| OPay | Flutterwave |

### Payouts & Transfers
| Feature | Providers |
|---|---|
| Single Transfer | All 6 |
| Bulk Transfer | Paystack, Monnify, Onafriq, Remita, Quickteller |
| Mobile Money (Payout) | Flutterwave, Onafriq |
| Virtual Accounts | Paystack, Flutterwave, Monnify, Onafriq |

### Bill Payments & VAS
| Feature | Providers |
|---|---|
| Airtime/Data | Monnify, Onafriq, Remita, Quickteller |
| Electricity | Monnify, Remita, Quickteller |
| TV/Cable | Monnify, Remita, Quickteller |
| Education | Monnify, Remita, Quickteller |
| Insurance | Quickteller |
| Betting | Monnify |

### International
| Feature | Providers |
|---|---|
| Cross-border Payments | Paystack, Flutterwave, Onafriq, Quickteller |
| FX Conversion | Flutterwave, Onafriq |
| Stablecoins | Flutterwave, Onafriq |
| PAPSS | Onafriq |

### Card Services
| Feature | Providers |
|---|---|
| Card Payments | Paystack, Flutterwave, Monnify, Onafriq, Quickteller |
| Card Issuance | Onafriq, Quickteller |
| Virtual Cards | Quickteller |

### Advanced Features
| Feature | Providers |
|---|---|
| Split Payments | Paystack, Remita |
| Direct Debit | Paystack, Monnify |
| Subscriptions | Paystack, Flutterwave, Monnify, Quickteller |
| QR Codes | Quickteller |
| POS Terminals | Paystack, Quickteller |
| Agent Banking | Onafriq |
| Offline Payouts (Paycode) | Monnify, Onafriq |

---

## TURBOPAY ROUTING RECOMMENDATIONS

Based on capability analysis, recommended provider routing:

| Transaction Type | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Card Payment (NG) | Paystack | Flutterwave | Monnify |
| Card Payment (International) | Flutterwave | Paystack | Onafriq |
| Bank Transfer Collection | Monnify | Paystack | Flutterwave |
| Mobile Money Collection | Flutterwave | Onafriq | Quickteller |
| Single Transfer | Paystack | Flutterwave | Monnify |
| Bulk Transfer | Paystack | Monnify | Remita |
| Bill Payment (Electricity) | Monnify | Remita | Quickteller |
| Bill Payment (Airtime/Data) | Monnify | Remita | Quickteller |
| Bill Payment (TV/Cable) | Quickteller | Remita | Monnify |
| Bill Payment (Education) | Remita | Quickteller | Monnify |
| Government Payment (TSA) | Remita | - | - |
| School Fees | Remita | Quickteller | Monnify |
| Virtual Account | Paystack | Flutterwave | Monnify |
| Cross-border (Intra-Africa) | Onafriq | Flutterwave | Quickteller |
| Insurance | Quickteller | - | - |
| QR Payment | Quickteller | - | - |
| FX Conversion | Flutterwave | Onafriq | - |
| Stablecoin Settlement | Flutterwave | Onafriq | - |

---

*Matrix compiled from official provider documentation. Capabilities marked PARTIAL may be available through non-public API versions or custom arrangements.*
