/**
 * Performance Monitoring System
 *
 * Provides a unified API for performance measurement using native Performance API
 * with enhanced features for tracking marks, measures, and custom metrics.
 *
 * @module monitoring/performance
 */

/**
 * Performance mark with metadata
 */
export interface PerformanceMark {
  /** Unique name of the mark */
  name: string;
  /** Timestamp when mark was created (DOMHighResTimeStamp) */
  timestamp: number;
  /** Optional metadata associated with the mark */
  metadata?: Record<string, any>;
  /** Type of mark for categorization */
  type?: 'component' | 'signal' | 'effect' | 'network' | 'custom';
}

/**
 * Performance measure between two marks
 */
export interface PerformanceMeasure {
  /** Unique name of the measure */
  name: string;
  /** Name of the start mark */
  startMark: string;
  /** Name of the end mark */
  endMark: string;
  /** Duration in milliseconds */
  duration: number;
  /** Optional metadata associated with the measure */
  metadata?: Record<string, any>;
  /** Type of measure for categorization */
  type?: 'render' | 'computation' | 'network' | 'custom';
}

/**
 * Performance entry for navigation timing
 */
export interface NavigationTiming {
  /** DNS lookup time */
  dnsLookup: number;
  /** TCP connection time */
  tcpConnection: number;
  /** TLS negotiation time */
  tlsNegotiation: number;
  /** Time to first byte */
  ttfb: number;
  /** DOM content loaded time */
  domContentLoaded: number;
  /** DOM complete time */
  domComplete: number;
  /** Load complete time */
  loadComplete: number;
  /** Total page load time */
  totalLoadTime: number;
}

/**
 * Performance budget thresholds
 */
export interface PerformanceBudget {
  /** Maximum render time in ms */
  maxRenderTime?: number;
  /** Maximum signal update time in ms */
  maxSignalUpdateTime?: number;
  /** Maximum effect execution time in ms */
  maxEffectTime?: number;
  /** Maximum network request time in ms */
  maxNetworkTime?: number;
  /** Custom thresholds */
  custom?: Record<string, number>;
}

/**
 * Performance violation event
 */
export interface PerformanceViolation {
  /** Type of violation */
  type: 'render' | 'signal' | 'effect' | 'network' | 'custom';
  /** Name of the operation that violated the budget */
  name: string;
  /** Actual duration */
  duration: number;
  /** Budget threshold that was exceeded */
  threshold: number;
  /** Timestamp of the violation */
  timestamp: number;
  /** Additional context */
  metadata?: Record<string, any>;
}

/**
 * Performance monitor configuration
 */
export interface PerformanceConfig {
  /** Enable performance monitoring */
  enabled?: boolean;
  /** Maximum number of marks to keep in memory */
  maxMarks?: number;
  /** Maximum number of measures to keep in memory */
  maxMeasures?: number;
  /** Performance budget thresholds */
  budget?: PerformanceBudget;
  /** Callback for performance violations */
  onViolation?: (violation: PerformanceViolation) => void;
  /** Enable automatic cleanup of old entries */
  autoCleanup?: boolean;
  /** Cleanup interval in ms */
  cleanupInterval?: number;
}

/**
 * Performance Monitor
 *
 * Central performance monitoring system for tracking performance marks,
 * measures, and detecting budget violations.
 *
 * @example
 * ```typescript
 * const monitor = new PerformanceMonitor({
 *   enabled: true,
 *   budget: {
 *     maxRenderTime: 16,
 *     maxSignalUpdateTime: 1
 *   },
 *   onViolation: (violation) => {
 *     console.warn('Performance violation:', violation);
 *   }
 * });
 *
 * // Mark start of operation
 * monitor.mark('render-start', { component: 'App' });
 *
 * // ... perform operation ...
 *
 * // Mark end and measure
 * monitor.mark('render-end', { component: 'App' });
 * const measure = monitor.measure('render', 'render-start', 'render-end');
 * console.log(`Render took ${measure.duration}ms`);
 * ```
 */
