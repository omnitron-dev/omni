/**
 * Memory leak detector for identifying potential memory leaks in tests.
 *
 * This class monitors heap memory usage over time and can detect memory growth
 * trends that may indicate memory leaks. It requires Node.js to be run with the
 * `--expose-gc` flag to enable manual garbage collection.
 *
 * @example
 * ```typescript
 * // Run Node with: node --expose-gc test.js
 *
 * const detector = new MemoryLeakDetector();
 *
 * // Run test iterations
 * for (let i = 0; i < 100; i++) {
 *   await doWork();
 *   detector.measure();
 * }
 *
 * // Check for leaks
 * if (detector.hasLeak()) {
 *   console.warn('Potential memory leak detected!');
 *   console.log('Trend:', detector.getTrend());
 * }
 * ```
 */
export class MemoryLeakDetector {
  private initialMemory: number;
  private measurements: number[] = [];

  /**
   * Creates a new memory leak detector.
   *
   * Triggers garbage collection (if available) and records the initial heap usage.
   *
   * @example
   * ```typescript
   * const detector = new MemoryLeakDetector();
   * ```
   */
  constructor() {
    if (global.gc) {
      global.gc();
    }
    this.initialMemory = process.memoryUsage().heapUsed;
  }

  /**
   * Measure current memory usage relative to the initial baseline.
   *
   * Triggers garbage collection (if available) before measuring to get
   * accurate readings.
   *
   * @returns The memory delta in bytes (positive indicates growth)
   *
   * @example
   * ```typescript
   * const delta = detector.measure();
   * console.log(`Memory delta: ${delta / 1024 / 1024}MB`);
   * ```
   */
  measure(): number {
    if (global.gc) {
      global.gc();
    }
    const current = process.memoryUsage().heapUsed;
    const delta = current - this.initialMemory;
    this.measurements.push(delta);
    return delta;
  }

  /**
   * Check if there's a potential memory leak.
   *
   * A leak is detected if the average of the last 5 measurements exceeds
   * the specified threshold.
   *
   * @param threshold - The memory growth threshold in bytes (default: 10MB)
   * @returns `true` if average memory growth exceeds the threshold
   *
   * @example
   * ```typescript
   * // Check with default 10MB threshold
   * if (detector.hasLeak()) {
   *   console.warn('Potential leak detected');
   * }
   *
   * // Check with custom 5MB threshold
   * if (detector.hasLeak(5 * 1024 * 1024)) {
   *   console.warn('Memory grew by more than 5MB');
   * }
   * ```
   */
  hasLeak(threshold = 10 * 1024 * 1024): boolean {
    // Consider it a leak if memory grows by more than threshold
    if (this.measurements.length < 2) {
      return false;
    }

    const recent = this.measurements.slice(-5);
    const average = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    return average > threshold;
  }

  /**
   * Get the memory growth trend.
   *
   * Analyzes the last 5 measurements to determine if memory is consistently
   * growing, shrinking, or stable.
   *
   * @returns The memory trend: 'growing', 'shrinking', or 'stable'
   *
   * @example
   * ```typescript
   * const trend = detector.getTrend();
   * console.log(`Memory trend: ${trend}`);
   * ```
   */
  getTrend(): 'stable' | 'growing' | 'shrinking' {
    if (this.measurements.length < 3) {
      return 'stable';
    }

    const recent = this.measurements.slice(-5);
    let growing = 0;
    let shrinking = 0;

    for (let i = 1; i < recent.length; i++) {
      const current = recent[i];
      const previous = recent[i - 1];
      if (current !== undefined && previous !== undefined) {
        if (current > previous) {
          growing++;
        } else if (current < previous) {
          shrinking++;
        }
      }
    }

    if (growing > shrinking * 2) {
      return 'growing';
    } else if (shrinking > growing * 2) {
      return 'shrinking';
    }
    return 'stable';
  }

  /**
   * Reset the detector to start fresh measurements.
   *
   * Triggers garbage collection (if available) and sets a new baseline.
   *
   * @example
   * ```typescript
   * detector.reset();
   * // Start new test run
   * ```
   */
  reset(): void {
    if (global.gc) {
      global.gc();
    }
    this.initialMemory = process.memoryUsage().heapUsed;
    this.measurements = [];
  }
}
