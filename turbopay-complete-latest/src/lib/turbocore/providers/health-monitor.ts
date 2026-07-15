/**
 * TurboCore — Provider Health Monitor
 * ====================================
 *
 * Dedicated service for continuously monitoring provider health.
 * Runs periodic health checks, tracks response times, detects
 * outages, and triggers alerts when providers degrade.
 *
 * Architecture:
 *   - Runs as a background task (called by cron or on-demand)
 *   - Stores results in ProviderHealthCheck table
 *   - Updates ProviderConfig health status
 *   - Triggers circuit breaker state changes
 *   - Publishes events for alerting
 *
 * Health check strategy:
 *   1. Check every provider every N minutes (configurable)
 *   2. Record latency and status
 *   3. Update rolling averages on ProviderConfig
 *   4. Detect consecutive failures → trip circuit breaker
 *   5. Detect recovery → reset circuit breaker
 */

import { db } from "@/lib/db";
import { pluginRegistry } from "@/lib/turbocore/providers/plugin";
import { getCircuitBreaker } from "@/lib/turbocore/providers/circuit-breaker";
import { eventBus } from "@/lib/turbocore/events/bus";
import { logger } from "@/lib/turbocore/logger";

// ─── Health Check Result ──────────────────────────────────────

export interface HealthCheckResult {
  providerConfigId: string;
  providerName: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number;
  error?: string;
  checkedAt: Date;
}

// ─── Health Monitor ───────────────────────────────────────────

class ProviderHealthMonitorImpl {
  private checkIntervalMs = 5 * 60 * 1000; // 5 minutes
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Start the periodic health check loop.
   * Called once at application startup.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runAllChecks(), this.checkIntervalMs);
    logger.info("health_monitor.started", { intervalSeconds: this.checkIntervalMs / 1000 });
  }

  /**
   * Stop the periodic health check loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run health checks for all enabled providers.
   * Called periodically by the timer, or on-demand by admin.
   */
  async runAllChecks(): Promise<HealthCheckResult[]> {
    if (this.running) return []; // Prevent concurrent runs
    this.running = true;

    try {
      const configs = await db.providerConfig.findMany({
        where: { enabled: true },
      });

      const results: HealthCheckResult[] = [];

      // Check all providers in parallel (bounded concurrency).
      const batchSize = 5;
      for (let i = 0; i < configs.length; i += batchSize) {
        const batch = configs.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map((config) => this.checkProvider(config.id, config.providerName))
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
          }
        }
      }

      logger.info("health_monitor.completed", { checksRun: results.length });
      return results;
    } finally {
      this.running = false;
    }
  }

  /**
   * Check a single provider's health.
   */
  async checkProvider(
    providerConfigId: string,
    providerName: string
  ): Promise<HealthCheckResult> {
    const plugin = pluginRegistry.get(providerName);
    const start = Date.now();
    let status: "ok" | "degraded" | "down" = "ok";
    let error: string | undefined;

    try {
      if (plugin) {
        // Use plugin's health check if available.
        const result = await plugin.healthCheck();
        if (!result.ok) {
          status = result.latencyMs > 3000 ? "down" : "degraded";
          error = result.error;
        } else if (result.latencyMs > 3000) {
          status = "degraded";
        }
      } else {
        // No plugin — check if the config exists and credentials are set.
        const config = await db.providerConfig.findUnique({
          where: { id: providerConfigId },
          select: { credentialsEnc: true, mode: true },
        });
        if (!config?.credentialsEnc && config?.mode === "production") {
          status = "down";
          error = "No credentials configured";
        }
      }
    } catch (e) {
      status = "down";
      error = e instanceof Error ? e.message : "Health check failed";
    }

    const latencyMs = Date.now() - start;

    // Persist the health check result.
    await db.providerHealthCheck.create({
      data: {
        providerConfigId,
        status,
        latencyMs,
        errorMessage: error ?? null,
        checkedAt: new Date(),
      },
    }).catch(() => null); // Don't fail on DB errors

    // Update the provider config's rolling health status.
    await this.updateProviderHealth(providerConfigId, providerName, status, latencyMs);

    // Handle circuit breaker transitions.
    await this.handleCircuitBreaker(providerConfigId, providerName, status);

    return {
      providerConfigId,
      providerName,
      status,
      latencyMs,
      error,
      checkedAt: new Date(),
    };
  }

  /**
   * Get the health dashboard data for the admin UI.
   */
  async getDashboard(): Promise<Array<{
    providerConfigId: string;
    providerName: string;
    contract: string;
    mode: string;
    lastCheckAt: Date | null;
    lastStatus: string | null;
    avgLatencyMs: number | null;
    errorRate: number;
    circuitBreaker: string;
  }>> {
    const configs = await db.providerConfig.findMany({
      where: { enabled: true },
      orderBy: [{ contract: "asc" }, { priority: "asc" }],
    });

    const dashboard = [];
    for (const config of configs) {
      // Get last 20 health checks.
      const checks = await db.providerHealthCheck.findMany({
        where: { providerConfigId: config.id },
        orderBy: { checkedAt: "desc" },
        take: 20,
      });

      const lastCheck = checks[0];
      const failures = checks.filter((c) => c.status !== "ok").length;
      const errorRate = checks.length > 0 ? failures / checks.length : 0;
      const avgLatency = checks.length > 0
        ? checks.reduce((sum, c) => sum + (c.latencyMs ?? 0), 0) / checks.length
        : null;

      const breaker = getCircuitBreaker(config.providerName);
      const isOpen = await breaker.isOpen();

      dashboard.push({
        providerConfigId: config.id,
        providerName: config.providerName,
        contract: config.contract,
        mode: config.mode,
        lastCheckAt: lastCheck?.checkedAt ?? null,
        lastStatus: lastCheck?.status ?? null,
        avgLatencyMs: avgLatency ? Math.round(avgLatency) : null,
        errorRate: Math.round(errorRate * 100) / 100,
        circuitBreaker: isOpen ? "OPEN" : "CLOSED",
      });
    }

    return dashboard;
  }

  // ── Private: Helpers ──────────────────────────────────────

  private async updateProviderHealth(
    providerConfigId: string,
    _providerName: string,
    status: string,
    latencyMs: number
  ): Promise<void> {
    await db.providerConfig.update({
      where: { id: providerConfigId },
      data: {
        lastHealthCheckAt: new Date(),
        lastHealthStatus: status,
        lastHealthLatencyMs: latencyMs,
      },
    }).catch(() => null);
  }

  private async handleCircuitBreaker(
    _providerConfigId: string,
    providerName: string,
    status: string
  ): Promise<void> {
    const breaker = getCircuitBreaker(providerName);

    if (status === "down") {
      // Record failure — may trip the breaker.
      try {
        await breaker.execute(() => Promise.reject(new Error("Health check failed")));
      } catch {
        // Expected: breaker trips after threshold
      }

      // Publish event for alerting.
      await eventBus.publish("provider.unavailable", {
        providerId: providerName,
        operation: "health_check",
        error: "Provider marked as down by health monitor",
      });
    } else if (status === "ok") {
      // Record success — may reset the breaker from HALF_OPEN.
      try {
        await breaker.execute(() => Promise.resolve());
      } catch {
        // Ignore
      }

      await eventBus.publish("provider.recovered", {
        providerId: providerName,
      });
    }
  }
}

/** Singleton health monitor. */
export const providerHealthMonitor = new ProviderHealthMonitorImpl();