export class PerformanceMonitor {
  private marks = new Map<string, PerformanceMark>();
  private measures: PerformanceMeasure[] = [];
  private violations: PerformanceViolation[] = [];
  private config: Required<PerformanceConfig>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private enabled = true;
  private observers: Array<(entry: PerformanceEntry) => void> = [];

  constructor(config: PerformanceConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxMarks: config.maxMarks ?? 1000,
      maxMeasures: config.maxMeasures ?? 1000,
      budget: config.budget ?? {},
      onViolation: config.onViolation ?? (() => {}),
      autoCleanup: config.autoCleanup ?? true,
      cleanupInterval: config.cleanupInterval ?? 60000,
    };

    this.enabled = this.config.enabled;

    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Create a performance mark
   */
  mark(name: string, metadata?: Record<string, any>): PerformanceMark {
    if (!this.enabled) return { name, timestamp: 0 };

    const timestamp = performance.now();

    const perfMark: PerformanceMark = {
      name,
      timestamp,
      metadata,
      type: metadata?.type || 'custom',
    };

    this.marks.set(name, perfMark);

    if (typeof performance !== 'undefined' && performance.mark) {
      try {
        performance.mark(name);
      } catch {
        // Ignore errors
      }
    }

    if (this.marks.size > this.config.maxMarks) {
      const oldestKey = this.marks.keys().next().value;
      if (oldestKey) {
        this.marks.delete(oldestKey);
      }
    }

    return perfMark;
  }

  /**
   * Start a performance mark (alias for mark)
   * Provided for API consistency with tests
   */
  startMark(name: string, metadata?: Record<string, any>): PerformanceMark {
    return this.mark(name, metadata);
  }

  /**
   * End a performance mark
   * Creates a mark with "-end" suffix for measuring
   */
  endMark(name: string, metadata?: Record<string, any>): PerformanceMark {
    return this.mark(`${name}-end`, metadata);
  }

  /**
   * Create a performance measure between two marks
   * Can be called with 2 parameters (name, startMark) to auto-detect end mark,
   * or 3 parameters (name, startMark, endMark) for explicit marks.
   */
  measure(name: string, startMark: string, endMark?: string): PerformanceMeasure | number | null {
    if (!this.enabled) return null;

    // If only 2 parameters, assume endMark is startMark + '-end'
    const actualEndMark = endMark ?? `${startMark}-end`;

    const start = this.marks.get(startMark);
    const end = this.marks.get(actualEndMark);

    if (!start || !end) {
      console.warn(`Performance marks not found: ${startMark} or ${actualEndMark}`);
      return null;
    }

    const duration = end.timestamp - start.timestamp;

    const perfMeasure: PerformanceMeasure = {
      name,
      startMark,
      endMark: actualEndMark,
      duration,
      metadata: {
        ...start.metadata,
        ...end.metadata,
      },
      type: start.type === end.type ? (start.type as any) : 'custom',
    };

    this.measures.push(perfMeasure);

    if (typeof performance !== 'undefined' && performance.measure) {
      try {
        performance.measure(name, startMark, actualEndMark);
      } catch {
        // Ignore errors
      }
    }

    this.checkBudgetViolation(perfMeasure);

    if (this.measures.length > this.config.maxMeasures) {
      this.measures.shift();
    }

    // If called with 2 parameters, return just the duration for convenience
    if (!endMark) {
      return duration;
    }

    return perfMeasure;
  }

