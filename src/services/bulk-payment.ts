// TurboPay Bulk Payment Pipeline
// CSV Upload → Parser → Schema Validation → Duplicate Detection → Risk Check →
// Balance Check → Queue → Provider Routing → Execution → Webhook → Settlement → Report

import {
  ProviderName,
  BulkPaymentFile,
  BulkPaymentItem,
  BulkPaymentStatus,
  BulkPaymentItemStatus,
  BulkPaymentValidationResult,
  BulkPaymentValidationError,
  BulkPaymentValidationWarning,
  BulkPaymentReport,
  UnifiedTransferRequest,
  UnifiedBulkTransferResponse,
  RecipientInfo,
  Wallet,
  LedgerEntry
} from '../types';
import { ProviderRouter } from './provider-router';
import { LedgerService } from './ledger';

// =============================================================================
// CONFIG
// =============================================================================

export interface BulkPaymentConfig {
  max_items_per_batch: number;
  max_amount_per_item: number;
  max_total_amount: number;
  risk_threshold: number;
  require_balance_check: boolean;
  auto_retry_failed: boolean;
  max_retries: number;
}

const DEFAULT_CONFIG: BulkPaymentConfig = {
  max_items_per_batch: 1000,
  max_amount_per_item: 5000000, // 50M
  max_total_amount: 500000000, // 500M
  risk_threshold: 0.7,
  require_balance_check: true,
  auto_retry_failed: true,
  max_retries: 3
};

// =============================================================================
// CSV ROW TYPE
// =============================================================================

export interface BulkPaymentCSVRow {
  row_number: number;
  recipient_name: string;
  recipient_account: string;
  bank_code: string;
  amount: number | string;
  currency?: string;
  narration?: string;
  email?: string;
  phone?: string;
}

// =============================================================================
// BULK PAYMENT SERVICE
// =============================================================================

export class BulkPaymentService {
  private bulkPayments: Map<string, BulkPaymentFile> = new Map();
  private bulkItems: Map<string, BulkPaymentItem[]> = new Map();
  private router: ProviderRouter;
  private ledger: LedgerService;
  private config: BulkPaymentConfig;

  constructor(
    router: ProviderRouter,
    ledger: LedgerService,
    config: Partial<BulkPaymentConfig> = {}
  ) {
    this.router = router;
    this.ledger = ledger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // STEP 1: CSV UPLOAD & PARSING
  // ===========================================================================

  parseCSV(csvContent: string): BulkPaymentCSVRow[] {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const rows: BulkPaymentCSVRow[] = [];

    // Map header names to our fields
    const headerMap = this.mapHeaders(headers);

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

      const row: BulkPaymentCSVRow = {
        row_number: i + 1,
        recipient_name: this.getField(values, headerMap, 'recipient_name') ||
                        this.getField(values, headerMap, 'name') || '',
        recipient_account: this.getField(values, headerMap, 'recipient_account') ||
                           this.getField(values, headerMap, 'account_number') ||
                           this.getField(values, headerMap, 'account') || '',
        bank_code: this.getField(values, headerMap, 'bank_code') ||
                   this.getField(values, headerMap, 'bank') || '',
        amount: this.getField(values, headerMap, 'amount') || '0',
        currency: this.getField(values, headerMap, 'currency'),
        narration: this.getField(values, headerMap, 'narration') ||
                   this.getField(values, headerMap, 'description'),
        email: this.getField(values, headerMap, 'email'),
        phone: this.getField(values, headerMap, 'phone')
      };

      // Parse amount to number
      const amountStr = String(row.amount).replace(/[,\s]/g, '');
      row.amount = parseFloat(amountStr) || 0;

      rows.push(row);
    }

    return rows;
  }

  // ===========================================================================
  // STEP 2: SCHEMA VALIDATION
  // ===========================================================================

