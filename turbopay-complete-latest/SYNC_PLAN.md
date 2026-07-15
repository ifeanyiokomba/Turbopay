# TurboPay Provider Synchronization Plan

**Date:** July 12, 2026
**Purpose:** Align capability declarations, adapter implementations, and provider interfaces with documented API capabilities

---

## PART 1: GAP ANALYSIS

### 1. PAYSTACK

| Capability | Documented | Declared | Coded | Gap |
|---|---|---|---|---|
| Collections | YES | YES | YES | - |
| Transactions (Init/Verify) | YES | YES | YES | - |
| Transfers (Single) | YES | YES | YES | - |
| Transfers (Bulk) | YES | YES | YES | - |
| Transfer Recipients | YES | YES | PARTIAL | Need full CRUD |
| Virtual/Dedicated Accounts | YES | YES | YES | - |
| Subscriptions/Recurring | YES | NO | NO | **MISSING** |
| Plans | YES | NO | NO | **MISSING** |
| Customers | YES | PARTIAL | PARTIAL | Need full CRUD |
| Refunds | YES | YES | YES | - |
| Disputes | YES | NO | NO | **MISSING** |
| Settlements | YES | YES | NO | **MISSING** |
| Payment Pages | YES | NO | NO | **MISSING** |
| Payment Requests/Invoices | YES | NO | NO | **MISSING** |
| Split Payments | YES | NO | NO | **MISSING** |
| Subaccounts | YES | NO | NO | **MISSING** |
| Terminals/POS | YES | NO | NO | **MISSING** |
| Virtual Terminals | YES | NO | NO | **MISSING** |
| Cards (Payments) | YES | YES | YES | - |
| Mobile Money | PARTIAL | YES | YES | Ghana only |
| Bank Transfers | YES | YES | YES | - |
| Apple Pay | YES | NO | NO | **MISSING** |
| Bill Payments | NO | NO | NO | Not supported |
| QR Codes | NO | YES | NO | **WRONG** - not supported |
| International | YES | YES | YES | 5 currencies |
| FX | NO | NO | NO | Not supported |
| PAPSS | NO | NO | NO | Not supported |
| Direct Debit | YES | NO | NO | **MISSING** |
| BVN Verification | YES | YES | YES | - |
| NIN Verification | YES | YES | YES | - |
| Bank Resolution | YES | YES | YES | - |
| KYC | YES | YES | YES | - |

**Paystack Action Items:**
1. Fix `supportsQR: () => false` (documented as NO, currently says YES)
2. Add Subscriptions/Plans support
3. Add Customers CRUD
4. Add Disputes management
5. Add Settlements read API
6. Add Payment Pages
7. Add Payment Requests/Invoices
8. Add Split Payments
9. Add Subaccounts
10. Add Terminals/POS
11. Add Virtual Terminals
12. Add Apple Pay domain registration
13. Add Direct Debit support

---

### 2. FLUTTERWAVE

