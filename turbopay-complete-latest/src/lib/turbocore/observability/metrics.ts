/**
 * TurboCore — Observability Metrics
 * ==================================
 *
 * In-memory metrics collector for production monitoring.
 * Tracks key operational metrics without external dependencies.
 *
 * Metrics collected:
 *   - Request latency (per endpoint)
 *   - Error rates (per endpoint, per provider)
 *   - Provider latency and success rates
 *   - Queue depth (async tasks, settlements)
 *   - Wallet balance drift
 *   - Active sessions
 *   - Rate limit triggers
 *
 * The metrics endpoint exposes these for Prometheus/Grafana scraping.
 * For now, they're served as JSON from /api/admin/metrics.
 */

// ─── Metric Types ─────────────────────────────────────────────

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  values: number[];
  labels: Record<string, string>;
}

interface Gauge {
  value: number;
  labels: Record<string, string>;
}

// ─── Metrics Collector ────────────────────────────────────────

class MetricsCollectorImpl {
  private counters = new Map<string, Counter[]>();
  private histograms = new Map<string, Histogram[]>();
  private gauges = new Map<string, Gauge[]>();

  // ── Counters ──────────────────────────────────────────────

  /**
   * Increment a counter.
   */
  inc(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = this.key(name, labels);
    const existing = this.counters.get(key);
    if (existing && existing.length > 0) {
      existing[0].value += value;
    } else {
      if (!this.counters.has(name)) this.counters.set(name, []);
      this.counters.get(name)!.push({ value, labels });
    }
  }

  // ── Histograms ────────────────────────────────────────────

  /**
   * Record a value in a histogram (for latency tracking).
   */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    const existing = this.histograms.get(key);
    if (existing && existing.length > 0) {
      existing[0].values.push(value);
      // Keep only last 1000 values to prevent memory growth.
      if (existing[0].values.length > 1000) {
        existing[0].values = existing[0].values.slice(-1000);
      }
    } else {
      if (!this.histograms.has(name)) this.histograms.set(name, []);
      this.histograms.get(name)!.push({ values: [value], labels });
    }
  }

  // ── Gauges ────────────────────────────────────────────────

  /**
   * Set a gauge value (for current-state metrics).
   */
  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    const existing = this.gauges.get(key);
    if (existing && existing.length > 0) {
      existing[0].value = value;
    } else {
      if (!this.gauges.has(name)) this.gauges.set(name, []);
      this.gauges.get(name)!.push({ value, labels });
    }
  }

  // ── Query ─────────────────────────────────────────────────

  /**
   * Get all metrics in a format suitable for JSON export.
   */
  snapshot(): {
    counters: Array<{ name: string; value: number; labels: Record<string, string> }>;
    histograms: Array<{
      name: string;
      labels: Record<string, string>;
      count: number;
      sum: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    }>;
    gauges: Array<{ name: string; value: number; labels: Record<string, string> }>;
  } {
    const counters: Array<{ name: string; value: number; labels: Record<string, string> }> = [];
    for (const [name, entries] of this.counters) {
      for (const entry of entries) {
        counters.push({ name, value: entry.value, labels: entry.labels });
      }
    }

    const histograms: Array<{
      name: string;
      labels: Record<string, string>;
      count: number;
      sum: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    }> = [];
    for (const [name, entries] of this.histograms) {
      for (const entry of entries) {
        const sorted = [...entry.values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        histograms.push({
          name,
          labels: entry.labels,
          count: sorted.length,
          sum,
          avg: sorted.length > 0 ? Math.round(sum / sorted.length) : 0,
          p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
          p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
          p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
        });
      }
    }

    const gauges: Array<{ name: string; value: number; labels: Record<string, string> }> = [];
    for (const [name, entries] of this.gauges) {
      for (const entry of entries) {
        gauges.push({ name, value: entry.value, labels: entry.labels });
      }
    }

    return { counters, histograms, gauges };
  }

  /**
   * Record a request metric (convenience method).
   */
  recordRequest(endpoint: string, method: string, statusCode: number, latencyMs: number): void {
    this.inc("http_requests_total", { endpoint, method, status: String(statusCode) });
    this.observe("http_request_duration_ms", latencyMs, { endpoint, method });

    if (statusCode >= 400) {
      this.inc("http_errors_total", { endpoint, method, status: String(statusCode) });
    }
  }

  /**
   * Record a provider call metric.
   */
  recordProviderCall(provider: string, operation: string, success: boolean, latencyMs: number): void {
    this.inc("provider_calls_total", { provider, operation, success: String(success) });
    this.observe("provider_latency_ms", latencyMs, { provider, operation });

    if (!success) {
      this.inc("provider_errors_total", { provider, operation });
    }
  }

  // ── Private ───────────────────────────────────────────────

  private key(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}=${v}`).join(",");
    return `${name}{${labelStr}}`;
  }
}

/** Singleton metrics collector. */
export const metrics = new MetricsCollectorImpl();
