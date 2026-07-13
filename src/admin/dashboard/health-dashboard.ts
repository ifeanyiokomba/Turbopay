// TurboPay Health Dashboard
// Live provider health monitoring with circuit breaker visualization
// Displays real-time health metrics for all registered providers

import {
  ProviderName,
  ProviderAdapter
} from '../../types';
import { ProviderSelectionEngine, ProviderHealthData } from '../../services/provider-selection-engine';
import { ProviderRegistry } from '../../services/provider-wrapper';

// =============================================================================
// TYPES
// =============================================================================

export interface ProviderHealthStatus {
  provider: ProviderName;
  display_name: string;
  is_healthy: boolean;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  latency_ms: number;
  latency_status: 'excellent' | 'good' | 'poor' | 'critical';
  success_rate: number;
  success_rate_status: 'excellent' | 'good' | 'poor' | 'critical';
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  last_success: Date | null;
  last_failure: Date | null;
  last_health_check: Date | null;
  circuit_breaker: CircuitBreakerStatus;
  api_key_status: ApiKeyStatus;
  version: string;
  uptime_percentage: number;
  avg_latency_24h: number;
  requests_per_minute: number;
}

export interface CircuitBreakerStatus {
  state: 'closed' | 'open' | 'half_open';
  opened_at: Date | null;
  failure_count: number;
  cooldown_remaining_ms: number;
}

export interface ApiKeyStatus {
  is_valid: boolean;
  last_validated: Date | null;
  expires_at: Date | null;
}

export interface WebhookHealthStatus {
  provider: ProviderName;
  total_received: number;
  successful: number;
  failed: number;
  avg_processing_time_ms: number;
  last_received_at: Date | null;
  last_error: string | null;
}

export interface HealthDashboardSummary {
  total_providers: number;
  healthy_providers: number;
  degraded_providers: number;
  down_providers: number;
  avg_success_rate: number;
  avg_latency_ms: number;
  total_requests_24h: number;
  last_updated: Date;
}

// =============================================================================
// HEALTH DASHBOARD
// =============================================================================

export class HealthDashboard {
  private selectionEngine: ProviderSelectionEngine;
  private registry: ProviderRegistry;
  private webhookHealth: Map<ProviderName, WebhookHealthStatus> = new Map();
  private lastHealthChecks: Map<ProviderName, Date> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(selectionEngine: ProviderSelectionEngine, registry: ProviderRegistry) {
    this.selectionEngine = selectionEngine;
    this.registry = registry;
  }

  // ===========================================================================
  // HEALTH CHECK
  // ===========================================================================

  async runHealthCheck(): Promise<ProviderHealthStatus[]> {
    const providers = this.registry.getAll();
    const results: ProviderHealthStatus[] = [];

    for (const wrapper of providers) {
      try {
        const startTime = Date.now();
        const healthResult = await wrapper.healthCheck();
        const latency = Date.now() - startTime;

        // Record in selection engine
        if (healthResult.is_healthy) {
          this.selectionEngine.recordSuccess(wrapper.name, latency);
        } else {
          this.selectionEngine.recordFailure(wrapper.name);
        }

        this.lastHealthChecks.set(wrapper.name, new Date());

        results.push(this.buildProviderStatus(wrapper.name, wrapper.displayName, latency));
      } catch (error) {
        this.selectionEngine.recordFailure(wrapper.name);
        this.lastHealthChecks.set(wrapper.name, new Date());

        results.push(this.buildProviderStatus(wrapper.name, wrapper.displayName, -1));
      }
    }

    return results;
  }