| Capability | Documented | Declared | Coded | Gap |
|---|---|---|---|---|
| Collections | YES | YES | YES | - |
| Transactions | YES | YES | YES | - |
| Transfers (Single) | YES | YES | YES | - |
| Transfers (Bulk) | NO | YES | YES | **WRONG** - not in v4 |
| Transfer Recipients | YES | YES | PARTIAL | Need full CRUD |
| Virtual Accounts | YES | YES | YES | - |
| Subscriptions | YES (token) | NO | NO | **MISSING** |
| Customers | YES | YES | PARTIAL | Need full CRUD |
| Refunds | YES | YES | YES | - |
| Chargebacks/Reversals | YES | NO | NO | **MISSING** |
| Settlements | YES | YES | NO | **MISSING** |
| Payment Pages | NO | YES | NO | **WRONG** - removed in v4 |
| Split Payments | NO | YES | NO | **WRONG** - not in v4 |
| Terminals/POS | NO | YES | NO | **WRONG** - not in v4 |
| Cards (Payments) | YES | YES | YES | - |
| Mobile Money | YES | YES | YES | - |
| Bank Transfers | YES | YES | YES | - |
| Bill Payments | NO | YES | NO | **WRONG** - not in v4 |
| Airtime | NO | YES | NO | **WRONG** - not in v4 |
| Data | NO | YES | NO | **WRONG** - not in v4 |
| Electricity | NO | YES | NO | **WRONG** - not in v4 |
| TV/Cable | NO | YES | NO | **WRONG** - not in v4 |
| Betting | NO | YES | NO | **WRONG** - not in v4 |
| QR Codes | NO | YES | NO | **WRONG** - not in v4 |
| International | YES | YES | YES | - |
| FX | YES | YES | YES | - |
| Stablecoins | YES | YES | YES | - |
| USSD | YES | YES | YES | - |
| OPay | YES | YES | YES | - |
| Apple Pay | NO | YES | NO | **WRONG** - not documented |
| Google Pay | NO | YES | NO | **WRONG** - not documented |
| BVN Verification | YES | YES | YES | - |
| Bank Resolution | YES | YES | YES | - |
| KYC | YES | YES | YES | - |

**Flutterwave Action Items:**
1. Remove Bulk Transfer (not in v4)
2. Remove Payment Pages (removed in v4)
3. Remove Split Payments (not in v4)
4. Remove Terminals/POS (not in v4)
5. Remove Bill Payments/Airtime/Data/Electricity/TV/Betting (not in v4)
6. Remove QR Codes (not in v4)
7. Remove Apple Pay/Google Pay (not documented)
8. Add Subscriptions (token-based recurring)
9. Add Chargebacks/Reversals
10. Add Settlements read API
11. Add Customers full CRUD

---

### 3. MONNIFY

| Capability | Documented | Declared | Coded | Gap |
|---|---|---|---|---|
| Collections | YES | YES | YES | - |
| Transactions | YES | YES | YES | - |
| Transfers (Single) | YES | YES | NO | **MISSING** |
| Transfers (Bulk) | YES | NO | NO | **MISSING** |
| Virtual/Reserved Accounts | YES | YES | YES | - |
| Subscriptions/Recurring | YES | NO | NO | **MISSING** (3 methods) |
| Customers | PARTIAL | NO | NO | Partial support |
| Refunds | YES | YES | NO | **MISSING** |
| Reversals | YES | NO | NO | **MISSING** |
| Settlements | YES | YES | NO | **MISSING** |
| Invoices | YES | NO | NO | **MISSING** |
| Payment Pages/Checkout | YES | NO | NO | **MISSING** |
| Split Payments | YES | NO | NO | **MISSING** |
| Subaccounts | YES | NO | NO | **MISSING** |
| Cards (Payments) | YES | YES | YES | - |
| Mobile Money | PARTIAL | NO | NO | Phone number method |
| Bank Transfers | YES | YES | YES | - |
| Bill Payments | YES | NO | NO | **MISSING** |
| Airtime | YES | NO | NO | **MISSING** |
| Data | YES | NO | NO | **MISSING** |
| Electricity | YES | NO | NO | **MISSING** |
| TV/Cable | YES | NO | NO | **MISSING** |
| Education | YES | NO | NO | **MISSING** |
| QR Codes | NO | NO | NO | Not supported |
| International (USD) | YES | NO | NO | **MISSING** |
| Direct Debit | YES | NO | NO | **MISSING** |
| Card Tokenization | YES | NO | NO | **MISSING** |
| BVN Verification | YES | NO | NO | **MISSING** |
| NIN Verification | YES | NO | NO | **MISSING** |
| Bank Resolution | YES | YES | YES | - |
| KYC | YES | NO | NO | **MISSING** |
| Wallet Management | YES | NO | NO | **MISSING** |
| Paycode (Offline) | YES | NO | NO | **MISSING** |

