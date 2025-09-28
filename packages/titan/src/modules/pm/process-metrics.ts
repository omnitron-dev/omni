/**
 * Process Metrics Collector
 *
 * Collects and aggregates metrics from running processes
 */

import type { ILogger } from '../logger/logger.types.js';
import type { IProcessMetrics, ServiceProxy, ILatencyMetrics } from './types.js';

/**
 * Metrics collector for processes
 */
export class ProcessMetricsCollector {
  private collectors = new Map<string, NodeJS.Timeout>();
  private metricsHistory = new Map<string, IProcessMetrics[]>();
  private latencyTracking = new Map<string, number[]>();

  constructor(private readonly logger: ILogger) {}

  /**
   * Start collecting metrics for a process
   */
  startCollection(
    processId: string,
    proxy: ServiceProxy<any>,
    interval: number = 5000
  ): void {
    if (this.collectors.has(processId)) {
      return; // Already collecting
    }

    this.logger.debug({ processId }, 'Starting metrics collection');

    // Initialize history
    this.metricsHistory.set(processId, []);
    this.latencyTracking.set(processId, []);

    // Setup collection interval
    const collector = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics(proxy);
        this.storeMetrics(processId, metrics);
      } catch (error) {
        this.logger.error(
          { error, processId },
          'Failed to collect metrics'
        );
      }
    }, interval);

    this.collectors.set(processId, collector);
  }

  /**
   * Stop collecting metrics for a process
   */
  stopCollection(processId: string): void {
    const collector = this.collectors.get(processId);
    if (collector) {
      clearInterval(collector);
      this.collectors.delete(processId);
      this.metricsHistory.delete(processId);
      this.latencyTracking.delete(processId);

      this.logger.debug({ processId }, 'Stopped metrics collection');
    }
  }

  /**
   * Get current metrics for a process
   */
  getMetrics(processId: string): IProcessMetrics | null {
    const history = this.metricsHistory.get(processId);
    if (!history || history.length === 0) {
      return null;
    }

    return history[history.length - 1] || null;
  }

  /**
   * Get metrics history for a process
   */
  getMetricsHistory(processId: string): IProcessMetrics[] {
    return this.metricsHistory.get(processId) || [];
  }

  /**
   * Get aggregated metrics for a process
   */
  getAggregatedMetrics(
    processId: string,
    windowSize: number = 60000
  ): IProcessMetrics | null {
    const history = this.metricsHistory.get(processId);
    if (!history || history.length === 0) {
      return null;
    }

    const now = Date.now();
    const recentMetrics = history.filter(
      m => (m as any).timestamp && now - (m as any).timestamp < windowSize
    );

    if (recentMetrics.length === 0) {
      return null;
    }

    return this.aggregateMetrics(recentMetrics);
  }

  /**
   * Track latency for a method call
   */
  trackLatency(processId: string, duration: number): void {
    const latencies = this.latencyTracking.get(processId) || [];
    latencies.push(duration);

    // Keep only last 1000 measurements
    if (latencies.length > 1000) {
      latencies.shift();
    }

    this.latencyTracking.set(processId, latencies);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Collect metrics from a process
   */
  private async collectMetrics(proxy: ServiceProxy<any>): Promise<IProcessMetrics> {
    try {
      // Try to get metrics from the process itself
      if ('__getMetrics' in proxy) {
        return await proxy.__getMetrics();
      }

      // Fallback to basic metrics
      return {
        cpu: 0,
        memory: 0,
        requests: 0,
        errors: 0
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect process metrics');

      return {
        cpu: 0,
        memory: 0,
        requests: 0,
        errors: 1
      };
    }
  }

  /**
   * Store metrics in history
   */
  private storeMetrics(processId: string, metrics: IProcessMetrics): void {
    const history = this.metricsHistory.get(processId) || [];

    // Add timestamp
    const timestampedMetrics = {
      ...metrics,
      timestamp: Date.now()
    };

    history.push(timestampedMetrics as IProcessMetrics);

    // Keep only last 1000 entries
    if (history.length > 1000) {
      history.shift();
    }

    this.metricsHistory.set(processId, history);

    // Calculate latency metrics
    const latencies = this.latencyTracking.get(processId);
    if (latencies && latencies.length > 0) {
      metrics.latency = this.calculateLatencyMetrics(latencies);
    }
  }

  /**
   * Calculate latency metrics from measurements
   */
  private calculateLatencyMetrics(latencies: number[]): ILatencyMetrics {
    const sorted = [...latencies].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      p50: this.percentile(sorted, 50),
      p75: this.percentile(sorted, 75),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      mean: sorted.reduce((a, b) => a + b, 0) / len
    };
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;

    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  /**
   * Aggregate multiple metrics
   */
  private aggregateMetrics(metrics: IProcessMetrics[]): IProcessMetrics {
    if (metrics.length === 0) {
      return {
        cpu: 0,
        memory: 0,
        requests: 0,
        errors: 0
      };
    }

    const sum = metrics.reduce((acc, m) => ({
      cpu: acc.cpu + m.cpu,
      memory: acc.memory + m.memory,
      requests: (acc.requests ?? 0) + (m.requests ?? 0),
      errors: (acc.errors ?? 0) + (m.errors ?? 0)
    }), {
      cpu: 0,
      memory: 0,
      requests: 0,
      errors: 0
    });

    const count = metrics.length;

    // Aggregate latency metrics if present
    let latency: ILatencyMetrics | undefined;
    const latencyMetrics = metrics.filter(m => m.latency).map(m => m.latency!);

    if (latencyMetrics.length > 0) {
      latency = {
        p50: this.average(latencyMetrics.map(l => l.p50)),
        p75: this.average(latencyMetrics.map(l => l.p75)),
        p90: this.average(latencyMetrics.map(l => l.p90)),
        p95: this.average(latencyMetrics.map(l => l.p95)),
        p99: this.average(latencyMetrics.map(l => l.p99)),
        mean: this.average(latencyMetrics.map(l => l.mean))
      };
    }

    return {
      cpu: sum.cpu / count,
      memory: sum.memory / count,
      requests: sum.requests,
      errors: sum.errors,
      latency
    };
  }

  /**
   * Calculate average
   */
  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }
}