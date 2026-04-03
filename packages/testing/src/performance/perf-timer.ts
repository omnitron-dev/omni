import { NotFoundError } from '../errors.js';

/**
 * Performance timer for measuring operation performance with percentile calculation.
 *
 * This class provides utilities for timing operations and calculating statistics
 * like averages and percentiles across multiple measurements.
 *
 * @example
 * ```typescript
 * const timer = new PerfTimer();
 *
 * // Mark start and end points
 * timer.mark('start');
 * await doWork();
 * timer.mark('end');
 *
 * // Measure duration
 * const duration = timer.measure('work', 'start', 'end');
 * console.log(`Duration: ${duration}ms`);
 *
 * // Get statistics
 * const avg = timer.getAverage('work');
 * const p95 = timer.getPercentile('work', 95);
 * ```
 */
export class PerfTimer {
  private marks = new Map<string, number>();
  private measures = new Map<string, number[]>();

  /**
   * Mark a point in time.
   *
   * @param name - The name of the mark
   *
   * @example
   * ```typescript
   * timer.mark('start');
   * await doWork();
   * timer.mark('end');
   * ```
   */
  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  /**
   * Measure the duration between two marks.
   *
   * @param name - The name of the measurement (used for statistics)
   * @param startMark - The name of the start mark
   * @param endMark - The name of the end mark (defaults to current time if not provided)
   * @returns The duration in milliseconds
   * @throws {NotFoundError} If the start or end mark is not found
   *
   * @example
   * ```typescript
   * timer.mark('start');
   * await doWork();
   * timer.mark('end');
   * const duration = timer.measure('work', 'start', 'end');
   * ```
   */
  measure(name: string, startMark: string, endMark?: string): number {
    const start = this.marks.get(startMark);
    if (!start) {
      throw new NotFoundError('performance mark', startMark);
    }

    const end = endMark ? this.marks.get(endMark) : performance.now();
    if (!end) {
      throw new NotFoundError('performance mark', endMark);
    }

    const duration = end - start;

    let measures = this.measures.get(name);
    if (!measures) {
      measures = [];
      this.measures.set(name, measures);
    }
    measures.push(duration);

    return duration;
  }

  /**
   * Get the average duration for a measurement.
   *
   * @param name - The name of the measurement
   * @returns The average duration in milliseconds, or 0 if no measurements exist
   *
   * @example
   * ```typescript
   * // After multiple measurements
   * const avg = timer.getAverage('work');
   * console.log(`Average: ${avg}ms`);
   * ```
   */
  getAverage(name: string): number {
    const measures = this.measures.get(name);
    if (!measures || measures.length === 0) {
      return 0;
    }
    return measures.reduce((sum, val) => sum + val, 0) / measures.length;
  }

  /**
   * Get a percentile value for a measurement.
   *
   * @param name - The name of the measurement
   * @param percentile - The percentile to calculate (0-100)
   * @returns The percentile value in milliseconds, or 0 if no measurements exist
   *
   * @example
   * ```typescript
   * // Get 95th percentile
   * const p95 = timer.getPercentile('work', 95);
   * console.log(`P95: ${p95}ms`);
   * ```
   */
  getPercentile(name: string, percentile: number): number {
    const measures = this.measures.get(name);
    if (!measures || measures.length === 0) {
      return 0;
    }

    const sorted = [...measures].sort((a, b) => a - b);
    const index = Math.min(Math.floor(sorted.length * (percentile / 100)), sorted.length - 1);
    return sorted[index] ?? 0;
  }

  /**
   * Clear all marks and measures.
   *
   * @example
   * ```typescript
   * timer.clear();
   * // Start fresh measurements
   * ```
   */
  clear(): void {
    this.marks.clear();
    this.measures.clear();
  }
}
