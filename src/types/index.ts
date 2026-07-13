// TurboPay Unified Types
// Core types for the payment orchestration system

// =============================================================================
// PROVIDER TYPES
// =============================================================================

export type ProviderName = 'paystack' | 'flutterwave' | 'monnify' | 'onafriq' | 'remita' | 'quickteller';

export type PaymentOperation =
  | 'card_collection'
  | 'bank_transfer_collection'
  | 'ussd_collection'
  | 'mobile_money_collection'
  | 'qr_collection'
  | 'bank_transfer_payout'
  | 'mobile_money_payout'
  | 'bulk_payment'
  | 'virtual_account'
  | 'bill_payment'
  | 'airtime'
  | 'data'
  | 'electricity'
  | 'cable_tv'
  | 'education'
  | 'refund'
  | 'reversal'
  | 'papss'
  | 'fx'
  | 'bank_resolution'
  | 'bvn'
  | 'kyc'
  | 'mobile_money'
  | 'merchant_collection';

export type TransactionStatus = 'pending' | 'processing' | 'success' | 'failed' | 'reversed' | 'cancelled';

export type TransferType = 'instant' | 'scheduled' | 'deferred';

export type Environment = 'sandbox' | 'production';

// =============================================================================
// CUSTOMER TYPES
// =============================================================================

export interface CustomerName {
  first: string;
  middle?: string;
  last: string;
}

export interface CustomerPhone {
  country_code: string;
  number: string;
}

export interface CustomerAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
}

export interface CustomerInfo {
  id?: string;
  email: string;
  name?: CustomerName;
  phone?: CustomerPhone;
  address?: CustomerAddress;
  bvn?: string;
  nin?: string;
  metadata?: Record<string, any>;
}

// =============================================================================
// PAYMENT TYPES
// =============================================================================

export interface CardPaymentMethod {
  type: 'card';
  card_number?: string;
  expiry_month?: string;
  expiry_year?: string;
  cvv?: string;
  encrypted_card_number?: string;
  encrypted_expiry_month?: string;
  encrypted_expiry_year?: string;
  encrypted_cvv?: string;
  nonce?: string;
}

export interface BankTransferPaymentMethod {
  type: 'bank_transfer';
}

export interface USSDPaymentMethod {
  type: 'ussd';
  account?: string;
}

export interface MobileMoneyPaymentMethod {
  type: 'mobile_money';
  country_code: string;
  network: string;
  phone_number: string;
}

export interface QRPaymentMethod {
  type: 'qr';
}

export type PaymentMethod = 
  | CardPaymentMethod 
  | BankTransferPaymentMethod 
  | USSDPaymentMethod 
  | MobileMoneyPaymentMethod 
  | QRPaymentMethod;

// =============================================================================
// RECIPIENT TYPES
// =============================================================================

export interface BankRecipient {
  type: 'bank';
  bank: {
    code: string;
    account_number: string;
    name?: string;
    branch?: string;
    routing_number?: string;
    swift_code?: string;
    account_type?: string;
  };
  name?: CustomerName;
  email?: string;
  phone?: CustomerPhone;
  address?: CustomerAddress;
}

export interface MobileMoneyRecipient {
  type: 'mobile_money';
  mobile_money: {
    network: string;
    phone_number: string;
    country_code: string;
    country?: string;
  };
  name?: CustomerName;
}

export type RecipientInfo = BankRecipient | MobileMoneyRecipient;

// =============================================================================
// REQUEST TYPES
// =============================================================================

export interface UnifiedPaymentRequest {
  amount: number;
  currency: string;
  reference: string;
  description?: string;
  metadata?: Record<string, any>;
  callback_url?: string;
  redirect_url?: string;
  customer?: CustomerInfo;
  payment_method?: PaymentMethod;
}

export interface UnifiedTransferRequest {
  amount: number;
  currency: string;
  reference: string;
  narration?: string;
  recipient: RecipientInfo;
  type?: TransferType;
  scheduled_date?: Date;
  callback_url?: string;
  metadata?: Record<string, any>;
}

