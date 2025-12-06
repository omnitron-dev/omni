/**
 * Memory Health Indicator
 *
 * Monitors memory usage and reports health status based on thresholds.
 *
 * @module titan/modules/health/indicators
 */

import { HealthIndicator } from '../health.indicator.js';
import type { HealthIndicatorResult, MemoryThresholds } from '../health.types.js';

/**
 * Default memory thresholds
 */
const DEFAULT_THRESHOLDS: Required<MemoryThresholds> = {
  heapDegradedThreshold: 0.7,
  heapUnhealthyThreshold: 0.9,
  rssLimit: 0, // 0 means disabled
  externalLimit: 0, // 0 means disabled
};

/**
 * Memory usage information
 */
interface MemoryInfo {
  heapUsed: number;
  heapTotal: number;
  heapUsedPercent: number;
  rss: number;
  external: number;
  arrayBuffers: number;
}

/**
 * Memory Health Indicator
 *
 * Monitors Node.js memory usage and reports health based on configurable thresholds.
 *
 * @example
 * ```typescript
 * const memoryIndicator = new MemoryHealthIndicator({
 *   heapDegradedThreshold: 0.7,  // 70% heap usage triggers degraded
 *   heapUnhealthyThreshold: 0.9, // 90% heap usage triggers unhealthy
 * });
 *
 * const result = await memoryIndicator.check();
 * // Returns health status based on current memory usage
 * ```
 */
export class MemoryHealthIndicator extends HealthIndicator {
  readonly name = 'memory';
  private thresholds: Required<MemoryThresholds>;

  constructor(thresholds: MemoryThresholds = {}) {
    super();
    this.thresholds = {
      heapDegradedThreshold: thresholds.heapDegradedThreshold ?? DEFAULT_THRESHOLDS.heapDegradedThreshold,
      heapUnhealthyThreshold: thresholds.heapUnhealthyThreshold ?? DEFAULT_THRESHOLDS.heapUnhealthyThreshold,
      rssLimit: thresholds.rssLimit ?? DEFAULT_THRESHOLDS.rssLimit,
      externalLimit: thresholds.externalLimit ?? DEFAULT_THRESHOLDS.externalLimit,
    };
  }

  /**
   * Perform the memory health check
   */
  async check(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    const memoryInfo = this.getMemoryInfo();

    const details = {
      heapUsed: this.formatBytes(memoryInfo.heapUsed),
      heapTotal: this.formatBytes(memoryInfo.heapTotal),
      heapUsedPercent: (memoryInfo.heapUsedPercent * 100).toFixed(1) + '%',
      rss: this.formatBytes(memoryInfo.rss),
      external: this.formatBytes(memoryInfo.external),
      arrayBuffers: this.formatBytes(memoryInfo.arrayBuffers),
      thresholds: {
        degraded: (this.thresholds.heapDegradedThreshold * 100).toFixed(0) + '%',
        unhealthy: (this.thresholds.heapUnhealthyThreshold * 100).toFixed(0) + '%',
      },
    };

    const latency = Date.now() - start;

    // Check RSS limit
    if (this.thresholds.rssLimit > 0 && memoryInfo.rss > this.thresholds.rssLimit) {
      return {
        ...this.unhealthy(
          'RSS memory (' + this.formatBytes(memoryInfo.rss) + ') exceeds limit (' + this.formatBytes(this.thresholds.rssLimit) + ')',
          details
        ),
        latency,
      };
    }

    // Check external memory limit
    if (this.thresholds.externalLimit > 0 && memoryInfo.external > this.thresholds.externalLimit) {
      return {
        ...this.unhealthy(
          'External memory (' + this.formatBytes(memoryInfo.external) + ') exceeds limit (' + this.formatBytes(this.thresholds.externalLimit) + ')',
          details
        ),
        latency,
      };
    }

    // Check heap usage
    if (memoryInfo.heapUsedPercent >= this.thresholds.heapUnhealthyThreshold) {
      return {
        ...this.unhealthy(
          'Heap usage (' + (memoryInfo.heapUsedPercent * 100).toFixed(1) + '%) exceeds unhealthy threshold',
          details
        ),
        latency,
      };
    }

    if (memoryInfo.heapUsedPercent >= this.thresholds.heapDegradedThreshold) {
      return {
        ...this.degraded(
          'Heap usage (' + (memoryInfo.heapUsedPercent * 100).toFixed(1) + '%) exceeds degraded threshold',
          details
        ),
        latency,
      };
    }

    return {
      ...this.healthy(
        'Memory usage is within normal limits (' + (memoryInfo.heapUsedPercent * 100).toFixed(1) + '% heap)',
        details
      ),
      latency,
    };
  }

  /**
   * Get current memory information
   */
  private getMemoryInfo(): MemoryInfo {
    const memUsage = process.memoryUsage();

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapUsedPercent: memUsage.heapUsed / memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return size.toFixed(2) + ' ' + units[unitIndex];
  }

  /**
   * Get the current thresholds
   */
  getThresholds(): Required<MemoryThresholds> {
    return { ...this.thresholds };
  }

  /**
   * Update the thresholds
   */
  setThresholds(thresholds: Partial<MemoryThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
    };
  }
}
