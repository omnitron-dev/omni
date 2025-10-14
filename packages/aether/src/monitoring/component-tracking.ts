/**
 * Component Render Tracking
 *
 * Tracks component lifecycle events, render performance, and re-render patterns.
 *
 * @module monitoring/component-tracking
 */

import { getPerformanceMonitor } from './performance.js';
import { signal } from '../core/reactivity/signal.js';
import type { WritableSignal } from '../core/reactivity/types.js';

/**
 * Component lifecycle event types
 */
export type ComponentLifecycleEvent = 'mount' | 'unmount' | 'render' | 'error';

/**
 * Component render information
 */
export interface ComponentRenderInfo {
  /** Component name or identifier */
  name: string;
  /** Render start time */
  startTime: number;
  /** Render end time */
  endTime: number;
  /** Render duration in ms */
  duration: number;
  /** Number of times this component has rendered */
  renderCount: number;
  /** Props that triggered the render */
  triggeredBy?: string[];
  /** Whether this was an initial mount or update */
  isMount: boolean;
  /** Component props (sanitized) */
  props?: Record<string, any>;
}

/**
 * Component mount information
 */
export interface ComponentMountInfo {
  /** Component name */
  name: string;
  /** Mount timestamp */
  mountTime: number;
  /** Unmount timestamp (if unmounted) */
  unmountTime?: number;
  /** Total lifetime in ms */
  lifetime?: number;
  /** Total number of renders */
  totalRenders: number;
  /** Average render duration */
  averageRenderDuration: number;
  /** Props at mount time */
  mountProps?: Record<string, any>;
}

/**
 * Props change tracking
 */
export interface PropsChange {
  /** Component name */
  component: string;
  /** Timestamp of change */
  timestamp: number;
  /** Changed prop names */
  changedProps: string[];
  /** Previous values */
  previousValues: Record<string, any>;
  /** New values */
  newValues: Record<string, any>;
}

/**
 * Effect execution information
 */
export interface EffectExecution {
  /** Component name */
  component: string;
  /** Effect identifier */
  effectId: string;
  /** Execution start time */
  startTime: number;
  /** Execution end time */
  endTime: number;
  /** Duration in ms */
  duration: number;
  /** Dependencies that triggered the effect */
  dependencies?: string[];
}

/**
 * Component tracker configuration
 */
export interface ComponentTrackerConfig {
  /** Enable component tracking */
  enabled?: boolean;
  /** Track props changes */
  trackProps?: boolean;
  /** Track effects execution */
  trackEffects?: boolean;
  /** Maximum number of render info entries to keep */
  maxRenderInfo?: number;
  /** Maximum number of mount info entries to keep */
  maxMountInfo?: number;
  /** Callback for slow renders */
  onSlowRender?: (info: ComponentRenderInfo) => void;
  /** Threshold for slow render in ms */
  slowRenderThreshold?: number;
}

/**
 * Component Performance Tracker
 *
 * Tracks component lifecycle, render performance, and re-render patterns.
 *
 * @example
 * ```typescript
 * const tracker = new ComponentTracker({
 *   enabled: true,
 *   slowRenderThreshold: 16,
 *   onSlowRender: (info) => {
 *     console.warn(`Slow render: ${info.name} took ${info.duration}ms`);
 *   }
 * });
 *
 * // Track component mount
 * tracker.trackMount('MyComponent', props);
 *
 * // Track render
 * tracker.trackRenderStart('MyComponent');
 * // ... render happens ...
 * tracker.trackRenderEnd('MyComponent');
 *
 * // Get statistics
 * const stats = tracker.getComponentStats('MyComponent');
 * console.log(`Average render: ${stats.averageRenderDuration}ms`);
 * ```
 */
export class ComponentTracker {
  private config: Required<ComponentTrackerConfig>;
  private renderInfo = new Map<string, ComponentRenderInfo[]>();
  private mountInfo = new Map<string, ComponentMountInfo>();
  private propsChanges = new Map<string, PropsChange[]>();
  private effectExecutions = new Map<string, EffectExecution[]>();
  private activeRenders = new Map<string, { startTime: number; renderCount: number }>();
  private renderCounts = new Map<string, number>();
  private enabled = true;

  constructor(config: ComponentTrackerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      trackProps: config.trackProps ?? true,
      trackEffects: config.trackEffects ?? true,
      maxRenderInfo: config.maxRenderInfo ?? 100,
      maxMountInfo: config.maxMountInfo ?? 50,
      onSlowRender: config.onSlowRender ?? (() => {}),
      slowRenderThreshold: config.slowRenderThreshold ?? 16,
    };

