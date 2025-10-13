/**
 * Performance Profiler UI
 *
 * Provides visual performance profiling with flame graphs, timelines,
 * bottleneck detection, memory graphs, and FPS monitoring.
 *
 * @module devtools/profiler-ui
 */

import type { Profiler, PerformanceProfile, PerformanceMeasurement } from './types.js';

/**
 * Profiler UI configuration
 */
export interface ProfilerUIConfig {
  /** Enable flame graph */
  enableFlameGraph?: boolean;
  /** Enable timeline */
  enableTimeline?: boolean;
  /** Enable FPS counter */
  enableFPSCounter?: boolean;
  /** Enable memory graph */
  enableMemoryGraph?: boolean;
  /** Target FPS (default: 60) */
  targetFPS?: number;
  /** Bottleneck threshold (ms) */
  bottleneckThreshold?: number;
  /** Show overlay */
  showOverlay?: boolean;
  /** Position of overlay */
  overlayPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Flame graph node
 */
export interface FlameGraphNode {
  name: string;
  value: number;
  children: FlameGraphNode[];
  type: 'component' | 'effect' | 'computed';
  startTime: number;
  duration: number;
  depth: number;
}

/**
 * Timeline event
 */
export interface TimelineEvent {
  id: string;
  name: string;
  type: 'component' | 'effect' | 'computed';
  startTime: number;
  duration: number;
  lane: number;
}

/**
 * FPS data point
 */
export interface FPSDataPoint {
  timestamp: number;
  fps: number;
  frameTime: number;
}

/**
 * Memory data point
 */
export interface MemoryDataPoint {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Bottleneck info
 */
export interface BottleneckInfo {
  measurement: PerformanceMeasurement;
  severity: 'critical' | 'warning' | 'info';
  impact: number; // percentage of total time
  recommendation: string;
}

/**
 * Render phase breakdown
 */
export interface RenderPhaseBreakdown {
  component: number;
  effect: number;
  computed: number;
  total: number;
  percentages: {
    component: number;
    effect: number;
    computed: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<ProfilerUIConfig> = {
  enableFlameGraph: true,
  enableTimeline: true,
  enableFPSCounter: true,
  enableMemoryGraph: true,
  targetFPS: 60,
  bottleneckThreshold: 16, // 60fps frame time
  showOverlay: true,
  overlayPosition: 'top-right',
};

/**
 * Profiler UI implementation
 */
export class ProfilerUI {
  private config: Required<ProfilerUIConfig>;
  private profiler: Profiler;
  private isEnabled = false;

  // FPS tracking
  private fpsData: FPSDataPoint[] = [];
  private lastFrameTime = 0;
  private frameCount = 0;
  private fpsUpdateInterval?: number;

  // Memory tracking
  private memoryData: MemoryDataPoint[] = [];
  private memoryUpdateInterval?: number;

  // Overlay elements
  private overlayContainer?: HTMLDivElement;
  private fpsCounter?: HTMLDivElement;
  private memoryGraph?: HTMLDivElement;

  constructor(profiler: Profiler, config: Partial<ProfilerUIConfig> = {}) {
    this.profiler = profiler;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Enable profiler UI
   */
  enable(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;

    if (this.config.showOverlay) {
      this.createOverlay();
    }

    if (this.config.enableFPSCounter) {
      this.startFPSTracking();
    }

    if (this.config.enableMemoryGraph) {
      this.startMemoryTracking();
    }
  }

  /**
   * Disable profiler UI
   */
  disable(): void {
    if (!this.isEnabled) return;
    this.isEnabled = false;

    this.stopFPSTracking();
    this.stopMemoryTracking();
    this.removeOverlay();
  }

  /**
   * Generate flame graph from profile
   */
  generateFlameGraph(profile: PerformanceProfile): FlameGraphNode {
    const root: FlameGraphNode = {
      name: 'Root',
      value: profile.duration,
      children: [],
      type: 'component',
      startTime: profile.startTime,
      duration: profile.duration,
      depth: 0,
    };

    // Sort measurements by start time
    const sorted = [...profile.measurements].sort((a, b) => a.startTime - b.startTime);

    // Build tree structure
    const stack: FlameGraphNode[] = [root];

    for (const measurement of sorted) {
      const node: FlameGraphNode = {
        name: measurement.name,
        value: measurement.duration,
        children: [],
        type: measurement.type,
        startTime: measurement.startTime,
        duration: measurement.duration,
        depth: 0,
      };

      // Find parent (last node that contains this one)
      while (stack.length > 1) {
        const parent = stack[stack.length - 1];
        if (!parent) break;

        const parentEnd = parent.startTime + parent.duration;

        if (measurement.startTime >= parent.startTime && measurement.startTime < parentEnd) {
          // This node is a child of parent
          node.depth = parent.depth + 1;
          parent.children.push(node);
          stack.push(node);
          break;
        } else {
          // Pop parent from stack
          stack.pop();
        }
      }

      // If we popped everything, add to root
      if (stack.length === 1) {
        node.depth = 1;
        root.children.push(node);
        stack.push(node);
      }
    }

    return root;
  }

  /**
   * Generate timeline events
   */
  generateTimeline(profile: PerformanceProfile): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    const lanes = new Map<string, number>();
    let nextLane = 0;

    // Sort measurements by start time
    const sorted = [...profile.measurements].sort((a, b) => a.startTime - b.startTime);

    for (const measurement of sorted) {
      // Find available lane
      let lane = 0;
      for (const [key, laneNum] of lanes.entries()) {
        const existing = events.find(e => e.id === key);
        if (existing) {
          const existingEnd = existing.startTime + existing.duration;
          if (measurement.startTime >= existingEnd) {
            lane = laneNum;
            lanes.delete(key);
            break;
          }
        }
      }

      if (lane === 0) {
        lane = nextLane++;
      }

      const event: TimelineEvent = {
        id: measurement.id,
        name: measurement.name,
        type: measurement.type,
        startTime: measurement.startTime - profile.startTime,
        duration: measurement.duration,
        lane,
      };

      events.push(event);
      lanes.set(measurement.id, lane);
    }

    return events;
  }

  /**
   * Identify bottlenecks with analysis
   */
  identifyBottlenecks(profile: PerformanceProfile): BottleneckInfo[] {
    const bottlenecks: BottleneckInfo[] = [];
    const threshold = this.config.bottleneckThreshold;

    const slowMeasurements = profile.measurements
      .filter(m => m.duration > threshold)
      .sort((a, b) => b.duration - a.duration);

    for (const measurement of slowMeasurements) {
      const impact = (measurement.duration / profile.duration) * 100;

      let severity: 'critical' | 'warning' | 'info';
      if (measurement.duration > threshold * 3) {
        severity = 'critical';
      } else if (measurement.duration > threshold * 2) {
        severity = 'warning';
      } else {
        severity = 'info';
      }

      const recommendation = this.getBottleneckRecommendation(measurement);

      bottlenecks.push({
        measurement,
        severity,
        impact,
        recommendation,
      });
    }

    return bottlenecks;
  }

  /**
   * Get bottleneck recommendation
   */
  private getBottleneckRecommendation(measurement: PerformanceMeasurement): string {
    switch (measurement.type) {
      case 'component':
        return 'Consider memoization, splitting into smaller components, or lazy loading.';
      case 'effect':
        return 'Review effect dependencies and consider debouncing or throttling.';
      case 'computed':
        return 'Optimize computation logic or break into smaller computed values.';
      default:
        return 'Review implementation for optimization opportunities.';
    }
  }

  /**
   * Get render phase breakdown
   */
  getRenderPhaseBreakdown(profile: PerformanceProfile): RenderPhaseBreakdown {
    let componentTime = 0;
    let effectTime = 0;
    let computedTime = 0;

    for (const measurement of profile.measurements) {
      switch (measurement.type) {
        case 'component':
          componentTime += measurement.duration;
          break;
        case 'effect':
          effectTime += measurement.duration;
          break;
        case 'computed':
          computedTime += measurement.duration;
          break;
        default:
          // Unknown measurement type, skip
          break;
      }
    }

    const total = componentTime + effectTime + computedTime;

    return {
      component: componentTime,
      effect: effectTime,
      computed: computedTime,
      total,
      percentages: {
        component: total > 0 ? (componentTime / total) * 100 : 0,
        effect: total > 0 ? (effectTime / total) * 100 : 0,
        computed: total > 0 ? (computedTime / total) * 100 : 0,
      },
    };
  }

  /**
   * Start FPS tracking
   */
  private startFPSTracking(): void {
    this.lastFrameTime = performance.now();
    this.frameCount = 0;

    const trackFrame = () => {
      if (!this.isEnabled) return;

      const now = performance.now();
      const delta = now - this.lastFrameTime;
      this.frameCount++;

      // Update FPS every second
      if (delta >= 1000) {
        const fps = Math.round((this.frameCount * 1000) / delta);
        const frameTime = delta / this.frameCount;

        this.fpsData.push({
          timestamp: now,
          fps,
          frameTime,
        });

        // Keep last 100 data points
        if (this.fpsData.length > 100) {
          this.fpsData.shift();
        }

        this.updateFPSCounter(fps, frameTime);

        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      requestAnimationFrame(trackFrame);
    };

    requestAnimationFrame(trackFrame);
  }

  /**
   * Stop FPS tracking
   */
  private stopFPSTracking(): void {
    // FPS tracking stops when isEnabled is false
  }

  /**
   * Start memory tracking
   */
  private startMemoryTracking(): void {
    this.memoryUpdateInterval = window.setInterval(() => {
      if (!this.isEnabled) return;

      const memory = this.getMemoryInfo();
      if (memory) {
        this.memoryData.push(memory);

        // Keep last 100 data points
        if (this.memoryData.length > 100) {
          this.memoryData.shift();
        }

        this.updateMemoryGraph();
      }
    }, 1000);
  }

  /**
   * Stop memory tracking
   */
  private stopMemoryTracking(): void {
    if (this.memoryUpdateInterval) {
      clearInterval(this.memoryUpdateInterval);
      this.memoryUpdateInterval = undefined;
    }
  }

  /**
   * Get memory info
   */
  private getMemoryInfo(): MemoryDataPoint | null {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory;
      if (memory) {
        return {
          timestamp: Date.now(),
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
        };
      }
    }
    return null;
  }

  /**
   * Create overlay
   */
  private createOverlay(): void {
    if (this.overlayContainer) return;

    this.overlayContainer = document.createElement('div');
    this.overlayContainer.style.cssText = `
      position: fixed;
      ${this.getOverlayPositionStyle()}
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      z-index: 999999;
      pointer-events: none;
      min-width: 200px;
    `;

    if (this.config.enableFPSCounter) {
      this.fpsCounter = document.createElement('div');
      this.fpsCounter.style.cssText = 'margin-bottom: 8px;';
      this.overlayContainer.appendChild(this.fpsCounter);
    }

    if (this.config.enableMemoryGraph) {
      this.memoryGraph = document.createElement('div');
      this.memoryGraph.style.cssText = 'font-size: 10px;';
      this.overlayContainer.appendChild(this.memoryGraph);
    }

    document.body.appendChild(this.overlayContainer);
  }

  /**
   * Get overlay position style
   */
  private getOverlayPositionStyle(): string {
    switch (this.config.overlayPosition) {
      case 'top-left':
        return 'top: 10px; left: 10px;';
      case 'top-right':
        return 'top: 10px; right: 10px;';
      case 'bottom-left':
        return 'bottom: 10px; left: 10px;';
      case 'bottom-right':
        return 'bottom: 10px; right: 10px;';
      default:
        return 'top: 10px; right: 10px;';
    }
  }

  /**
   * Update FPS counter
   */
  private updateFPSCounter(fps: number, frameTime: number): void {
    if (!this.fpsCounter) return;

    const color = fps >= this.config.targetFPS ? '#0f0' : fps >= this.config.targetFPS * 0.8 ? '#ff0' : '#f00';

    this.fpsCounter.innerHTML = `
      <div>FPS: <span style="color: ${color}; font-weight: bold;">${fps}</span></div>
      <div>Frame: ${frameTime.toFixed(2)}ms</div>
    `;
  }

  /**
   * Update memory graph
   */
  private updateMemoryGraph(): void {
    if (!this.memoryGraph || this.memoryData.length === 0) return;

    const latest = this.memoryData[this.memoryData.length - 1];
    if (!latest) return;

    const usedMB = (latest.usedJSHeapSize / 1024 / 1024).toFixed(1);
    const totalMB = (latest.totalJSHeapSize / 1024 / 1024).toFixed(1);
    const percentage = ((latest.usedJSHeapSize / latest.totalJSHeapSize) * 100).toFixed(1);

    this.memoryGraph.innerHTML = `
      <div>Memory: ${usedMB} / ${totalMB} MB</div>
      <div>Usage: ${percentage}%</div>
    `;
  }

  /**
   * Remove overlay
   */
  private removeOverlay(): void {
    if (this.overlayContainer) {
      this.overlayContainer.remove();
      this.overlayContainer = undefined;
      this.fpsCounter = undefined;
      this.memoryGraph = undefined;
    }
  }

  /**
   * Get FPS history
   */
  getFPSHistory(): FPSDataPoint[] {
    return [...this.fpsData];
  }

  /**
   * Get memory history
   */
  getMemoryHistory(): MemoryDataPoint[] {
    return [...this.memoryData];
  }

  /**
   * Get current FPS
   */
  getCurrentFPS(): number {
    if (this.fpsData.length === 0) return 0;
    const latest = this.fpsData[this.fpsData.length - 1];
    return latest ? latest.fps : 0;
  }

  /**
   * Get average FPS
   */
  getAverageFPS(): number {
    if (this.fpsData.length === 0) return 0;
    const sum = this.fpsData.reduce((acc, point) => acc + point.fps, 0);
    return sum / this.fpsData.length;
  }

  /**
   * Export profiling report
   */
  exportReport(profile: PerformanceProfile): string {
    const breakdown = this.getRenderPhaseBreakdown(profile);
    const bottlenecks = this.identifyBottlenecks(profile);
    const avgFPS = this.getAverageFPS();

    const report = {
      profile: {
        id: profile.id,
        duration: profile.duration,
        startTime: profile.startTime,
        endTime: profile.endTime,
      },
      summary: profile.summary,
      breakdown,
      bottlenecks: bottlenecks.map(b => ({
        name: b.measurement.name,
        type: b.measurement.type,
        duration: b.measurement.duration,
        severity: b.severity,
        impact: b.impact,
        recommendation: b.recommendation,
      })),
      performance: {
        averageFPS: avgFPS,
        fpsHistory: this.fpsData,
        memoryHistory: this.memoryData,
      },
    };

    return JSON.stringify(report, null, 2);
  }
}

/**
 * Create profiler UI instance
 */
export function createProfilerUI(profiler: Profiler, config?: Partial<ProfilerUIConfig>): ProfilerUI {
  return new ProfilerUI(profiler, config);
}
