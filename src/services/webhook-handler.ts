// TurboPay Webhook Handler
// Unified webhook handling for all payment providers

import {
  ProviderName,
  ProviderAdapter,
  UnifiedWebhookEvent,
  UnifiedTransactionResponse,
  TransactionStatus
} from '../types';
import { ProviderRouter } from './provider-router';
import { hmacSHA256, validateFlutterwaveSignature, validatePaystackSignature, validateMonnifySignature, validateOnafriqSignature, validateRemitaSignature, validateQuicktellerSignature } from '../utils/crypto';

// =============================================================================
// WEBHOOK HANDLER CONFIG
// =============================================================================

export interface WebhookHandlerConfig {
  enableLogging?: boolean;
  enableSignatureValidation?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

// =============================================================================
// WEBHOOK EVENT TYPES
// =============================================================================

export type WebhookEventType =
  | 'payment.success'
  | 'payment.failed'
  | 'payment.pending'
  | 'transfer.success'
  | 'transfer.failed'
  | 'transfer.reversed'
  | 'virtual_account.success'
  | 'virtual_account.expired'
  | 'refund.success'
  | 'refund.failed'
  | 'chargeback.success'
  | 'settlement.success'
  | 'settlement.pending'
  // Mobile Money specific events
  | 'mobile_money.collection.success'
  | 'mobile_money.collection.failed'
  | 'mobile_money.collection.pending'
  | 'mobile_money.disbursement.success'
  | 'mobile_money.disbursement.failed'
  | 'mobile_money.disbursement.pending'
  | 'mobile_money.airtime.success'
  | 'mobile_money.airtime.failed'
  | 'mobile_money.data.success'
  | 'mobile_money.data.failed'
  | 'mobile_money.bill_payment.success'
  | 'mobile_money.bill_payment.failed'
  | 'unknown';

// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

export class WebhookHandler {
  private router: ProviderRouter;
  private config: WebhookHandlerConfig;
  private eventHandlers: Map<WebhookEventType, WebhookEventHandler[]> = new Map();
  private processedEvents: Set<string> = new Set();

  constructor(router: ProviderRouter, config: WebhookHandlerConfig = {}) {
    this.router = router;
    this.config = {
      enableLogging: true,
      enableSignatureValidation: true,
      maxRetries: 3,
      retryDelay: 1000,
      ...config
    };
  }

  // ===========================================================================
  // EVENT HANDLER REGISTRATION
  // ===========================================================================

  /**
   * Register handler for specific event type
   */
  on(event: WebhookEventType, handler: WebhookEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
    if (this.config.enableLogging) {
      console.log(`[WebhookHandler] Registered handler for: ${event}`);
    }
  }

  /**
   * Register handler for multiple event types
   */
  onMany(events: WebhookEventType[], handler: WebhookEventHandler): void {
    events.forEach(event => this.on(event, handler));
  }

  /**
   * Register catch-all handler
   */
  onAny(handler: WebhookEventHandler): void {
    this.on('payment.success', handler);
    this.on('payment.failed', handler);
    this.on('transfer.success', handler);
    this.on('transfer.failed', handler);
    this.on('virtual_account.success', handler);
    this.on('refund.success', handler);
  }

  // ===========================================================================
  // WEBHOOK PROCESSING
  // ===========================================================================

  /**
   * Process incoming webhook from Express/Next.js/etc.
   */
  async handleWebhook(
    provider: ProviderName,
    payload: any,
    headers: Record<string, string> = {}
  ): Promise<WebhookProcessingResult> {
    const startTime = Date.now();

    try {
      // 1. Validate signature if enabled
      if (this.config.enableSignatureValidation) {
        const signature = this.extractSignature(provider, headers, payload);
        if (!this.validateSignature(provider, payload, signature)) {
          this.log(`[WebhookHandler] Invalid signature for ${provider}`, 'error');
          return {
            success: false,
            error: 'Invalid signature',
            provider
          };
        }
      }

      // 2. Parse and normalize event
      const event = this.parseEvent(provider, payload);
      if (!event) {
        this.log(`[WebhookHandler] Failed to parse event for ${provider}`, 'error');
        return {
          success: false,
          error: 'Failed to parse event',
          provider
        };
      }

      // 3. Check for duplicate event
      const eventKey = this.generateEventKey(event);
      if (this.processedEvents.has(eventKey)) {
        this.log(`[WebhookHandler] Duplicate event ignored: ${eventKey}`, 'warn');
        return {
          success: true,
          event: event.event as WebhookEventType,
          duplicate: true,
          provider
        };
      }

      // 4. Mark as processed
      this.processedEvents.add(eventKey);

      // 5. Log event
      if (this.config.enableLogging) {
        console.log(`[WebhookHandler] Processing ${event.event} from ${provider}`, {
          reference: event.data.reference,
          status: event.data.status,
          amount: event.data.amount,
          currency: event.data.currency
        });
      }

      // 6. Execute handlers
      const handlers = this.eventHandlers.get(event.event as WebhookEventType) || [];
      const results: HandlerResult[] = [];

      for (const handler of handlers) {
        try {
          const result = await handler(event);
          results.push({ success: true, handler: handler.name || 'anonymous', result });
        } catch (error: any) {
          results.push({
            success: false,
            handler: handler.name || 'anonymous',
            error: error.message
          });
          this.log(`[WebhookHandler] Handler failed: ${error.message}`, 'error');
        }
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        event: event.event as WebhookEventType,
        data: event.data,
        results,
        processingTime,
        provider
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.log(`[WebhookHandler] Processing failed: ${error.message}`, 'error');

      return {
        success: false,
        error: error.message,
        processingTime,
        provider
      };
    }
  }

  /**
   * Process webhook with retry logic
   */
  async handleWebhookWithRetry(
    provider: ProviderName,
    payload: any,
    headers: Record<string, string> = {},
    retries: number = this.config.maxRetries!
  ): Promise<WebhookProcessingResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await this.handleWebhook(provider, payload, headers);

      if (result.success || result.duplicate) {
        return result;
      }

      lastError = result.error;

      if (attempt < retries) {
        this.log(`[WebhookHandler] Retry ${attempt + 1}/${retries} for ${provider}`, 'warn');
        await this.delay(this.config.retryDelay! * Math.pow(2, attempt));
      }
    }

