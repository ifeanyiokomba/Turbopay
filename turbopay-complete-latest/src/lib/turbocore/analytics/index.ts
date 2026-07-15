/**
 * TurboCore — Analytics Service
 * ==============================
 *
 * Provides cohort analysis, trend aggregation, and drill-down capabilities
 * for the admin platform. All queries are read-only and optimized for
 * dashboard performance.
 *
 * Metrics tracked:
 *   - User growth (daily/weekly/monthly cohorts)
 *   - Transaction volume (by type, status, provider)
 *   - Revenue (fees collected, FX spread)
 *   - Wallet metrics (total balance, active wallets)
 *   - Provider performance (success rates, latency)
 *   - KYC completion rates
 *   - Support ticket trends
 */

import { db } from "@/lib/db";
import { dbRead, hasReadReplica } from "@/lib/db-read";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface CohortResult {
  cohort: string;
  count: number;
  retention?: number;
}

class AnalyticsService {
  /** Get the appropriate database client for analytics queries. */
  private get db() {
    return hasReadReplica() ? dbRead : db;
  }

  /**
   * User growth trend — new users per day/week/month.
   */
  async userGrowth(range: DateRange, granularity: "day" | "week" | "month" = "day"): Promise<TrendPoint[]> {
    const users = await this.db.user.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const grouped = new Map<string, number>();
    for (const user of users) {
      const key = this.truncateDate(user.createdAt, granularity);
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }

    return Array.from(grouped.entries()).map(([date, value]) => ({ date, value }));
  }

