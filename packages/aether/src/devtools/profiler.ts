/**
 * Performance Profiler - Measure and analyze performance
 *
 * Provides performance profiling capabilities for components, effects,
 * and computed values to identify bottlenecks.
 *
 * @module devtools/profiler
 */

import type { Profiler, ProfilerState, PerformanceProfile, PerformanceMeasurement } from './types.js';

/**
 * Default bottleneck threshold (ms)
 */
const DEFAULT_BOTTLENECK_THRESHOLD = 16; // One frame at 60fps

/**
 * Generate unique ID
 */
let nextMeasurementId = 0;
const generateMeasurementId = (): string => `measurement-${++nextMeasurementId}`;

let nextProfileId = 0;
const generateProfileId = (): string => `profile-${++nextProfileId}`;

/**
 * Get call stack trace
 */
function getStackTrace(): string {
  const stack = new Error().stack;
  if (!stack) return '';
  return stack.split('\n').slice(3).join('\n');
}

/**
 * Get memory usage (if available)
 */
function getMemoryUsage(): number | undefined {
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const memory = (performance as any).memory;
    if (memory && typeof memory.usedJSHeapSize === 'number') {
      return memory.usedJSHeapSize;
    }
  }
  return undefined;
}

/**
 * Performance measurement tracker
 */
class MeasurementTracker {
  private startTime: number;
  private startMemory?: number;
  private type: 'component' | 'effect' | 'computed';
  private targetId: string;
  private name: string;

  constructor(type: 'component' | 'effect' | 'computed', targetId: string, name: string) {
    this.type = type;
    this.targetId = targetId;
    this.name = name;
    this.startTime = performance.now();
    this.startMemory = getMemoryUsage();
  }

  /**
   * End measurement and return result
   */
  end(): PerformanceMeasurement {
    const endTime = performance.now();
    const endMemory = getMemoryUsage();
    const duration = endTime - this.startTime;

    let memoryDelta: number | undefined;
    if (this.startMemory !== undefined && endMemory !== undefined) {
      memoryDelta = endMemory - this.startMemory;
    }

    return {
      id: generateMeasurementId(),
      type: this.type,
      targetId: this.targetId,
      name: this.name,
      startTime: this.startTime,
      duration,
      memoryDelta,
      stack: getStackTrace(),
    };
  }
}

/**
 * Profiler implementation
 */
export class ProfilerImpl implements Profiler {
  private isProfiling = false;
  private currentProfile?: PerformanceProfile;
  private measurements: PerformanceMeasurement[] = [];
  private activeMeasurements = new Map<string, MeasurementTracker>();

  // Statistics tracking
  private componentStats = new Map<string, { total: number; count: number }>();
  private effectStats = new Map<string, { total: number; count: number }>();
  private computedStats = new Map<string, { total: number; count: number }>();

  /**
   * Start profiling session
   */
  startProfiling(): void {
    if (this.isProfiling) return;

    this.isProfiling = true;
    this.measurements = [];
    this.activeMeasurements.clear();

    this.currentProfile = {
      id: generateProfileId(),
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      measurements: [],
      summary: {
        totalComponents: 0,
        totalEffects: 0,
        totalComputed: 0,
      },
    };
  }

  /**
   * Stop profiling session
   */
  stopProfiling(): PerformanceProfile {
    if (!this.isProfiling || !this.currentProfile) {
      throw new Error('Profiling not active');
    }

    this.isProfiling = false;

    const endTime = performance.now();
    this.currentProfile.endTime = endTime;
    this.currentProfile.duration = endTime - this.currentProfile.startTime;
    this.currentProfile.measurements = [...this.measurements];

    // Calculate summary
    this.currentProfile.summary = this.calculateSummary();

    const profile = this.currentProfile;
    this.currentProfile = undefined;

    return profile;
  }

  /**
   * Start measuring component render
   */
  startMeasuringComponent(componentId: string, name: string): void {
    if (!this.isProfiling) return;

    const tracker = new MeasurementTracker('component', componentId, name);
    this.activeMeasurements.set(`component:${componentId}`, tracker);
  }

  /**
   * End measuring component render
   */
  endMeasuringComponent(componentId: string): void {
    if (!this.isProfiling) return;

    const key = `component:${componentId}`;
    const tracker = this.activeMeasurements.get(key);
    if (!tracker) return;

    const measurement = tracker.end();
    this.measurements.push(measurement);
    this.activeMeasurements.delete(key);

    // Update stats
    this.updateStats(this.componentStats, componentId, measurement.duration);
  }

  /**
   * Measure component (convenience wrapper)
   */
  measureComponent(component: any, fn: () => void): void {
    if (!this.isProfiling) {
      fn();
      return;
    }

    const componentId = component.id || component.name || 'anonymous';
    const name = component.name || 'Anonymous';

    this.startMeasuringComponent(componentId, name);
    try {
      fn();
    } finally {
      this.endMeasuringComponent(componentId);
    }
  }