    this.enabled = this.config.enabled;
  }

  /**
   * Track component mount
   */
  trackMount(name: string, props?: Record<string, any>): void {
    if (!this.enabled) return;

    const mountTime = performance.now();

    this.mountInfo.set(name, {
      name,
      mountTime,
      totalRenders: 0,
      averageRenderDuration: 0,
      mountProps: this.config.trackProps ? this.sanitizeProps(props) : undefined,
    });

    this.renderCounts.set(name, 0);

    // Create performance mark
    getPerformanceMonitor().mark(`${name}-mount`, {
      type: 'component',
      component: name,
      event: 'mount',
    });
  }

  /**
   * Track component unmount
   */
  trackUnmount(name: string): void {
    if (!this.enabled) return;

    const unmountTime = performance.now();
    const info = this.mountInfo.get(name);

    if (info) {
      info.unmountTime = unmountTime;
      info.lifetime = unmountTime - info.mountTime;

      // Create performance mark
      getPerformanceMonitor().mark(`${name}-unmount`, {
        type: 'component',
        component: name,
        event: 'unmount',
      });

      // Measure total lifetime
      getPerformanceMonitor().measure(`${name}-lifetime`, `${name}-mount`, `${name}-unmount`);
    }
  }

  /**
   * Track render start
   */
  trackRenderStart(name: string): void {
    if (!this.enabled) return;

    const renderCount = (this.renderCounts.get(name) || 0) + 1;
    this.renderCounts.set(name, renderCount);

    this.activeRenders.set(name, {
      startTime: performance.now(),
      renderCount,
    });

    // Create performance mark
    getPerformanceMonitor().mark(`${name}-render-start-${renderCount}`, {
      type: 'component',
      component: name,
      event: 'render-start',
      renderCount,
    });
  }

  /**
   * Track render end
   */
  trackRenderEnd(name: string, triggeredBy?: string[]): void {
    if (!this.enabled) return;

    const active = this.activeRenders.get(name);
    if (!active) return;

    const endTime = performance.now();
    const duration = endTime - active.startTime;
    const renderCount = active.renderCount;

    const info: ComponentRenderInfo = {
      name,
      startTime: active.startTime,
      endTime,
      duration,
      renderCount,
      triggeredBy,
      isMount: renderCount === 1,
    };

    // Store render info
    if (!this.renderInfo.has(name)) {
      this.renderInfo.set(name, []);
    }
    const renders = this.renderInfo.get(name)!;
    renders.push(info);

    // Enforce max limit
    if (renders.length > this.config.maxRenderInfo) {
      renders.shift();
    }

    // Update mount info
    const mountInfo = this.mountInfo.get(name);
    if (mountInfo) {
      mountInfo.totalRenders = renderCount;
      const allRenders = this.renderInfo.get(name) || [];
      const totalDuration = allRenders.reduce((sum, r) => sum + r.duration, 0);
      mountInfo.averageRenderDuration = totalDuration / allRenders.length;
    }

    // Create performance mark and measure
    getPerformanceMonitor().mark(`${name}-render-end-${renderCount}`, {
      type: 'component',
      component: name,
      event: 'render-end',
      renderCount,
    });

    getPerformanceMonitor().measure(
      `${name}-render-${renderCount}`,
      `${name}-render-start-${renderCount}`,
      `${name}-render-end-${renderCount}`
    );

    // Check for slow render
    if (duration > this.config.slowRenderThreshold) {
      this.config.onSlowRender(info);
    }

    this.activeRenders.delete(name);
  }

  /**
   * Track props change
   */
  trackPropsChange(
    component: string,
    changedProps: string[],
    previousValues: Record<string, any>,
    newValues: Record<string, any>
  ): void {
    if (!this.enabled || !this.config.trackProps) return;

    const change: PropsChange = {
      component,
      timestamp: performance.now(),
      changedProps,
      previousValues: this.sanitizeProps(previousValues),
      newValues: this.sanitizeProps(newValues),
    };

    if (!this.propsChanges.has(component)) {
      this.propsChanges.set(component, []);
    }
    this.propsChanges.get(component)!.push(change);
  }

  /**
   * Track effect execution
   */
  trackEffectExecution(component: string, effectId: string, duration: number, dependencies?: string[]): void {
    if (!this.enabled || !this.config.trackEffects) return;

    const endTime = performance.now();
    const execution: EffectExecution = {
      component,
      effectId,
      startTime: endTime - duration,
      endTime,
      duration,
      dependencies,
    };

    if (!this.effectExecutions.has(component)) {
      this.effectExecutions.set(component, []);
    }
    this.effectExecutions.get(component)!.push(execution);
  }

  /**
   * Get component statistics
   */
  getComponentStats(name: string): ComponentMountInfo | null {
    return this.mountInfo.get(name) || null;
  }

  /**
   * Get all component render history
   */
  getComponentRenderHistory(name: string): ComponentRenderInfo[] {
    return this.renderInfo.get(name) || [];
  }

  /**
   * Get props change history
   */
  getPropsChangeHistory(name: string): PropsChange[] {
    return this.propsChanges.get(name) || [];
  }

  /**
   * Get effect execution history
   */
  getEffectExecutionHistory(name: string): EffectExecution[] {
    return this.effectExecutions.get(name) || [];
  }

  /**
   * Get all tracked components
   */
  getAllComponents(): string[] {
    return Array.from(this.mountInfo.keys());
  }

  /**
   * Get components with most re-renders
   */
  getTopRerenderingComponents(limit: number = 10): Array<{ name: string; renderCount: number }> {
    const components = Array.from(this.renderCounts.entries())
      .map(([name, renderCount]) => ({ name, renderCount }))
      .sort((a, b) => b.renderCount - a.renderCount)
      .slice(0, limit);

    return components;
  }

  /**
   * Get slowest rendering components
   */
  getSlowestComponents(limit: number = 10): Array<{ name: string; averageDuration: number }> {
    const components = Array.from(this.mountInfo.values())
      .map((info) => ({
        name: info.name,
        averageDuration: info.averageRenderDuration,
      }))
      .sort((a, b) => b.averageDuration - a.averageDuration)
      .slice(0, limit);

    return components;
  }

  /**
   * Sanitize props for storage (remove functions, large objects, etc.)
   */
  private sanitizeProps(props?: Record<string, any>): Record<string, any> | undefined {
    if (!props) return undefined;

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'function') {
        sanitized[key] = '[Function]';
      } else if (value === null) {
        sanitized[key] = null;
      } else if (typeof value === 'object') {
        sanitized[key] = '[Object]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.renderInfo.clear();
    this.mountInfo.clear();
    this.propsChanges.clear();
    this.effectExecutions.clear();
    this.activeRenders.clear();
    this.renderCounts.clear();
  }

  /**
   * Enable tracking
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable tracking
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Global component tracker instance
 */
