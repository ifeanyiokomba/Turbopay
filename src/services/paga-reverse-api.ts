// TurboPay Paga Reverse-API Handler
// Implements Paga's expected reverse-API surface for notification handling
//
// Paga uses a reverse API model: Paga calls specific endpoints on YOUR server
// that you register at onboarding. This is NOT a standard webhook with signature headers.
//
// Expected endpoints (from Paga documentation):
// - getIntegrationServices: Paga queries available services
// - processPayment: Paga sends payment notifications
// - getTransactionStatus: Paga queries transaction status
//
// Reference: Paga Business REST API documentation

import { ProviderName, UnifiedTransactionResponse } from '../types';
import { PagaAdapter } from '../adapters/paga.adapter';

// =============================================================================
// TYPES
// =============================================================================

export interface PagaIntegrationService {
  serviceId: string;
  serviceName: string;
  serviceType: 'collection' | 'disbursement' | 'bill_payment' | 'airtime' | 'data';
  isEnabled: boolean;
  callbackUrl?: string;
}

export interface PagaPaymentNotification {
  transactionReference: string;
  reference: string;
  amount: number;
  currency: string;
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING';
  payerAccountNumber?: string;
  payerName?: string;
  payeeAccountNumber?: string;
  payeeName?: string;
  serviceId?: string;
  narration?: string;
  fees?: number;
  createdDate?: string;
  metadata?: Record<string, any>;
}

export interface PagaTransactionStatusQuery {
  transactionReference: string;
  reference?: string;
}

export interface PagaReverseAPIResponse {
  responseCode: string;
  responseMessage: string;
  data?: any;
}

// =============================================================================
// PAGA REVERSE-API SERVICE
// =============================================================================

export class PagaReverseAPIService {
  private adapter: PagaAdapter | null = null;
  private paymentHandlers: Map<string, (notification: PagaPaymentNotification) => Promise<void>> = new Map();
  private transactionStore: Map<string, UnifiedTransactionResponse> = new Map();

  constructor(adapter?: PagaAdapter) {
    if (adapter) {
      this.adapter = adapter;
    }
  }

  setAdapter(adapter: PagaAdapter): void {
    this.adapter = adapter;
  }

  // ===========================================================================
  // REVERSE-API ENDPOINTS
  // ===========================================================================

  /**
   * getIntegrationServices
   * Called by Paga to query available services on TurboPay
   * Returns the list of services TurboPay has registered with Paga
   */
  async getIntegrationServices(): Promise<PagaReverseAPIResponse> {
    const services: PagaIntegrationService[] = [
      {
        serviceId: 'turbopay_collection',
        serviceName: 'TurboPay Wallet Collection',
        serviceType: 'collection',
        isEnabled: true,
        callbackUrl: '/api/v1/paga/callback/payment'
      },
      {
        serviceId: 'turbopay_disbursement',
        serviceName: 'TurboPay Wallet Disbursement',
        serviceType: 'disbursement',
        isEnabled: true,
        callbackUrl: '/api/v1/paga/callback/disbursement'
      },
      {
        serviceId: 'turbopay_airtime',
        serviceName: 'TurboPay Airtime Purchase',
        serviceType: 'airtime',
        isEnabled: true,
        callbackUrl: '/api/v1/paga/callback/airtime'
      },
      {
        serviceId: 'turbopay_data',
        serviceName: 'TurboPay Data Purchase',
        serviceType: 'data',
        isEnabled: true,
        callbackUrl: '/api/v1/paga/callback/data'
      },
      {
        serviceId: 'turbopay_bills',
        serviceName: 'TurboPay Bill Payment',
        serviceType: 'bill_payment',
        isEnabled: true,
        callbackUrl: '/api/v1/paga/callback/bills'
      }
    ];

    return {
      responseCode: '0',
      responseMessage: 'Success',
      data: { services }
    };
  }

  /**
   * processPayment
   * Called by Paga when a payment is made to TurboPay
   * This is the main callback endpoint for collections
   */
  async processPayment(notification: PagaPaymentNotification): Promise<PagaReverseAPIResponse> {
    try {
      // Validate the notification has required fields
      if (!notification.transactionReference && !notification.reference) {
        return {
          responseCode: '1',
          responseMessage: 'Missing transaction reference'
        };
      }

      const reference = notification.transactionReference || notification.reference;

      // Check if we already processed this transaction (idempotency)
      if (this.transactionStore.has(reference)) {
        return {
          responseCode: '0',
          responseMessage: 'Transaction already processed',
          data: { status: 'already_processed' }
        };
      }

      // Map the Paga notification to our unified transaction response
      const transaction: UnifiedTransactionResponse = {
        id: reference,
        reference: notification.reference || reference,
        status: this.mapPagaStatus(notification.status),
        amount: notification.amount,
        currency: notification.currency || 'NGN',
        provider: 'paga',
        provider_reference: notification.transactionReference,
        fees: notification.fees || 0,
        created_at: notification.createdDate
          ? new Date(notification.createdDate)
          : new Date(),
        updated_at: new Date(),
        metadata: {
          payer_account: notification.payerAccountNumber,
          payer_name: notification.payerName,
          payee_account: notification.payeeAccountNumber,
          payee_name: notification.payeeName,
          service_id: notification.serviceId,
          narration: notification.narration,
          ...notification.metadata
        }
      };

      // Store the transaction
      this.transactionStore.set(reference, transaction);

      // Notify any registered handlers
      for (const handler of this.paymentHandlers.values()) {
        try {
          await handler(notification);
        } catch (handlerError) {
          console.error(`[PagaReverseAPI] Handler error for ${reference}:`, handlerError);
        }
      }

      console.log(`[PagaReverseAPI] Payment processed: ${reference} — ${notification.status}`);

      return {
        responseCode: '0',
        responseMessage: 'Payment processed successfully',
        data: {
          transactionReference: reference,
          status: transaction.status
        }
      };
    } catch (error) {
      console.error('[PagaReverseAPI] processPayment error:', error);
      return {
        responseCode: '1',
        responseMessage: `Processing error: ${(error as Error).message}`
      };
    }
  }