  /**
   * Start measuring effect
   */
  startMeasuringEffect(effectId: string, name: string): void {
    if (!this.isProfiling) return;

    const tracker = new MeasurementTracker('effect', effectId, name);
    this.activeMeasurements.set(`effect:${effectId}`, tracker);
  }

  /**
   * End measuring effect
   */
  endMeasuringEffect(effectId: string): void {
    if (!this.isProfiling) return;

    const key = `effect:${effectId}`;
    const tracker = this.activeMeasurements.get(key);
    if (!tracker) return;

    const measurement = tracker.end();
    this.measurements.push(measurement);
    this.activeMeasurements.delete(key);

    // Update stats
    this.updateStats(this.effectStats, effectId, measurement.duration);
  }

  /**
   * Measure effect (convenience wrapper)
   */
  measureEffect(effect: () => void, fn: () => void): void {
    if (!this.isProfiling) {
      fn();
      return;
    }

    const effectId = (effect as any).id || 'anonymous';
    const name = (effect as any).name || 'Anonymous';

    this.startMeasuringEffect(effectId, name);
    try {
      fn();
    } finally {
      this.endMeasuringEffect(effectId);
    }
  }

  /**
   * Start measuring computed
   */
  startMeasuringComputed(computedId: string, name: string): void {
    if (!this.isProfiling) return;

    const tracker = new MeasurementTracker('computed', computedId, name);
    this.activeMeasurements.set(`computed:${computedId}`, tracker);
  }

  /**
   * End measuring computed
   */
  endMeasuringComputed(computedId: string): void {
    if (!this.isProfiling) return;

    const key = `computed:${computedId}`;
    const tracker = this.activeMeasurements.get(key);
    if (!tracker) return;

    const measurement = tracker.end();
    this.measurements.push(measurement);
    this.activeMeasurements.delete(key);

    // Update stats
    this.updateStats(this.computedStats, computedId, measurement.duration);
  }

  /**
   * Update statistics
   */
  private updateStats(
    stats: Map<string, { total: number; count: number }>,
    id: string,
    duration: number,
  ): void {
    const existing = stats.get(id);
    if (existing) {
      existing.total += duration;
      existing.count++;
    } else {
      stats.set(id, { total: duration, count: 1 });
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(): PerformanceProfile['summary'] {
    const componentMeasurements = this.measurements.filter(m => m.type === 'component');
    const effectMeasurements = this.measurements.filter(m => m.type === 'effect');
    const computedMeasurements = this.measurements.filter(m => m.type === 'computed');

    const slowestComponent = this.findSlowest(componentMeasurements);
    const slowestEffect = this.findSlowest(effectMeasurements);
    const slowestComputed = this.findSlowest(computedMeasurements);

    return {
      totalComponents: componentMeasurements.length,
      totalEffects: effectMeasurements.length,
      totalComputed: computedMeasurements.length,
      slowestComponent,
      slowestEffect,
      slowestComputed,
    };
  }

  /**
   * Find slowest measurement
   */
  private findSlowest(measurements: PerformanceMeasurement[]): PerformanceMeasurement | undefined {
    if (measurements.length === 0) return undefined;
    return measurements.reduce((slowest, current) =>
      current.duration > slowest.duration ? current : slowest,
    );
  }

  /**
   * Get performance report
   */
  getPerformanceReport(): PerformanceProfile | undefined {
    return this.currentProfile;
  }

  /**
   * Identify bottlenecks
   */
  identifyBottlenecks(threshold = DEFAULT_BOTTLENECK_THRESHOLD): PerformanceMeasurement[] {
    return this.measurements
      .filter(m => m.duration > threshold)
      .sort((a, b) => b.duration - a.duration);
  }

  /**
   * Get current state
   */
  getState(): ProfilerState {
    return {
      isProfiling: this.isProfiling,
      currentProfile: this.currentProfile,
      measurements: [...this.measurements],
      bottlenecks: this.identifyBottlenecks(),
    };
  }

  /**
   * Clear measurements
   */
  clear(): void {
    this.measurements = [];
    this.activeMeasurements.clear();
    this.componentStats.clear();
    this.effectStats.clear();
    this.computedStats.clear();
  }

  /**
   * Get average execution time for target
   */
  getAverageTime(targetId: string, type: 'component' | 'effect' | 'computed'): number {
    const stats =
      type === 'component'
        ? this.componentStats
        : type === 'effect'
          ? this.effectStats
          : this.computedStats;

    const stat = stats.get(targetId);
    if (!stat || stat.count === 0) return 0;

    return stat.total / stat.count;
  }
}

/**
 * Create profiler instance
 */
export function createProfiler(): Profiler {
  return new ProfilerImpl();
}
