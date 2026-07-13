// TurboPay Settlement & Reconciliation Service
// Handles provider settlements, transaction reconciliation, and balance management
// Tracks settlement status, pending amounts, and generates reconciliation reports

import {
  ProviderName,
  TransactionStatus,
  SettlementResponse
} from '../types';
import { ProviderRegistry } from './provider-wrapper';
import { LedgerService } from './ledger';
import { AnalyticsDashboard, TransactionRecord } from '../admin/dashboard/analytics-dashboard';
import { AuditLogService } from '../admin/dashboard/audit-log';

// =============================================================================
// TYPES
// =============================================================================

export type SettlementStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'disputed';

export interface SettlementBatch {
  id: string;
  provider: ProviderName;
  status: SettlementStatus;
  total_amount: number;
  total_fee: number;
  net_amount: number;
  currency: string;
  transaction_count: number;
  transaction_ids: string[];
  settlement_date: Date;
  expected_settlement_date: Date;
  actual_settlement_date?: Date;
  bank_account?: string;
  reference?: string;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ReconciliationRecord {
  id: string;
  provider: ProviderName;
  turbopay_reference: string;
  provider_reference: string;
  amount: number;
  fee: number;
  currency: string;
  type: 'collection' | 'payout' | 'refund' | 'fee';
  turbopay_status: TransactionStatus;
  provider_status: TransactionStatus;
  is_reconciled: boolean;
  discrepancy_type?: 'amount_mismatch' | 'status_mismatch' | 'missing_provider' | 'missing_turbopay' | 'fee_mismatch';
  discrepancy_details?: string;
  created_at: Date;
  reconciled_at?: Date;
}

export interface ReconciliationReport {
  id: string;
  period: { start: Date; end: Date };
  provider: ProviderName;
  total_transactions: number;
  reconciled_count: number;
  unreconciled_count: number;
  discrepancy_count: number;
  total_turbopay_amount: number;
  total_provider_amount: number;
  total_turbopay_fees: number;
  total_provider_fees: number;
  amount_discrepancy: number;
  fee_discrepancy: number;
  discrepancies: ReconciliationRecord[];
  generated_at: Date;
}

export interface ProviderSettlementConfig {
  provider: ProviderName;
  settlement_schedule: 'instant' | 'same_day' | 't1' | 't2' | 't3' | 't7';
  settlement_time: string; // HH:mm
  minimum_settlement: number;
  settlement_bank_account: string;
  settlement_currency: string;
  auto_sweep: boolean;
  sweep_threshold: number;
}

// =============================================================================
// SETTLEMENT & RECONCILIATION SERVICE
// =============================================================================

export class SettlementReconciliationService {
  private settlementBatches: Map<string, SettlementBatch> = new Map();
  private reconciliationRecords: Map<string, ReconciliationRecord> = new Map();
  private settlementConfigs: Map<ProviderName, ProviderSettlementConfig> = new Map();
  private registry: ProviderRegistry;
  private ledger: LedgerService;
  private analytics: AnalyticsDashboard;
  private auditLog: AuditLogService;

  constructor(
    registry: ProviderRegistry,
    ledger: LedgerService,
    analytics: AnalyticsDashboard,
    auditLog: AuditLogService
  ) {
    this.registry = registry;
    this.ledger = ledger;
    this.analytics = analytics;
    this.auditLog = auditLog;

    // Initialize default settlement configs
    this.initializeDefaultConfigs();
  }

  // ===========================================================================
  // SETTLEMENT MANAGEMENT
  // ===========================================================================

