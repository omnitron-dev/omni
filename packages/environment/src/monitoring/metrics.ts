/**
 * Metrics Collection
 * Collects and aggregates operational metrics
 */

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

export interface MetricSnapshot {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
}

export class MetricsCollector {
  private metrics: Map<string, Metric>;
  private histograms: Map<string, number[]>;

  constructor() {
    this.metrics = new Map();
    this.histograms = new Map();
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const existing = this.metrics.get(key);

    if (existing && existing.type === 'counter') {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      this.metrics.set(key, {
        name,
        type: 'counter',
        value,
        timestamp: Date.now(),
        labels,
      });
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    this.metrics.set(key, {
      name,
      type: 'gauge',
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  /**
   * Observe a value for histogram
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);

    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }

    this.histograms.get(key)!.push(value);

    // Update metric with current stats
    const values = this.histograms.get(key)!;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;

    this.metrics.set(key, {
      name,
      type: 'histogram',
      value: avg,
      timestamp: Date.now(),
      labels,
    });
  }

  /**
   * Record a summary value
   */
  recordSummary(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const existing = this.metrics.get(key);

    if (existing && existing.type === 'summary') {
      // Simple moving average
      existing.value = (existing.value + value) / 2;
      existing.timestamp = Date.now();
    } else {
      this.metrics.set(key, {
        name,
        type: 'summary',
        value,
        timestamp: Date.now(),
        labels,
      });
    }
  }

  /**
   * Get a metric value
   */
  getMetric(name: string, labels?: Record<string, string>): Metric | undefined {
    const key = this.getKey(name, labels);
    return this.metrics.get(key);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Metric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get metrics snapshot
   */
  getSnapshot(): MetricSnapshot[] {
    return this.getAllMetrics().map((m) => ({
      name: m.name,
      type: m.type,
      value: m.value,
      labels: m.labels,
    }));
  }

  /**
   * Get metrics by name
   */
  getMetricsByName(name: string): Metric[] {
    return this.getAllMetrics().filter((m) => m.name === name);
  }

  /**
   * Get metrics by type
   */
  getMetricsByType(type: MetricType): Metric[] {
    return this.getAllMetrics().filter((m) => m.type === type);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.histograms.clear();
  }

  /**
   * Clear a specific metric
   */
  clearMetric(name: string, labels?: Record<string, string>): boolean {
    const key = this.getKey(name, labels);
    this.histograms.delete(key);
    return this.metrics.delete(key);
  }

  /**
   * Get histogram statistics
   */
  getHistogramStats(
    name: string,
    labels?: Record<string, string>
  ):
    | {
        count: number;
        sum: number;
        min: number;
        max: number;
        avg: number;
        p50: number;
        p95: number;
        p99: number;
      }
    | undefined {
    const key = this.getKey(name, labels);
    const values = this.histograms.get(key);

    if (!values || values.length === 0) {
      return undefined;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
    };
  }

  private getKey(name: string, labels?: Record<string, string>): string {
    if (!labels) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}
