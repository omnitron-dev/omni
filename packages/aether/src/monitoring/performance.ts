/**
 * Performance Monitoring Module
 *
 * Tracks Core Web Vitals, resource timing, navigation timing, and custom performance metrics.
 */

import type {
  WebVitals,
  PerformanceTiming,
  ResourceTiming,
  MemoryUsage,
  PerformanceMark,
  PerformanceMonitoringConfig,
} from './types.js';

/**
 * Performance observer callback
 */
type PerformanceCallback = (entries: PerformanceEntry[]) => void;

/**
 * Performance monitoring class
 */
export class PerformanceMonitor {
  private config: PerformanceMonitoringConfig;
  private webVitals: Partial<WebVitals> = {};
  private marks: Map<string, PerformanceMark> = new Map();
  private observers: PerformanceObserver[] = [];
  private callbacks: Set<PerformanceCallback> = new Set();

  constructor(config: PerformanceMonitoringConfig = {}) {
    this.config = {
      webVitals: true,
      resourceTiming: true,
      navigationTiming: true,
      memoryUsage: true,
      bundleSize: true,
      sampleRate: 1,
      reportThreshold: 0,
      ...config,
    };

    if (typeof window !== 'undefined' && this.shouldSample()) {
      this.init();
    }
  }

  /**
   * Initialize performance monitoring
   */
  private init(): void {
    if (this.config.webVitals) {
      this.initWebVitals();
    }

    if (this.config.resourceTiming) {
      this.observeResourceTiming();
    }

    if (this.config.navigationTiming) {
      this.captureNavigationTiming();
    }

    // Capture on page load
    if (document.readyState === 'complete') {
      this.captureMetrics();
    } else {
      window.addEventListener('load', () => this.captureMetrics());
    }
  }

  /**
   * Check if should sample
   */
  private shouldSample(): boolean {
    return Math.random() < (this.config.sampleRate || 1);
  }

  /**
   * Initialize Core Web Vitals tracking
   */
  private initWebVitals(): void {
    // First Contentful Paint (FCP)
    this.observePaint('first-contentful-paint', (entry) => {
      this.webVitals.FCP = entry.startTime;
      this.reportMetric('FCP', entry.startTime);
    });

    // Largest Contentful Paint (LCP)
    this.observeLargestContentfulPaint((entry) => {
      this.webVitals.LCP = entry.startTime;
      this.reportMetric('LCP', entry.startTime);
    });

    // First Input Delay (FID)
    this.observeFirstInputDelay((entry) => {
      this.webVitals.FID = entry.processingStart - entry.startTime;
      this.reportMetric('FID', this.webVitals.FID);
    });

    // Cumulative Layout Shift (CLS)
    this.observeCumulativeLayoutShift((value) => {
      this.webVitals.CLS = value;
      this.reportMetric('CLS', value);
    });

    // Interaction to Next Paint (INP)
    this.observeInteractionToNextPaint((value) => {
      this.webVitals.INP = value;
      this.reportMetric('INP', value);
    });

    // Time to First Byte (TTFB)
    this.captureTimeToFirstByte();
  }