  private checkBudgetViolation(perfMeasure: PerformanceMeasure): void {
    const { budget } = this.config;
    let threshold: number | undefined;
    let type: PerformanceViolation['type'] = 'custom';

    // Check by measure type first
    if (perfMeasure.type === 'render' && budget.maxRenderTime) {
      threshold = budget.maxRenderTime;
      type = 'render';
    } else if (perfMeasure.metadata?.type === 'signal' && budget.maxSignalUpdateTime) {
      threshold = budget.maxSignalUpdateTime;
      type = 'signal';
    } else if (perfMeasure.metadata?.type === 'effect' && budget.maxEffectTime) {
      threshold = budget.maxEffectTime;
      type = 'effect';
    } else if (perfMeasure.type === 'network' && budget.maxNetworkTime) {
      threshold = budget.maxNetworkTime;
      type = 'network';
    }

    // Check by measure name patterns if no type match
    if (!threshold) {
      if (perfMeasure.name.includes('render') && budget.maxRenderTime) {
        threshold = budget.maxRenderTime;
        type = 'render';
      } else if (perfMeasure.name.includes('signal') && budget.maxSignalUpdateTime) {
        threshold = budget.maxSignalUpdateTime;
        type = 'signal';
      } else if (perfMeasure.name.includes('effect') && budget.maxEffectTime) {
        threshold = budget.maxEffectTime;
        type = 'effect';
      }
    }

    // Check custom thresholds by name
    if (!threshold && budget.custom && budget.custom[perfMeasure.name]) {
      threshold = budget.custom[perfMeasure.name];
    }

    // If still no threshold, use the most restrictive budget as a fallback
    // This catches operations that don't match any pattern but are clearly slow
    if (!threshold) {
      const budgetThresholds = [
        budget.maxRenderTime,
        budget.maxSignalUpdateTime,
        budget.maxEffectTime,
        budget.maxNetworkTime,
      ].filter((t): t is number => t !== undefined);

      if (budgetThresholds.length > 0) {
        // Use the smallest (most restrictive) threshold as the fallback
        threshold = Math.min(...budgetThresholds);
      }
    }

    if (threshold && perfMeasure.duration > threshold) {
      const violation: PerformanceViolation = {
        type,
        name: perfMeasure.name,
        duration: perfMeasure.duration,
        threshold,
        timestamp: performance.now(),
        metadata: perfMeasure.metadata,
      };

      this.violations.push(violation);
      this.config.onViolation(violation);
    }
  }

  getMarks(): PerformanceMark[] {
    return Array.from(this.marks.values());
  }

  getMeasures(): PerformanceMeasure[] {
    return [...this.measures];
  }

  getViolations(): PerformanceViolation[] {
    return [...this.violations];
  }

  getNavigationTiming(): NavigationTiming | null {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) {
      return null;
    }

    const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (!navigation) return null;

