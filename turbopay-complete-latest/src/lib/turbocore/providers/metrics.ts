/**
 * TurboCore — Provider Metrics Aggregation
 * ==========================================
 *
 * Tracks per-provider operational metrics in real-time using in-memory
 * counters with periodic aggregation to the database. Provides rolling
 * windows for success rate, latency percentiles, error distribution,
 * and transaction volume.
 *
 * Architecture:
 *   - In-memory ring buffer per provider (last 1000 operations)
 *   - Periodic flush to DB every 5 minutes (for durability)
 *   - On-demand aggregation for dashboards and routing decisions
 *   - No synchronous writes on the hot path
 *
 * Usage:
 *   import { providerMetrics } from "@/lib/turbocore/providers/metrics";
 *
 *   providerMetrics.recordRequest("paystack", "walletFunding", {
 *     success: true, latencyMs: 450, amountKobo: 500000,
 *   });
 *
 *   const summary = await providerMetrics.getSummary("paystack", "1h");
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/turbocore/logger";

// ─── Types ────────────────────────────────────────────────────

export type TimeWindow = "5m" | "15m" | "1h" | "6h" | "24h" | "7d";

export interface RequestRecord {
  timestamp: number;
  success: boolean;
  latencyMs: number;
  amountKobo: number;
  error?: string;
  contract?: string;
  countryCode?: string;
  currency?: string;
}

export interface ProviderMetricsSummary {
  providerName: string;
  window: TimeWindow;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  timeoutCount: number;
  totalVolumeKobo: number;
  avgAmountKobo: number;
  errorDistribution: Record<string, number>;
  contractBreakdown: Record<string, { count: number; successRate: number }>;
  computedAt: Date;
}

export interface GlobalMetricsSummary {
  totalProviders: number;
  totalRequests: number;
  overallSuccessRate: number;
  overallAvgLatencyMs: number;
  providerSummaries: ProviderMetricsSummary[];
  computedAt: Date;
}

// ─── In-Memory Ring Buffer ────────────────────────────────────

const MAX_RECORDS_PER_PROVIDER = 1000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class ProviderMetricsBuffer {
  private buffers = new Map<string, RequestRecord[]>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pendingFlush = false;

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushToDb(), FLUSH_INTERVAL_MS);
    logger.info("provider_metrics.started", { flushIntervalSeconds: FLUSH_INTERVAL_MS / 1000 });
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Record a provider request in the in-memory buffer.
   */
  record(providerName: string, record: RequestRecord): void {
    let buffer = this.buffers.get(providerName);
    if (!buffer) {
      buffer = [];
      this.buffers.set(providerName, buffer);
    }

    buffer.push(record);

    // Ring buffer: trim oldest if over limit
    if (buffer.length > MAX_RECORDS_PER_PROVIDER) {
      buffer.splice(0, buffer.length - MAX_RECORDS_PER_PROVIDER);
    }
  }

  /**
   * Get all records for a provider within a time window.
   */
  getRecords(providerName: string, windowMs: number): RequestRecord[] {
    const buffer = this.buffers.get(providerName) ?? [];
    const cutoff = Date.now() - windowMs;
    return buffer.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Get all provider names with recorded data.
   */
  getProviderNames(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Flush aggregated metrics to the database.
   * Only flushes if there's data — no empty writes.
   */
  private async flushToDb(): Promise<void> {
    if (this.pendingFlush) return;
    this.pendingFlush = true;

    try {
      for (const [providerName, buffer] of this.buffers.entries()) {
        if (buffer.length === 0) continue;

        // Aggregate the buffer into a single DB record
        const now = new Date();
        const totalRequests = buffer.length;
        const successCount = buffer.filter((r) => r.success).length;
        const successRate = totalRequests > 0 ? successCount / totalRequests : 0;
        const avgLatencyMs = totalRequests > 0
          ? Math.round(buffer.reduce((sum, r) => sum + r.latencyMs, 0) / totalRequests)
          : 0;
        const totalVolumeKobo = buffer.reduce((sum, r) => sum + r.amountKobo, 0);

        // Write aggregated summary
        await db.providerMetric.create({
          data: {
            providerName,
            windowStart: new Date(now.getTime() - FLUSH_INTERVAL_MS),
            windowEnd: now,
            totalRequests,
            successCount,
            failureCount: totalRequests - successCount,
            successRate: Math.round(successRate * 10000) / 10000,
            avgLatencyMs,
            totalVolumeKobo,
            metadata: JSON.stringify({
              avgAmountKobo: totalRequests > 0 ? Math.round(totalVolumeKobo / totalRequests) : 0,
            }),
          },
        }).catch((err) => {
          logger.warn("provider_metrics.flush_error", { providerName, error: err instanceof Error ? err.message : String(err) });
        });
      }
    } finally {
      this.pendingFlush = false;
    }
  }

  /**
   * Force-flush and clear all buffers (for testing or shutdown).
   */
  async forceFlushAndClear(): Promise<void> {
    await this.flushToDb();
    this.buffers.clear();
  }
}

// ─── Metrics Service ──────────────────────────────────────────

const WINDOW_MS: Record<TimeWindow, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

class ProviderMetricsService {
  private buffer = new ProviderMetricsBuffer();

  /** Start the background flush timer. Call once at app startup. */
  start(): void {
    this.buffer.start();
  }

  /** Stop the background flush timer. */
  stop(): void {
    this.buffer.stop();
  }

  /**
   * Record a provider request. This is the hot-path method — must be fast.
   */
  recordRequest(
    providerName: string,
    opts: {
      success: boolean;
      latencyMs: number;
      amountKobo: number;
      error?: string;
      contract?: string;
      countryCode?: string;
      currency?: string;
      timeout?: boolean;
    }
  ): void {
    this.buffer.record(providerName, {
      timestamp: Date.now(),
      success: opts.success,
      latencyMs: opts.latencyMs,
      amountKobo: opts.amountKobo,
      error: opts.error,
      contract: opts.contract,
      countryCode: opts.countryCode,
      currency: opts.currency,
    });
  }

  /**
   * Get aggregated metrics for a single provider within a time window.
   */
  async getSummary(providerName: string, window: TimeWindow = "1h"): Promise<ProviderMetricsSummary> {
    const windowMs = WINDOW_MS[window];
    const records = this.buffer.getRecords(providerName, windowMs);

    const totalRequests = records.length;
    const successCount = records.filter((r) => r.success).length;
    const failureCount = totalRequests - successCount;
    const successRate = totalRequests > 0 ? successCount / totalRequests : 1;

    // Latency percentiles
    const sortedLatencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs = totalRequests > 0
      ? Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / totalRequests)
      : 0;
    const p50LatencyMs = percentile(sortedLatencies, 0.50);
    const p95LatencyMs = percentile(sortedLatencies, 0.95);
    const p99LatencyMs = percentile(sortedLatencies, 0.99);

    // Timeout detection (>10s latency)
    const timeoutCount = records.filter((r) => r.latencyMs > 10000).length;

    // Volume
    const totalVolumeKobo = records.reduce((sum, r) => sum + r.amountKobo, 0);
    const avgAmountKobo = totalRequests > 0 ? Math.round(totalVolumeKobo / totalRequests) : 0;

    // Error distribution
    const errorDistribution: Record<string, number> = {};
    for (const record of records) {
      if (!record.success && record.error) {
        const errorType = classifyError(record.error);
        errorDistribution[errorType] = (errorDistribution[errorType] ?? 0) + 1;
      }
    }

    // Contract breakdown
    const contractBreakdown: Record<string, { count: number; successRate: number }> = {};
    for (const record of records) {
      const contract = record.contract ?? "unknown";
      if (!contractBreakdown[contract]) {
        contractBreakdown[contract] = { count: 0, successRate: 0 };
      }
      contractBreakdown[contract].count++;
    }
    // Compute per-contract success rates
    for (const contract of Object.keys(contractBreakdown)) {
      const contractRecords = records.filter((r) => (r.contract ?? "unknown") === contract);
      const contractSuccess = contractRecords.filter((r) => r.success).length;
      contractBreakdown[contract].successRate = contractRecords.length > 0
        ? contractSuccess / contractRecords.length
        : 0;
    }

    return {
      providerName,
      window,
      totalRequests,
      successCount,
      failureCount,
      successRate: Math.round(successRate * 10000) / 10000,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      timeoutCount,
      totalVolumeKobo,
      avgAmountKobo,
      errorDistribution,
      contractBreakdown,
      computedAt: new Date(),
    };
  }

  /**
   * Get summaries for all providers.
   */
  async getGlobalSummary(window: TimeWindow = "1h"): Promise<GlobalMetricsSummary> {
    const providerNames = this.buffer.getProviderNames();
    const summaries = await Promise.all(
      providerNames.map((name) => this.getSummary(name, window))
    );

    const totalRequests = summaries.reduce((sum, s) => sum + s.totalRequests, 0);
    const totalSuccesses = summaries.reduce((sum, s) => sum + s.successCount, 0);

    return {
      totalProviders: summaries.length,
      totalRequests,
      overallSuccessRate: totalRequests > 0 ? Math.round((totalSuccesses / totalRequests) * 10000) / 10000 : 1,
      overallAvgLatencyMs: totalRequests > 0
        ? Math.round(summaries.reduce((sum, s) => sum + s.avgLatencyMs * s.totalRequests, 0) / totalRequests)
        : 0,
      providerSummaries: summaries.sort((a, b) => b.totalRequests - a.totalRequests),
      computedAt: new Date(),
    };
  }

  /**
   * Get historical metrics from the database (for longer windows).
   */
  async getHistoricalSummary(providerName: string, windowMs: number): Promise<{
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalVolumeKobo: number;
  }> {
    const since = new Date(Date.now() - windowMs);
    const rows = await db.providerMetric.findMany({
      where: { providerName, windowStart: { gte: since } },
    });

    const totalRequests = rows.reduce((sum, r) => sum + r.totalRequests, 0);
    const totalSuccess = rows.reduce((sum, r) => sum + r.successCount, 0);
    const totalVolume = rows.reduce((sum, r) => sum + r.totalVolumeKobo, 0);
    const weightedLatency = rows.reduce((sum, r) => sum + r.avgLatencyMs * r.totalRequests, 0);

    return {
      totalRequests,
      successRate: totalRequests > 0 ? totalSuccess / totalRequests : 1,
      avgLatencyMs: totalRequests > 0 ? Math.round(weightedLatency / totalRequests) : 0,
      totalVolumeKobo: totalVolume,
    };
  }

  /**
   * Force flush and clear (for testing).
   */
  async forceFlushAndClear(): Promise<void> {
    await this.buffer.forceFlushAndClear();
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

function classifyError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) return "TIMEOUT";
  if (lower.includes("network") || lower.includes("econnrefused") || lower.includes("econnreset")) return "NETWORK";
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized")) return "AUTH";
  if (lower.includes("429") || lower.includes("rate limit")) return "RATE_LIMIT";
  if (lower.includes("500") || lower.includes("502") || lower.includes("503")) return "SERVER_ERROR";
  if (lower.includes("validation") || lower.includes("invalid")) return "VALIDATION";
  if (lower.includes("circuit breaker")) return "CIRCUIT_BREAKER";
  return "OTHER";
}

/** Singleton metrics service. */
export const providerMetrics = new ProviderMetricsService();
