/**
 * TurboCore — Provider Integration Contracts
 * ==========================================
 *
 * Every external dependency is expressed as an interface. TurboCore never
 * depends directly on provider SDKs. Adapters (Mock / Sandbox / Production)
 * implement these contracts and are registered in the ProviderRegistry.
 *
 * Swapping Monnify for Paystack requires changing only the adapter registered
 * for IVirtualAccountProvider — no business code changes.
 *
 * All contracts are async (network-bound) and return normalised domain types,
 * never raw provider payloads.
 */

import type { Currency } from "@/lib/turbocore/types";

// ─── Shared domain types ──────────────────────────────────────

export interface ProviderContext {
  /** The product initiating the call: "turbopay" | "billswift" | … */
  product: string;
  /** User's ISO 3166-1 alpha-2 country code (NG, GH, US, …). */
  country?: string;
  /** Correlation id for tracing through logs + audit. */
  correlationId?: string;
  /** Idempotency key (carried through to the provider if supported). */
  idempotencyKey?: string;
}

export interface ProviderResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; raw?: unknown };
  /** Provider's own reference for this operation. */
  providerRef?: string;
  /** Raw provider response (audit only — never used by business logic). */
  raw?: unknown;
}

// ─── Virtual Account ──────────────────────────────────────────

export interface VirtualAccountDetails {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  providerRef: string;
  currency: Currency;
}