export interface VirtualAccountRequest {
  reference: string;
  customer_id?: string;
  customer?: CustomerInfo;
  amount: number;
  currency: string;
  account_type: 'static' | 'dynamic' | 'dedicated';
  narration?: string;
  bvn?: string;
  nin?: string;
  expiry?: number;
  bank_code?: string;
}

export interface BillPaymentRequest {
  biller_id: string;
  item_id?: string;
  amount: number;
  customer_reference: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  due_date?: Date;
  metadata?: Record<string, any>;
}

export interface BulkTransferRequest {
  transfers: UnifiedTransferRequest[];
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

export interface UnifiedTransactionResponse {
  id: string;
  reference: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  provider: ProviderName;
  provider_reference?: string;
  fees?: number;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
  payment_method_details?: Record<string, any>;
  authorization?: {
    redirect_url?: string;
    pin_required?: boolean;
    otp_required?: boolean;
    ussd_code?: string;
    [key: string]: any;
  };
}

export interface VirtualAccountResponse {
  id: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
  account_type: 'static' | 'dynamic' | 'dedicated';
  status: 'active' | 'inactive';
  currency: string;
  amount: number;
  expires_at?: Date;
  customer_id?: string;
  created_at: Date;
}

export interface UnifiedTransferResponse {
  id: string;
  reference: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  provider: ProviderName;
  provider_reference?: string;
  fees?: number;
  created_at: Date;
  updated_at: Date;
  recipient?: RecipientInfo;
  metadata?: Record<string, any>;
}

export interface UnifiedBulkTransferResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_amount: number;
  total_count: number;
  successful_count: number;
  failed_count: number;
  transfers: UnifiedTransferResponse[];
  created_at: Date;
}