  /**
   * processDisbursement
   * Called by Paga when a disbursement (payout) status changes
   */
  async processDisbursement(notification: PagaPaymentNotification): Promise<PagaReverseAPIResponse> {
    try {
      const reference = notification.transactionReference || notification.reference;

      if (!reference) {
        return {
          responseCode: '1',
          responseMessage: 'Missing transaction reference'
        };
      }

      // Update existing transaction or create new one
      const existing = this.transactionStore.get(reference);
      if (existing) {
        existing.status = this.mapPagaStatus(notification.status);
        existing.updated_at = new Date();
        if (notification.fees) existing.fees = notification.fees;
      } else {
        const transaction: UnifiedTransactionResponse = {
          id: reference,
          reference: notification.reference || reference,
          status: this.mapPagaStatus(notification.status),
          amount: notification.amount,
          currency: notification.currency || 'NGN',
          provider: 'paga',
          provider_reference: notification.transactionReference,
          fees: notification.fees || 0,
          created_at: new Date(),
          updated_at: new Date(),
          metadata: {
            type: 'disbursement',
            payee_account: notification.payeeAccountNumber,
            payee_name: notification.payeeName,
            narration: notification.narration
          }
        };
        this.transactionStore.set(reference, transaction);
      }

      console.log(`[PagaReverseAPI] Disbursement processed: ${reference} — ${notification.status}`);

      return {
        responseCode: '0',
        responseMessage: 'Disbursement processed successfully',
        data: {
          transactionReference: reference,
          status: this.mapPagaStatus(notification.status)
        }
      };
    } catch (error) {
      console.error('[PagaReverseAPI] processDisbursement error:', error);
      return {
        responseCode: '1',
        responseMessage: `Processing error: ${(error as Error).message}`
      };
    }
  }

  /**
   * getTransactionStatus
   * Called by Paga to query the status of a transaction
   */
  getTransactionStatus(query: PagaTransactionStatusQuery): PagaReverseAPIResponse {
    const reference = query.transactionReference;
    const transaction = this.transactionStore.get(reference);

    if (!transaction) {
      return {
        responseCode: '1',
        responseMessage: 'Transaction not found'
      };
    }

    return {
      responseCode: '0',
      responseMessage: 'Success',
      data: {
        transactionReference: reference,
        reference: transaction.reference,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        fees: transaction.fees,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at
      }
    };
  }

  /**
   * healthCheck
   * Simple health endpoint for Paga to verify TurboPay is reachable
   */
  healthCheck(): PagaReverseAPIResponse {
    return {
      responseCode: '0',
      responseMessage: 'TurboPay Paga integration is healthy',
      data: {
        service: 'TurboPay',
        provider: 'paga',
        timestamp: new Date().toISOString(),
        adapter_configured: !!this.adapter
      }
    };
  }

  // ===========================================================================
  // HANDLER REGISTRATION
  // ===========================================================================

  /**
   * Register a handler for payment notifications
   * Multiple handlers can be registered — they all fire on each notification
   */
  registerPaymentHandler(
    id: string,
    handler: (notification: PagaPaymentNotification) => Promise<void>
  ): void {
    this.paymentHandlers.set(id, handler);
  }

  unregisterPaymentHandler(id: string): void {
    this.paymentHandlers.delete(id);
  }

  // ===========================================================================
  // TRANSACTION LOOKUP
  // ===========================================================================

  getTransaction(reference: string): UnifiedTransactionResponse | undefined {
    return this.transactionStore.get(reference);
  }

  getAllTransactions(): UnifiedTransactionResponse[] {
    return Array.from(this.transactionStore.values());
  }

  getTransactionsByStatus(status: string): UnifiedTransactionResponse[] {
    return Array.from(this.transactionStore.values())
      .filter(t => t.status === status);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private mapPagaStatus(pagaStatus: string): 'pending' | 'processing' | 'success' | 'failed' | 'reversed' | 'cancelled' {
    switch (pagaStatus?.toUpperCase()) {
      case 'SUCCESSFUL': return 'success';
      case 'FAILED': return 'failed';
      case 'PENDING': return 'pending';
      case 'PROCESSING': return 'processing';
      case 'REVERSED': return 'reversed';
      case 'CANCELLED': return 'cancelled';
      default: return 'pending';
    }
  }
}

export default PagaReverseAPIService;