export interface IVirtualAccountProvider {
  readonly name: string;
  createReservedAccount(
    accountName: string,
    customerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<VirtualAccountDetails>>;
  closeAccount(
    providerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ closed: boolean }>>;
}

// ─── Wallet Funding ───────────────────────────────────────────

export interface WalletFundingInit {
  accountNumber: string;
  amountMinor: number;
  currency: Currency;
  reference: string;
}

export interface WalletFundingResult {
  providerRef: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  settledAmountMinor: number;
  settledCurrency: Currency;
  /** Redirect URL for hosted checkout (Paystack, Flutterwave, Stripe). */
  authorizationUrl?: string;
}

/**
 * Synthesised funding webhook payload — used by the demo/sandbox funding
 * flow to exercise the same idempotent processFunding path the real webhook
 * uses, without a live bank transfer.
 */
export interface SimulatedFundingEvent {
  event: string;
  payload: {
    transactionReference: string;
    paymentReference: string;
    accountReference: string;
    paidAt: string;
    amount: number;
    amountPaid: number;
    paymentMethod: string;
    paymentStatus: string;
    currency: string;
    settlementAmount: number;
  };
}

export interface IWalletFundingProvider {
  readonly name: string;
  /** Initiate / simulate a funding (some providers are webhook-only). */
  initiateFunding(
    input: WalletFundingInit,
    ctx?: ProviderContext
  ): Promise<ProviderResult<WalletFundingResult>>;
  /** Synthesise a funding webhook payload (demo/sandbox only). */
  simulateFunding(
    accountNumber: string,
    amountMinor: number,
    ctx?: ProviderContext
  ): Promise<SimulatedFundingEvent>;
}

// ─── Local Transfer ───────────────────────────────────────────

export interface LocalTransferInput {
  fromAccount: string;
  toAccount: string;
  toBankCode: string;
  amountMinor: number;
  currency: Currency;
  reference: string;
  narration?: string;
}

export interface ILocalTransferProvider {
  readonly name: string;
  transfer(
    input: LocalTransferInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ providerRef: string; status: "PENDING" | "SUCCESS" | "FAILED" }>>;
  getTransferStatus(
    providerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>>;
}

// ─── International Transfer (outbound) ────────────────────────

export interface InternationalTransferInput {
  sourceCurrency: Currency;
  destinationCurrency: Currency;
  amountMinor: number; // in source currency
  beneficiary: {
    name: string;
    account?: string;
    bank?: string;
    country: string;
    routingCode?: string;
  };
  purpose: string;
  reference: string;
}

export interface InternationalTransferResult {
  providerRef: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  quotedRate: number;
  destinationAmountMinor: number;
  feesMinor: number;
  settlementCurrency: Currency;
}

export interface IInternationalTransferProvider {
  readonly name: string;
  send(
    input: InternationalTransferInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<InternationalTransferResult>>;
  getStatus(
    providerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ status: "PENDING" | "SUCCESS" | "FAILED" }>>;
}

// ─── International Receiving (inbound) ────────────────────────

/**
 * Receives a normalised inbound international payment event from a provider
 * webhook. The raw webhook is handled by the Webhook Framework; this contract
 * is called by the settlement engine after normalisation.
 */
export interface IntlReceivingEvent {
  providerRef: string;
  sourceCurrency: Currency;
  sourceAmountMinor: number;
  destinationCurrency: Currency;
  destinationAmountMinor: number;
  rate: number;
  feesMinor: number;
  beneficiaryAccount: string; // Turbopay virtual account
  sender: { name: string; country: string };
  paidAt: string;
}

export interface IInternationalReceivingProvider {
  readonly name: string;
  /** Validate an inbound webhook payload + return the normalised event. */
  parseWebhook(
    rawPayload: unknown,
    headers: Record<string, string>,
    ctx?: ProviderContext
  ): Promise<ProviderResult<IntlReceivingEvent>>;
}

// ─── Cross-Border Settlement ──────────────────────────────────

export interface SettlementDetails {
  providerRef: string;
  settlementCurrency: Currency;
  settlementAmountMinor: number;
  status: "PENDING" | "SETTLED" | "FAILED";
  settledAt?: string;
}

export interface ICrossBorderSettlementProvider {
  readonly name: string;
  getSettlement(
    providerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<SettlementDetails>>;
}

// ─── Exchange Rate ────────────────────────────────────────────

export interface FxQuote {
  from: Currency;
  to: Currency;
  rate: number;
  rateId?: string; // lockable quote id (future)
  expiresAt?: string;
  providerFeeMinor: number;
  platformFeeMinor: number;
}

export interface IExchangeRateProvider {
  readonly name: string;
  getQuote(
    from: Currency,
    to: Currency,
    amountMinor: number,
    ctx?: ProviderContext
  ): Promise<ProviderResult<FxQuote>>;
}

// ─── Bill Payment ─────────────────────────────────────────────

export interface BillValidationInput {
  productCode: string;
  customer: string;
  meterType?: "PREPAID" | "POSTPAID";
}

export interface BillValidationResult {
  valid: boolean;
  customerName: string;
  message: string;
}

export interface BillPayInput {
  productCode: string;
  customer: string;
  customerName: string;
  amountMinor: number;
  currency: Currency;
  meterType?: "PREPAID" | "POSTPAID";
  reference: string;
}

export interface BillPayResult {
  providerRef: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  token?: string; // prepaid electricity token
  receiptNumber?: string;
}

export interface BillProductCatalog {
  code: string;
  name: string;
  category: string;
  fields: string[];
  fixedAmountMinor?: number;
  provider: string;
}

export interface IBillPaymentProvider {
  readonly name: string;
  /** Products this provider can fulfil. */
  listProducts(ctx?: ProviderContext): Promise<ProviderResult<BillProductCatalog[]>>;
  validate(
    input: BillValidationInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<BillValidationResult>>;
  pay(
    input: BillPayInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<BillPayResult>>;
}

// ─── KYC ──────────────────────────────────────────────────────

export interface KycVerificationResult {
  verified: boolean;
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string;
  gender: string;
  providerRef: string;
  phoneMatch?: boolean; // BVN phone-match
  stateOfOrigin?: string;
  lga?: string;
  town?: string;
}

/** Generic identity verification input — used by Paystack Identity and Stripe Identity. */
export interface IdentityVerificationInput {
  /** User's ISO 3166-1 alpha-2 country code. */
  country: string;
  /** Document type — meaning depends on provider:
   *  Paystack (NG/GH): "nin" | "bvn" | "phone"
   *  Stripe (rest of world): "passport" | "drivers_license" | "national_id"
   */
  documentType: string;
  /** Document value — number (NIN/BVN) or file reference (Stripe document). */
  documentValue: string;
  /** User's phone (for Paystack phone-based verification). */
  phone?: string;
}

/** Generic identity verification result — returned by all providers. */
export interface IdentityVerificationResult {
  verified: boolean;
  firstName: string;
  lastName: string;
  middleName?: string;
  dob: string;
  gender?: string;
  providerRef: string;
  /** Address fields (when returned by the provider). */
  address?: { line1?: string; city?: string; state?: string; postalCode?: string; country?: string };
}

export interface IKYCProvider {
  readonly name: string;
  verifyNin(nin: string, ctx?: ProviderContext): Promise<ProviderResult<KycVerificationResult>>;
  verifyBvn(
    bvn: string,
    phone: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<KycVerificationResult & { phoneMatch: boolean }>>;
  /** Generic identity verification — used by Paystack Identity and Stripe Identity.
   *  Default implementation throws UNSUPPORTED; providers that support it override. */
  verifyIdentity(
    input: IdentityVerificationInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<IdentityVerificationResult>>;
}

// ─── Notification ─────────────────────────────────────────────

export interface NotificationPayload {
  to: string; // phone or email
  channel: "SMS" | "EMAIL" | "PUSH";
  template: string; // e.g. "transaction.debit"
  variables: Record<string, string | number>;
  reference?: string;
}

export interface INotificationProvider {
  readonly name: string;
  send(
    payload: NotificationPayload,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ delivered: boolean; messageId?: string }>>;
}

// ─── Virtual Card Issuing ─────────────────────────────────────

export interface CardIssueInput {
  cardholderName: string;
  type: "VIRTUAL" | "PHYSICAL";
  brand: "VISA" | "MASTERCARD";
  currency: Currency;
  spendingLimitMinor?: number;
}

export interface IssuedCardDetails {
  providerCardId: string;
  pan: string; // 16-digit primary account number (Luhn-valid)
  cvv: string; // 3-digit security code
  expiryMonth: number; // 1-12
  expiryYear: number; // 4-digit
  last4: string;
  brand: string;
}

export interface IVirtualCardProvider {
  readonly name: string;
  /** Issue a new virtual/physical card. Returns the full PAN + CVV (encrypted by the caller before storage). */
  issueCard(
    input: CardIssueInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<IssuedCardDetails>>;
  /** Freeze / unfreeze / terminate a card at the issuer. */
  setCardStatus(
    providerCardId: string,
    status: "ACTIVE" | "FROZEN" | "TERMINATED",
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ updated: boolean }>>;
  /** Process a card authorization (purchase). Called by the card network webhook handler. */
  authorizePurchase(
    providerCardId: string,
    amountMinor: number,
    currency: Currency,
    merchant: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ approved: boolean; providerRef: string; declineReason?: string }>>;
}

// ─── Subscription / Recurring Payments ─────────────────────────

export interface SubscriptionPlan {
  /** Provider's plan identifier. */
  planId: string;
  /** Human-readable plan name. */
  name: string;
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency: Currency;
  /** Interval: "daily" | "weekly" | "monthly" | "yearly". */
  interval: string;
  /** Description. */
  description?: string;
}

export interface SubscriptionDetails {
  /** Provider's subscription identifier. */
  subscriptionId: string;
  /** Customer code/id. */
  customerCode: string;
  /** Plan identifier. */
  planId: string;
  /** Current status. */
  status: "active" | "inactive" | "pending" | "cancelled" | "completed";
  /** Next payment date. */
  nextPaymentDate?: string;
  /** Total payments made. */
  paymentsCount: number;
  /** Amount per payment in minor units. */
  amountMinor: number;
}

export interface ISubscriptionProvider {
  readonly name: string;
  /** Create a subscription plan. */
  createPlan(
    input: Omit<SubscriptionPlan, "planId">,
    ctx?: ProviderContext
  ): Promise<ProviderResult<SubscriptionPlan>>;
  /** List available plans. */
  listPlans(ctx?: ProviderContext): Promise<ProviderResult<SubscriptionPlan[]>>;
  /** Fetch a single plan. */
  getPlan(
    planId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<SubscriptionPlan>>;
  /** Create a subscription for a customer. */
  createSubscription(
    input: { customerCode: string; planId: string; authorization?: string },
    ctx?: ProviderContext
  ): Promise<ProviderResult<SubscriptionDetails>>;
  /** List subscriptions. */
  listSubscriptions(ctx?: ProviderContext): Promise<ProviderResult<SubscriptionDetails[]>>;
  /** Fetch a subscription. */
  getSubscription(
    subscriptionId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<SubscriptionDetails>>;
  /** Enable a disabled subscription. */
  enableSubscription(
    subscriptionId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ enabled: boolean }>>;
  /** Disable an active subscription. */
  disableSubscription(
    subscriptionId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ disabled: boolean }>>;
}

// ─── Disputes / Chargebacks ────────────────────────────────────

export interface DisputeDetails {
  /** Provider's dispute identifier. */
  disputeId: string;
  /** Transaction reference. */
  transactionRef: string;
  /** Dispute category. */
  category: string;
  /** Current status. */
  status: "pending" | "resolved" | "escalated" | "closed";
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency: Currency;
  /** Customer comment. */
  comment?: string;
  /** Resolution (if resolved). */
  resolution?: string;
  /** Created date. */
  createdAt: string;
}

export interface IDisputeProvider {
  readonly name: string;
  /** List all disputes. */
  listDisputes(ctx?: ProviderContext): Promise<ProviderResult<DisputeDetails[]>>;
  /** Fetch a single dispute. */
  getDispute(
    disputeId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<DisputeDetails>>;
  /** Resolve a dispute (accept or reject). */
  resolveDispute(
    disputeId: string,
    resolution: "accept" | "reject",
    comment?: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ resolved: boolean }>>;
}

// ─── Settlements ────────────────────────────────────────────────

export interface SettlementDetails2 {
  /** Provider's settlement identifier. */
  settlementId: string;
  /** Settlement status. */
  status: "pending" | "processing" | "success" | "failed";
  /** Total amount in minor units. */
  totalAmount: number;
  /** Net amount after fees in minor units. */
  netAmount: number;
  /** Fees in minor units. */
  fees: number;
  /** Currency code. */
  currency: Currency;
  /** Settlement date. */
  settledAt?: string;
  /** Transaction count in this settlement. */
  transactionCount: number;
}

export interface ISettlementProvider {
  readonly name: string;
  /** List settlements. */
  listSettlements(
    filters?: { from?: string; to?: string; status?: string },
    ctx?: ProviderContext
  ): Promise<ProviderResult<SettlementDetails2[]>>;
  /** Fetch a single settlement. */
  getSettlement(
    settlementId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<SettlementDetails2>>;
  /** List transactions in a settlement. */
  getSettlementTransactions(
    settlementId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<Array<{ transactionRef: string; amount: number; fee: number; currency: Currency }>>>;
}

// ─── Payment Pages ──────────────────────────────────────────────

export interface PaymentPageDetails {
  /** Provider's page identifier. */
  pageId: string;
  /** Page slug/URL. */
  slug?: string;
  /** Page name. */
  name: string;
  /** Page description. */
  description?: string;
  /** Amount (fixed amount pages). */
  amountMinor?: number;
  /** Currency. */
  currency?: Currency;
  /** Whether the page collects custom amounts. */
  collectCustomAmount: boolean;
  /** Page status. */
  status: "active" | "inactive";
  /** Page URL. */
  url?: string;
}

export interface IPaymentPageProvider {
  readonly name: string;
  /** Create a payment page. */
  createPage(
    input: { name: string; description?: string; amountMinor?: number; currency?: Currency; collectCustomAmount?: boolean },
    ctx?: ProviderContext
  ): Promise<ProviderResult<PaymentPageDetails>>;
  /** List payment pages. */
  listPages(ctx?: ProviderContext): Promise<ProviderResult<PaymentPageDetails[]>>;
  /** Fetch a payment page. */
  getPage(
    pageId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<PaymentPageDetails>>;
  /** Update a payment page. */
  updatePage(
    pageId: string,
    input: { name?: string; description?: string; amountMinor?: number; status?: "active" | "inactive" },
    ctx?: ProviderContext
  ): Promise<ProviderResult<PaymentPageDetails>>;
}

// ─── Split Payments ─────────────────────────────────────────────

export interface SplitConfig {
  /** Subaccount/recipient code. */
  subaccountCode: string;
  /** Share type: "percentage" or "flat". */
  shareType: "percentage" | "flat";
  /** Share value (percentage 0-100 or flat amount in minor units). */
  shareValue: number;
}

export interface SplitDetails {
  /** Provider's split identifier. */
  splitId: string;
  /** Split name. */
  name: string;
  /** Split configuration. */
  splits: SplitConfig[];
  /** Currency code. */
  currency: Currency;
  /** Total collected amount in minor units. */
  totalAmount?: number;
}

export interface ISplitPaymentProvider {
  readonly name: string;
  /** Create a split payment configuration. */
  createSplit(
    input: { name: string; currency: Currency; splits: SplitConfig[] },
    ctx?: ProviderContext
  ): Promise<ProviderResult<SplitDetails>>;
  /** List split configurations. */
  listSplits(ctx?: ProviderContext): Promise<ProviderResult<SplitDetails[]>>;
  /** Fetch a split configuration. */
  getSplit(
    splitId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<SplitDetails>>;
}

// ─── Bulk Transfers ─────────────────────────────────────────────

export interface BulkTransferItem {
  /** Recipient account number. */
  accountNumber: string;
  /** Recipient bank code. */
  bankCode: string;
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency: Currency;
  /** Unique reference for this item. */
  reference: string;
  /** Narration/description. */
  narration?: string;
}

export interface BulkTransferResult {
  /** Batch identifier. */
  batchId: string;
  /** Total items in batch. */
  totalItems: number;
  /** Total amount in minor units. */
  totalAmount: number;
  /** Number of items queued. */
  queuedCount: number;
  /** Number of items that failed validation. */
  failedCount: number;
}

export interface IBulkTransferProvider {
  readonly name: string;
  /** Initiate a bulk transfer. */
  bulkTransfer(
    items: BulkTransferItem[],
    ctx?: ProviderContext
  ): Promise<ProviderResult<BulkTransferResult>>;
  /** Get bulk transfer status. */
  getBulkStatus(
    batchId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ status: "pending" | "processing" | "completed" | "failed"; completedCount: number; failedCount: number }>>;
}

// ─── Direct Debit ───────────────────────────────────────────────

export interface DirectDebitMandate {
  /** Mandate identifier. */
  mandateId: string;
  /** Customer code/id. */
  customerCode: string;
  /** Account number. */
  accountNumber: string;
  /** Bank code. */
  bankCode: string;
  /** Mandate status. */
  status: "pending" | "active" | "cancelled" | "expired";
  /** Amount limit per debit in minor units. */
  maxAmountMinor?: number;
  /** Currency. */
  currency: Currency;
  /** Created date. */
  createdAt: string;
}

export interface IDirectDebitProvider {
  readonly name: string;
  /** Create a direct debit mandate. */
  createMandate(
    input: { customerCode: string; accountNumber: string; bankCode: string; maxAmountMinor?: number; currency: Currency },
    ctx?: ProviderContext
  ): Promise<ProviderResult<DirectDebitMandate>>;
  /** List mandates. */
  listMandates(ctx?: ProviderContext): Promise<ProviderResult<DirectDebitMandate[]>>;
  /** Fetch a mandate. */
  getMandate(
    mandateId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<DirectDebitMandate>>;
  /** Cancel a mandate. */
  cancelMandate(
    mandateId: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ cancelled: boolean }>>;
  /** Initiate a debit against a mandate. */
  debit(
    mandateId: string,
    amountMinor: number,
    reference: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ providerRef: string; status: "pending" | "success" | "failed" }>>;
}

// ─── PAPSS (Pan-African Payment and Settlement System) ─────────

export interface PapssPaymentInput {
  /** Source currency. */
  sourceCurrency: Currency;
  /** Destination currency. */
  destinationCurrency: Currency;
  /** Amount in source currency (minor units). */
  amountMinor: number;
  /** Sender details. */
  sender: { name: string; account?: string; country: string };
  /** Receiver details. */
  receiver: { name: string; account?: string; country: string };
  /** Payment reference. */
  reference: string;
  /** Payment description. */
  description?: string;
}

export interface IPAPSSProvider {
  readonly name: string;
  /** Initiate a PAPSS payment. */
  initiatePayment(
    input: PapssPaymentInput,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ providerRef: string; status: "pending" | "processing" | "completed" | "failed"; exchangeRate?: number }>>;
  /** Check payment status. */
  getStatus(
    providerRef: string,
    ctx?: ProviderContext
  ): Promise<ProviderResult<{ status: "pending" | "processing" | "completed" | "failed"; settlementStatus?: string }>>;
}

// ─── Balance / Wallet ───────────────────────────────────────────

export interface BalanceDetails {
  /** Currency code. */
  currency: Currency;
  /** Available balance in minor units. */
  available: number;
  /** Pending balance in minor units. */
  pending: number;
  /** Ledger balance in minor units. */
  ledger: number;
}

export interface IBalanceProvider {
  readonly name: string;
  /** Get balance for a specific currency. */
  getBalance(
    currency: Currency,
    ctx?: ProviderContext
  ): Promise<ProviderResult<BalanceDetails>>;
  /** Get balances for all currencies. */
  getAllBalances(ctx?: ProviderContext): Promise<ProviderResult<BalanceDetails[]>>;
}

// ─── Contract registry keys ───────────────────────────────────

export type ProviderContract =
  | "virtualAccount"
  | "walletFunding"
  | "localTransfer"
  | "internationalTransfer"
  | "internationalReceiving"
  | "crossBorderSettlement"
  | "exchangeRate"
  | "billPayment"
  | "kyc"
  | "notification"
  | "cardIssuer"
  | "subscription"
  | "dispute"
  | "settlement"
  | "paymentPage"
  | "splitPayment"
  | "bulkTransfer"
  | "directDebit"
  | "papss"
  | "balance";
