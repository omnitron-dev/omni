/**
 * Performance utilities for Advanced Editor
 *
 * Provides:
 * - Performance measurement using Performance API
 * - FPS counter
 * - Memory usage tracking
 * - Render time tracking
 * - Timing decorators
 * - Performance budget warnings
 * - Export performance data
 */

/**
 * Performance mark entry
 */
export interface PerformanceMark {
  name: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Performance measure entry
 */
export interface PerformanceMeasure {
  name: string;
  duration: number;
  startMark: string;
  endMark: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Performance budget
 */
export interface PerformanceBudget {
  name: string;
  target: number; // ms
  warning: number; // ms
}

/**
 * FPS sample
 */
interface FPSSample {
  fps: number;
  timestamp: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  marks: PerformanceMark[];
  measures: PerformanceMeasure[];
  fps: FPSSample[];
  memory?: MemoryUsage;
  budgetViolations: BudgetViolation[];
}

/**
 * Memory usage
 */
export interface MemoryUsage {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

/**
 * Budget violation
 */
export interface BudgetViolation {
  measure: string;
  duration: number;
  budget: number;
  timestamp: number;
}

/**
 * Performance tracker class
 */
class PerformanceTracker {
  private marks: PerformanceMark[] = [];
  private measures: PerformanceMeasure[] = [];
  private budgets = new Map<string, PerformanceBudget>();
  private violations: BudgetViolation[] = [];

  /** FPS tracking */
  private fpsSamples: FPSSample[] = [];
  private fpsFrameCount = 0;
  private fpsLastTime = 0;
  private fpsAnimationId?: number;

  /** Memory tracking */
  private memoryInterval?: ReturnType<typeof setInterval>;
  private memoryHistory: MemoryUsage[] = [];

  /**
   * Mark a point in time
   */
  mark(name: string, metadata?: Record<string, any>): void {
    const timestamp = performance.now();

    // Use Performance API if available
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(name);
    }

    this.marks.push({
      name,
      timestamp,
      metadata,
    });
  }

  /**
   * Measure duration between two marks
   */
  measure(name: string, startMark: string, endMark: string, metadata?: Record<string, any>): number {
    const start = this.marks.find((m) => m.name === startMark);
    const end = this.marks.find((m) => m.name === endMark);

    if (!start || !end) {
      console.warn(`Cannot measure "${name}": marks not found`);
      return 0;
    }

    const duration = end.timestamp - start.timestamp;

    // Use Performance API if available
    if (typeof performance !== 'undefined' && performance.measure) {
      try {
        performance.measure(name, startMark, endMark);
      } catch {
        // Marks might not exist in Performance API
      }
    }

    const measure: PerformanceMeasure = {
      name,
      duration,
      startMark,
      endMark,
      timestamp: performance.now(),
      metadata,
    };

    this.measures.push(measure);

    // Check budget
    this.checkBudget(measure);

    return duration;
  }

  /**
   * Time a function execution
   */
  time<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    const startMark = `${name}-start`;
    const endMark = `${name}-end`;

    this.mark(startMark, metadata);
    const result = fn();
    this.mark(endMark, metadata);
    this.measure(name, startMark, endMark, metadata);

    return result;
  }

  /**
   * Time an async function execution
   */
  async timeAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    const startMark = `${name}-start`;
    const endMark = `${name}-end`;

    this.mark(startMark, metadata);
    const result = await fn();
    this.mark(endMark, metadata);
    this.measure(name, startMark, endMark, metadata);

    return result;
  }

  /**
   * Set performance budget
   */
  setBudget(name: string, target: number, warning: number = target * 0.8): void {
    this.budgets.set(name, { name, target, warning });
  }

  /**
   * Check if measure violates budget
   */
  private checkBudget(measure: PerformanceMeasure): void {
    const budget = this.budgets.get(measure.name);
    if (!budget) return;

    if (measure.duration > budget.target) {
      const violation: BudgetViolation = {
        measure: measure.name,
        duration: measure.duration,
        budget: budget.target,
        timestamp: measure.timestamp,
      };

      this.violations.push(violation);

      console.warn(
        `Performance budget exceeded: ${measure.name} took ${measure.duration.toFixed(2)}ms (budget: ${budget.target}ms)`
      );
    } else if (measure.duration > budget.warning) {
      console.warn(
        `Performance budget warning: ${measure.name} took ${measure.duration.toFixed(2)}ms (warning: ${budget.warning}ms, target: ${budget.target}ms)`
      );
    }
  }

  /**
   * Start FPS tracking
   */
  startFPSTracking(sampleInterval: number = 1000): void {
    this.fpsFrameCount = 0;
    this.fpsLastTime = performance.now();

    const trackFrame = (): void => {
      this.fpsFrameCount++;
      const now = performance.now();
      const elapsed = now - this.fpsLastTime;

      if (elapsed >= sampleInterval) {
        const fps = Math.round((this.fpsFrameCount * 1000) / elapsed);
        this.fpsSamples.push({ fps, timestamp: now });

        // Keep only last 100 samples
        if (this.fpsSamples.length > 100) {
          this.fpsSamples.shift();
        }

        this.fpsFrameCount = 0;
        this.fpsLastTime = now;
      }

      this.fpsAnimationId = requestAnimationFrame(trackFrame);
    };

    this.fpsAnimationId = requestAnimationFrame(trackFrame);
  }

