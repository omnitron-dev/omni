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
  trackSignalCreation(name?: string | number, initialValue?: any): string {
    if (!this.enabled) return '';

    const signalId =
      typeof name === 'string' ? name : name !== undefined ? `signal-${name}` : `signal-${this.signalIdCounter++}`;

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
   * Track signal read (simplified API)
   */
  trackSignalRead(signalId: string): void {
    if (!this.enabled) return;

    // Track as a subscription
    this.trackSubscription(signalId);

    getPerformanceMonitor().mark(`${signalId}-read`, {
      type: 'signal',
      event: 'read',
    });
  }

  /**
   * Track signal write (simplified API)
   */
  trackSignalWrite(signalId: string, previousValue: any, newValue: any): void {
    if (!this.enabled) return;

    // Track as an update with 1 subscriber (simplified)
    this.trackUpdate(signalId, previousValue, newValue, 1, 0);
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
      previousValue: this.sanitizeValue(previousValue),
      newValue: this.sanitizeValue(newValue),
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
   * Get signal info (alias for getSignalStats with additional fields)
   */
  getSignalInfo(signalId: string): {
    reads: number;
    writes: number;
    computations?: number;
    currentValue?: any;
    subscriptionCount?: number;
  } | null {
    const dependency = this.dependencies.get(signalId);
    if (!dependency) return null;

    const updates = this.updates.get(signalId) || [];
    const subscription = this.subscriptions.get(signalId);

    // Get the latest value from updates
    const latestUpdate = updates[updates.length - 1];

    // For computed signals, computations means the number of times it has been recomputed
    // For regular signals, it means the number of dependents
    // We can check if this is a computed signal by checking if it has dependencies
    const isComputed = dependency.dependencies.length > 0;
    const computations = isComputed ? updates.length : dependency.dependents.length;

    return {
      reads: subscription?.subscriptionCount || 0,
      writes: updates.length,
      computations,
      currentValue: latestUpdate ? latestUpdate.newValue : undefined,
      subscriptionCount: subscription?.subscriptionCount || 0,
    };
  }

  /**
   * Get signal update history
   */
  getUpdateHistory(signalId: string): SignalUpdateInfo[] {
    return this.updates.get(signalId) || [];
  }

  /**
   * Get dependencies for a signal
   */
  getDependencies(signalId: string): string[] {
    const dependency = this.dependencies.get(signalId);
    return dependency ? [...dependency.dependencies] : [];
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
   * Track computed signal creation
   */
  trackComputedCreation(signalId: string, dependencies: string[]): void {
    if (!this.enabled) return;

    // Create the signal in dependencies map
    this.dependencies.set(signalId, {
      signalId,
      dependents: [],
      dependencies: [...dependencies],
      depth: 0,
    });

    // Track dependencies
    for (const dep of dependencies) {
      this.trackDependency(signalId, dep);
    }

    getPerformanceMonitor().mark(`${signalId}-computed-created`, {
      type: 'signal',
      event: 'computed-created',
    });
  }

  /**
   * Track computed signal update
   */
  trackComputedUpdate(signalId: string, previousValue: any, newValue: any): void {
    if (!this.enabled) return;

    // Track as an update with 0 subscribers (computed signals don't have direct subscribers)
    this.trackUpdate(signalId, previousValue, newValue, 0, 0);

    getPerformanceMonitor().mark(`${signalId}-computed-update`, {
      type: 'signal',
      event: 'computed-update',
    });
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
   * Get hot signals (most active signals by reads and writes)
   */
  getHotSignals(limit: number = 10): Array<{ id: string; reads: number; writes: number; activity: number }> {
    const signals: Array<{ id: string; reads: number; writes: number; activity: number }> = [];

    for (const [signalId, updates] of this.updates.entries()) {
      const subscription = this.subscriptions.get(signalId);
      const reads = subscription?.subscriptionCount || 0;
      const writes = updates.length;
      const activity = reads + writes;

      signals.push({ id: signalId, reads, writes, activity });
    }

    return signals.sort((a, b) => b.activity - a.activity).slice(0, limit);
  }

  /**
   * Get overall signal statistics
   */
  getStatistics(): {
    totalSignals: number;
    totalReads: number;
    totalWrites: number;
    totalComputations: number;
  } {
    const totalSignals = this.dependencies.size;
    let totalReads = 0;
    let totalWrites = 0;
    let totalComputations = 0;

    for (const subscription of this.subscriptions.values()) {
      totalReads += subscription.subscriptionCount;
    }

    for (const updates of this.updates.values()) {
      totalWrites += updates.length;
    }

    for (const dependency of this.dependencies.values()) {
      totalComputations += dependency.dependents.length;
    }

    return {
      totalSignals,
      totalReads,
      totalWrites,
      totalComputations,
    };
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