    return {
      dnsLookup: navigation.domainLookupEnd - navigation.domainLookupStart,
      tcpConnection: navigation.connectEnd - navigation.connectStart,
      tlsNegotiation: navigation.secureConnectionStart > 0 ? navigation.connectEnd - navigation.secureConnectionStart : 0,
      ttfb: navigation.responseStart - navigation.requestStart,
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
      domComplete: navigation.domComplete - navigation.domContentLoadedEventEnd,
      loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
      totalLoadTime: navigation.loadEventEnd - navigation.fetchStart,
    };
  }

  clearMarks(): void {
    this.marks.clear();
    if (typeof performance !== 'undefined' && performance.clearMarks) {
      performance.clearMarks();
    }
  }

  clearMeasures(): void {
    this.measures = [];
    if (typeof performance !== 'undefined' && performance.clearMeasures) {
      performance.clearMeasures();
    }
  }

  clearViolations(): void {
    this.violations = [];
  }

  clear(): void {
    this.clearMarks();
    this.clearMeasures();
    this.clearViolations();
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updateConfig(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }
  }

  private startAutoCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      const now = performance.now();
      const maxAge = this.config.cleanupInterval;

      for (const [name, perfMark] of this.marks.entries()) {
        if (now - perfMark.timestamp > maxAge) {
          this.marks.delete(name);
        }
      }

      this.measures = this.measures.filter((perfMeasure) => {
        const endMark = this.marks.get(perfMeasure.endMark);
        return endMark && now - endMark.timestamp <= maxAge;
      });
    }, this.config.cleanupInterval);
  }

  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  dispose(): void {
    this.stopAutoCleanup();
    this.observers = [];
    this.clear();
  }

  /**
   * Disconnect observers (alias for dispose)
   * Provided for API consistency with tests
   */
  disconnect(): void {
    this.observers = [];
    this.dispose();
  }

  /**
   * Subscribe to performance entries
   * Callback will be invoked whenever a new performance entry is created
   */
  onPerformance(callback: (entry: PerformanceEntry) => void): () => void {
    this.observers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.observers.indexOf(callback);
      if (index !== -1) {
        this.observers.splice(index, 1);
      }
    };
  }

  /**
   * Get memory usage from Performance API
   * Returns memory information if available in the environment
   */
  getMemoryUsage(): {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const memory = (performance as any).memory;
      return {
        usedJSHeapSize: memory.usedJSHeapSize || 0,
        totalJSHeapSize: memory.totalJSHeapSize || 0,
        jsHeapSizeLimit: memory.jsHeapSizeLimit || 0,
      };
    }
    return null;
  }

  /**
   * Get Web Vitals metrics
   * Returns an object with core web vitals if available
   */
  getWebVitals(): Record<string, number> {
    const vitals: Record<string, number> = {};

    if (typeof performance === 'undefined' || !performance.getEntriesByType) {
      return vitals;
    }

    try {
      // Get paint entries (FCP, LCP)
      const paintEntries = performance.getEntriesByType('paint');
      for (const entry of paintEntries) {
        if (entry.name === 'first-contentful-paint') {
          vitals.FCP = entry.startTime;
        }
      }

      // Get largest contentful paint
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) {
        vitals.LCP = lcpEntries[lcpEntries.length - 1]?.startTime ?? 0;
      }

      // Get first input delay
      const fidEntries = performance.getEntriesByType('first-input');
      if (fidEntries.length > 0) {
        const fidEntry = fidEntries[0] as PerformanceEntry & { processingStart?: number };
        if (fidEntry.processingStart) {
          vitals.FID = fidEntry.processingStart - fidEntry.startTime;
        }
      }

      // Get cumulative layout shift
      const clsEntries = performance.getEntriesByType('layout-shift');
      let clsScore = 0;
      for (const entry of clsEntries) {
        const clsEntry = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!clsEntry.hadRecentInput) {
          clsScore += clsEntry.value || 0;
        }
      }
      if (clsScore > 0) {
        vitals.CLS = clsScore;
      }
    } catch {
      // Ignore errors if APIs not available
    }

    return vitals;
  }

  /**
   * Notify observers of a new performance entry
   * @internal
   */
  private notifyObservers(entry: PerformanceEntry): void {
    for (const observer of this.observers) {
      try {
        observer(entry);
      } catch (error) {
        console.error('Error in performance observer:', error);
      }
    }
  }

  getSummary(): {
    totalMarks: number;
    totalMeasures: number;
    totalViolations: number;
    averageDuration: number;
    maxDuration: number;
    minDuration: number;
  } {
    const durations = this.measures.map((m) => m.duration);

    return {
      totalMarks: this.marks.size,
      totalMeasures: this.measures.length,
      totalViolations: this.violations.length,
      averageDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
      minDuration: durations.length > 0 ? Math.min(...durations) : 0,
    };
  }
}

let globalMonitor: PerformanceMonitor | null = null;

export function getPerformanceMonitor(config?: PerformanceConfig): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor(config);
  }
  return globalMonitor;
}

export function resetPerformanceMonitor(): void {
  if (globalMonitor) {
    globalMonitor.dispose();
    globalMonitor = null;
  }
}

export function mark(name: string, metadata?: Record<string, any>): PerformanceMark {
  return getPerformanceMonitor().mark(name, metadata);
}

export function measure(name: string, startMark: string, endMark: string): PerformanceMeasure | null {
  return getPerformanceMonitor().measure(name, startMark, endMark) as PerformanceMeasure | null;
}

/**
 * Create a new performance monitor instance
 * This is useful for isolated testing or multiple monitor instances
 */
export function createPerformanceMonitor(config?: PerformanceConfig): PerformanceMonitor {
  return new PerformanceMonitor(config);
}
