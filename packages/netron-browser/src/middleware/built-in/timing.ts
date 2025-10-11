/**
 * Performance Timing Middleware
 *
 * Measures and reports performance metrics for RPC calls
 */

import type { MiddlewareFunction } from '../types.js';

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  service: string;
  method: string;
  transport: 'http' | 'websocket';
  duration: number;
  timestamp: number;
}

/**
 * Metrics collector interface
 */
export interface MetricsCollector {
  /**
   * Record performance metrics
   */
  record(metrics: PerformanceMetrics): void;
}

/**
 * In-memory metrics collector
 */
export class InMemoryMetricsCollector implements MetricsCollector {
  private metrics: PerformanceMetrics[] = [];
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  record(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics);

    // Keep only the last maxSize entries
    if (this.metrics.length > this.maxSize) {
      this.metrics.shift();
    }
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get average duration for a service/method
   */
  getAverageDuration(service?: string, method?: string): number {
    const filtered = this.metrics.filter(
      (m) =>
        (!service || m.service === service) && (!method || m.method === method)
    );

    if (filtered.length === 0) return 0;

    const total = filtered.reduce((sum, m) => sum + m.duration, 0);
    return total / filtered.length;
  }

  /**
   * Get slowest calls
   */
  getSlowestCalls(limit: number = 10): PerformanceMetrics[] {
    return [...this.metrics].sort((a, b) => b.duration - a.duration).slice(0, limit);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

/**
 * Timing middleware options
 */
export interface TimingMiddlewareOptions {
  /**
   * Metrics collector
   */
  collector?: MetricsCollector;

  /**
   * Callback for each measurement
   */
  onMeasure?: (metrics: PerformanceMetrics) => void;

  /**
   * Threshold in ms for slow request warning
   */
  slowThreshold?: number;

  /**
   * Callback for slow requests
   */
  onSlowRequest?: (metrics: PerformanceMetrics) => void;

  /**
   * Skip timing for specific services
   */
  skipServices?: string[];

  /**
   * Skip timing for specific methods
   */
  skipMethods?: string[];
}

/**
 * Create timing middleware
 */
export function createTimingMiddleware(
  options: TimingMiddlewareOptions = {}
): MiddlewareFunction {
  const {
    collector,
    onMeasure,
    slowThreshold,
    onSlowRequest,
    skipServices = [],
    skipMethods = [],
  } = options;

  return async (ctx, next) => {
    // Skip if service or method is in skip list
    if (
      skipServices.includes(ctx.service) ||
      skipMethods.includes(`${ctx.service}.${ctx.method}`)
    ) {
      return next();
    }

    const startTime = performance.now();
    const startMark = `netron-${ctx.service}-${ctx.method}-start`;
    const endMark = `netron-${ctx.service}-${ctx.method}-end`;
    const measureName = `netron-${ctx.service}-${ctx.method}`;

    // Use Performance API if available
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(startMark);
    }

    try {
      await next();
    } finally {
      const duration = performance.now() - startTime;

      // Create performance mark
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(endMark);
        try {
          performance.measure(measureName, startMark, endMark);
        } catch {
          // Ignore measurement errors
        }
      }

      // Store timing in context
      ctx.timing.end = performance.now();

      // Create metrics object
      const metrics: PerformanceMetrics = {
        service: ctx.service,
        method: ctx.method,
        transport: ctx.transport,
        duration,
        timestamp: Date.now(),
      };

      // Store in metadata
      ctx.metadata.set('timing:duration', duration);
      ctx.metadata.set('timing:metrics', metrics);

      // Record metrics
      if (collector) {
        collector.record(metrics);
      }

      // Call measurement callback
      if (onMeasure) {
        onMeasure(metrics);
      }

      // Check for slow requests
      if (slowThreshold && duration > slowThreshold) {
        if (onSlowRequest) {
          onSlowRequest(metrics);
        } else {
          console.warn(
            `[Netron] Slow request detected: ${ctx.service}.${ctx.method} took ${duration.toFixed(2)}ms`
          );
        }
      }
    }
  };
}

/**
 * Create performance observer for Netron RPC calls
 */
export function createPerformanceObserver(
  callback: (entries: PerformanceEntry[]) => void
): PerformanceObserver | null {
  if (
    typeof PerformanceObserver === 'undefined' ||
    typeof performance === 'undefined'
  ) {
    return null;
  }

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list
        .getEntries()
        .filter((entry) => entry.name.startsWith('netron-'));
      if (entries.length > 0) {
        callback(entries);
      }
    });

    observer.observe({ entryTypes: ['measure'] });
    return observer;
  } catch {
    return null;
  }
}
