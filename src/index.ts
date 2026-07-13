// TurboPay Payment Orchestration System
// Unified provider interface for seamless payment operations

// =============================================================================
// TYPES
// =============================================================================

export {
  // Provider types
  ProviderName,
  PaymentOperation,
  TransactionStatus,
  TransferType,
  Environment,

  // Customer types
  CustomerName,
  CustomerPhone,
  CustomerAddress,
  CustomerInfo,

  // Payment types
  CardPaymentMethod,
  BankTransferPaymentMethod,
  USSDPaymentMethod,
  MobileMoneyPaymentMethod,
  QRPaymentMethod,
  PaymentMethod,

  // Recipient types
  BankRecipient,
  MobileMoneyRecipient,
  RecipientInfo,

  // Request types
  UnifiedPaymentRequest,
  UnifiedTransferRequest,
  VirtualAccountRequest,
  BillPaymentRequest,
  BulkTransferRequest,

  // Response types
  UnifiedTransactionResponse,
  VirtualAccountResponse,
  UnifiedTransferResponse,
  UnifiedBulkTransferResponse,
  CustomerResponse,

  // Bank types
  Bank,
  BankAccountResolution,

  // Biller types
  Biller,
  BillerItem,

  // Webhook types
  UnifiedWebhookEvent,

  // Capability types
  CollectionCapabilities,
  PayoutCapabilities,
  VirtualAccountCapabilities,
  BillCapabilities,
  CustomerCapabilities,
  TechnicalCapabilities,
  ProviderCapabilities,

  // Router types
  RouterConfig,
  ProviderHealth,
  CircuitBreaker,

  // Adapter interface
  ProviderAdapter,

  // Error types
  ProviderUnavailableError,
  ProviderFeatureUnavailableError,
  PaymentFailedError,
  WebhookValidationError,
  AuthenticationError,
  InsufficientBalanceError,
  RateLimitError,

  // Exchange rate
  ExchangeRateResponse,

  // Provider health check
  ProviderHealthCheckResult,

  // Settlement
  SettlementResponse,

  // Refund / Reversal
  RefundRequest,
  ReversalRequest,

  // Ledger types
  LedgerEntryType,
  LedgerEntryStatus,
  LedgerEntry,
  Wallet,
  JournalEntry,
  JournalLine,
  AuditLog,

  // Bulk payment types
  BulkPaymentStatus,
  BulkPaymentItemStatus,
  BulkPaymentFile,
  BulkPaymentItem,
  BulkPaymentValidationResult,
  BulkPaymentValidationError,
  BulkPaymentValidationWarning,
  BulkPaymentReport
} from './types';

// =============================================================================
// ADAPTERS
// =============================================================================

export { FlutterwaveAdapter, FlutterwaveAdapterConfig } from './adapters/flutterwave.adapter';
export { FlutterwaveV3Adapter, FlutterwaveV3AdapterConfig, SubAccount, PaymentPlan, Chargeback } from './adapters/flutterwave-v3.adapter';
export { PaystackAdapter, PaystackAdapterConfig } from './adapters/paystack.adapter';
export { MonnifyAdapter, MonnifyAdapterConfig } from './adapters/monnify.adapter';
export { OnafriqAdapter, OnafriqAdapterConfig } from './adapters/onafriq.adapter';
export { RemitaAdapter, RemitaAdapterConfig } from './adapters/remita.adapter';
export { QuicktellerAdapter, QuicktellerAdapterConfig } from './adapters/quickteller.adapter';
export { BaseAdapter, BaseAdapterConfig } from './adapters/base.adapter';

// =============================================================================
// SERVICES
// =============================================================================

export { 
  UnifiedPaymentService, 
  UnifiedServiceConfig,
  FlutterwaveConfig,
  PaystackConfig,
  MonnifyConfig,
  OnafriqConfig,
  RemitaConfig,
  QuicktellerConfig
} from './services/unified-service';

export {
  ProviderRouter,
  ProviderFeeStructure
} from './services/provider-router';