    return {
      success: false,
      error: `Failed after ${retries} retries: ${lastError}`,
      provider
    };
  }

  // ===========================================================================
  // SIGNATURE VALIDATION
  // ===========================================================================

  /**
   * Extract signature from headers based on provider
   */
  private extractSignature(
    provider: ProviderName,
    headers: Record<string, string>,
    payload: any
  ): string {
    const headerMap: Record<ProviderName, string> = {
      flutterwave: 'x-flutterwave-signature',
      paystack: 'x-paystack-signature',
      monnify: 'x-monnify-signature',
      onafriq: 'x-onafriq-signature',
      remita: 'x-remita-signature',
      quickteller: 'x-quickteller-signature',
      // Mobile Money Providers
      smartcash: 'x-smartcash-signature',
      airtel_money: 'x-airtel-signature',
      mtn_momo: 'x-mtn-signature',
      mpesa: 'x-mpesa-signature',
      paga: 'x-paga-signature'
    };

    const headerName = headerMap[provider];
    return headers[headerName] || headers[headerName.toLowerCase()] || '';
  }

  /**
   * Validate webhook signature based on provider
   */
  validateSignature(provider: ProviderName, payload: any, signature: string): boolean {
    if (!signature) return false;

    const adapter = this.router.getProvider(provider);
    if (!adapter) return false;

    return adapter.validateWebhook(payload, signature);
  }

  // ===========================================================================
  // EVENT PARSING
  // ===========================================================================

  /**
   * Parse webhook event from provider
   */
  private parseEvent(provider: ProviderName, payload: any): UnifiedWebhookEvent | null {
    const adapter = this.router.getProvider(provider);
    if (!adapter) return null;

    return adapter.parseWebhookEvent(payload);
  }

  // ===========================================================================
  // EVENT KEY GENERATION
  // ===========================================================================

