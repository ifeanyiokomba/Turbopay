/**
 * TurboCore — Alerting Service
 * ==============================
 *
 * Evaluates threshold-based conditions and generates alert events.
 * Integrates with the event bus and the AlertEvent database model.
 *
 * Alert categories:
 *   - provider.degraded / provider.down
 *   - stuck_transaction
 *   - reconciliation.mismatch
 *   - wallet.ledger_inconsistency
 *   - high_failure_rate
 *
 * Alerts are persisted in the database for the admin dashboard.
 * The event bus notifies subscribers for real-time awareness.
 */

import { db } from "@/lib/db";
import { eventBus } from "@/lib/turbocore/events/bus";
import { logger } from "@/lib/turbocore/logger";
import { stuckTransactionDetector } from "@/lib/turbocore/reconciliation/stuck-transactions";
import { providerMetrics } from "@/lib/turbocore/providers/metrics";
import type { TimeWindow } from "@/lib/turbocore/providers/metrics";

// ─── Types ────────────────────────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AlertStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";

export interface AlertCondition {
  alertType: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  providerName?: string;
  transactionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AlertEvaluationResult {
  evaluatedAt: Date;
  alertsGenerated: number;
  conditionsChecked: number;
  alerts: Array<{ id: string; alertType: string; severity: AlertSeverity; title: string }>;
}

// ─── Threshold Configuration ──────────────────────────────────

interface AlertThresholds {
  /** Minimum failure rate (0-1) to trigger a degraded alert */
  providerDegradedFailureRate: number;
  /** Minimum failure rate (0-1) to trigger a down alert */
  providerDownFailureRate: number;
  /** Minimum requests required before evaluating thresholds */
  providerMinRequests: number;
  /** Minimum stuck transactions to trigger an alert */
  stuckTransactionThreshold: number;
  /** Time window for provider health evaluation */
  providerEvaluationWindow: TimeWindow;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  providerDegradedFailureRate: 0.3, // 30% failure rate
  providerDownFailureRate: 0.8,     // 80% failure rate
  providerMinRequests: 5,
  stuckTransactionThreshold: 1,
  providerEvaluationWindow: "1h",
};

// ─── Deduplication ────────────────────────────────────────────

const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between duplicate alerts
const recentAlerts = new Map<string, number>(); // alertKey → last alert timestamp

function shouldAlert(key: string): boolean {
  const last = recentAlerts.get(key);
  if (last && Date.now() - last < ALERT_COOLDOWN_MS) return false;
  recentAlerts.set(key, Date.now());
  return true;
}

// ─── Alerting Service ─────────────────────────────────────────

class AlertingService {
  private thresholds: AlertThresholds;