**Monnify Action Items:**
1. Add Transfers (Single + Bulk)
2. Add Bill Payments (all categories)
3. Add Refunds
4. Add Reversals
5. Add Settlements
6. Add Invoices
7. Add Payment Pages/Checkout
8. Add Split Payments
9. Add Subscriptions (Reserved Accounts + Direct Debit + Card Tokenization)
10. Add International USD collections
11. Add BVN/NIN Verification
12. Add Wallet Management
13. Add Paycode (Offline Payouts)
14. Update categories to include all bill payment types

---

### 4. ONAFRIQ

| Capability | Documented | Declared | Coded | Gap |
|---|---|---|---|---|
| Collections | YES | YES | NO | **MISSING** |
| Transfers (Single) | YES | NO | NO | **MISSING** |
| Transfers (Bulk) | YES | NO | NO | **MISSING** |
| Mobile Money | YES | YES | NO | **MISSING** |
| Bank Transfers | YES | YES | NO | **MISSING** |
| PAPSS | YES | YES | NO | **MISSING** |
| FX | YES | YES | NO | **MISSING** |
| Card Issuance | YES | NO | NO | **MISSING** |
| Virtual Accounts | YES | NO | NO | **MISSING** |
| Bill Payments | YES | NO | NO | **MISSING** (via Baxi) |
| Airtime | YES | NO | NO | **MISSING** (via Baxi) |
| Data | YES | NO | NO | **MISSING** (via Baxi) |
| Agent Banking | YES | NO | NO | **MISSING** (Baxi) |
| Stablecoins | YES | NO | NO | **MISSING** |
| Refunds | PARTIAL | NO | NO | Not documented |
| Settlements | YES | YES | NO | **MISSING** |
| International | YES | YES | NO | **MISSING** |

**Onafriq Action Items:**
1. Add Collections adapter
2. Add Transfers (Single + Bulk)
3. Add Mobile Money adapter
4. Add Bank Transfer adapter
5. Add PAPSS adapter
6. Add FX adapter
7. Add Card Issuance adapter
8. Add Virtual Accounts
9. Add Bill Payments (via Baxi)
10. Add Agent Banking
11. Add Stablecoins
12. Add Settlements
13. Add International payments

---

### 5. REMITA

| Capability | Documented | Declared | Coded | Gap |
|---|---|---|---|---|
| Collections (RRR) | YES | YES | YES | - |
| Transactions | YES | YES | YES | - |
| Transfers (Single - RITs) | YES | NO | NO | **MISSING** |
| Transfers (Bulk - RITs) | YES | NO | NO | **MISSING** |
| Bill Payments | YES | YES | YES | - |
| Electricity | YES | YES | YES | - |
| TV/Cable | YES | YES | YES | - |
| Airtime | YES | YES | YES | - |
| Data | YES | YES | YES | - |
| Education | YES | NO | NO | **MISSING** |
| Government/TSA | YES | YES | YES | - |
| Subscriptions | PARTIAL | NO | NO | Direct Debit exists |
| Refunds | NO | NO | NO | Not supported |
| Reversals | NO | NO | NO | Not supported |
| Settlements | YES | YES | NO | **MISSING** |
| Split Payments | YES | NO | NO | **MISSING** |
| Cards | NO | NO | NO | Not supported |
| QR Codes | NO | NO | NO | Not supported |
| International | NO | NO | NO | Not supported |
| Bank Resolution | YES | NO | NO | **MISSING** |

**Remita Action Items:**
1. Add Transfers (Single + Bulk via RITs)
2. Add Education bill payments
3. Add Settlements
4. Add Split Payments
5. Add Bank Resolution
6. Add Subscriptions (Direct Debit)
7. Update categories to include education

---

### 6. QUICKTELLER