  /**
   * Generate unique event key for deduplication
   */
  private generateEventKey(event: UnifiedWebhookEvent): string {
    return `${event.provider}:${event.data.reference}:${event.event}:${event.data.status}`;
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Clear processed events cache
   */
  clearProcessedEvents(): void {
    this.processedEvents.clear();
    this.log('[WebhookHandler] Cleared processed events cache');
  }

  /**
   * Get processed events count
   */
  getProcessedEventsCount(): number {
    return this.processedEvents.size;
  }

  /**
   * Check if a provider is a mobile money provider
   */
  isMobileMoneyProvider(provider: ProviderName): boolean {
    const mobileMoneyProviders: ProviderName[] = ['smartcash', 'airtel_money', 'mtn_momo', 'mpesa', 'paga'];
    return mobileMoneyProviders.includes(provider);
  }

  /**
   * Map a provider event to a mobile money event type
   */
  mapToMobileMoneyEvent(provider: ProviderName, originalEvent: string, status: string): WebhookEventType {
    if (status === 'success' || status === 'successful' || status === 'completed') {
      if (originalEvent.includes('collection') || originalEvent.includes('payment')) {
        return 'mobile_money.collection.success';
      }
      if (originalEvent.includes('disbursement') || originalEvent.includes('transfer')) {
        return 'mobile_money.disbursement.success';
      }
      if (originalEvent.includes('airtime')) {
        return 'mobile_money.airtime.success';
      }
      if (originalEvent.includes('data')) {
        return 'mobile_money.data.success';
      }
      if (originalEvent.includes('bill')) {
        return 'mobile_money.bill_payment.success';
      }
      return 'payment.success';
    }
    if (status === 'failed' || status === 'error' || status === 'rejected') {
      if (originalEvent.includes('collection') || originalEvent.includes('payment')) {
        return 'mobile_money.collection.failed';
      }
      if (originalEvent.includes('disbursement') || originalEvent.includes('transfer')) {
        return 'mobile_money.disbursement.failed';
      }
      return 'payment.failed';
    }
    if (status === 'pending' || status === 'processing') {
      return 'mobile_money.collection.pending';
    }
    return 'unknown';
  }

  /**
   * Log message
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;

    switch (level) {
      case 'error':
        console.error(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// TYPES
// =============================================================================

export type WebhookEventHandler = (event: UnifiedWebhookEvent) => Promise<any> | any;

export interface WebhookProcessingResult {
  success: boolean;
  event?: WebhookEventType;
  data?: UnifiedTransactionResponse;
  results?: HandlerResult[];
  error?: string;
  duplicate?: boolean;
  processingTime?: number;
  provider: ProviderName;
}

export interface HandlerResult {
  success: boolean;
  handler: string;
  result?: any;
  error?: string;
}

// =============================================================================
// EXPRESS.JS INTEGRATION EXAMPLE
// =============================================================================

/**
 * Express.js middleware for handling webhooks
 * 
 * Usage:
 * 
 * import { createWebhookMiddleware } from '@turbopay/payment-sdk';
 * 
 * const webhookHandler = new WebhookHandler(router);
 * webhookHandler.on('payment.success', async (event) => {
 *   await updateOrderStatus(event.data.reference, 'paid');
 *   await sendConfirmationEmail(event.data.customer);
 * });
 * 
 * app.post('/webhooks/flutterwave', createWebhookMiddleware(webhookHandler, 'flutterwave'));
 * app.post('/webhooks/paystack', createWebhookMiddleware(webhookHandler, 'paystack'));
 */
export function createWebhookMiddleware(
  handler: WebhookHandler,
  provider: ProviderName
) {
  return async (req: any, res: any) => {
    try {
      // Extract headers
      const headers: Record<string, string> = {};
      Object.keys(req.headers).forEach(key => {
        headers[key] = req.headers[key];
      });

      // Process webhook
      const result = await handler.handleWebhookWithRetry(provider, req.body, headers);

      if (result.success) {
        res.status(200).json({ received: true, event: result.event });
      } else if (result.duplicate) {
        res.status(200).json({ received: true, duplicate: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error(`[WebhookMiddleware] Error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// =============================================================================
// NEXT.JS INTEGRATION EXAMPLE
// =============================================================================

/**
 * Next.js API route handler for webhooks
 * 
 * Usage:
 * 
 * // app/api/webhooks/flutterwave/route.ts
 * import { createWebhookRoute } from '@turbopay/payment-sdk';
 * 
 * const webhookHandler = new WebhookHandler(router);
 * webhookHandler.on('payment.success', async (event) => {
 *   await updateOrderStatus(event.data.reference, 'paid');
 * });
 * 
 * export const POST = createWebhookRoute(webhookHandler, 'flutterwave');
 */
export function createWebhookRoute(
  handler: WebhookHandler,
  provider: ProviderName
) {
  return async (req: Request) => {
    try {
      // Parse body
      const body = await req.json();

      // Extract headers
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Process webhook
      const result = await handler.handleWebhookWithRetry(provider, body, headers);

      if (result.success || result.duplicate) {
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (error: any) {
      console.error(`[WebhookRoute] Error: ${error.message}`);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
}

// =============================================================================
// USAGE EXAMPLE
// =============================================================================

/*
import { UnifiedPaymentService, WebhookHandler, createWebhookMiddleware } from '@turbopay/payment-sdk';
import express from 'express';

// Initialize
const service = new UnifiedPaymentService({ environment: 'sandbox' });
await service.registerFlutterwave({ client_id: '...', client_secret: '...' });
await service.registerPaystack({ secret_key: '...', public_key: '...' });

// Create webhook handler
const webhookHandler = new WebhookHandler(service['router']);

// Register handlers
webhookHandler.on('payment.success', async (event) => {
  console.log('Payment successful:', event.data.reference);
  // Update database
  // Send confirmation email
  // Trigger fulfillment
});

webhookHandler.on('payment.failed', async (event) => {
  console.log('Payment failed:', event.data.reference);
  // Update database
  // Notify customer
});

webhookHandler.on('transfer.success', async (event) => {
  console.log('Transfer successful:', event.data.reference);
  // Update transfer status
  // Notify recipient
});

webhookHandler.onMany(['payment.success', 'transfer.success'], async (event) => {
  // Common handler for all successes
  await auditLog.log(event);
});

// Express routes
const app = express();
app.use(express.json());

app.post('/webhooks/flutterwave', createWebhookMiddleware(webhookHandler, 'flutterwave'));
app.post('/webhooks/paystack', createWebhookMiddleware(webhookHandler, 'paystack'));

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
*/

export default WebhookHandler;