  constructor(thresholds: Partial<AlertThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Run all alert evaluations. Called periodically by a cron job.
   */
  async evaluateAll(): Promise<AlertEvaluationResult> {
    const evaluatedAt = new Date();
    const generatedAlerts: Array<{ id: string; alertType: string; severity: AlertSeverity; title: string }> = [];
    let conditionsChecked = 0;

    // 1. Check provider health
    const providerAlerts = await this.evaluateProviderHealth();
    conditionsChecked++;
    for (const alert of providerAlerts) {
      const created = await this.createAlert(alert);
      if (created) {
        generatedAlerts.push({ id: created.id, alertType: alert.alertType, severity: alert.severity, title: alert.title });
      }
    }

    // 2. Check stuck transactions
    const stuckAlerts = await this.evaluateStuckTransactions();
    conditionsChecked++;
    for (const alert of stuckAlerts) {
      const created = await this.createAlert(alert);
      if (created) {
        generatedAlerts.push({ id: created.id, alertType: alert.alertType, severity: alert.severity, title: alert.title });
      }
    }

    // 3. Check high failure rates
    const failureAlerts = await this.evaluateHighFailureRates();
    conditionsChecked++;
    for (const alert of failureAlerts) {
      const created = await this.createAlert(alert);
      if (created) {
        generatedAlerts.push({ id: created.id, alertType: alert.alertType, severity: alert.severity, title: alert.title });
      }
    }

    logger.info("alerting.evaluation.completed", {
      conditionsChecked,
      alertsGenerated: generatedAlerts.length,
    });

    return { evaluatedAt, alertsGenerated: generatedAlerts.length, conditionsChecked, alerts: generatedAlerts };
  }

  /**
   * Evaluate provider health and generate alerts for degraded/down providers.
   */
  private async evaluateProviderHealth(): Promise<AlertCondition[]> {
    const alerts: AlertCondition[] = [];
    const globalSummary = await providerMetrics.getGlobalSummary(this.thresholds.providerEvaluationWindow);

    for (const summary of globalSummary.providerSummaries) {
      if (summary.totalRequests < this.thresholds.providerMinRequests) continue;

      const alertKey = `provider_health:${summary.providerName}`;

      if (summary.successRate <= 1 - this.thresholds.providerDownFailureRate) {
        if (shouldAlert(`${alertKey}:down`)) {
          alerts.push({
            alertType: "provider.down",
            severity: "CRITICAL",
            title: `Provider ${summary.providerName} is DOWN`,
            description: `Success rate is ${Math.round(summary.successRate * 100)}% over the last ${this.thresholds.providerEvaluationWindow}. ${summary.failureCount} failures out of ${summary.totalRequests} requests.`,
            providerName: summary.providerName,
            metadata: {
              successRate: summary.successRate,
              totalRequests: summary.totalRequests,
              failureCount: summary.failureCount,
              avgLatencyMs: summary.avgLatencyMs,
              window: this.thresholds.providerEvaluationWindow,
            },
          });
        }
      } else if (summary.successRate <= 1 - this.thresholds.providerDegradedFailureRate) {
        if (shouldAlert(`${alertKey}:degraded`)) {
          alerts.push({
            alertType: "provider.degraded",
            severity: "WARNING",
            title: `Provider ${summary.providerName} is DEGRADED`,
            description: `Success rate is ${Math.round(summary.successRate * 100)}% over the last ${this.thresholds.providerEvaluationWindow}.`,
            providerName: summary.providerName,
            metadata: {
              successRate: summary.successRate,
              totalRequests: summary.totalRequests,
              failureCount: summary.failureCount,
              avgLatencyMs: summary.avgLatencyMs,
              window: this.thresholds.providerEvaluationWindow,
            },
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Evaluate stuck transactions and generate alerts.
   */
  private async evaluateStuckTransactions(): Promise<AlertCondition[]> {
    const alerts: AlertCondition[] = [];
    const result = await stuckTransactionDetector.detect();

    if (result.stuckCount >= this.thresholds.stuckTransactionThreshold) {
      const alertKey = "stuck_transactions";
      if (shouldAlert(alertKey)) {
        alerts.push({
          alertType: "stuck_transaction",
          severity: result.stuckCount >= 5 ? "CRITICAL" : "WARNING",
          title: `${result.stuckCount} stuck transaction(s) detected`,
          description: `${result.stuckCount} transactions are stuck in PENDING/PROCESSING beyond their thresholds. ${result.totalChecked} total pending transactions.`,
          metadata: {
            stuckCount: result.stuckCount,
            totalChecked: result.totalChecked,
            byType: result.byType,
            byProvider: result.byProvider,
            oldestStuckMinutes: result.stuckTransactions[0]?.stuckDurationMinutes,
          },
        });
      }
    }

    return alerts;
  }

  /**
   * Evaluate high failure rates across all providers.
   */
  private async evaluateHighFailureRates(): Promise<AlertCondition[]> {
    const alerts: AlertCondition[] = [];
    const globalSummary = await providerMetrics.getGlobalSummary("1h");

    if (globalSummary.totalRequests < 10) return alerts;

    if (globalSummary.overallSuccessRate < 0.7) {
      const alertKey = "global_failure_rate";
      if (shouldAlert(alertKey)) {
        alerts.push({
          alertType: "high_failure_rate",
          severity: "CRITICAL",
          title: `System-wide failure rate is high: ${Math.round((1 - globalSummary.overallSuccessRate) * 100)}%`,
          description: `Overall success rate across all providers is ${Math.round(globalSummary.overallSuccessRate * 100)}% in the last hour. ${globalSummary.totalRequests} total requests.`,
          metadata: {
            overallSuccessRate: globalSummary.overallSuccessRate,
            totalRequests: globalSummary.totalRequests,
            totalProviders: globalSummary.totalProviders,
          },
        });
      }
    }

    return alerts;
  }

  /**
   * Persist an alert and publish it on the event bus.
   */
  private async createAlert(condition: AlertCondition): Promise<{ id: string } | null> {
    try {
      const alert = await db.alertEvent.create({
        data: {
          alertType: condition.alertType,
          severity: condition.severity,
          title: condition.title,
          description: condition.description,
          providerName: condition.providerName ?? null,
          transactionId: condition.transactionId ?? null,
          metadata: condition.metadata ? JSON.stringify(condition.metadata) : null,
          status: "ACTIVE",
        },
      });

      // Publish to event bus for real-time subscribers
      await eventBus.publish("provider.unavailable", {
        providerId: condition.providerName ?? "system",
        operation: condition.alertType,
        error: condition.description,
      }).catch(() => {}); // Don't fail on event bus errors

      return { id: alert.id };
    } catch (error) {
      logger.error("alerting.create_alert_error", {
        alertType: condition.alertType,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Acknowledge an alert.
   */
  async acknowledge(alertId: string, actorId: string): Promise<void> {
    await db.alertEvent.update({
      where: { id: alertId },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedBy: actorId,
        acknowledgedAt: new Date(),
      },
    });
  }

  /**
   * Resolve an alert.
   */
  async resolve(alertId: string, actorId: string): Promise<void> {
    await db.alertEvent.update({
      where: { id: alertId },
      data: {
        status: "RESOLVED",
        resolvedBy: actorId,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Dismiss an alert.
   */
  async dismiss(alertId: string, actorId: string): Promise<void> {
    await db.alertEvent.update({
      where: { id: alertId },
      data: {
        status: "DISMISSED",
        resolvedBy: actorId,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Get active alerts for the dashboard.
   */
  async getActiveAlerts(limit = 50): Promise<Array<{
    id: string;
    alertType: string;
    severity: AlertSeverity;
    title: string;
    description: string;
    providerName: string | null;
    status: AlertStatus;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
  }>> {
    const alerts = await db.alertEvent.findMany({
      where: { status: { in: ["ACTIVE", "ACKNOWLEDGED"] } },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: limit,
    });

    return alerts.map((a) => ({
      id: a.id,
      alertType: a.alertType,
      severity: a.severity as AlertSeverity,
      title: a.title,
      description: a.description,
      providerName: a.providerName,
      status: a.status as AlertStatus,
      metadata: a.metadata ? JSON.parse(a.metadata) : null,
      createdAt: a.createdAt,
    }));
  }

  /**
   * Get alert summary for the dashboard.
   */
  async getSummary(): Promise<{
    active: number;
    acknowledged: number;
    critical: number;
    warning: number;
    info: number;
    last24h: number;
  }> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [active, acknowledged, critical, warning, info, last24h] = await Promise.all([
      db.alertEvent.count({ where: { status: "ACTIVE" } }),
      db.alertEvent.count({ where: { status: "ACKNOWLEDGED" } }),
      db.alertEvent.count({ where: { status: "ACTIVE", severity: "CRITICAL" } }),
      db.alertEvent.count({ where: { status: "ACTIVE", severity: "WARNING" } }),
      db.alertEvent.count({ where: { status: "ACTIVE", severity: "INFO" } }),
      db.alertEvent.count({ where: { createdAt: { gte: since24h } } }),
    ]);

    return { active, acknowledged, critical, warning, info, last24h };
  }
}

export const alertingService = new AlertingService();