let globalTracker: ComponentTracker | null = null;

/**
 * Get or create the global component tracker
 */
export function getComponentTracker(config?: ComponentTrackerConfig): ComponentTracker {
  if (!globalTracker) {
    globalTracker = new ComponentTracker(config);
  }
  return globalTracker;
}

/**
 * Reset the global component tracker
 */
export function resetComponentTracker(): void {
  if (globalTracker) {
    globalTracker.clear();
    globalTracker = null;
  }
}

/**
 * Create a reactive component tracker that integrates with signals
 */
export function createReactiveComponentTracker(config?: ComponentTrackerConfig): {
  tracker: ComponentTracker;
  stats: WritableSignal<Map<string, ComponentMountInfo>>;
  topRerendering: WritableSignal<Array<{ name: string; renderCount: number }>>;
  slowest: WritableSignal<Array<{ name: string; averageDuration: number }>>;
} {
  const tracker = new ComponentTracker(config);
  const stats = signal(new Map<string, ComponentMountInfo>());
  const topRerendering = signal<Array<{ name: string; renderCount: number }>>([]);
  const slowest = signal<Array<{ name: string; averageDuration: number }>>([]);

  // Update signals periodically
  const updateStats = () => {
    const allComponents = tracker.getAllComponents();
    const newStats = new Map<string, ComponentMountInfo>();

    for (const name of allComponents) {
      const componentStats = tracker.getComponentStats(name);
      if (componentStats) {
        newStats.set(name, componentStats);
      }
    }

    stats.set(newStats);
    topRerendering.set(tracker.getTopRerenderingComponents(10));
    slowest.set(tracker.getSlowestComponents(10));
  };

  // Update every second
  setInterval(updateStats, 1000);

  return {
    tracker,
    stats,
    topRerendering,
    slowest,
  };
}
