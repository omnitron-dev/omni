/**
 * Signal Update Tracking
 *
 * Monitors signal updates, subscriptions, and dependency graphs for
 * performance analysis and debugging.
 *
 * @module monitoring/signal-tracking
 */

import { getPerformanceMonitor } from './performance.js';
import { signal } from '../core/reactivity/signal.js';
import type { WritableSignal } from '../core/reactivity/types.js';

/**
 * Signal update information
 */
export interface SignalUpdateInfo {
  /** Signal identifier */
  signalId: string;
  /** Update timestamp */
  timestamp: number;
  /** Previous value (sanitized) */
  previousValue: any;
  /** New value (sanitized) */
  newValue: any;
  /** Number of subscribers notified */
  subscribersNotified: number;
  /** Update duration in ms */
  duration: number;
  /** Stack trace (if available) */
  stack?: string;
}

/**
 * Signal subscription information
 */
export interface SignalSubscriptionInfo {
  /** Signal identifier */
  signalId: string;
  /** Number of active subscriptions */
  subscriptionCount: number;
  /** Subscription rate (subscriptions per second) */
  subscriptionRate: number;
  /** Last subscription timestamp */
  lastSubscription: number;
}

/**
 * Signal dependency information
 */
export interface SignalDependency {
  /** Signal identifier */
  signalId: string;
  /** Signals that depend on this signal */
  dependents: string[];
  /** Signals this signal depends on */
  dependencies: string[];
  /** Depth in dependency tree */
  depth: number;
}

/**
 * Circular dependency detection result
 */
export interface CircularDependency {
  /** Signals involved in the cycle */
  cycle: string[];
  /** Timestamp when detected */
  timestamp: number;
}

/**
 * Signal tracker configuration
 */
export interface SignalTrackerConfig {
  /** Enable signal tracking */
  enabled?: boolean;
  /** Track signal values */
  trackValues?: boolean;
  /** Maximum number of updates to keep */
  maxUpdates?: number;
  /** Detect circular dependencies */
  detectCircular?: boolean;
  /** Callback for circular dependency detection */
  onCircularDetected?: (cycle: CircularDependency) => void;
  /** Callback for excessive updates */
  onExcessiveUpdates?: (signalId: string, count: number) => void;
  /** Threshold for excessive updates per second */
  excessiveUpdateThreshold?: number;
}

/**
 * Signal Performance Tracker
 *
 * Tracks signal updates, subscriptions, and dependency relationships.
 *
 * @example
 * ```typescript
 * const tracker = new SignalTracker({
 *   enabled: true,
 *   detectCircular: true,
 *   onCircularDetected: (cycle) => {
 *     console.error('Circular dependency detected:', cycle.cycle);
 *   }
 * });
 *
 * // Track signal creation
 * const id = tracker.trackSignalCreation('count');
 *
 * // Track update
 * tracker.trackUpdate(id, 0, 1, 2);
 *
 * // Get statistics
 * const stats = tracker.getSignalStats(id);
 * console.log(`Updates: ${stats.updateCount}`);
 * ```
 */
export class SignalTracker {
  private config: Required<SignalTrackerConfig>;
  private updates = new Map<string, SignalUpdateInfo[]>();
  private subscriptions = new Map<string, SignalSubscriptionInfo>();
  private dependencies = new Map<string, SignalDependency>();
  private updateCounts = new Map<string, { count: number; lastReset: number }>();
  private circularDependencies: CircularDependency[] = [];
  private signalIdCounter = 0;
  private enabled = true;

  constructor(config: SignalTrackerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      trackValues: config.trackValues ?? false,
      maxUpdates: config.maxUpdates ?? 100,
      detectCircular: config.detectCircular ?? true,
      onCircularDetected: config.onCircularDetected ?? (() => {}),
      onExcessiveUpdates: config.onExcessiveUpdates ?? (() => {}),
      excessiveUpdateThreshold: config.excessiveUpdateThreshold ?? 100,
    };

    this.enabled = this.config.enabled;