| Capability | Documented | Declared | Coded | Gap |
|---|---|---|---|---|
| Collections | YES | NO | NO | **MISSING** |
| Transactions | YES | NO | NO | **MISSING** |
| Transfers (Single) | YES | NO | NO | **MISSING** |
| Transfers (Bulk) | YES | NO | NO | **MISSING** |
| Bill Payments | YES | YES | YES | - |
| Electricity | YES | NO | NO | **MISSING** |
| TV/Cable | YES | NO | NO | **MISSING** |
| Airtime | YES | YES | YES | - |
| Data | YES | YES | YES | - |
| Education | YES | YES | YES | - |
| Insurance | YES | YES | YES | - |
| Transport | YES | YES | YES | - |
| Subscriptions/Recurring | YES | NO | NO | **MISSING** |
| Refunds | YES | NO | NO | **MISSING** |
| Cards (Payments) | YES | NO | NO | **MISSING** |
| Card Issuance | YES | NO | NO | **MISSING** |
| Virtual Cards | YES | NO | NO | **MISSING** |
| QR Codes | YES | NO | NO | **MISSING** |
| International (PIPEChain) | YES | NO | NO | **MISSING** |
| Bank Resolution | YES | NO | NO | **MISSING** |
| KYC | YES | NO | NO | **MISSING** |
| Payouts | YES | NO | NO | **MISSING** |
| Settlements | YES | YES | NO | **MISSING** |
| Virtual Accounts | YES | YES | YES | - |

**Quickteller Action Items:**
1. Add Collections adapter
2. Add Transfers (Single + Bulk)
3. Add Electricity bill payments
4. Add TV/Cable bill payments
5. Add Subscriptions/Recurring
6. Add Refunds
7. Add Cards (Payments)
8. Add Card Issuance
9. Add Virtual Cards
10. Add QR Codes
11. Add PIPEChain International
12. Add Bank Resolution
13. Add KYC
14. Add Payouts
15. Add Settlements

---

## PART 2: PROVIDER INTERFACE GAPS

Current interfaces don't cover all needed capabilities:

| Interface | Status | Missing |
|---|---|---|
| IVirtualAccountProvider | EXISTS | - |
| IWalletFundingProvider | EXISTS | - |
| ILocalTransferProvider | EXISTS | - |
| IInternationalTransferProvider | EXISTS | - |
| IInternationalReceivingProvider | EXISTS | - |
| ICrossBorderSettlementProvider | EXISTS | - |
| IExchangeRateProvider | EXISTS | - |
| IBillPaymentProvider | EXISTS | - |
| IKYCProvider | EXISTS | - |
| INotificationProvider | EXISTS | - |
| IVirtualCardProvider | EXISTS | - |
| **ISubscriptionProvider** | MISSING | Recurring payments |
| **IDisputeProvider** | MISSING | Chargebacks/Disputes |
| **ISettlementProvider** | MISSING | Settlement queries |
| **IPaymentPageProvider** | MISSING | Payment page creation |
| **ISplitPaymentProvider** | MISSING | Split payments |
| **IBulkTransferProvider** | MISSING | Bulk transfers |
| **IDirectDebitProvider** | MISSING | Direct debit mandates |
| **IPAPSSProvider** | MISSING | PAPSS cross-border |
| **IAgentBankingProvider** | MISSING | Agent banking (Baxi) |
| **IBalanceProvider** | MISSING | Wallet/balance queries |
| **ICardPaymentProvider** | MISSING | Card charge processing |

---

## PART 3: IMPLEMENTATION PLAN

### Phase 1: Capability Declaration Updates (Priority: IMMEDIATE)

**1.1 Fix Incorrect Declarations**

| Provider | Fix | File |
|---|---|---|
| Paystack | `supportsQR: () => false` | paystack.ts |
| Flutterwave | Remove Bill Payments categories | flutterwave.ts |
| Flutterwave | Remove Split Payments | flutterwave.ts |
| Flutterwave | Remove Terminals/POS | flutterwave.ts |
| Flutterwave | Remove Apple Pay/Google Pay | flutterwave.ts |
| Flutterwave | `supportsBulkTransfer: () => false` | flutterwave.ts |