  async initiateSettlement(params: {
    provider: ProviderName;
    transaction_ids: string[];
    bank_account?: string;
  }): Promise<SettlementBatch> {
    const config = this.settlementConfigs.get(params.provider);
    if (!config) {
      throw new Error(`No settlement config for provider ${params.provider}`);
    }

    // Calculate totals from transactions
    let totalAmount = 0;
    let totalFee = 0;

    for (const txnId of params.transaction_ids) {
      const record = this.analytics['transactions']?.find((t: TransactionRecord) => t.id === txnId);
      if (record && record.status === 'success') {
        totalAmount += record.amount;
        totalFee += record.fee;
      }
    }

    const netAmount = totalAmount - totalFee;

    // Calculate expected settlement date
    const expectedDate = this.calculateSettlementDate(config.settlement_schedule);

    const batch: SettlementBatch = {
      id: this.generateId('settlement'),
      provider: params.provider,
      status: 'pending',
      total_amount: totalAmount,
      total_fee: totalFee,
      net_amount: netAmount,
      currency: config.settlement_currency,
      transaction_count: params.transaction_ids.length,
      transaction_ids: params.transaction_ids,
      settlement_date: new Date(),
      expected_settlement_date: expectedDate,
      bank_account: params.bank_account || config.settlement_bank_account,
      created_at: new Date(),
      updated_at: new Date()
    };

    this.settlementBatches.set(batch.id, batch);

    // Record in ledger
    this.ledger.recordSettlement(
      params.provider,
      totalAmount,
      config.settlement_currency,
      totalFee,
      batch.id,
      params.transaction_ids
    );

    // Audit log
    this.auditLog.log({
      event: 'settlement.created',
      entity_type: 'settlement',
      entity_id: batch.id,
      metadata: {
        provider: params.provider,
        total_amount: totalAmount,
        total_fee: totalFee,
        net_amount: netAmount,
        transaction_count: params.transaction_ids.length
      },
      severity: 'info'
    });

    return batch;
  }

  async completeSettlement(batchId: string): Promise<SettlementBatch> {
    const batch = this.settlementBatches.get(batchId);
    if (!batch) {
      throw new Error(`Settlement batch ${batchId} not found`);
    }

    batch.status = 'completed';
    batch.actual_settlement_date = new Date();
    batch.updated_at = new Date();

    this.settlementBatches.set(batchId, batch);

    // Audit log
    this.auditLog.log({
      event: 'settlement.completed',
      entity_type: 'settlement',
      entity_id: batchId,
      metadata: {
        provider: batch.provider,
        net_amount: batch.net_amount,
        actual_date: batch.actual_settlement_date
      },
      severity: 'info'
    });

    return batch;
  }

  async failSettlement(batchId: string, errorMessage: string): Promise<SettlementBatch> {
    const batch = this.settlementBatches.get(batchId);
    if (!batch) {
      throw new Error(`Settlement batch ${batchId} not found`);
    }

    batch.status = 'failed';
    batch.error_message = errorMessage;
    batch.updated_at = new Date();

    this.settlementBatches.set(batchId, batch);

    // Audit log
    this.auditLog.log({
      event: 'settlement.created',
      entity_type: 'settlement',
      entity_id: batchId,
      metadata: {
        provider: batch.provider,
        error: errorMessage
      },
      severity: 'error'
    });

    return batch;
  }

  getSettlement(batchId: string): SettlementBatch | undefined {
    return this.settlementBatches.get(batchId);
  }