  /**
   * Observe paint timing
   */
  private observePaint(name: string, callback: (entry: any) => void): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.name === name) {
            callback(entry);
          }
        }
      });
      observer.observe({ type: 'paint', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      // PerformanceObserver not supported
    }
  }

  /**
   * Observe Largest Contentful Paint
   */
  private observeLargestContentfulPaint(callback: (entry: any) => void): void {
    try {
      let lastEntry: any = null;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        lastEntry = entries[entries.length - 1];
        callback(lastEntry);
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      this.observers.push(observer);

      // Report final LCP on visibility change or page hide
      const reportFinalLCP = () => {
        if (lastEntry) {
          callback(lastEntry);
          observer.disconnect();
        }
      };

      document.addEventListener('visibilitychange', reportFinalLCP, { once: true });
      window.addEventListener('pagehide', reportFinalLCP, { once: true });
    } catch (error) {
      // LCP not supported
    }
  }

  /**
   * Observe First Input Delay
   */
  private observeFirstInputDelay(callback: (entry: any) => void): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          callback(entries[0]);
          observer.disconnect();
        }
      });
      observer.observe({ type: 'first-input', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      // FID not supported
    }
  }

  /**
   * Observe Cumulative Layout Shift
   */
  private observeCumulativeLayoutShift(callback: (value: number) => void): void {
    try {
      let clsValue = 0;
      let sessionValue = 0;
      let sessionEntries: any[] = [];
      const maxSessionGap = 1000;
      const maxSessionDuration = 5000;
      let prevTime = 0;

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          // Ignore layout shifts from user input
          if (!entry.hadRecentInput) {
            const firstSessionEntry = sessionEntries[0];
            const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

            // If the entry is within the current session window
            if (
              sessionValue &&
              entry.startTime - lastSessionEntry.startTime < maxSessionGap &&
              entry.startTime - firstSessionEntry.startTime < maxSessionDuration
            ) {
              sessionValue += entry.value;
              sessionEntries.push(entry);
            } else {
              // Start new session
              sessionValue = entry.value;
              sessionEntries = [entry];
            }

            // Update CLS value if session value is greater
            if (sessionValue > clsValue) {
              clsValue = sessionValue;
              callback(clsValue);
            }
          }

          prevTime = entry.startTime;
        }
      });

      observer.observe({ type: 'layout-shift', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      // CLS not supported
    }
  }

  /**
   * Observe Interaction to Next Paint
   */
  private observeInteractionToNextPaint(callback: (value: number) => void): void {
    try {
      let maxDuration = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          if (entry.duration > maxDuration) {
            maxDuration = entry.duration;
            callback(maxDuration);
          }
        }
      });
      observer.observe({ type: 'event', buffered: true, durationThreshold: 16 });
      this.observers.push(observer);
    } catch (error) {
      // INP not supported
    }
  }

  /**
   * Capture Time to First Byte
   */
  private captureTimeToFirstByte(): void {
    try {
      const navTiming = performance.getEntriesByType('navigation')[0] as any;
      if (navTiming) {
        this.webVitals.TTFB = navTiming.responseStart - navTiming.requestStart;
        this.reportMetric('TTFB', this.webVitals.TTFB);
      }
    } catch (error) {
      // Navigation timing not available
    }
  }

  /**
   * Observe resource timing
   */
  private observeResourceTiming(): void {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries() as PerformanceResourceTiming[];
        const resources = entries.map((entry) => this.parseResourceTiming(entry));
        this.notifyCallbacks(entries);
      });
      observer.observe({ type: 'resource', buffered: true });
      this.observers.push(observer);
    } catch (error) {
      // Resource timing not supported
    }
  }

  /**
   * Parse resource timing entry
   */
  private parseResourceTiming(entry: PerformanceResourceTiming): ResourceTiming {
    const type = this.getResourceType(entry.name, entry.initiatorType);
    return {
      name: entry.name,
      type,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      startTime: entry.startTime,
      cached: entry.transferSize === 0 && entry.decodedBodySize > 0,
    };
  }

  /**
   * Get resource type
   */
  private getResourceType(url: string, initiatorType: string): string {
    if (initiatorType === 'script' || url.endsWith('.js')) return 'script';
    if (initiatorType === 'css' || url.endsWith('.css')) return 'stylesheet';
    if (initiatorType === 'img' || /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(url))
      return 'image';
    if (initiatorType === 'fetch' || initiatorType === 'xmlhttprequest') return 'xhr';
    return initiatorType || 'other';
  }

  /**
   * Capture navigation timing
   */
  private captureNavigationTiming(): PerformanceTiming | null {
    try {
      const navTiming = performance.getEntriesByType('navigation')[0] as any;
      if (!navTiming) return null;

      const timing: PerformanceTiming = {
        dns: navTiming.domainLookupEnd - navTiming.domainLookupStart,
        tcp: navTiming.connectEnd - navTiming.connectStart,
        request: navTiming.responseStart - navTiming.requestStart,
        response: navTiming.responseEnd - navTiming.responseStart,
        domProcessing: navTiming.domInteractive - navTiming.domLoading,
        domContentLoaded: navTiming.domContentLoadedEventEnd - navTiming.domContentLoadedEventStart,
        loadComplete: navTiming.loadEventEnd - navTiming.loadEventStart,
        ttfb: navTiming.responseStart - navTiming.requestStart,
      };

      return timing;
    } catch (error) {
      return null;
    }
  }

  /**
   * Capture memory usage
   */
  getMemoryUsage(): MemoryUsage | null {
    if (!this.config.memoryUsage) return null;

    try {
      const memory = (performance as any).memory;
      if (memory) {
        return {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
        };
      }
    } catch (error) {
      // Memory API not available
    }
    return null;
  }

  /**
   * Capture all metrics
   */
  private captureMetrics(): void {
    const navTiming = this.captureNavigationTiming();
    const memory = this.getMemoryUsage();

    // Report metrics that exceed threshold
    if (navTiming && this.config.reportThreshold) {
      Object.entries(navTiming).forEach(([key, value]) => {
        if (value && value > this.config.reportThreshold!) {
          this.reportMetric(`navigation.${key}`, value);
        }
      });
    }
  }

  /**
   * Start performance mark
   */
  startMark(name: string, metadata?: Record<string, any>): void {
    const mark: PerformanceMark = {
      name,
      startTime: performance.now(),
      metadata,
    };
    this.marks.set(name, mark);
    performance.mark(name);
  }

  /**
   * End performance mark
   */
  endMark(name: string): void {
    const mark = this.marks.get(name);
    if (mark) {
      mark.duration = performance.now() - mark.startTime;
      performance.mark(`${name}-end`);
    }
  }

  /**
   * Measure performance between marks
   */
  measure(name: string, startMark: string, endMark?: string): number {
    try {
      const measureName = `measure-${name}`;
      const end = endMark || `${startMark}-end`;
      performance.measure(measureName, startMark, end);

      const measure = performance.getEntriesByName(measureName)[0];
      if (measure) {
        this.reportMetric(name, measure.duration);
        return measure.duration;
      }
    } catch (error) {
      // Measure failed
    }
    return 0;
  }

  /**
   * Get Web Vitals
   */
  getWebVitals(): WebVitals {
    return { ...this.webVitals };
  }

  /**
   * Report metric
   */
  private reportMetric(name: string, value: number): void {
    // Hook for external reporting
    if (this.config.reportThreshold && value < this.config.reportThreshold) {
      return;
    }

    // Emit metric event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('aether:metric', {
          detail: { name, value, timestamp: Date.now() },
        })
      );
    }
  }

  /**
   * Subscribe to performance entries
   */
  onPerformance(callback: PerformanceCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Notify callbacks
   */
  private notifyCallbacks(entries: PerformanceEntry[]): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(entries);
      } catch (error) {
        console.error('Performance callback error:', error);
      }
    });
  }

  /**
   * Clear performance data
   */
  clear(): void {
    this.marks.clear();
    performance.clearMarks();
    performance.clearMeasures();
  }

  /**
   * Disconnect observers
   */
  disconnect(): void {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
    this.callbacks.clear();
  }
}

/**
 * Global performance monitor instance
 */
let globalPerformanceMonitor: PerformanceMonitor | null = null;

/**
 * Get or create global performance monitor
 */
export function getPerformanceMonitor(config?: PerformanceMonitoringConfig): PerformanceMonitor {
  if (!globalPerformanceMonitor) {
    globalPerformanceMonitor = new PerformanceMonitor(config);
  }
  return globalPerformanceMonitor;
}

/**
 * Reset global performance monitor
 */
export function resetPerformanceMonitor(): void {
  if (globalPerformanceMonitor) {
    globalPerformanceMonitor.disconnect();
    globalPerformanceMonitor = null;
  }
}
