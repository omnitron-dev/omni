/**
 * Performance metrics collection and analysis
 */

import type { Flow } from '@holon/flow';
import type { FlowMetrics, ExecutionTrace } from '../types.js';

/**
 * Metrics collector for flow execution
 */
export class MetricsCollector {
  private readonly metrics: Map<string, FlowMetrics> = new Map();
  private readonly durations: Map<string, number[]> = new Map();

  /**
   * Record execution metrics
   */
  record(
    flowId: string,
    flowName: string,
    duration: number,
    success: boolean
  ): void {
    let metrics = this.metrics.get(flowId);

    if (!metrics) {
      metrics = {
        flowId,
        flowName,
        executions: 0,
        successCount: 0,
        errorCount: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        lastExecution: 0,
        resourceUsage: {
          cpu: 0,
          memory: 0,
          uptime: 0,
          timestamp: Date.now(),
        },
      };
      this.metrics.set(flowId, metrics);
      this.durations.set(flowId, []);
    }

    // Update metrics
    metrics.executions++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
    }

    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
    metrics.lastExecution = Date.now();

    // Store duration for percentile calculation
    const durations = this.durations.get(flowId)!;
    durations.push(duration);

    // Keep only last 1000 durations
    if (durations.length > 1000) {
      durations.shift();
    }

    // Calculate average
    metrics.avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;

    // Calculate percentiles
    const sorted = [...durations].sort((a, b) => a - b);
    metrics.p50Duration = this.calculatePercentile(sorted, 0.5);
    metrics.p95Duration = this.calculatePercentile(sorted, 0.95);
    metrics.p99Duration = this.calculatePercentile(sorted, 0.99);
  }

  /**
   * Get metrics for a flow
   */
  getMetrics(flowId: string): FlowMetrics | undefined {
    return this.metrics.get(flowId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): FlowMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics.clear();
    this.durations.clear();
  }

  /**
   * Export metrics
   */
  export(): string {
    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        metrics: this.getAllMetrics(),
      },
      null,
      2
    );
  }
}

/**
 * Analyze execution trace
 */
export function analyzeTrace(trace: ExecutionTrace): TraceAnalysis {
  const totalDuration = trace.duration;
  const spanDurations = trace.spans.map((s) => s.duration);

  return {
    totalDuration,
    spanCount: trace.spans.length,
    avgSpanDuration: spanDurations.reduce((sum, d) => sum + d, 0) / spanDurations.length,
    longestSpan: Math.max(...spanDurations, 0),
    shortestSpan: Math.min(...spanDurations, Infinity),
    spans: trace.spans.map((span) => ({
      name: span.name,
      duration: span.duration,
      percentage: (span.duration / totalDuration) * 100,
    })),
  };
}

export interface TraceAnalysis {
  totalDuration: number;
  spanCount: number;
  avgSpanDuration: number;
  longestSpan: number;
  shortestSpan: number;
  spans: Array<{
    name: string;
    duration: number;
    percentage: number;
  }>;
}

/**
 * Generate performance report
 */
export function generatePerformanceReport(metrics: FlowMetrics[]): string {
  const lines: string[] = ['# Performance Report', ''];

  for (const metric of metrics) {
    lines.push(`## ${metric.flowName}`);
    lines.push('');
    lines.push(`- **Executions**: ${metric.executions}`);
    lines.push(`- **Success Rate**: ${((metric.successCount / metric.executions) * 100).toFixed(2)}%`);
    lines.push(`- **Avg Duration**: ${metric.avgDuration.toFixed(2)}ms`);
    lines.push(`- **P50 Duration**: ${metric.p50Duration.toFixed(2)}ms`);
    lines.push(`- **P95 Duration**: ${metric.p95Duration.toFixed(2)}ms`);
    lines.push(`- **P99 Duration**: ${metric.p99Duration.toFixed(2)}ms`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create a metrics collector singleton
 */
export const metricsCollector = new MetricsCollector();