  getProviderSettlements(provider: ProviderName): SettlementBatch[] {
    return Array.from(this.settlementBatches.values())
      .filter(b => b.provider === provider)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  getPendingSettlements(): SettlementBatch[] {
    return Array.from(this.settlementBatches.values())
      .filter(b => b.status === 'pending' || b.status === 'processing')
      .sort((a, b) => a.expected_settlement_date.getTime() - b.expected_settlement_date.getTime());
  }

  // ===========================================================================
  // RECONCILIATION
  // ===========================================================================

  async reconcileTransaction(params: {
    provider: ProviderName;
    turbopay_reference: string;
    provider_reference: string;
    provider_amount: number;
    provider_fee: number;
    provider_status: TransactionStatus;
  }): Promise<ReconciliationRecord> {
    // Find Turbopay transaction
    const turbopayTx = this.analytics['transactions']?.find(
      (t: TransactionRecord) => t.id === params.turbopay_reference || t.id === params.provider_reference
    );

    let turbopayAmount = turbopayTx?.amount || 0;
    let turbopayFee = turbopayTx?.fee || 0;
    let turbopayStatus = turbopayTx?.status || 'pending';

    // Determine if there's a discrepancy
    let isReconciled = true;
    let discrepancyType: ReconciliationRecord['discrepancy_type'] | undefined;
    let discrepancyDetails: string | undefined;

    // Check amount mismatch
    if (Math.abs(turbopayAmount - params.provider_amount) > 0.01) {
      isReconciled = false;
      discrepancyType = 'amount_mismatch';
      discrepancyDetails = `Turbopay: ${turbopayAmount}, Provider: ${params.provider_amount}`;
    }

    // Check status mismatch
    if (turbopayStatus !== params.provider_status) {
      isReconciled = false;
      discrepancyType = discrepancyType || 'status_mismatch';
      discrepancyDetails = (discrepancyDetails ? discrepancyDetails + '; ' : '') +
        `Turbopay status: ${turbopayStatus}, Provider status: ${params.provider_status}`;
    }

    // Check fee mismatch
    if (Math.abs(turbopayFee - params.provider_fee) > 0.01) {
      isReconciled = false;
      discrepancyType = discrepancyType || 'fee_mismatch';
      discrepancyDetails = (discrepancyDetails ? discrepancyDetails + '; ' : '') +
        `Turbopay fee: ${turbopayFee}, Provider fee: ${params.provider_fee}`;
    }

    const record: ReconciliationRecord = {
      id: this.generateId('recon'),
      provider: params.provider,
      turbopay_reference: params.turbopay_reference,
      provider_reference: params.provider_reference,
      amount: turbopayAmount,
      fee: turbopayFee,
      currency: turbopayTx?.currency || 'NGN',
      type: 'collection',
      turbopay_status: turbopayStatus,
      provider_status: params.provider_status,
      is_reconciled: isReconciled,
      discrepancy_type: discrepancyType,
      discrepancy_details: discrepancyDetails,
      created_at: new Date(),
      reconciled_at: isReconciled ? new Date() : undefined
    };

    this.reconciliationRecords.set(record.id, record);

    // Audit log
    if (!isReconciled) {
      this.auditLog.log({
        event: 'transaction.failed',
        entity_type: 'reconciliation',
        entity_id: record.id,
        metadata: {
          provider: params.provider,
          turbopay_reference: params.turbopay_reference,
          provider_reference: params.provider_reference,
          discrepancy_type: discrepancyType,
          discrepancy_details: discrepancyDetails
        },
        severity: 'warning'
      });
    }

    return record;
  }

  async generateReconciliationReport(params: {
    provider: ProviderName;
    start_date: Date;
    end_date: Date;
  }): Promise<ReconciliationReport> {
    const records = Array.from(this.reconciliationRecords.values()).filter(
      r => r.provider === params.provider &&
        r.created_at >= params.start_date &&
        r.created_at <= params.end_date
    );

    const reconciled = records.filter(r => r.is_reconciled);
    const unreconciled = records.filter(r => !r.is_reconciled);

    const totalTurbopayAmount = records.reduce((sum, r) => sum + r.amount, 0);
    const totalProviderAmount = records.reduce((sum, r) => sum + (r.provider_status === 'success' ? r.amount : 0), 0);
    const totalTurbopayFees = records.reduce((sum, r) => sum + r.fee, 0);
    const totalProviderFees = records.reduce((sum, r) => sum + (r.provider_status === 'success' ? r.fee : 0), 0);

    const report: ReconciliationReport = {
      id: this.generateId('report'),
      period: { start: params.start_date, end: params.end_date },
      provider: params.provider,
      total_transactions: records.length,
      reconciled_count: reconciled.length,
      unreconciled_count: unreconciled.length,
      discrepancy_count: unreconciled.length,
      total_turbopay_amount: totalTurbopayAmount,
      total_provider_amount: totalProviderAmount,
      total_turbopay_fees: totalTurbopayFees,
      total_provider_fees: totalProviderFees,
      amount_discrepancy: Math.abs(totalTurbopayAmount - totalProviderAmount),
      fee_discrepancy: Math.abs(totalTurbopayFees - totalProviderFees),
      discrepancies: unreconciled,
      generated_at: new Date()
    };

    return report;
  }

  // ===========================================================================
  // SETTLEMENT CONFIGURATION
  // ===========================================================================

  setSettlementConfig(provider: ProviderName, config: Partial<ProviderSettlementConfig>): void {
    const existing = this.settlementConfigs.get(provider) || this.getDefaultConfig(provider);
    this.settlementConfigs.set(provider, { ...existing, ...config });
  }

  getSettlementConfig(provider: ProviderName): ProviderSettlementConfig | undefined {
    return this.settlementConfigs.get(provider);
  }

  // ===========================================================================
  // SETTLEMENT SUMMARY
  // ===========================================================================

  getSettlementSummary(provider?: ProviderName): {
    total_settled: number;
    pending_settlement: number;
    failed_settlement: number;
    settlement_count: number;
    last_settlement_date: Date | null;
    next_expected_settlement: Date | null;
  } {
    const batches = provider
      ? this.getProviderSettlements(provider)
      : Array.from(this.settlementBatches.values());

    const settled = batches.filter(b => b.status === 'completed');
    const pending = batches.filter(b => b.status === 'pending' || b.status === 'processing');
    const failed = batches.filter(b => b.status === 'failed');

    return {
      total_settled: settled.reduce((sum, b) => sum + b.net_amount, 0),
      pending_settlement: pending.reduce((sum, b) => sum + b.net_amount, 0),
      failed_settlement: failed.reduce((sum, b) => sum + b.net_amount, 0),
      settlement_count: batches.length,
      last_settlement_date: settled.length > 0
        ? new Date(Math.max(...settled.map(b => (b.actual_settlement_date || b.settlement_date).getTime())))
        : null,
      next_expected_settlement: pending.length > 0
        ? new Date(Math.min(...pending.map(b => b.expected_settlement_date.getTime())))
        : null
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private calculateSettlementDate(schedule: string): Date {
    const now = new Date();

    switch (schedule) {
      case 'instant':
        return now;
      case 'same_day':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0, 0); // 10 PM
      case 't1':
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0, 0);
      case 't2':
        const dayAfter = new Date(now);
        dayAfter.setDate(dayAfter.getDate() + 2);
        return new Date(dayAfter.getFullYear(), dayAfter.getMonth(), dayAfter.getDate(), 10, 0, 0);
      case 't3':
        const in3Days = new Date(now);
        in3Days.setDate(in3Days.getDate() + 3);
        return new Date(in3Days.getFullYear(), in3Days.getMonth(), in3Days.getDate(), 10, 0, 0);
      case 't7':
        const in7Days = new Date(now);
        in7Days.setDate(in7Days.getDate() + 7);
        return new Date(in7Days.getFullYear(), in7Days.getMonth(), in7Days.getDate(), 10, 0, 0);
      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  private initializeDefaultConfigs(): void {
    const configs: ProviderSettlementConfig[] = [
      { provider: 'paystack', settlement_schedule: 't1', settlement_time: '10:00', minimum_settlement: 0, settlement_bank_account: '', settlement_currency: 'NGN', auto_sweep: false, sweep_threshold: 0 },
      { provider: 'flutterwave', settlement_schedule: 't1', settlement_time: '10:00', minimum_settlement: 0, settlement_bank_account: '', settlement_currency: 'NGN', auto_sweep: false, sweep_threshold: 0 },
      { provider: 'monnify', settlement_schedule: 'same_day', settlement_time: '22:00', minimum_settlement: 5000, settlement_bank_account: '', settlement_currency: 'NGN', auto_sweep: true, sweep_threshold: 50000 },
      { provider: 'onafriq', settlement_schedule: 't1', settlement_time: '10:00', minimum_settlement: 0, settlement_bank_account: '', settlement_currency: 'USD', auto_sweep: false, sweep_threshold: 0 },
      { provider: 'remita', settlement_schedule: 't1', settlement_time: '10:00', minimum_settlement: 0, settlement_bank_account: '', settlement_currency: 'NGN', auto_sweep: false, sweep_threshold: 0 },
      { provider: 'quickteller', settlement_schedule: 't1', settlement_time: '10:00', minimum_settlement: 0, settlement_bank_account: '', settlement_currency: 'NGN', auto_sweep: false, sweep_threshold: 0 },
    ];

    for (const config of configs) {
      this.settlementConfigs.set(config.provider, config);
    }
  }

  private getDefaultConfig(provider: ProviderName): ProviderSettlementConfig {
    return {
      provider,
      settlement_schedule: 't1',
      settlement_time: '10:00',
      minimum_settlement: 0,
      settlement_bank_account: '',
      settlement_currency: 'NGN',
      auto_sweep: false,
      sweep_threshold: 0
    };
  }

  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }
}

export default SettlementReconciliationService;