**1.2 Add Missing Categories**

| Provider | Add | File |
|---|---|---|
| Paystack | subscription, plan, dispute, payment_page, payment_request, split, subaccount, terminal, direct_debit, apple_pay | paystack.ts |
| Monnify | bill_payment, airtime, data, electricity, tv, education, invoice, split, direct_debit, international, bvn, nin, wallet, paycode | monnify.ts |
| Onafriq | transfer, bulk_transfer, virtual_account, card_issuance, bill_payment, airtime, data, agent_banking, stablecoin, settlement | onafriq.ts |
| Remita | transfer, bulk_transfer, education, settlement, split, bank_resolution | remita.ts |
| Quickteller | collection, transfer, bulk_transfer, electricity, tv, subscription, refund, card, card_issuance, qr, international, bank_resolution, kyc, payout, settlement | quickteller.ts |

**1.3 Update Supported Countries/Currencies**

| Provider | Update |
|---|---|
| Flutterwave | Add INR, AUD, EGP, ETB, MWK currencies |
| Monnify | Add USD for international |
| Onafriq | Already comprehensive |
| Quickteller | Add KE, CD countries; KES, USD currencies |

---

### Phase 2: New Provider Interfaces (Priority: HIGH)

Create new interface files:

```
src/lib/turbocore/providers/interfaces/
  ├── index.ts (existing, extend)
  ├── subscription.ts (NEW)
  ├── dispute.ts (NEW)
  ├── settlement.ts (NEW)
  ├── payment-page.ts (NEW)
  ├── split-payment.ts (NEW)
  ├── bulk-transfer.ts (NEW)
  ├── direct-debit.ts (NEW)
  ├── papss.ts (NEW)
  ├── agent-banking.ts (NEW)
  ├── balance.ts (NEW)
  └── card-payment.ts (NEW)
```

---

### Phase 3: Adapter Implementations (Priority: HIGH)

**3.1 Paystack Adapter Extensions**

| Method | Interface | Priority |
|---|---|---|
| createSubscription | ISubscriptionProvider | P1 |
| listPlans | ISubscriptionProvider | P1 |
| createCustomer | ICustomerProvider | P1 |
| listDisputes | IDisputeProvider | P2 |
| createPaymentPage | IPaymentPageProvider | P2 |
| createPaymentRequest | IPaymentRequestProvider | P2 |
| createSplit | ISplitPaymentProvider | P2 |
| createTerminal | ITerminalProvider | P3 |

**3.2 Monnify Adapter Extensions**

| Method | Interface | Priority |
|---|---|---|
| initiateTransfer | ILocalTransferProvider | P1 |
| bulkTransfer | IBulkTransferProvider | P1 |
| processBillPayment | IBillPaymentProvider | P1 |
| createRefund | IRefundProvider | P1 |
| createInvoice | IInvoiceProvider | P2 |
| createSplit | ISplitPaymentProvider | P2 |
| createDirectDebit | IDirectDebitProvider | P2 |
| verifyBVN | IKYCProvider | P2 |
| verifyNIN | IKYCProvider | P2 |
| createPaycode | IOfflinePayoutProvider | P3 |

**3.3 Onafriq Adapter (NEW)**

| Method | Interface | Priority |
|---|---|---|
| initializeCollection | ICollectionProvider | P1 |
| initiateTransfer | ILocalTransferProvider | P1 |
| bulkTransfer | IBulkTransferProvider | P1 |
| mobileMoneyCollection | IMobileMoneyProvider | P1 |
| mobileMoneyPayout | IMobileMoneyProvider | P1 |
| getFxQuote | IExchangeRateProvider | P1 |
| createVirtualAccount | IVirtualAccountProvider | P2 |
| issueCard | IVirtualCardProvider | P2 |
| processBillPayment | IBillPaymentProvider | P2 |
| papssPayment | IPAPSSProvider | P2 |

**3.4 Remita Adapter Extensions**