export { CapabilityEngine } from './services/capability-engine';
export { HealthMonitor } from './services/health-monitor';
export { LedgerService } from './services/ledger';
export { ProviderWrapper, ProviderRegistry } from './services/provider-wrapper';
export { ProviderSelectionEngine, ScoringWeights, ProviderScore, ProviderHealthData, ProviderFeeData } from './services/provider-selection-engine';
export { TransactionProcessor, TransactionConfig, TransactionContext, TransactionResult, ProcessPaymentRequest, ProcessTransferRequest, ProcessBillPaymentRequest } from './services/transaction-processor';
export { SettlementReconciliationService, SettlementBatch, ReconciliationRecord, ReconciliationReport, ProviderSettlementConfig } from './services/settlement-reconciliation';
export { InternationalTransferService, InternationalTransferRequest, InternationalTransferResult, CrossBorderCorridor, FXRate } from './services/international-transfer';
export { VirtualCardService, VirtualCard, CardTransaction, VirtualCardRequest, CardScheme, CardType, CardStatus } from './services/virtual-card';
export { MarkupConfigService, MarkupRule, FeeBreakdown, MarkupAnalytics } from './admin/dashboard/markup-config';
export { MultiCurrencyService, CurrencyInfo, CountryCurrencyConfig, FundingMethod, WalletBalance } from './services/multi-currency';
export { CountryAccountsService, CountryUserAccount, CreateUserAccountRequest } from './services/country-accounts';
export { TurboPayRoutes, Route } from './api/routes';
export { createTurboPay, TurboPayConfig, TurboPayInstance } from './main';
export { BulkPaymentService, BulkPaymentConfig, BulkPaymentCSVRow } from './services/bulk-payment';
export { CustomerAuthService, KYCTier } from './auth/customer-auth.service';
export { HealthDashboard, ProviderHealthStatus as HealthDashboardStatus, CircuitBreakerStatus, WebhookHealthStatus } from './admin/dashboard/health-dashboard';
export { AdminAuthService, AdminUser } from './admin/auth/auth.service';
export { AnalyticsDashboard, TransactionRecord, ProviderAnalytics as AnalyticsProviderAnalytics, CostComparison, SettlementAnalytics } from './admin/dashboard/analytics-dashboard';
export { AuditLogService, AuditEventType, AuditLogEntry, AuditLogFilter } from './admin/dashboard/audit-log';
export {
  ProviderManagementService,
  ProviderCredential,
  ProviderConfig,
  ProviderStatus,
  ProviderAnalytics,
  DailyVolume,
  RevenueBreakdown,
  SettlementSummary,
  ProviderService,
  ServiceBiller,
  ServiceBillerItem,
  ServiceBank,
  AdminDashboardSummary
} from './admin/dashboard/provider-management';

export {
  WebhookHandler,
  WebhookHandlerConfig,
  WebhookEventType,
  WebhookEventHandler,
  WebhookProcessingResult,
  HandlerResult,
  createWebhookMiddleware,
  createWebhookRoute
} from './services/webhook-handler';

// =============================================================================
// UTILITIES
// =============================================================================

export {
  // Encryption
  encryptAES256GCM,
  generateNonce,

  // Hashing
  md5Hash,
  sha256Hash,
  sha512Hash,

  // HMAC
  hmacSHA256,
  hmacSHA512,
  hmacMD5,

  // Signature validation
  validateFlutterwaveSignature,
  validatePaystackSignature,
  validateMonnifySignature,
  validateOnafriqSignature,
  validateRemitaSignature,
  validateQuicktellerSignature,

  // Remita specific
  generateRemitaHash,
  generateRemitaHMAC,

  // Quickteller specific
  generateQuicktellerAuthHash,

  // Utilities
  generateReference,
  generateUUID,
  maskAccountNumber,
  maskCardNumber,
  validateBVN,
  validateNIN,
  validateEmail,
  validatePhoneNumber,
  formatAmount,
  toMinorUnits,
  fromMinorUnits
} from './utils/crypto';

export { HttpClient, HttpApiError, HttpClientConfig } from './utils/http-client';

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

import { UnifiedPaymentService } from './services/unified-service';
export default UnifiedPaymentService;