  /**
   * Transaction volume trend — transactions per day by type.
   */
  async transactionVolume(range: DateRange, granularity: "day" | "week" | "month" = "day"): Promise<Record<string, TrendPoint[]>> {
    const txns = await this.db.transaction.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { createdAt: true, type: true, amountKobo: true, status: true },
      orderBy: { createdAt: "asc" },
    });

    const byType = new Map<string, Map<string, { count: number; volume: number }>>();
    for (const txn of txns) {
      const key = this.truncateDate(txn.createdAt, granularity);
      if (!byType.has(txn.type)) byType.set(txn.type, new Map());
      const typeMap = byType.get(txn.type)!;
      const existing = typeMap.get(key) ?? { count: 0, volume: 0 };
      typeMap.set(key, { count: existing.count + 1, volume: existing.volume + txn.amountKobo });
    }

    const result: Record<string, TrendPoint[]> = {};
    for (const [type, data] of byType) {
      result[type] = Array.from(data.entries()).map(([date, v]) => ({ date, value: v.count }));
    }
    return result;
  }

  /**
   * Revenue summary — fees collected + FX spread revenue.
   * Uses Prisma aggregate instead of loading all rows into JS.
   */
  async revenueSummary(range: DateRange): Promise<{
    totalFeesKobo: number;
    totalFxRevenueKobo: number;
    transactionCount: number;
    averageFeeKobo: number;
  }> {
    const result = await this.db.transaction.aggregate({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        status: "SUCCESS",
      },
      _sum: { feeKobo: true },
      _count: { id: true },
    });

    const totalFeesKobo = result._sum.feeKobo ?? 0;
    const transactionCount = result._count.id;

    // FX revenue is estimated from spread (simplified — real calculation would
    // query FxRateSnapshot and compare mid-market vs customer rate)
    const totalFxRevenueKobo = 0; // Placeholder — needs FX transaction join

    return {
      totalFeesKobo,
      totalFxRevenueKobo,
      transactionCount,
      averageFeeKobo: transactionCount > 0 ? Math.round(totalFeesKobo / transactionCount) : 0,
    };
  }

  /**
   * Wallet metrics — total balance, active wallets, avg balance.
   */
  async walletMetrics(): Promise<{
    totalBalanceKobo: number;
    activeWallets: number;
    averageBalanceKobo: number;
    frozenWallets: number;
  }> {
    const [stats, frozen] = await Promise.all([
      db.wallet.aggregate({
        where: { status: "ACTIVE" },
        _sum: { balanceKobo: true },
        _count: true,
        _avg: { balanceKobo: true },
      }),
      db.wallet.count({ where: { status: "FROZEN" } }),
    ]);

    return {
      totalBalanceKobo: stats._sum.balanceKobo ?? 0,
      activeWallets: stats._count,
      averageBalanceKobo: Math.round(stats._avg.balanceKobo ?? 0),
      frozenWallets: frozen,
    };
  }

  /**
   * Provider performance — success rates and latency by provider.
   */
  async providerPerformance(range: DateRange): Promise<{
    provider: string;
    totalCalls: number;
    successRate: number;
    averageLatencyMs: number;
  }[]> {
    const healthChecks = await this.db.providerHealthCheck.findMany({
      where: { checkedAt: { gte: range.from, lte: range.to } },
      select: { providerConfigId: true, status: true, latencyMs: true },
    });

    const byProvider = new Map<string, { total: number; success: number; totalLatency: number }>();
    for (const hc of healthChecks) {
      const existing = byProvider.get(hc.providerConfigId) ?? { total: 0, success: 0, totalLatency: 0 };
      existing.total++;
      if (hc.status === "ok") existing.success++;
      existing.totalLatency += hc.latencyMs ?? 0;
      byProvider.set(hc.providerConfigId, existing);
    }

    // Get provider names
    const configs = await this.db.providerConfig.findMany({
      select: { id: true, providerName: true },
    });
    const configMap = new Map(configs.map(c => [c.id, c.providerName]));

    return Array.from(byProvider.entries()).map(([id, data]) => ({
      provider: configMap.get(id) ?? id,
      totalCalls: data.total,
      successRate: data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
      averageLatencyMs: data.total > 0 ? Math.round(data.totalLatency / data.total) : 0,
    }));
  }

  /**
   * KYC completion rates by tier.
   */
  async kycCompletionRates(): Promise<{
    tier: number;
    total: number;
    verified: number;
    completionRate: number;
  }[]> {
    const tiers = [1, 2, 3];
    const results = [];

    for (const tier of tiers) {
      const [total, verified] = await Promise.all([
        db.user.count({ where: { kycTier: { gte: tier } } }),
        db.user.count({ where: { kycTier: { gte: tier }, kycStatus: "VERIFIED" } }),
      ]);
      results.push({
        tier,
        total,
        verified,
        completionRate: total > 0 ? Math.round((verified / total) * 100) : 0,
      });
    }

    return results;
  }

  /**
   * Support ticket trends — tickets per day by category and status.
   */
  async supportTrends(range: DateRange): Promise<{
    totalTickets: number;
    resolvedTickets: number;
    averageResolutionHours: number;
    byCategory: Record<string, number>;
  }> {
    const tickets = await this.db.supportTicket.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { category: true, status: true, createdAt: true, resolvedAt: true },
    });

    const totalTickets = tickets.length;
    const resolvedTickets = tickets.filter(t => t.status === "RESOLVED" || t.status === "CLOSED").length;

    const resolutionTimes = tickets
      .filter(t => t.resolvedAt)
      .map(t => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60));
    const averageResolutionHours = resolutionTimes.length > 0
      ? Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length)
      : 0;

    const byCategory: Record<string, number> = {};
    for (const t of tickets) {
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    }

    return { totalTickets, resolvedTickets, averageResolutionHours, byCategory };
  }

  /**
   * AML flag summary — flags by rule and severity.
   */
  async amlSummary(range: DateRange): Promise<{
    totalFlags: number;
    unresolved: number;
    byRule: Record<string, number>;
    bySeverity: Record<string, number>;
  }> {
    const flags = await this.db.amlFlag.findMany({
      where: { createdAt: { gte: range.from, lte: range.to } },
      select: { rule: true, severity: true, resolved: true },
    });

    const totalFlags = flags.length;
    const unresolved = flags.filter(f => !f.resolved).length;

    const byRule: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const f of flags) {
      byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    }

    return { totalFlags, unresolved, byRule, bySeverity };
  }

  /**
   * Comprehensive dashboard summary — all key metrics in one call.
   * Uses Prisma aggregate/count instead of loading all rows into JS.
   */
  async dashboardSummary(range: DateRange): Promise<{
    users: { total: number; newThisPeriod: number; growthRate: number };
    transactions: { total: number; volumeKobo: number; successRate: number };
    revenue: { feesKobo: number; averageFeeKobo: number };
    wallets: { totalBalanceKobo: number; active: number; frozen: number };
    kyc: { verified: number; pending: number; completionRate: number };
    support: { open: number; resolved: number; avgResolutionHours: number };
    aml: { totalFlags: number; unresolved: number };
  }> {
    const [
      totalUsers, newUsers,
      txStats, successStats, volumeStats,
      revenue, walletMetrics,
      kycVerified, kycPending,
      openTickets, resolvedTickets,
      amlFlags, unresolvedFlags,
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      db.transaction.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      db.transaction.count({ where: { createdAt: { gte: range.from, lte: range.to }, status: "SUCCESS" } }),
      db.transaction.aggregate({ where: { createdAt: { gte: range.from, lte: range.to } }, _sum: { amountKobo: true } }),
      this.revenueSummary(range),
      this.walletMetrics(),
      db.user.count({ where: { kycStatus: "VERIFIED" } }),
      db.user.count({ where: { kycStatus: "PENDING" } }),
      db.supportTicket.count({ where: { status: { in: ["NEW", "OPEN", "IN_PROGRESS", "ESCALATED"] } } }),
      db.supportTicket.count({ where: { status: { in: ["RESOLVED", "CLOSED"] }, createdAt: { gte: range.from, lte: range.to } } }),
      db.amlFlag.count({ where: { createdAt: { gte: range.from, lte: range.to } } }),
      db.amlFlag.count({ where: { resolved: false } }),
    ]);

    const totalVolume = volumeStats._sum.amountKobo ?? 0;

    return {
      users: {
        total: totalUsers,
        newThisPeriod: newUsers,
        growthRate: totalUsers > 0 ? Math.round((newUsers / totalUsers) * 100) : 0,
      },
      transactions: {
        total: txStats,
        volumeKobo: totalVolume,
        successRate: txStats > 0 ? Math.round((successStats / txStats) * 100) : 0,
      },
      revenue: {
        feesKobo: revenue.totalFeesKobo,
        averageFeeKobo: revenue.averageFeeKobo,
      },
      wallets: {
        totalBalanceKobo: walletMetrics.totalBalanceKobo,
        active: walletMetrics.activeWallets,
        frozen: walletMetrics.frozenWallets,
      },
      kyc: {
        verified: kycVerified,
        pending: kycPending,
        completionRate: kycVerified + kycPending > 0 ? Math.round((kycVerified / (kycVerified + kycPending)) * 100) : 0,
      },
      support: {
        open: openTickets,
        resolved: resolvedTickets,
        avgResolutionHours: 0, // Would need full query
      },
      aml: {
        totalFlags: amlFlags,
        unresolved: unresolvedFlags,
      },
    };
  }

  private truncateDate(date: Date, granularity: "day" | "week" | "month"): string {
    const d = new Date(date);
    if (granularity === "day") return d.toISOString().split("T")[0];
    if (granularity === "week") {
      const day = d.getDay();
      d.setDate(d.getDate() - day);
      return d.toISOString().split("T")[0];
    }
    // month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
}

export const analytics = new AnalyticsService();
