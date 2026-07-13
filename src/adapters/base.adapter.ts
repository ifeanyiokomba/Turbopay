// TurboPay Base Provider Adapter
// Abstract base class for all provider adapters

import {
  ProviderAdapter,
  ProviderName,
  ProviderCapabilities,
  Environment,
  CustomerInfo,
  CustomerResponse,
  UnifiedPaymentRequest,
  UnifiedTransactionResponse,
  UnifiedTransferRequest,
  UnifiedTransferResponse,
  VirtualAccountRequest,
  VirtualAccountResponse,
  BillPaymentRequest,
  Bank,
  BankAccountResolution,
  Biller,
  BillerItem,
  UnifiedWebhookEvent,
  UnifiedBulkTransferResponse,
  TransactionStatus,
  ExchangeRateResponse,
  ProviderHealthCheckResult,
  SettlementResponse,
  ProviderFeatureUnavailableError
} from '../types';
import { HttpClient, HttpClientConfig } from '../utils/http-client';

// =============================================================================
// BASE ADAPTER CONFIG
// =============================================================================

export interface BaseAdapterConfig {
  environment: Environment;
  timeout?: number;
  retries?: number;
  retry_delay?: number;
}

// =============================================================================
// BASE ADAPTER
// =============================================================================

export abstract class BaseAdapter implements ProviderAdapter {
  abstract readonly name: ProviderName;
  abstract readonly displayName: string;
  abstract readonly baseUrl: string;
  abstract readonly sandboxBaseUrl: string;

  protected config: BaseAdapterConfig;
  protected httpClient: HttpClient;
  protected token: string | null = null;
  protected tokenExpiry: Date | null = null;

  constructor(config: BaseAdapterConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retry_delay: 1000,
      ...config
    };

    this.httpClient = new HttpClient({
      baseUrl: this.getBaseUrl(),
      timeout: this.config.timeout
    });
  }

  /**
   * Get the appropriate base URL based on environment
   */
  protected getBaseUrl(): string {
    return this.config.environment === 'production' 
      ? this.baseUrl 
      : this.sandboxBaseUrl;
  }

  /**
   * Set authentication token
   */
  protected setToken(token: string, expiresIn?: number): void {
    this.token = token;
    this.httpClient.setToken(token, expiresIn);
  }

  /**
   * Check if token is expired
   */
  protected isTokenExpired(): boolean {
    if (!this.tokenExpiry) return true;
    return this.tokenExpiry <= new Date();
  }

  /**
   * Get common headers for requests
   */
  protected getCommonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Map provider status to unified status
   */
  protected mapStatus(providerStatus: string): TransactionStatus {
    const statusMap: Record<string, TransactionStatus> = {
      // Common statuses
      'success': 'success',
      'successful': 'success',
      'succeeded': 'success',
      'completed': 'success',
      'pending': 'pending',
      'processing': 'processing',
      'failed': 'failed',
      'failure': 'failed',
      'error': 'failed',
      'reversed': 'reversed',
      'reversal': 'reversed',
      'cancelled': 'cancelled',
      'canceled': 'cancelled',
      // Provider specific
      'NEW': 'pending',
      'INITIATED': 'pending',
      'PROCESSING': 'processing',
      'SUCCESSFUL': 'success',
      'FAILED': 'failed',
      'CANCELLED': 'cancelled',
      'ACTIVE': 'success',
      'INACTIVE': 'failed'
    };

    return statusMap[providerStatus?.toUpperCase()] || 'pending';
  }

  /**
   * Retry wrapper for HTTP requests
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    retries: number = this.config.retries!
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on client errors (4xx)
        if (error instanceof Error && 'status' in error) {
          const status = (error as any).status;
          if (status >= 400 && status < 500) {
            throw error;
          }
        }

        if (attempt < retries) {
          await this.delay(this.config.retry_delay! * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Delay utility
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate unique reference
   */
  protected generateReference(prefix: string = 'ref'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${timestamp}_${random}`;
  }

  // =============================================================================
  // ABSTRACT METHODS (Must be implemented by providers)
  // =============================================================================

  abstract authenticate(): Promise<void>;
  abstract refreshToken(): Promise<void>;
  abstract getCapabilities(): ProviderCapabilities;

  abstract initializePayment(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse>;
  abstract verifyPayment(reference: string): Promise<UnifiedTransactionResponse>;
  abstract getPaymentStatus(id: string): Promise<UnifiedTransactionResponse>;

  abstract createTransfer(request: UnifiedTransferRequest): Promise<UnifiedTransferResponse>;
  abstract verifyTransfer(reference: string): Promise<UnifiedTransferResponse>;
  abstract getTransferStatus(id: string): Promise<UnifiedTransferResponse>;
  abstract createBulkTransfers(transfers: UnifiedTransferRequest[]): Promise<UnifiedBulkTransferResponse>;

  abstract createVirtualAccount(request: VirtualAccountRequest): Promise<VirtualAccountResponse>;
  abstract getVirtualAccount(id: string): Promise<VirtualAccountResponse>;
  abstract listVirtualAccounts(customer_id?: string): Promise<VirtualAccountResponse[]>;

  abstract createCustomer(customer: CustomerInfo): Promise<CustomerResponse>;
  abstract getCustomer(id: string): Promise<CustomerResponse>;
  abstract updateCustomer(id: string, customer: Partial<CustomerInfo>): Promise<CustomerResponse>;

  abstract listBanks(country?: string): Promise<Bank[]>;
  abstract resolveBank(code: string, account_number: string): Promise<BankAccountResolution>;

  abstract listBillers(): Promise<Biller[]>;
  abstract getBillerItems(biller_id: string): Promise<BillerItem[]>;
  abstract payBill(request: BillPaymentRequest): Promise<UnifiedTransactionResponse>;

  abstract validateWebhook(payload: any, signature: string): boolean;
  abstract parseWebhookEvent(payload: any): UnifiedWebhookEvent;

  // ===========================================================================
  // OPTIONAL METHODS (Default: throw ProviderFeatureUnavailableError)
  // Providers override these if they support the feature
  // ===========================================================================

  async refund(transaction_id: string, amount?: number, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError(this.name, 'refund');
  }

  async reverse(transaction_id: string, reason?: string): Promise<UnifiedTransactionResponse> {
    throw new ProviderFeatureUnavailableError(this.name, 'reversal');
  }

  async exchangeRate(from_currency: string, to_currency: string, amount: number): Promise<ExchangeRateResponse> {
    throw new ProviderFeatureUnavailableError(this.name, 'exchange_rate');
  }

  async healthCheck(): Promise<ProviderHealthCheckResult> {
    const start = Date.now();
    try {
      await this.refreshToken();
      return {
        provider: this.name,
        is_healthy: true,
        latency: Date.now() - start,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        provider: this.name,
        is_healthy: false,
        latency: Date.now() - start,
        timestamp: new Date(),
        error: (error as Error).message
      };
    }
  }

  async settlement(): Promise<SettlementResponse> {
    throw new ProviderFeatureUnavailableError(this.name, 'settlement');
  }

  async merchantCollection(request: UnifiedPaymentRequest): Promise<UnifiedTransactionResponse> {
    return this.initializePayment(request);
  }
}

export default BaseAdapter;
