// TurboPay Analytics Dashboard
// Transaction analytics, reporting, and provider cost comparison

import {
  ProviderName,
  PaymentOperation,
  TransactionStatus
} from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface TransactionRecord {
  id: string;
  provider: ProviderName;
  operation: PaymentOperation;
  amount: number;
  currency: string;
  fee: number;
  status: TransactionStatus;
  country: string;
  created_at: Date;
  completed_at?: Date;
  latency_ms?: number;
  error_message?: string;
}

export interface DailyAnalytics {
  date: string;
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
  total_volume: number;
  total_fees: number;
  avg_latency_ms: number;
  success_rate: number;
}

export interface ProviderAnalytics {
  provider: ProviderName;
  period: 'day' | 'week' | 'month';
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
  total_volume: number;
  total_fees: number;
  average_amount: number;
  success_rate: number;
  average_latency_ms: number;
  daily_breakdown: DailyAnalytics[];
  top_operations: OperationAnalytics[];
}

export interface OperationAnalytics {
  operation: PaymentOperation;
  count: number;
  volume: number;
  fees: number;
  success_rate: number;
}

export interface CostComparison {
  provider: ProviderName;
  operation: PaymentOperation;
  avg_fee_per_transaction: number;
  total_fees: number;
  total_volume: number;
  cost_percentage: number;
}

export interface SettlementAnalytics {
  provider: ProviderName;
  total_settled: number;
  pending_settlement: number;
  settlement_count: number;
  last_settlement_date: Date | null;
  avg_settlement_time_ms: number;
}

// =============================================================================
// ANALYTICS DASHBOARD
// =============================================================================

export class AnalyticsDashboard {
  private transactions: TransactionRecord[] = [];
  private readonly MAX_RECORDS = 100000;

  // ===========================================================================
  // RECORD TRANSACTIONS
  // ===========================================================================

  recordTransaction(record: TransactionRecord): void {
    this.transactions.push(record);

    // Trim old records
    if (this.transactions.length > this.MAX_RECORDS) {
      this.transactions = this.transactions.slice(-this.MAX_RECORDS);
    }
  }

  updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    fee?: number,
    latency_ms?: number,
    error_message?: string
  ): void {
    const record = this.transactions.find(t => t.id === id);
    if (record) {
      record.status = status;
      if (fee !== undefined) record.fee = fee;
      if (latency_ms !== undefined) record.latency_ms = latency_ms;
      if (error_message !== undefined) record.error_message = error_message;
      if (status === 'success' || status === 'failed') {
        record.completed_at = new Date();
      }
    }
  }

  // ===========================================================================
  // ANALYTICS QUERIES
  // ===========================================================================

  getProviderAnalytics(
    provider: ProviderName,
    period: 'day' | 'week' | 'month' = 'day'
  ): ProviderAnalytics {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const providerTransactions = this.transactions.filter(
      t => t.provider === provider && t.created_at >= startDate
    );

    const successful = providerTransactions.filter(t => t.status === 'success');
    const failed = providerTransactions.filter(t => t.status === 'failed');

    const totalVolume = providerTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalFees = providerTransactions.reduce((sum, t) => sum + t.fee, 0);
    const avgLatency = providerTransactions.filter(t => t.latency_ms).reduce((sum, t) => sum + (t.latency_ms || 0), 0) /
      Math.max(providerTransactions.filter(t => t.latency_ms).length, 1);

    // Daily breakdown
    const dailyMap = new Map<string, { count: number; success: number; failed: number; volume: number; fees: number; latency: number }>();
    for (const t of providerTransactions) {
      const dateKey = t.created_at.toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || { count: 0, success: 0, failed: 0, volume: 0, fees: 0, latency: 0 };
      existing.count++;
      if (t.status === 'success') existing.success++;
      if (t.status === 'failed') existing.failed++;
      existing.volume += t.amount;
      existing.fees += t.fee;
      if (t.latency_ms) existing.latency += t.latency_ms;
      dailyMap.set(dateKey, existing);
    }

    const daily_breakdown: DailyAnalytics[] = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      total_transactions: data.count,
      successful_transactions: data.success,
      failed_transactions: data.failed,
      total_volume: data.volume,
      total_fees: data.fees,
      avg_latency_ms: data.count > 0 ? Math.round(data.latency / data.count) : 0,
      success_rate: data.count > 0 ? data.success / data.count : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Top operations
    const operationMap = new Map<PaymentOperation, { count: number; volume: number; fees: number; success: number }>();
    for (const t of providerTransactions) {
      const existing = operationMap.get(t.operation) || { count: 0, volume: 0, fees: 0, success: 0 };
      existing.count++;
      existing.volume += t.amount;
      existing.fees += t.fee;
      if (t.status === 'success') existing.success++;
      operationMap.set(t.operation, existing);
    }

    const top_operations: OperationAnalytics[] = Array.from(operationMap.entries()).map(([operation, data]) => ({
      operation,
      count: data.count,
      volume: data.volume,
      fees: data.fees,
      success_rate: data.count > 0 ? data.success / data.count : 0
    })).sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      provider,
      period,
      total_transactions: providerTransactions.length,
      successful_transactions: successful.length,
      failed_transactions: failed.length,
      total_volume: totalVolume,
      total_fees: totalFees,
      average_amount: providerTransactions.length > 0 ? totalVolume / providerTransactions.length : 0,
      success_rate: providerTransactions.length > 0 ? successful.length / providerTransactions.length : 0,
      average_latency_ms: Math.round(avgLatency),
      daily_breakdown,
      top_operations
    };
  }

  getAllProviderAnalytics(period: 'day' | 'week' | 'month' = 'day'): ProviderAnalytics[] {
    const providers = new Set(this.transactions.map(t => t.provider));
    return Array.from(providers).map(provider =>
      this.getProviderAnalytics(provider, period)
    );
  }

  // ===========================================================================
  // COST COMPARISON
  // ===========================================================================

  getCostComparison(operation: PaymentOperation): CostComparison[] {
    const providerMap = new Map<ProviderName, { fees: number; volume: number; count: number }>();

    for (const t of this.transactions.filter(t => t.operation === operation && t.status === 'success')) {
      const existing = providerMap.get(t.provider) || { fees: 0, volume: 0, count: 0 };
      existing.fees += t.fee;
      existing.volume += t.amount;
      existing.count++;
      providerMap.set(t.provider, existing);
    }

    const totalFees = Array.from(providerMap.values()).reduce((sum, data) => sum + data.fees, 0);

    return Array.from(providerMap.entries()).map(([provider, data]) => ({
      provider,
      operation,
      avg_fee_per_transaction: data.count > 0 ? data.fees / data.count : 0,
      total_fees: data.fees,
      total_volume: data.volume,
      cost_percentage: totalFees > 0 ? (data.fees / totalFees) * 100 : 0
    })).sort((a, b) => a.avg_fee_per_transaction - b.avg_fee_per_transaction);
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================

  getSummary(period: 'day' | 'week' | 'month' = 'day'): {
    total_transactions: number;
    successful_transactions: number;
    failed_transactions: number;
    total_volume: number;
    total_fees: number;
    success_rate: number;
    avg_latency_ms: number;
    top_provider: ProviderName | null;
    top_operation: PaymentOperation | null;
  } {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const periodTransactions = this.transactions.filter(t => t.created_at >= startDate);

    const successful = periodTransactions.filter(t => t.status === 'success');
    const failed = periodTransactions.filter(t => t.status === 'failed');

    const totalVolume = periodTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalFees = periodTransactions.reduce((sum, t) => sum + t.fee, 0);
    const avgLatency = periodTransactions.filter(t => t.latency_ms).reduce((sum, t) => sum + (t.latency_ms || 0), 0) /
      Math.max(periodTransactions.filter(t => t.latency_ms).length, 1);

    // Top provider by volume
    const providerVolume = new Map<ProviderName, number>();
    for (const t of periodTransactions) {
      providerVolume.set(t.provider, (providerVolume.get(t.provider) || 0) + t.amount);
    }
    const topProvider = Array.from(providerVolume.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Top operation by count
    const operationCount = new Map<PaymentOperation, number>();
    for (const t of periodTransactions) {
      operationCount.set(t.operation, (operationCount.get(t.operation) || 0) + 1);
    }
    const topOperation = Array.from(operationCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      total_transactions: periodTransactions.length,
      successful_transactions: successful.length,
      failed_transactions: failed.length,
      total_volume: totalVolume,
      total_fees: totalFees,
      success_rate: periodTransactions.length > 0 ? successful.length / periodTransactions.length : 0,
      avg_latency_ms: Math.round(avgLatency),
      top_provider: topProvider,
      top_operation: topOperation
    };
  }

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  exportTransactions(
    startDate: Date,
    endDate: Date,
    provider?: ProviderName,
    format: 'json' | 'csv' = 'json'
  ): string {
    let filtered = this.transactions.filter(
      t => t.created_at >= startDate && t.created_at <= endDate
    );

    if (provider) {
      filtered = filtered.filter(t => t.provider === provider);
    }

    if (format === 'json') {
      return JSON.stringify(filtered, null, 2);
    }

    // CSV format
    const headers = 'id,provider,operation,amount,currency,fee,status,country,created_at,latency_ms\n';
    const rows = filtered.map(t =>
      `${t.id},${t.provider},${t.operation},${t.amount},${t.currency},${t.fee},${t.status},${t.country},${t.created_at.toISOString()},${t.latency_ms || ''}`
    ).join('\n');

    return headers + rows;
  }
}

export default AnalyticsDashboard;