  startPeriodicHealthChecks(intervalMs: number = 60000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.runHealthCheck();
    }, intervalMs);

    // Run immediately
    this.runHealthCheck();
  }

  stopPeriodicHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // ===========================================================================
  // STATUS QUERIES
  // ===========================================================================

  getProviderStatus(provider: ProviderName): ProviderHealthStatus | null {
    const wrapper = this.registry.get(provider);
    if (!wrapper) return null;

    return this.buildProviderStatus(provider, wrapper.displayName);
  }

  getAllProviderStatuses(): ProviderHealthStatus[] {
    const providers = this.registry.getAll();
    return providers.map(wrapper =>
      this.buildProviderStatus(wrapper.name, wrapper.displayName)
    );
  }

  getSummary(): HealthDashboardSummary {
    const statuses = this.getAllProviderStatuses();

    const healthy = statuses.filter(s => s.status === 'healthy').length;
    const degraded = statuses.filter(s => s.status === 'degraded').length;
    const down = statuses.filter(s => s.status === 'down').length;

    const avgSuccessRate = statuses.length > 0
      ? statuses.reduce((sum, s) => sum + s.success_rate, 0) / statuses.length
      : 0;

    const avgLatency = statuses.length > 0
      ? statuses.filter(s => s.latency_ms > 0).reduce((sum, s) => sum + s.latency_ms, 0) /
        Math.max(statuses.filter(s => s.latency_ms > 0).length, 1)
      : 0;

    return {
      total_providers: statuses.length,
      healthy_providers: healthy,
      degraded_providers: degraded,
      down_providers: down,
      avg_success_rate: Math.round(avgSuccessRate * 100) / 100,
      avg_latency_ms: Math.round(avgLatency),
      total_requests_24h: statuses.reduce((sum, s) => sum + s.total_requests, 0),
      last_updated: new Date()
    };
  }

  // ===========================================================================
  // WEBHOOK HEALTH
  // ===========================================================================

  recordWebhookReceived(provider: ProviderName, success: boolean, processingTimeMs: number, error?: string): void {
    const current = this.webhookHealth.get(provider) || {
      provider,
      total_received: 0,
      successful: 0,
      failed: 0,
      avg_processing_time_ms: 0,
      last_received_at: null,
      last_error: null
    };

    current.total_received++;
    if (success) {
      current.successful++;
    } else {
      current.failed++;
      current.last_error = error || 'Unknown error';
    }

    // Update average processing time
    current.avg_processing_time_ms =
      (current.avg_processing_time_ms * (current.total_received - 1) + processingTimeMs) /
      current.total_received;

    current.last_received_at = new Date();
    this.webhookHealth.set(provider, current);
  }

  getWebhookHealth(provider: ProviderName): WebhookHealthStatus | undefined {
    return this.webhookHealth.get(provider);
  }

  getAllWebhookHealth(): WebhookHealthStatus[] {
    return Array.from(this.webhookHealth.values());
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private buildProviderStatus(
    provider: ProviderName,
    displayName: string,
    currentLatency?: number
  ): ProviderHealthStatus {
    const healthData = this.selectionEngine.getHealthData(provider);
    const wrapper = this.registry.get(provider);

    const isHealthy = healthData?.is_healthy ?? true;
    const circuitBreakerOpen = healthData?.circuit_breaker_open ?? false;

    const totalRequests = (healthData?.success_count ?? 0) + (healthData?.failure_count ?? 0);
    const successRate = totalRequests > 0 ? (healthData?.success_count ?? 0) / totalRequests : 1;
    const latency = currentLatency ?? healthData?.average_latency ?? 0;

    // Determine status
    let status: 'healthy' | 'degraded' | 'down' | 'unknown' = 'unknown';
    if (circuitBreakerOpen) {
      status = 'down';
    } else if (isHealthy && successRate >= 0.95) {
      status = 'healthy';
    } else if (isHealthy && successRate >= 0.8) {
      status = 'degraded';
    } else if (!isHealthy) {
      status = 'down';
    }

    // Determine latency status
    let latencyStatus: 'excellent' | 'good' | 'poor' | 'critical' = 'unknown' as any;
    if (latency <= 500) latencyStatus = 'excellent';
    else if (latency <= 1000) latencyStatus = 'good';
    else if (latency <= 3000) latencyStatus = 'poor';
    else latencyStatus = 'critical';

    // Determine success rate status
    let successRateStatus: 'excellent' | 'good' | 'poor' | 'critical' = 'unknown' as any;
    if (successRate >= 0.99) successRateStatus = 'excellent';
    else if (successRate >= 0.95) successRateStatus = 'good';
    else if (successRate >= 0.8) successRateStatus = 'poor';
    else successRateStatus = 'critical';

    // Circuit breaker
    const cooldownRemaining = circuitBreakerOpen && healthData?.circuit_breaker_opened_at
      ? Math.max(0, 300000 - (Date.now() - healthData.circuit_breaker_opened_at.getTime()))
      : 0;

    const circuitBreakerState: CircuitBreakerStatus = {
      state: circuitBreakerOpen ? 'open' : 'closed',
      opened_at: healthData?.circuit_breaker_opened_at ?? null,
      failure_count: healthData?.failure_count ?? 0,
      cooldown_remaining_ms: cooldownRemaining
    };

    // Uptime calculation
    const uptimePercentage = totalRequests > 0 ? (healthData?.success_count ?? 0) / totalRequests * 100 : 100;

    return {
      provider,
      display_name: displayName,
      is_healthy: isHealthy,
      status,
      latency_ms: Math.round(latency),
      latency_status: latencyStatus,
      success_rate: Math.round(successRate * 100) / 100,
      success_rate_status: successRateStatus,
      total_requests: totalRequests,
      successful_requests: healthData?.success_count ?? 0,
      failed_requests: healthData?.failure_count ?? 0,
      last_success: healthData?.last_success ?? null,
      last_failure: healthData?.last_failure ?? null,
      last_health_check: this.lastHealthChecks.get(provider) ?? null,
      circuit_breaker: circuitBreakerState,
      api_key_status: {
        is_valid: isHealthy,
        last_validated: this.lastHealthChecks.get(provider) ?? null,
        expires_at: null
      },
      version: wrapper?.baseUrl || 'unknown',
      uptime_percentage: Math.round(uptimePercentage * 100) / 100,
      avg_latency_24h: Math.round(healthData?.average_latency ?? 0),
      requests_per_minute: this.calculateRequestsPerMinute(healthData)
    };
  }

  private calculateRequestsPerMinute(healthData: ProviderHealthData | undefined): number {
    if (!healthData) return 0;

    const total = healthData.success_count + healthData.failure_count;
    if (total === 0) return 0;

    // Estimate based on recent activity
    const lastActivity = healthData.last_success || healthData.last_failure;
    if (!lastActivity) return 0;

    const minutesSinceLastActivity = (Date.now() - lastActivity.getTime()) / 60000;
    if (minutesSinceLastActivity === 0) return total;

    return Math.round(total / Math.max(minutesSinceLastActivity, 1));
  }
}

export default HealthDashboard;