export interface CustomerResponse {
  id: string;
  email: string;
  name?: CustomerName;
  phone?: CustomerPhone;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// BANK TYPES
// =============================================================================

export interface Bank {
  code: string;
  name: string;
  longcode?: string;
  type?: string;
  country?: string;
}

export interface BankAccountResolution {
  account_number: string;
  account_name: string;
  bank_code: string;
  bank_name: string;
}

// =============================================================================
// BILLER TYPES
// =============================================================================

export interface Biller {
  id: string;
  name: string;
  category: string;
  description?: string;
  payment_items?: BillerItem[];
}

export interface BillerItem {
  id: string;
  name: string;
  amount?: number;
  code?: string;
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export interface UnifiedWebhookEvent {
  event: string;
  data: UnifiedTransactionResponse;
  provider: ProviderName;
  signature: string;
  timestamp: Date;
  raw_payload?: any;
}

// =============================================================================
// CAPABILITY TYPES
// =============================================================================

export interface CollectionCapabilities {
  card: boolean;
  bank_transfer: boolean;
  ussd: boolean;
  mobile_money: boolean;
  qr: boolean;
  opay?: boolean;
}

export interface PayoutCapabilities {
  bank_transfer: boolean;
  mobile_money: boolean;
  bulk: boolean;
  scheduled: boolean;
  instant: boolean;
}

export interface VirtualAccountCapabilities {
  dedicated: boolean;
  dynamic: boolean;
  static: boolean;
  bank_selection?: boolean;
}

export interface BillCapabilities {
  airtime: boolean;
  data: boolean;
  electricity: boolean;
  cable_tv: boolean;
  education: boolean;
  insurance?: boolean;
  government?: boolean;
  betting?: boolean;
}

export interface CustomerCapabilities {
  creation: boolean;
  kyc: boolean;
  bvn: boolean;
  nin?: boolean;
}

export interface TechnicalCapabilities {
  webhooks: boolean;
  idempotency: boolean;
  sandbox: boolean;
  multi_currency: boolean;
  international: boolean;
  recurring: boolean;
  refunds: boolean;
  reversals: boolean;
}

export interface ProviderCapabilities {
  provider: ProviderName;
  name: string;
  collections: CollectionCapabilities;
  payouts: PayoutCapabilities;
  virtual_accounts: VirtualAccountCapabilities;
  bills: BillCapabilities;
  customers: CustomerCapabilities;
  technical: TechnicalCapabilities;
  countries: string[];
  currencies: string[];
}

// =============================================================================
// ROUTER TYPES
// =============================================================================

// =============================================================================
// EXCHANGE RATE TYPES
// =============================================================================

export interface ExchangeRateResponse {
  from_currency: string;
  to_currency: string;
  rate: number;
  amount: number;
  converted_amount: number;
  provider: ProviderName;
  timestamp: Date;
}

// =============================================================================
// PROVIDER HEALTH CHECK
// =============================================================================

export interface ProviderHealthCheckResult {
  provider: ProviderName;
  is_healthy: boolean;
  latency: number;
  timestamp: Date;
  api_status?: string;
  error?: string;
}

// =============================================================================
// SETTLEMENT TYPES
// =============================================================================

export interface SettlementResponse {
  id: string;
  provider: ProviderName;
  total_amount: number;
  currency: string;
  fee: number;
  net_amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  settlement_date: Date;
  reference: string;
  transactions: string[];
}

// =============================================================================
// REFUND / REVERSAL
// =============================================================================

export interface RefundRequest {
  transaction_id: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface ReversalRequest {
  transaction_id: string;
  reason?: string;
  metadata?: Record<string, any>;
}

// =============================================================================
// LEDGER TYPES
// =============================================================================

export type LedgerEntryType =
  | 'credit'
  | 'debit'
  | 'hold'
  | 'release'
  | 'settlement'
  | 'fee'
  | 'refund'
  | 'reversal'
  | 'adjustment';

export type LedgerEntryStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export interface LedgerEntry {
  id: string;
  wallet_id: string;
  type: LedgerEntryType;
  amount: number;
  currency: string;
  status: LedgerEntryStatus;
  reference: string;
  provider?: ProviderName;
  provider_reference?: string;
  description?: string;
  metadata?: Record<string, any>;
  balance_before: number;
  balance_after: number;
  created_at: Date;
  updated_at: Date;
}

export interface Wallet {
  id: string;
  user_id: string;
  currency: string;
  balance: number;
  available_balance: number;
  held_balance: number;
  status: 'active' | 'frozen' | 'closed';
  created_at: Date;
  updated_at: Date;
}

export interface JournalEntry {
  id: string;
  reference: string;
  wallet_id: string;
  entries: JournalLine[];
  status: 'pending' | 'committed' | 'reversed';
  description?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  committed_at?: Date;
}

export interface JournalLine {
  wallet_id: string;
  type: 'debit' | 'credit';
  amount: number;
  currency: string;
}

export interface AuditLog {
  id: string;
  event: string;
  entity_type: string;
  entity_id: string;
  actor?: string;
  changes?: Record<string, { before: any; after: any }>;
  metadata?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

// =============================================================================
// BULK PAYMENT PIPELINE TYPES
// =============================================================================

export type BulkPaymentStatus =
  | 'uploaded'
  | 'parsing'
  | 'validated'
  | 'validation_failed'
  | 'processing'
  | 'completed'
  | 'partially_completed'
  | 'failed';

export type BulkPaymentItemStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'skipped';

export interface BulkPaymentFile {
  id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  status: BulkPaymentStatus;
  total_count: number;
  successful_count: number;
  failed_count: number;
  skipped_count: number;
  total_amount: number;
  currency: string;
  processing_started_at?: Date;
  processing_completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface BulkPaymentItem {
  id: string;
  bulk_payment_id: string;
  row_number: number;
  recipient_name: string;
  recipient_account: string;
  bank_code: string;
  amount: number;
  currency: string;
  narration?: string;
  status: BulkPaymentItemStatus;
  error_message?: string;
  provider?: ProviderName;
  provider_reference?: string;
  processed_at?: Date;
  created_at: Date;
  updated_at?: Date;
}

export interface BulkPaymentValidationResult {
  valid: boolean;
  errors: BulkPaymentValidationError[];
  warnings: BulkPaymentValidationWarning[];
  duplicate_indices: number[];
  risk_score: number;
}

export interface BulkPaymentValidationError {
  row: number;
  field: string;
  message: string;
}

export interface BulkPaymentValidationWarning {
  row: number;
  field: string;
  message: string;
}

export interface BulkPaymentReport {
  bulk_payment_id: string;
  status: BulkPaymentStatus;
  total_count: number;
  successful_count: number;
  failed_count: number;
  skipped_count: number;
  total_amount: number;
  processed_amount: number;
  failed_amount: number;
  currency: string;
  items: BulkPaymentItem[];
  generated_at: Date;
}

export interface RouterConfig {
  health_check_interval: number;
  max_retries: number;
  retry_delay: number;
  failover_enabled: boolean;
  circuit_breaker_threshold: number;
  circuit_breaker_timeout: number;
  default_timeout: number;
}

export interface ProviderHealth {
  is_healthy: boolean;
  success_count: number;
  failure_count: number;
  last_success: Date | null;
  last_failure: Date | null;
  average_latency: number;
  recent_latencies: number[];
  last_health_check: Date;
}

export interface CircuitBreaker {
  is_open: boolean;
  opened_at: Date | null;
  failure_count: number;
  last_failure: Date | null;
}

// =============================================================================
// PROVIDER ADAPTER INTERFACE
// =============================================================================

export interface ProviderAdapter {
  readonly name: ProviderName;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly sandboxBaseUrl: string;

