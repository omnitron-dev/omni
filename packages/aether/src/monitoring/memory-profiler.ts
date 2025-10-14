/**
 * Memory Profiling
 *
 * Tracks memory usage, component footprints, and detects potential memory leaks.
 *
 * @module monitoring/memory-profiler
 */

import { getPerformanceMonitor } from './performance.js';

export interface MemorySnapshot {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  percentage: number;
}

export interface ComponentMemoryInfo {
  componentName: string;
  instanceCount: number;
  estimatedSize: number;
  domNodes: number;
  eventListeners: number;
}

export interface MemoryLeak {
  type: 'component' | 'event-listener' | 'dom-node' | 'signal';
  identifier: string;
  growthRate: number;
  timestamp: number;
  description: string;
}

export interface MemoryProfilerConfig {
  enabled?: boolean;
  snapshotInterval?: number;
  maxSnapshots?: number;
  leakDetectionThreshold?: number;
  onLeakDetected?: (leak: MemoryLeak) => void;
}

export class MemoryProfiler {
  private config: Required<MemoryProfilerConfig>;
  private snapshots: MemorySnapshot[] = [];
  private componentMemory = new Map<string, ComponentMemoryInfo>();
  private detectedLeaks: MemoryLeak[] = [];
  private snapshotTimer?: ReturnType<typeof setInterval>;
  private enabled = true;

  constructor(config: MemoryProfilerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      snapshotInterval: config.snapshotInterval ?? 5000,
      maxSnapshots: config.maxSnapshots ?? 100,
      leakDetectionThreshold: config.leakDetectionThreshold ?? 0.1,
      onLeakDetected: config.onLeakDetected ?? (() => {}),
    };

    this.enabled = this.config.enabled;

    if (this.enabled) {
      this.startProfiling();
    }
  }

  private startProfiling(): void {
    this.snapshotTimer = setInterval(() => {
      this.takeSnapshot();
      this.detectLeaks();
    }, this.config.snapshotInterval);
  }

  takeSnapshot(): MemorySnapshot {
    if (!this.enabled || typeof performance === 'undefined') {
      // Return a mock snapshot in environments without performance.memory
      return {
        timestamp: Date.now(),
        usedJSHeapSize: 0,
        totalJSHeapSize: 0,
        jsHeapSizeLimit: 0,
        percentage: 0,
      };
    }

    const memory = (performance as any).memory;
    if (!memory) {
      // Return a mock snapshot in environments without performance.memory
      return {
        timestamp: performance.now(),
        usedJSHeapSize: 0,
        totalJSHeapSize: 0,
        jsHeapSizeLimit: 0,
        percentage: 0,
      };
    }

    const snapshot: MemorySnapshot = {
      timestamp: performance.now(),
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      percentage: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
    };

    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    getPerformanceMonitor().mark('memory-snapshot', {
      type: 'custom',
      usedMemory: snapshot.usedJSHeapSize,
      percentage: snapshot.percentage,
    });

    return snapshot;
  }

  trackComponent(name: string, estimatedSize: number = 0, domNodes: number = 0, eventListeners: number = 0): void {
    if (!this.enabled) return;

    const existing = this.componentMemory.get(name);
    if (existing) {
      existing.instanceCount++;
      existing.estimatedSize += estimatedSize;
      existing.domNodes += domNodes;
      existing.eventListeners += eventListeners;
    } else {
      this.componentMemory.set(name, {
        componentName: name,
        instanceCount: 1,
        estimatedSize,
        domNodes,
        eventListeners,
      });
    }
  }

  untrackComponent(name: string): void {
    if (!this.enabled) return;

    const existing = this.componentMemory.get(name);
    if (existing) {
      existing.instanceCount = Math.max(0, existing.instanceCount - 1);
      if (existing.instanceCount === 0) {
        this.componentMemory.delete(name);
      }
    }
  }

  private detectLeaks(): void {
    if (this.snapshots.length < 10) return;

    const recent = this.snapshots.slice(-10);
    const firstSnapshot = recent[0];
    const lastSnapshot = recent[recent.length - 1];
    if (!firstSnapshot || !lastSnapshot || firstSnapshot.usedJSHeapSize === 0) return;
    const growthRate = (lastSnapshot.usedJSHeapSize - firstSnapshot.usedJSHeapSize) / firstSnapshot.usedJSHeapSize;

    if (growthRate > this.config.leakDetectionThreshold) {
      const leak: MemoryLeak = {
        type: 'component',
        identifier: 'general',
        growthRate,
        timestamp: performance.now(),
        description: `Memory growing at ${(growthRate * 100).toFixed(2)}% over recent samples`,
      };

      this.detectedLeaks.push(leak);
      this.config.onLeakDetected(leak);
    }
  }

  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  getLatestSnapshot(): MemorySnapshot | null {
    return this.snapshots[this.snapshots.length - 1] || null;
  }

  getComponentMemory(): ComponentMemoryInfo[] {
    return Array.from(this.componentMemory.values());
  }

  getDetectedLeaks(): MemoryLeak[] {
    return [...this.detectedLeaks];
  }

  getTotalDOMNodes(): number {
    return Array.from(this.componentMemory.values()).reduce((sum, info) => sum + info.domNodes, 0);
  }

  getTotalEventListeners(): number {
    return Array.from(this.componentMemory.values()).reduce((sum, info) => sum + info.eventListeners, 0);
  }

  /**
   * Get largest components by memory usage
   */
  getLargestComponents(limit: number = 10): Array<{ name: string; memory: number }> {
    return Array.from(this.componentMemory.values())
      .map((info) => ({
        name: info.componentName,
        memory: info.estimatedSize,
      }))
      .sort((a, b) => b.memory - a.memory)
      .slice(0, limit);
  }

  /**
   * Get memory statistics
   */
  getStatistics(): {
    totalComponents: number;
    totalMemory: number;
    averageMemory: number;
  } {
    const components = Array.from(this.componentMemory.values());
    const totalComponents = components.length;
    const totalMemory = components.reduce((sum, info) => sum + info.estimatedSize, 0);
    const averageMemory = totalComponents > 0 ? totalMemory / totalComponents : 0;

    return {
      totalComponents,
      totalMemory,
      averageMemory,
    };
  }

  /**
   * Start profiling (alias for enable with snapshot start)
   */
  start(): void {
    this.enable();
  }

  clear(): void {
    this.snapshots = [];
    this.componentMemory.clear();
    this.detectedLeaks = [];
  }

  enable(): void {
    this.enabled = true;
    if (!this.snapshotTimer) {
      this.startProfiling();
    }
  }

  disable(): void {
    this.enabled = false;
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  /**
   * Stop profiling (alias for disable)
   */
  stop(): void {
    this.disable();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.disable();
    this.clear();
  }
}

let globalProfiler: MemoryProfiler | null = null;

export function getMemoryProfiler(config?: MemoryProfilerConfig): MemoryProfiler {
  if (!globalProfiler) {
    globalProfiler = new MemoryProfiler(config);
  }
  return globalProfiler;
}

export function resetMemoryProfiler(): void {
  if (globalProfiler) {
    globalProfiler.dispose();
    globalProfiler = null;
  }
}
