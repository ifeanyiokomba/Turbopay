// TurboPay Health Monitor
// Monitors provider health, latency, and success rates

import { ProviderName, ProviderHealth, CircuitBreaker, RouterConfig } from '../types';

// =============================================================================
// HEALTH MONITOR
// =============================================================================

export class HealthMonitor {
  private health: Map<ProviderName, ProviderHealth> = new Map();
  private circuitBreakers: Map<ProviderName, CircuitBreaker> = new Map();
  private config: RouterConfig;

  constructor(config: RouterConfig) {
    this.config = config;
  }

  /**
   * Check if provider is healthy
   */
  isHealthy(provider: ProviderName): boolean {
    const providerHealth = this.getOrCreateHealth(provider);
    const circuitBreaker = this.getCircuitBreaker(provider);

    // Check circuit breaker
    if (circuitBreaker.is_open) {
      const timeSinceOpen = Date.now() - (circuitBreaker.opened_at?.getTime() || 0);
      if (timeSinceOpen > this.config.circuit_breaker_timeout) {
        // Reset circuit breaker
        circuitBreaker.is_open = false;
        circuitBreaker.opened_at = null;
        circuitBreaker.failure_count = 0;
      } else {
        return false;
      }
    }

    // Check if too many recent failures
    const totalRequests = providerHealth.success_count + providerHealth.failure_count;
    if (totalRequests >= 10) {
      const failureRate = providerHealth.failure_count / totalRequests;
      if (failureRate > 0.5) {
        return false;
      }
    }

    // Check if last failure was too recent
    if (providerHealth.last_failure) {
      const timeSinceFailure = Date.now() - providerHealth.last_failure.getTime();
      if (timeSinceFailure < 60000 && providerHealth.failure_count > 3) {
        return false;
      }
    }

    return providerHealth.is_healthy;
  }

  /**
   * Record successful operation
   */
  recordSuccess(provider: ProviderName, latency?: number): void {
    const providerHealth = this.getOrCreateHealth(provider);
    providerHealth.success_count++;
    providerHealth.last_success = new Date();
    providerHealth.is_healthy = true;

    // Record latency if provided
    if (latency !== undefined) {
      this.recordLatency(provider, latency);
    }

    // Reset circuit breaker on success
    const circuitBreaker = this.getCircuitBreaker(provider);
    if (circuitBreaker.is_open) {
      circuitBreaker.is_open = false;
      circuitBreaker.opened_at = null;
      circuitBreaker.failure_count = 0;
    }
  }

  /**
   * Record failed operation
   */
  recordFailure(provider: ProviderName): void {
    const providerHealth = this.getOrCreateHealth(provider);
    providerHealth.failure_count++;
    providerHealth.last_failure = new Date();

    // Update health status based on failure rate
    const totalRequests = providerHealth.success_count + providerHealth.failure_count;
    if (totalRequests >= 5) {
      const failureRate = providerHealth.failure_count / totalRequests;
      if (failureRate > 0.5) {
        providerHealth.is_healthy = false;
      }
    }

    // Check circuit breaker threshold
    const circuitBreaker = this.getCircuitBreaker(provider);
    circuitBreaker.failure_count++;
    circuitBreaker.last_failure = new Date();

    if (circuitBreaker.failure_count >= this.config.circuit_breaker_threshold) {
      circuitBreaker.is_open = true;
      circuitBreaker.opened_at = new Date();
      providerHealth.is_healthy = false;
    }
  }

  /**
   * Record latency
   */
  recordLatency(provider: ProviderName, latency: number): void {
    const providerHealth = this.getOrCreateHealth(provider);
    providerHealth.recent_latencies.push(latency);

    // Keep only last 100 latencies
    if (providerHealth.recent_latencies.length > 100) {
      providerHealth.recent_latencies.shift();
    }

    // Recalculate average
    providerHealth.average_latency =
      providerHealth.recent_latencies.reduce((a, b) => a + b, 0) /
      providerHealth.recent_latencies.length;
  }

  /**
   * Get health score (0-1)
   */
  getHealthScore(provider: ProviderName): number {
    const providerHealth = this.getOrCreateHealth(provider);
    const totalRequests = providerHealth.success_count + providerHealth.failure_count;

    if (totalRequests === 0) return 1;

    const successRate = providerHealth.success_count / totalRequests;
    return Math.min(successRate * 1.2, 1); // Slight boost for high success rates
  }

  /**
   * Get latency score (0-1, lower latency = higher score)
   */
  getLatencyScore(provider: ProviderName): number {
    const providerHealth = this.getOrCreateHealth(provider);

    if (providerHealth.recent_latencies.length === 0) return 1;

    // Normalize: 0ms = 1.0, 5000ms = 0.0
    const score = 1 - (providerHealth.average_latency / 5000);
    return Math.max(0, Math.min(score, 1));
  }

  /**
   * Get success rate (0-1)
   */
  getSuccessRate(provider: ProviderName): number {
    const providerHealth = this.getOrCreateHealth(provider);
    const totalRequests = providerHealth.success_count + providerHealth.failure_count;

    if (totalRequests === 0) return 1;

    return providerHealth.success_count / totalRequests;
  }

  /**
   * Get provider health data
   */
  getHealth(provider: ProviderName): ProviderHealth {
    return this.getOrCreateHealth(provider);
  }

  /**
   * Reset provider health
   */
  resetHealth(provider: ProviderName): void {
    this.health.delete(provider);
    this.circuitBreakers.delete(provider);
  }

  /**
   * Get all provider health data
   */
  getAllHealth(): Map<ProviderName, ProviderHealth> {
    return this.health;
  }

  /**
   * Get or create health record
   */
  private getOrCreateHealth(provider: ProviderName): ProviderHealth {
    if (!this.health.has(provider)) {
      this.health.set(provider, {
        is_healthy: true,
        success_count: 0,
        failure_count: 0,
        last_success: null,
        last_failure: null,
        average_latency: 0,
        recent_latencies: [],
        last_health_check: new Date()
      });
    }
    return this.health.get(provider)!;
  }

  /**
   * Get or create circuit breaker
   */
  private getCircuitBreaker(provider: ProviderName): CircuitBreaker {
    if (!this.circuitBreakers.has(provider)) {
      this.circuitBreakers.set(provider, {
        is_open: false,
        opened_at: null,
        failure_count: 0,
        last_failure: null
      });
    }
    return this.circuitBreakers.get(provider)!;
  }
}

export default HealthMonitor;