  /**
   * Stop FPS tracking
   */
  stopFPSTracking(): void {
    if (this.fpsAnimationId !== undefined) {
      cancelAnimationFrame(this.fpsAnimationId);
      this.fpsAnimationId = undefined;
    }
  }

  /**
   * Get current FPS
   */
  getCurrentFPS(): number {
    if (this.fpsSamples.length === 0) return 0;
    return this.fpsSamples[this.fpsSamples.length - 1].fps;
  }

  /**
   * Get average FPS
   */
  getAverageFPS(): number {
    if (this.fpsSamples.length === 0) return 0;
    const sum = this.fpsSamples.reduce((acc, sample) => acc + sample.fps, 0);
    return Math.round(sum / this.fpsSamples.length);
  }

  /**
   * Start memory tracking
   */
  startMemoryTracking(interval: number = 5000): void {
    if (typeof performance === 'undefined' || !(performance as any).memory) {
      console.warn('Memory tracking not supported in this environment');
      return;
    }

    this.memoryInterval = setInterval(() => {
      const memory = (performance as any).memory;
      this.memoryHistory.push({
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        timestamp: performance.now(),
      });

      // Keep only last 100 samples
      if (this.memoryHistory.length > 100) {
        this.memoryHistory.shift();
      }
    }, interval);
  }

  /**
   * Stop memory tracking
   */
  stopMemoryTracking(): void {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = undefined;
    }
  }

  /**
   * Get current memory usage
   */
  getCurrentMemory(): MemoryUsage | null {
    if (typeof performance === 'undefined' || !(performance as any).memory) {
      return null;
    }

    const memory = (performance as any).memory;
    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      timestamp: performance.now(),
    };
  }

  /**
   * Get all metrics
   */
  getMetrics(): PerformanceMetrics {
    return {
      marks: [...this.marks],
      measures: [...this.measures],
      fps: [...this.fpsSamples],
      memory: this.getCurrentMemory() || undefined,
      budgetViolations: [...this.violations],
    };
  }

  /**
   * Export metrics as JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.getMetrics(), null, 2);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.marks = [];
    this.measures = [];
    this.fpsSamples = [];
    this.violations = [];
    this.memoryHistory = [];
  }

  /**
   * Destroy tracker
   */
  destroy(): void {
    this.stopFPSTracking();
    this.stopMemoryTracking();
    this.clear();
  }
}

/**
 * Global performance tracker instance
 */
export const performanceTracker = new PerformanceTracker();

/**
 * Timing decorator for methods
 */
export function Timing(budgetMs?: number) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const name = `${target.constructor.name}.${propertyKey}`;

      if (budgetMs) {
        performanceTracker.setBudget(name, budgetMs);
      }

      return performanceTracker.time(name, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Async timing decorator for methods
 */
export function AsyncTiming(budgetMs?: number) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const name = `${target.constructor.name}.${propertyKey}`;

      if (budgetMs) {
        performanceTracker.setBudget(name, budgetMs);
      }

      return performanceTracker.timeAsync(name, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Measure render time
 */
export function measureRender<T>(name: string, renderFn: () => T): T {
  return performanceTracker.time(`render:${name}`, renderFn);
}

/**
 * Measure async render time
 */
export async function measureRenderAsync<T>(name: string, renderFn: () => Promise<T>): Promise<T> {
  return performanceTracker.timeAsync(`render:${name}`, renderFn);
}

/**
 * Create performance report
 */
export function createPerformanceReport(metrics: PerformanceMetrics): string {
  const lines: string[] = [];

  lines.push('# Performance Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Measures
  if (metrics.measures.length > 0) {
    lines.push('## Measures');
    lines.push('');
    lines.push('| Name | Duration (ms) | Budget |');
    lines.push('|------|---------------|--------|');

    for (const measure of metrics.measures) {
      lines.push(`| ${measure.name} | ${measure.duration.toFixed(2)} | - |`);
    }

    lines.push('');
  }

  // FPS
  if (metrics.fps.length > 0) {
    const avgFps = Math.round(
      metrics.fps.reduce((acc, s) => acc + s.fps, 0) / metrics.fps.length
    );
    const minFps = Math.min(...metrics.fps.map((s) => s.fps));
    const maxFps = Math.max(...metrics.fps.map((s) => s.fps));

    lines.push('## FPS');
    lines.push('');
    lines.push(`- Average: ${avgFps}`);
    lines.push(`- Min: ${minFps}`);
    lines.push(`- Max: ${maxFps}`);
    lines.push('');
  }

  // Memory
  if (metrics.memory) {
    const usedMB = (metrics.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
    const totalMB = (metrics.memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
    const limitMB = (metrics.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2);

    lines.push('## Memory');
    lines.push('');
    lines.push(`- Used: ${usedMB} MB`);
    lines.push(`- Total: ${totalMB} MB`);
    lines.push(`- Limit: ${limitMB} MB`);
    lines.push('');
  }

  // Budget violations
  if (metrics.budgetViolations.length > 0) {
    lines.push('## Budget Violations');
    lines.push('');
    lines.push('| Measure | Duration (ms) | Budget (ms) | Exceeded |');
    lines.push('|---------|---------------|-------------|----------|');

    for (const violation of metrics.budgetViolations) {
      const exceeded = violation.duration - violation.budget;
      lines.push(
        `| ${violation.measure} | ${violation.duration.toFixed(2)} | ${violation.budget} | ${exceeded.toFixed(2)} |`
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}