  validate(rows: BulkPaymentCSVRow[], currency: string = 'NGN'): BulkPaymentValidationResult {
    const errors: BulkPaymentValidationError[] = [];
    const warnings: BulkPaymentValidationWarning[] = [];
    const duplicateIndices: number[] = [];
    let riskScore = 0;

    // Track accounts for duplicate detection
    const accountTracker = new Map<string, number[]>();

    for (const row of rows) {
      // Required field validation
      if (!row.recipient_name || row.recipient_name.trim() === '') {
        errors.push({
          row: row.row_number,
          field: 'recipient_name',
          message: 'Recipient name is required'
        });
      }

      if (!row.recipient_account || row.recipient_account.trim() === '') {
        errors.push({
          row: row.row_number,
          field: 'recipient_account',
          message: 'Recipient account number is required'
        });
      } else if (!/^\d{10}$/.test(row.recipient_account.trim())) {
        errors.push({
          row: row.row_number,
          field: 'recipient_account',
          message: 'Account number must be 10 digits'
        });
      }

      if (!row.bank_code || row.bank_code.trim() === '') {
        errors.push({
          row: row.row_number,
          field: 'bank_code',
          message: 'Bank code is required'
        });
      }

      // Amount validation
      const amount = typeof row.amount === 'string' ? parseFloat(String(row.amount).replace(/[,\s]/g, '')) : row.amount;
      if (isNaN(amount) || amount <= 0) {
        errors.push({
          row: row.row_number,
          field: 'amount',
          message: 'Amount must be a positive number'
        });
      } else if (amount > this.config.max_amount_per_item) {
        errors.push({
          row: row.row_number,
          field: 'amount',
          message: `Amount exceeds maximum of ${this.config.max_amount_per_item}`
        });
      }

      // Duplicate detection
      const accountKey = `${row.recipient_account.trim()}_${row.bank_code.trim()}`;
      if (!accountTracker.has(accountKey)) {
        accountTracker.set(accountKey, []);
      }
      accountTracker.get(accountKey)!.push(row.row_number);

      // Risk warnings
      if (amount > 1000000) {
        warnings.push({
          row: row.row_number,
          field: 'amount',
          message: `High amount: ${amount}. May require additional verification.`
        });
        riskScore += 0.1;
      }

      if (!row.email && !row.phone) {
        warnings.push({
          row: row.row_number,
          field: 'contact',
          message: 'No contact information provided'
        });
      }
    }

    // Mark duplicates
    for (const [key, indices] of accountTracker) {
      if (indices.length > 1) {
        // Keep first occurrence, mark rest as duplicates
        for (let i = 1; i < indices.length; i++) {
          duplicateIndices.push(indices[i]);
          warnings.push({
            row: indices[i],
            field: 'duplicate',
            message: `Duplicate account ${key} found at row ${indices[0]}`
          });
          riskScore += 0.05;
        }
      }
    }

    // Total amount check
    const totalAmount = rows.reduce((sum, r) => {
      const amt = typeof r.amount === 'string' ? parseFloat(String(r.amount).replace(/[,\s]/g, '')) : r.amount;
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

    if (totalAmount > this.config.max_total_amount) {
      errors.push({
        row: 0,
        field: 'total_amount',
        message: `Total amount ${totalAmount} exceeds maximum ${this.config.max_total_amount}`
      });
    }

    // Batch size check
    if (rows.length > this.config.max_items_per_batch) {
      errors.push({
        row: 0,
        field: 'batch_size',
        message: `Batch size ${rows.length} exceeds maximum ${this.config.max_items_per_batch}`
      });
    }

    riskScore = Math.min(riskScore, 1);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      duplicate_indices: duplicateIndices,
      risk_score: riskScore
    };
  }

  // ===========================================================================
  // STEP 3: CREATE BULK PAYMENT
  // ===========================================================================

  createBulkPayment(
    filename: string,
    originalFilename: string,
    mimeType: string,
    size: number,
    uploadedBy: string,
    rows: BulkPaymentCSVRow[],
    currency: string = 'NGN'
  ): BulkPaymentFile {
    const totalAmount = rows.reduce((sum, r) => {
      const amt = typeof r.amount === 'string' ? parseFloat(String(r.amount).replace(/[,\s]/g, '')) : r.amount;
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

    const bulkPayment: BulkPaymentFile = {
      id: this.generateId('bulk'),
      filename,
      original_filename: originalFilename,
      mime_type: mimeType,
      size,
      uploaded_by: uploadedBy,
      status: 'uploaded',
      total_count: rows.length,
      successful_count: 0,
      failed_count: 0,
      skipped_count: 0,
      total_amount: totalAmount,
      currency,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.bulkPayments.set(bulkPayment.id, bulkPayment);

    // Create items
    const items: BulkPaymentItem[] = rows.map((row, index) => ({
      id: this.generateId('item'),
      bulk_payment_id: bulkPayment.id,
      row_number: row.row_number,
      recipient_name: row.recipient_name,
      recipient_account: row.recipient_account,
      bank_code: row.bank_code,
      amount: typeof row.amount === 'string' ? parseFloat(String(row.amount).replace(/[,\s]/g, '')) : row.amount,
      currency: row.currency || currency,
      narration: row.narration,
      status: 'pending' as BulkPaymentItemStatus,
      created_at: new Date()
    }));

    this.bulkItems.set(bulkPayment.id, items);

    return bulkPayment;
  }

  // ===========================================================================
  // STEP 4: PROCESS BULK PAYMENT
  // ===========================================================================

  async processBulkPayment(
    bulkPaymentId: string,
    walletId?: string
  ): Promise<BulkPaymentReport> {
    const bulkPayment = this.bulkPayments.get(bulkPaymentId);
    if (!bulkPayment) throw new Error(`Bulk payment ${bulkPaymentId} not found`);

    const items = this.bulkItems.get(bulkPaymentId) || [];
    if (items.length === 0) throw new Error('No items to process');

    // Update status
    bulkPayment.status = 'processing';
    bulkPayment.processing_started_at = new Date();
    bulkPayment.updated_at = new Date();

    // Step 4a: Balance check
    if (walletId && this.config.require_balance_check) {
      const balance = this.ledger.getWalletBalance(walletId);
      if (!balance) throw new Error(`Wallet ${walletId} not found`);
      if (balance.available < bulkPayment.total_amount) {
        bulkPayment.status = 'failed';
        bulkPayment.updated_at = new Date();
        throw new Error(`Insufficient balance: available ${balance.available}, required ${bulkPayment.total_amount}`);
      }

      // Hold funds
      this.ledger.hold(
        walletId,
        bulkPayment.total_amount,
        bulkPayment.currency,
        `bulk_${bulkPaymentId}`,
        'Bulk payment hold'
      );
    }

    // Step 4b: Process each item
    const pendingItems = items.filter(i => i.status === 'pending');
    const batchSize = 10; // Process 10 at a time

    for (let i = 0; i < pendingItems.length; i += batchSize) {
      const batch = pendingItems.slice(i, i + batchSize);
      await this.processBatch(batch, bulkPayment.currency);
    }

    // Step 4c: Calculate results
    bulkPayment.successful_count = items.filter(i => i.status === 'success').length;
    bulkPayment.failed_count = items.filter(i => i.status === 'failed').length;
    bulkPayment.skipped_count = items.filter(i => i.status === 'skipped').length;
    bulkPayment.processing_completed_at = new Date();
    bulkPayment.updated_at = new Date();

    if (bulkPayment.failed_count === 0) {
      bulkPayment.status = 'completed';
    } else if (bulkPayment.successful_count === 0) {
      bulkPayment.status = 'failed';
      // Release held funds
      if (walletId) {
        this.ledger.release(
          walletId,
          bulkPayment.total_amount,
          bulkPayment.currency,
          `bulk_${bulkPaymentId}_release`,
          'Bulk payment failed - releasing hold'
        );
      }
    } else {
      bulkPayment.status = 'partially_completed';
      // Release unprocessed amount
      if (walletId) {
        const processedAmount = items
          .filter(i => i.status === 'success')
          .reduce((sum, i) => sum + i.amount, 0);
        const holdRelease = bulkPayment.total_amount - processedAmount;
        if (holdRelease > 0) {
          this.ledger.release(
            walletId,
            holdRelease,
            bulkPayment.currency,
            `bulk_${bulkPaymentId}_release_partial`,
            'Bulk payment partial - releasing unprocessed hold'
          );
        }
      }
    }

    return this.generateReport(bulkPaymentId);
  }

  // ===========================================================================
  // STEP 5: GENERATE REPORT
  // ===========================================================================

  generateReport(bulkPaymentId: string): BulkPaymentReport {
    const bulkPayment = this.bulkPayments.get(bulkPaymentId);
    if (!bulkPayment) throw new Error(`Bulk payment ${bulkPaymentId} not found`);

    const items = this.bulkItems.get(bulkPaymentId) || [];

    const processedAmount = items
      .filter(i => i.status === 'success')
      .reduce((sum, i) => sum + i.amount, 0);

    const failedAmount = items
      .filter(i => i.status === 'failed')
      .reduce((sum, i) => sum + i.amount, 0);

    return {
      bulk_payment_id: bulkPaymentId,
      status: bulkPayment.status,
      total_count: bulkPayment.total_count,
      successful_count: bulkPayment.successful_count,
      failed_count: bulkPayment.failed_count,
      skipped_count: bulkPayment.skipped_count,
      total_amount: bulkPayment.total_amount,
      processed_amount: processedAmount,
      failed_amount: failedAmount,
      currency: bulkPayment.currency,
      items,
      generated_at: new Date()
    };
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  getBulkPayment(id: string): BulkPaymentFile | undefined {
    return this.bulkPayments.get(id);
  }

  getBulkPaymentItems(id: string): BulkPaymentItem[] {
    return this.bulkItems.get(id) || [];
  }

  getBulkPaymentsByUser(userId: string): BulkPaymentFile[] {
    return Array.from(this.bulkPayments.values()).filter(b => b.uploaded_by === userId);
  }

  // ===========================================================================
  // PRIVATE: BATCH PROCESSING
  // ===========================================================================

  private async processBatch(
    items: BulkPaymentItem[],
    defaultCurrency: string
  ): Promise<void> {
    // Build transfer requests
    const transfers: { item: BulkPaymentItem; request: UnifiedTransferRequest }[] = [];

    for (const item of items) {
      const recipient: RecipientInfo = {
        type: 'bank',
        bank: {
          code: item.bank_code,
          account_number: item.recipient_account,
          name: item.recipient_name
        }
      };

      transfers.push({
        item,
        request: {
          amount: item.amount,
          currency: item.currency || defaultCurrency,
          reference: item.id,
          narration: item.narration || `Bulk payment - ${item.recipient_name}`,
          recipient
        }
      });
    }

    // Execute with failover
    for (const { item, request } of transfers) {
      try {
        item.status = 'processing';
        item.updated_at = new Date();

        const result = await this.router.executeWithFailover(
          'bulk_payment',
          'NG',
          request.currency,
          async (adapter) => adapter.createTransfer(request),
          request.amount
        );

        item.status = 'success';
        item.provider = result.provider;
        item.provider_reference = result.provider_reference;
        item.processed_at = new Date();
        item.updated_at = new Date();
      } catch (error) {
        item.status = 'failed';
        item.error_message = (error as Error).message;
        item.processed_at = new Date();
        item.updated_at = new Date();
      }
    }
  }

  // ===========================================================================
  // PRIVATE: CSV HELPERS
  // ===========================================================================

  private mapHeaders(headers: string[]): Map<number, string> {
    const map = new Map<number, string>();
    const aliases: Record<string, string[]> = {
      recipient_name: ['recipient_name', 'name', 'beneficiary_name', 'payee_name', 'recipient'],
      recipient_account: ['recipient_account', 'account_number', 'account', 'beneficiary_account', 'payee_account', 'bank_account'],
      bank_code: ['bank_code', 'bank', 'bankcode', 'bank_code_number'],
      amount: ['amount', 'payment_amount', 'transfer_amount', 'value'],
      currency: ['currency', 'curr', 'ccy'],
      narration: ['narration', 'description', 'note', 'memo', 'purpose'],
      email: ['email', 'email_address', 'e_mail'],
      phone: ['phone', 'phone_number', 'mobile', 'contact']
    };

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].toLowerCase().replace(/['"]/g, '').trim();
      for (const [field, aliasList] of Object.entries(aliases)) {
        if (aliasList.includes(header)) {
          map.set(i, field);
          break;
        }
      }
    }

    return map;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  private getField(values: string[], headerMap: Map<number, string>, field: string): string | undefined {
    for (const [index, fieldName] of headerMap) {
      if (fieldName === field && index < values.length) {
        return values[index]?.replace(/^['"]|['"]$/g, '').trim();
      }
    }
    return undefined;
  }

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }
}

export default BulkPaymentService;