| Method | Interface | Priority |
|---|---|---|
| singleTransfer | ILocalTransferProvider | P1 |
| bulkTransfer | IBulkTransferProvider | P1 |
| getSettlement | ISettlementProvider | P2 |
| createSplit | ISplitPaymentProvider | P2 |

**3.5 Quickteller Adapter Extensions**

| Method | Interface | Priority |
|---|---|---|
| initializeCollection | ICollectionProvider | P1 |
| processPayment | ICardPaymentProvider | P1 |
| singleTransfer | ILocalTransferProvider | P1 |
| bulkTransfer | IBulkTransferProvider | P1 |
| processRefund | IRefundProvider | P1 |
| processBillPayment | IBillPaymentProvider | P1 (extend) |
| createSubscription | ISubscriptionProvider | P2 |
| issueCard | IVirtualCardProvider | P2 |
| papssPayment | IPAPSSProvider | P3 |

---

### Phase 4: Capability Registry Updates (Priority: MEDIUM)

Update `src/lib/turbocore/providers/capabilities/index.ts` to register new capabilities.

Update `src/lib/turbocore/providers/capabilities.ts` (the base type) to include:
- All new capability query methods
- Rate limit configurations
- Cost profiles
- Settlement configurations

---

### Phase 5: Adapter Factory Updates (Priority: MEDIUM)

Update `src/lib/turbocore/providers/adapter-factory.ts` to:
- Register new adapters (Onafriq)
- Wire new interfaces
- Handle credential rotation for new auth methods

---

### Phase 6: Webhook Handler Updates (Priority: MEDIUM)

Update webhook handlers for each provider to handle new event types:
- Paystack: subscription.*, dispute.*, settlement.*
- Flutterwave: chargebacks, settlements
- Monnify: bill payments, refunds, settlements
- Onafriq: all new events
- Remita: settlements
- Quickteller: subscriptions, refunds, settlements

---

### Phase 7: Frontend Dynamic Menu Generation (Priority: LOW)

Update the frontend to:
- Query capability registry
- Dynamically generate service menus
- Hide unsupported features per provider
- Show provider-specific options

---

## PART 4: IMPLEMENTATION SEQUENCE

### Sprint 1 (Week 1-2): Fix & Align
1. Fix all incorrect capability declarations
2. Add missing categories to all 6 providers
3. Update supported countries/currencies
4. Create missing provider interfaces

### Sprint 2 (Week 3-4): Core Adapters
1. Extend Paystack adapter (subscriptions, customers, disputes)
2. Extend Monnify adapter (transfers, bill payments, refunds)
3. Extend Remita adapter (transfers, education)
4. Extend Quickteller adapter (collections, transfers, electricity, TV)

### Sprint 3 (Week 5-6): New Adapters
1. Build Onafriq adapter from scratch
2. Add PAPSS support
3. Add card issuance support
4. Add agent banking support

### Sprint 4 (Week 7-8): Advanced Features
1. Add split payments support
2. Add payment pages
3. Add direct debit
4. Add dispute management

### Sprint 5 (Week 9-10): Integration & Testing
1. Update webhook handlers
2. Update adapter factory
3. Update capability registry
4. End-to-end testing

---

## PART 5: RISK ASSESSMENT

| Risk | Impact | Mitigation |
|---|---|---|
| Onafriq API docs not fully accessible | HIGH | Use Baxi sandbox + onboarding support |
| Remita developer portal SPA | MEDIUM | Use existing project code + community SDKs |
| Flutterwave v4 breaking changes | HIGH | Follow v4 docs strictly, ignore v3 |
| Monnify bill payment activation | MEDIUM | Contact integrations@monnify.com |
| Quickteller legacy auth complexity | MEDIUM | Use OAuth 2.0 only, skip legacy |
| Rate limit unknowns | LOW | Implement exponential backoff |

---

*Plan generated from comprehensive documentation analysis of all 6 providers.*