  authenticate(): Promise<void>;
  refreshToken(): Promise<void>;
  getCapabilities(): ProviderCapabilities;

  initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse>;
  verifyPayment(reference: string): Promise<UnifiedTransactionResponse>;
  getPaymentStatus(id: string): Promise<UnifiedTransactionResponse>;

  createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse>;
  verifyTransfer(reference: string): Promise<UnifiedTransferResponse>;
  getTransferStatus(id: string): Promise<UnifiedTransferResponse>;
  createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse>;

  createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse>;
  getVirtualAccount(id: string): Promise<VirtualAccountResponse>;
  listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]>;

  createCustomer(customer: CustomerInfo): Promise<CustomerResponse>;
  getCustomer(id: string): Promise<CustomerResponse>;
  updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse>;

  listBanks(country?: string): Promise<Bank[]>;
  resolveBank(code: string, account_number: string): Promise<BankAccountResolution>;

  listBillers(): Promise<Biller[]>;
  getBillerItems(biller_id: string): Promise<BillerItem[]>;
  payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse>;

  validateWebhook(payload: any, signature: string): boolean;
  parseWebhookEvent(payload: any): UnifiedWebhookEvent;

  refund?(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse>;
  reverse?(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse>;
  exchangeRate?(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse>;
  healthCheck?(): Promise<ProviderHealthCheckResult>;
  settlement?(): Promise<SettlementResponse>;
  merchantCollection?(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse>;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class PaymentFailedError extends Error {
  public provider: ProviderName;
  public provider_error?: string;
  public provider_code?: string;

  constructor(message: string, provider: ProviderName, provider_error?: string, provider_code?: string) {
    super(message);
    this.name = 'PaymentFailedError';
    this.provider = provider;
    this.provider_error = provider_error;
    this.provider_code = provider_code;
  }
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class InsufficientBalanceError extends Error {
  public available_balance?: number;
  public required_amount?: number;

  constructor(message: string, available_balance?: number, required_amount?: number) {
    super(message);
    this.name = 'InsufficientBalanceError';
    this.available_balance = available_balance;
    this.required_amount = required_amount;
  }
}

export class RateLimitError extends Error {
  public retry_after?: number;

  constructor(message: string, retry_after?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retry_after = retry_after;
  }
}

export class ProviderFeatureUnavailableError extends Error {
  public provider: ProviderName;
  public feature: string;

  constructor(provider: ProviderName, feature: string) {
    super(`Feature '${feature}' is not supported by provider '${provider}'`);
    this.name = 'ProviderFeatureUnavailableError';
    this.provider = provider;
    this.feature = feature;
  }
}
