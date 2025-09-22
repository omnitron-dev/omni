/**
 * Lifecycle management for Nexus DI Container
 */

import { InjectionToken, ResolutionContext } from './types.js';

/**
 * Lifecycle events
 */
export enum LifecycleEvent {
  // Container lifecycle
  ContainerCreated = 'container:created',
  ContainerInitialized = 'container:initialized',
  ContainerDisposing = 'container:disposing',
  ContainerDisposed = 'container:disposed',

  // Registration lifecycle
  BeforeRegister = 'register:before',
  AfterRegister = 'register:after',

  // Resolution lifecycle
  BeforeResolve = 'resolve:before',
  AfterResolve = 'resolve:after',
  ResolveFailed = 'resolve:failed',

  // Instance lifecycle
  InstanceCreating = 'instance:creating',
  InstanceCreated = 'instance:created',
  InstanceInitializing = 'instance:initializing',
  InstanceInitialized = 'instance:initialized',
  InstanceDisposing = 'instance:disposing',
  InstanceDisposed = 'instance:disposed',

  // Module lifecycle
  ModuleLoading = 'module:loading',
  ModuleLoaded = 'module:loaded',
  ModuleInitializing = 'module:initializing',
  ModuleInitialized = 'module:initialized',
  ModuleDestroying = 'module:destroying',
  ModuleDestroyed = 'module:destroyed',

  // Cache lifecycle
  CacheHit = 'cache:hit',
  CacheMiss = 'cache:miss',
  CacheSet = 'cache:set',
  CacheClearing = 'cache:clearing',
  CacheCleared = 'cache:cleared',

  // Scope lifecycle
  ScopeCreated = 'scope:created',
  ScopeDisposing = 'scope:disposing',
  ScopeDisposed = 'scope:disposed',

  // Middleware lifecycle
  MiddlewareAdded = 'middleware:added',
  MiddlewareRemoved = 'middleware:removed',
  MiddlewareExecuting = 'middleware:executing',
  MiddlewareExecuted = 'middleware:executed',

  // Plugin lifecycle
  PluginInstalling = 'plugin:installing',
  PluginInstalled = 'plugin:installed',
  PluginUninstalling = 'plugin:uninstalling',
  PluginUninstalled = 'plugin:uninstalled'
}

/**
 * Lifecycle event data
 */
export interface LifecycleEventData {
  event: LifecycleEvent;
  timestamp: number;
  token?: InjectionToken<any>;
  instance?: any;
  context?: ResolutionContext;
  error?: Error;
  metadata?: Record<string, any>;
}

/**
 * Lifecycle hook handler
 */
export type LifecycleHook = (data: LifecycleEventData) => void | Promise<void>;

/**
 * Lifecycle observer interface
 */
export interface LifecycleObserver {
  /**
   * Called when an event occurs
   */
  onEvent(data: LifecycleEventData): void | Promise<void>;

  /**
   * Events to observe (if not specified, observes all)
   */
  events?: LifecycleEvent[];
}

/**
 * Lifecycle manager for managing lifecycle hooks and events
 */
export class LifecycleManager {
  private hooks = new Map<LifecycleEvent, Set<LifecycleHook>>();
  private observers = new Set<LifecycleObserver>();
  private eventHistory: LifecycleEventData[] = [];
  private maxHistorySize = 1000;
  private enabled = true;

