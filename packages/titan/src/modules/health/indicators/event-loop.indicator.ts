/**
 * Event Loop Health Indicator
 *
 * Monitors event loop lag to detect performance issues.
 *
 * @module titan/modules/health/indicators
 */

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult, EventLoopThresholds } from '../health.types.js';

/**
 * Default event loop thresholds
 */
const DEFAULT_THRESHOLDS: Required<EventLoopThresholds> = {
  lagDegradedThreshold: 50,
  lagUnhealthyThreshold: 100,
};

/**
 * Event Loop Health Indicator
 *
 * Measures event loop lag to detect when the event loop is blocked
 * or running slowly due to CPU-intensive operations.
 *
 * @example
 * ```typescript
 * const eventLoopIndicator = new EventLoopHealthIndicator({
 *   lagDegradedThreshold: 50,  // 50ms lag triggers degraded
 *   lagUnhealthyThreshold: 100, // 100ms lag triggers unhealthy
 * });
 *
 * const result = await eventLoopIndicator.check();
 * // Returns health status based on event loop responsiveness
 * ```
 */
export class EventLoopHealthIndicator extends HealthIndicator {
  readonly name = 'event-loop';
  private thresholds: Required<EventLoopThresholds>;
  private lastCheckTime: number = 0;
  private measurementInterval: number = 50; // ms

  constructor(thresholds: EventLoopThresholds = {}) {
    super();
    this.thresholds = {
      lagDegradedThreshold: thresholds.lagDegradedThreshold ?? DEFAULT_THRESHOLDS.lagDegradedThreshold,
      lagUnhealthyThreshold: thresholds.lagUnhealthyThreshold ?? DEFAULT_THRESHOLDS.lagUnhealthyThreshold,
    };
  }

  /**
   * Perform the event loop health check
   */
  async check(): Promise<HealthIndicatorResult> {
    const checkStart = Date.now();
    const lag = await this.measureEventLoopLag();
    const latency = Date.now() - checkStart;

    const details = {
      lag: lag.toFixed(2) + 'ms',
      thresholds: {
        degraded: this.thresholds.lagDegradedThreshold + 'ms',
        unhealthy: this.thresholds.lagUnhealthyThreshold + 'ms',
      },
      measurementInterval: this.measurementInterval + 'ms',
    };

    if (lag >= this.thresholds.lagUnhealthyThreshold) {
      return {
        ...this.unhealthy(
          'Event loop lag (' + lag.toFixed(2) + 'ms) exceeds unhealthy threshold',
          details
        ),
        latency,
      };
    }

    if (lag >= this.thresholds.lagDegradedThreshold) {
      return {
        ...this.degraded(
          'Event loop lag (' + lag.toFixed(2) + 'ms) exceeds degraded threshold',
          details
        ),
        latency,
      };
    }

    return {
      ...this.healthy(
        'Event loop is responsive (lag: ' + lag.toFixed(2) + 'ms)',
        details
      ),
      latency,
    };
  }

  /**
   * Measure event loop lag
   *
   * This works by scheduling a timer and measuring how long it actually
   * takes to execute. The difference between expected and actual time
   * indicates event loop congestion.
   */
  private measureEventLoopLag(): Promise<number> {
    return new Promise((resolve) => {
      const start = Date.now();
      const expected = this.measurementInterval;

      setTimeout(() => {
        const actual = Date.now() - start;
        const lag = Math.max(0, actual - expected);
        resolve(lag);
      }, expected);
    });
  }

  /**
   * Get the current thresholds
   */
  getThresholds(): Required<EventLoopThresholds> {
    return { ...this.thresholds };
  }

  /**
   * Update the thresholds
   */
  setThresholds(thresholds: Partial<EventLoopThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
    };
  }

  /**
   * Set the measurement interval
   */
  setMeasurementInterval(interval: number): void {
    this.measurementInterval = Math.max(10, interval); // Minimum 10ms
  }

  /**
   * Get the measurement interval
   */
  getMeasurementInterval(): number {
    return this.measurementInterval;
  }
}

/**
 * High-resolution event loop monitor using perf_hooks
 *
 * Provides more accurate event loop lag measurements using Node.js
 * performance hooks when available.
 */
export class HighResEventLoopIndicator extends HealthIndicator {
  readonly name = 'event-loop-hr';
  private thresholds: Required<EventLoopThresholds>;
  private histogram: any = null;

  constructor(thresholds: EventLoopThresholds = {}) {
    super();
    this.thresholds = {
      lagDegradedThreshold: thresholds.lagDegradedThreshold ?? DEFAULT_THRESHOLDS.lagDegradedThreshold,
      lagUnhealthyThreshold: thresholds.lagUnhealthyThreshold ?? DEFAULT_THRESHOLDS.lagUnhealthyThreshold,
    };

    this.initHistogram();
  }

  /**
   * Initialize the event loop lag histogram
   */
  private initHistogram(): void {
    try {
      // Dynamic import to avoid issues on platforms without perf_hooks
      const { monitorEventLoopDelay } = require('perf_hooks');
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    } catch {
      // perf_hooks not available, will fall back to basic measurement
      this.histogram = null;
    }
  }

  /**
   * Perform the event loop health check
   */
  async check(): Promise<HealthIndicatorResult> {
    const checkStart = Date.now();

    if (!this.histogram) {
      // Fall back to basic measurement
      const fallbackIndicator = new EventLoopHealthIndicator(this.thresholds);
      return fallbackIndicator.check();
    }

    // Get histogram statistics
    const min = this.histogram.min / 1e6; // Convert nanoseconds to milliseconds
    const max = this.histogram.max / 1e6;
    const mean = this.histogram.mean / 1e6;
    const p50 = this.histogram.percentile(50) / 1e6;
    const p99 = this.histogram.percentile(99) / 1e6;

    const latency = Date.now() - checkStart;

    const details = {
      min: min.toFixed(2) + 'ms',
      max: max.toFixed(2) + 'ms',
      mean: mean.toFixed(2) + 'ms',
      p50: p50.toFixed(2) + 'ms',
      p99: p99.toFixed(2) + 'ms',
      thresholds: {
        degraded: this.thresholds.lagDegradedThreshold + 'ms',
        unhealthy: this.thresholds.lagUnhealthyThreshold + 'ms',
      },
    };

    // Use p99 for health determination (worst-case performance)
    if (p99 >= this.thresholds.lagUnhealthyThreshold) {
      return {
        ...this.unhealthy(
          'Event loop p99 lag (' + p99.toFixed(2) + 'ms) exceeds unhealthy threshold',
          details
        ),
        latency,
      };
    }

    if (p99 >= this.thresholds.lagDegradedThreshold) {
      return {
        ...this.degraded(
          'Event loop p99 lag (' + p99.toFixed(2) + 'ms) exceeds degraded threshold',
          details
        ),
        latency,
      };
    }

    return {
      ...this.healthy(
        'Event loop is responsive (p99: ' + p99.toFixed(2) + 'ms, mean: ' + mean.toFixed(2) + 'ms)',
        details
      ),
      latency,
    };
  }

  /**
   * Reset the histogram statistics
   */
  reset(): void {
    if (this.histogram) {
      this.histogram.reset();
    }
  }

  /**
   * Disable the histogram monitoring
   */
  disable(): void {
    if (this.histogram) {
      this.histogram.disable();
    }
  }

  /**
   * Enable the histogram monitoring
   */
  enable(): void {
    if (this.histogram) {
      this.histogram.enable();
    }
  }
}