    // Check for excessive updates every second
    setInterval(() => this.checkExcessiveUpdates(), 1000);
  }

  /**
   * Track signal creation and return unique ID
   */
  trackSignalCreation(name?: string): string {
    if (!this.enabled) return '';

    const signalId = name || `signal-${this.signalIdCounter++}`;

    this.dependencies.set(signalId, {
      signalId,
      dependents: [],
      dependencies: [],
      depth: 0,
    });

    this.subscriptions.set(signalId, {
      signalId,
      subscriptionCount: 0,
      subscriptionRate: 0,
      lastSubscription: 0,
    });

    getPerformanceMonitor().mark(`${signalId}-created`, {
      type: 'signal',
      event: 'created',
    });

    return signalId;
  }

  /**
   * Track signal update
   */
  trackUpdate(
    signalId: string,
    previousValue: any,
    newValue: any,
    subscribersNotified: number,
    duration: number = 0
  ): void {
    if (!this.enabled) return;

    const timestamp = performance.now();

    const updateInfo: SignalUpdateInfo = {
      signalId,
      timestamp,
      previousValue: this.config.trackValues ? this.sanitizeValue(previousValue) : undefined,
      newValue: this.config.trackValues ? this.sanitizeValue(newValue) : undefined,
      subscribersNotified,
      duration,
      stack: this.captureStack(),
    };

    if (!this.updates.has(signalId)) {
      this.updates.set(signalId, []);
    }

    const updates = this.updates.get(signalId)!;
    updates.push(updateInfo);

    // Enforce max limit
    if (updates.length > this.config.maxUpdates) {
      updates.shift();
    }

    // Track update count for excessive update detection
    const count = this.updateCounts.get(signalId) || { count: 0, lastReset: timestamp };
    count.count++;
    this.updateCounts.set(signalId, count);

    getPerformanceMonitor().mark(`${signalId}-update`, {
      type: 'signal',
      event: 'update',
      subscribersNotified,
    });
  }

  /**
   * Track signal subscription
   */
  trackSubscription(signalId: string): void {
    if (!this.enabled) return;

    const timestamp = performance.now();
    const info = this.subscriptions.get(signalId);

    if (info) {
      info.subscriptionCount++;
      info.lastSubscription = timestamp;

      // Calculate subscription rate
      const timeSinceLastReset = timestamp - (this.updateCounts.get(signalId)?.lastReset || timestamp);
      if (timeSinceLastReset > 0) {
        info.subscriptionRate = (info.subscriptionCount / timeSinceLastReset) * 1000; // per second
      }
    }
  }

  /**
   * Track signal unsubscription
   */
  trackUnsubscription(signalId: string): void {
    if (!this.enabled) return;

    const info = this.subscriptions.get(signalId);
    if (info && info.subscriptionCount > 0) {
      info.subscriptionCount--;
    }
  }

  /**
   * Track dependency relationship
   */
  trackDependency(signalId: string, dependsOn: string): void {
    if (!this.enabled) return;

    const signalDep = this.dependencies.get(signalId);
    const dependency = this.dependencies.get(dependsOn);

    if (signalDep && dependency) {
      if (!signalDep.dependencies.includes(dependsOn)) {
        signalDep.dependencies.push(dependsOn);
      }

      if (!dependency.dependents.includes(signalId)) {
        dependency.dependents.push(signalId);
      }

      // Update depth
      signalDep.depth = Math.max(signalDep.depth, dependency.depth + 1);

      // Check for circular dependencies
      if (this.config.detectCircular) {
        this.detectCircularDependencies();
      }
    }
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (signalId: string, path: string[]): string[] | null => {
      visited.add(signalId);
      recursionStack.add(signalId);
      path.push(signalId);

      const signalDep = this.dependencies.get(signalId);
      if (signalDep) {
        for (const dep of signalDep.dependencies) {
          if (!visited.has(dep)) {
            const cycle = dfs(dep, [...path]);
            if (cycle) return cycle;
          } else if (recursionStack.has(dep)) {
            // Found a cycle
            const cycleStart = path.indexOf(dep);
            return path.slice(cycleStart);
          }
        }
      }

      recursionStack.delete(signalId);
      return null;
    };

    for (const signalId of this.dependencies.keys()) {
      if (!visited.has(signalId)) {
        const cycle = dfs(signalId, []);
        if (cycle) {
          const circular: CircularDependency = {
            cycle,
            timestamp: performance.now(),
          };

          this.circularDependencies.push(circular);
          this.config.onCircularDetected(circular);
        }
      }
    }
  }

  /**
   * Check for excessive updates
   */
  private checkExcessiveUpdates(): void {
    const now = performance.now();

    for (const [signalId, count] of this.updateCounts.entries()) {
      const timeSinceReset = now - count.lastReset;

      if (timeSinceReset >= 1000) {
        // Check if exceeded threshold
        if (count.count > this.config.excessiveUpdateThreshold) {
          this.config.onExcessiveUpdates(signalId, count.count);
        }

        // Reset counter
        count.count = 0;
        count.lastReset = now;
      }
    }
  }

  /**
   * Get signal statistics
   */
  getSignalStats(signalId: string): {
    updateCount: number;
    averageUpdateDuration: number;
    subscriptionCount: number;
    dependencyCount: number;
    dependentCount: number;
  } | null {
    const updates = this.updates.get(signalId) || [];
    const subscription = this.subscriptions.get(signalId);
    const dependency = this.dependencies.get(signalId);

    if (!subscription || !dependency) return null;

    const totalDuration = updates.reduce((sum, u) => sum + u.duration, 0);

    return {
      updateCount: updates.length,
      averageUpdateDuration: updates.length > 0 ? totalDuration / updates.length : 0,
      subscriptionCount: subscription.subscriptionCount,
      dependencyCount: dependency.dependencies.length,
      dependentCount: dependency.dependents.length,
    };
  }

  /**
   * Get signal update history
   */
  getUpdateHistory(signalId: string): SignalUpdateInfo[] {
    return this.updates.get(signalId) || [];
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): Map<string, SignalDependency> {
    return new Map(this.dependencies);
  }

  /**
   * Get circular dependencies
   */
  getCircularDependencies(): CircularDependency[] {
    return [...this.circularDependencies];
  }

  /**
   * Get most updated signals
   */
  getMostUpdatedSignals(limit: number = 10): Array<{ signalId: string; updateCount: number }> {
    const signals = Array.from(this.updates.entries())
      .map(([signalId, updates]) => ({
        signalId,
        updateCount: updates.length,
      }))
      .sort((a, b) => b.updateCount - a.updateCount)
      .slice(0, limit);

    return signals;
  }

  /**
   * Get signals with most subscriptions
   */
  getMostSubscribedSignals(limit: number = 10): Array<{ signalId: string; subscriptionCount: number }> {
    const signals = Array.from(this.subscriptions.values())
      .map((info) => ({
        signalId: info.signalId,
        subscriptionCount: info.subscriptionCount,
      }))
      .sort((a, b) => b.subscriptionCount - a.subscriptionCount)
      .slice(0, limit);

    return signals;
  }

  /**
   * Visualize dependency graph
   */
  visualizeDependencyGraph(): {
    nodes: Array<{ id: string; depth: number }>;
    edges: Array<{ from: string; to: string }>;
  } {
    const nodes: Array<{ id: string; depth: number }> = [];
    const edges: Array<{ from: string; to: string }> = [];

    for (const [signalId, dep] of this.dependencies.entries()) {
      nodes.push({ id: signalId, depth: dep.depth });

      for (const dependency of dep.dependencies) {
        edges.push({ from: signalId, to: dependency });
      }
    }

    return { nodes, edges };
  }

  /**
   * Sanitize value for storage
   */
  private sanitizeValue(value: any): any {
    if (typeof value === 'function') return '[Function]';
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (typeof value === 'object') {
      if (Array.isArray(value)) return '[Array]';
      return '[Object]';
    }
    return value;
  }

  /**
   * Capture stack trace
   */
  private captureStack(): string | undefined {
    if (typeof Error !== 'undefined') {
      const stack = new Error().stack;
      return stack?.split('\n').slice(3, 6).join('\n');
    }
    return undefined;
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.updates.clear();
    this.subscriptions.clear();
    this.dependencies.clear();
    this.updateCounts.clear();
    this.circularDependencies = [];
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
 * Global signal tracker instance
 */
let globalTracker: SignalTracker | null = null;

/**
 * Get or create the global signal tracker
 */
export function getSignalTracker(config?: SignalTrackerConfig): SignalTracker {
  if (!globalTracker) {
    globalTracker = new SignalTracker(config);
  }
  return globalTracker;
}

/**
 * Reset the global signal tracker
 */
export function resetSignalTracker(): void {
  if (globalTracker) {
    globalTracker.clear();
    globalTracker = null;
  }
}

/**
 * Create a reactive signal tracker
 */
export function createReactiveSignalTracker(config?: SignalTrackerConfig): {
  tracker: SignalTracker;
  mostUpdated: WritableSignal<Array<{ signalId: string; updateCount: number }>>;
  mostSubscribed: WritableSignal<Array<{ signalId: string; subscriptionCount: number }>>;
  circularDeps: WritableSignal<CircularDependency[]>;
} {
  const tracker = new SignalTracker(config);
  const mostUpdated = signal<Array<{ signalId: string; updateCount: number }>>([]);
  const mostSubscribed = signal<Array<{ signalId: string; subscriptionCount: number }>>([]);
  const circularDeps = signal<CircularDependency[]>([]);

  // Update signals periodically
  const updateStats = () => {
    mostUpdated.set(tracker.getMostUpdatedSignals(10));
    mostSubscribed.set(tracker.getMostSubscribedSignals(10));
    circularDeps.set(tracker.getCircularDependencies());
  };

  setInterval(updateStats, 1000);

  return {
    tracker,
    mostUpdated,
    mostSubscribed,
    circularDeps,
  };
}