  /**
   * Register a lifecycle hook
   */
  on(event: LifecycleEvent, hook: LifecycleHook): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, new Set());
    }
    this.hooks.get(event)!.add(hook);
  }

  /**
   * Unregister a lifecycle hook
   */
  off(event: LifecycleEvent, hook: LifecycleHook): void {
    const hooks = this.hooks.get(event);
    if (hooks) {
      hooks.delete(hook);
    }
  }

  /**
   * Register a one-time lifecycle hook
   */
  once(event: LifecycleEvent, hook: LifecycleHook): void {
    const wrappedHook: LifecycleHook = async (data) => {
      // Remove the hook first to ensure it only runs once
      this.off(event, wrappedHook);
      // Then execute the original hook
      await hook(data);
    };
    this.on(event, wrappedHook);
  }

  /**
   * Emit a lifecycle event
   */
  async emit(event: LifecycleEvent, data?: Partial<LifecycleEventData>): Promise<void> {
    if (!this.enabled) return;

    const eventData: LifecycleEventData = {
      event,
      timestamp: Date.now(),
      ...data
    };

    // Store in history
    this.addToHistory(eventData);

    // Execute hooks
    const hooks = this.hooks.get(event);
    if (hooks) {
      for (const hook of hooks) {
        try {
          await hook(eventData);
        } catch (error) {
          console.error(`Lifecycle hook error for ${event}:`, error);
        }
      }
    }

    // Notify observers
    for (const observer of this.observers) {
      if (!observer.events || observer.events.includes(event)) {
        try {
          await observer.onEvent(eventData);
        } catch (error) {
          console.error(`Lifecycle observer error for ${event}:`, error);
        }
      }
    }
  }

  /**
   * Emit a lifecycle event synchronously
   */
  emitSync(event: LifecycleEvent, data?: Partial<LifecycleEventData>): void {
    if (!this.enabled) return;

    const eventData: LifecycleEventData = {
      event,
      timestamp: Date.now(),
      ...data
    };

    // Store in history
    this.addToHistory(eventData);

    // Execute hooks
    const hooks = this.hooks.get(event);
    if (hooks) {
      for (const hook of hooks) {
        try {
          const result = hook(eventData);
          if (result instanceof Promise) {
            result.catch(error => {
              console.error(`Async lifecycle hook error for ${event}:`, error);
            });
          }
        } catch (error) {
          console.error(`Lifecycle hook error for ${event}:`, error);
        }
      }
    }

    // Notify observers
    for (const observer of this.observers) {
      if (!observer.events || observer.events.includes(event)) {
        try {
          const result = observer.onEvent(eventData);
          if (result instanceof Promise) {
            result.catch(error => {
              console.error(`Async lifecycle observer error for ${event}:`, error);
            });
          }
        } catch (error) {
          console.error(`Lifecycle observer error for ${event}:`, error);
        }
      }
    }
  }

  /**
   * Add an observer
   */
  addObserver(observer: LifecycleObserver): void {
    this.observers.add(observer);
  }

  /**
   * Remove an observer
   */
  removeObserver(observer: LifecycleObserver): void {
    this.observers.delete(observer);
  }

  /**
   * Get event history
   */
  getHistory(event?: LifecycleEvent): LifecycleEventData[] {
    if (event) {
      return this.eventHistory.filter(e => e.event === event);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Enable/disable lifecycle events
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set max history size
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    this.trimHistory();
  }

  /**
   * Add event to history
   */
  private addToHistory(data: LifecycleEventData): void {
    this.eventHistory.push(data);
    this.trimHistory();
  }

  /**
   * Trim history to max size
   */
  private trimHistory(): void {
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Clear all hooks and observers
   */
  clear(): void {
    this.hooks.clear();
    this.observers.clear();
    this.eventHistory = [];
  }
}

/**
 * Built-in lifecycle observers
 */

/**
 * Performance monitoring observer
 */
export class PerformanceObserver implements LifecycleObserver {
  private metrics = new Map<string, { count: number; totalTime: number; avgTime: number }>();
  private activeTimers = new Map<string, number>();

  events = [
    LifecycleEvent.BeforeResolve,
    LifecycleEvent.AfterResolve,
    LifecycleEvent.ResolveFailed
  ];

  onEvent(data: LifecycleEventData): void {
    const key = this.getKey(data.token);

    if (data.event === LifecycleEvent.BeforeResolve) {
      this.activeTimers.set(key, Date.now());
    } else if (data.event === LifecycleEvent.AfterResolve || data.event === LifecycleEvent.ResolveFailed) {
      const start = this.activeTimers.get(key);
      if (start) {
        const duration = Date.now() - start;
        this.updateMetrics(key, duration);
        this.activeTimers.delete(key);

        if (duration > 100) {
          console.warn(`[Performance] Slow resolution: ${key} took ${duration}ms`);
        }
      }
    }
  }

  private getKey(token?: InjectionToken<any>): string {
    if (!token) return 'unknown';
    if (typeof token === 'string') return token;
    if (typeof token === 'symbol') return token.toString();
    if (typeof token === 'function') return token.name;
    if (token && typeof token === 'object' && 'name' in token) return token.name;
    return 'unknown';
  }

  private updateMetrics(key: string, duration: number): void {
    const current = this.metrics.get(key) || { count: 0, totalTime: 0, avgTime: 0 };
    current.count++;
    current.totalTime += duration;
    current.avgTime = current.totalTime / current.count;
    this.metrics.set(key, current);
  }

  getMetrics(): Map<string, { count: number; totalTime: number; avgTime: number }> {
    return new Map(this.metrics);
  }

  clearMetrics(): void {
    this.metrics.clear();
    this.activeTimers.clear();
  }
}

/**
 * Memory monitoring observer
 */
export class MemoryObserver implements LifecycleObserver {
  private instanceCounts = new Map<string, number>();
  private lastGC = Date.now();
  private gcInterval = 60000; // 1 minute

  events = [
    LifecycleEvent.InstanceCreated,
    LifecycleEvent.InstanceDisposed
  ];

  onEvent(data: LifecycleEventData): void {
    const key = this.getKey(data.token);

    if (data.event === LifecycleEvent.InstanceCreated) {
      const count = this.instanceCounts.get(key) || 0;
      this.instanceCounts.set(key, count + 1);
    } else if (data.event === LifecycleEvent.InstanceDisposed) {
      const count = this.instanceCounts.get(key) || 0;
      if (count > 0) {
        this.instanceCounts.set(key, count - 1);
      }
    }

    // Check if GC should be suggested
    if (Date.now() - this.lastGC > this.gcInterval) {
      const totalInstances = Array.from(this.instanceCounts.values()).reduce((a, b) => a + b, 0);
      if (totalInstances > 1000) {
        console.warn(`[Memory] High instance count: ${totalInstances} instances in memory`);
        if (global.gc) {
          global.gc();
          this.lastGC = Date.now();
        }
      }
    }
  }

  private getKey(token?: InjectionToken<any>): string {
    if (!token) return 'unknown';
    if (typeof token === 'string') return token;
    if (typeof token === 'symbol') return token.toString();
    if (typeof token === 'function') return token.name;
    if (token && typeof token === 'object' && 'name' in token) return token.name;
    return 'unknown';
  }

  getInstanceCounts(): Map<string, number> {
    return new Map(this.instanceCounts);
  }

  clearCounts(): void {
    this.instanceCounts.clear();
  }
}

/**
 * Audit logging observer
 */
export class AuditObserver implements LifecycleObserver {
  private auditLog: Array<{
    timestamp: number;
    event: string;
    token?: string;
    user?: string;
    metadata?: any;
  }> = [];

  constructor(
    private getUserContext?: () => { user?: string;[key: string]: any }
  ) { }

  async onEvent(data: LifecycleEventData): Promise<void> {
    const userContext = this.getUserContext ? this.getUserContext() : {};

    const entry = {
      timestamp: data.timestamp,
      event: data.event,
      token: this.getTokenName(data.token),
      user: userContext.user,
      metadata: {
        ...data.metadata,
        ...userContext
      }
    };

    this.auditLog.push(entry);

    // Could also send to external audit service
    // await this.sendToAuditService(entry);
  }

  private getTokenName(token?: InjectionToken<any>): string | undefined {
    if (!token) return undefined;
    if (typeof token === 'string') return token;
    if (typeof token === 'symbol') return token.toString();
    if (typeof token === 'function') return token.name;
    if (token && typeof token === 'object' && 'name' in token) return token.name;
    return 'unknown';
  }

  getAuditLog(): typeof this.auditLog {
    return [...this.auditLog];
  }

  clearLog(): void {
    this.auditLog = [];
  }
}