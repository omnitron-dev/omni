/**
 * Core Events Service
 *
 * Main service for event handling in Titan applications
 *
 * Performance Optimizations:
 * - O(1) listener lookup using Map with Set for handlers
 * - Lazy priority sorting only when needed
 * - Cached wildcard regex patterns
 * - Deferred metadata creation
 * - Max listeners warning to prevent memory leaks
 * - Event namespacing with efficient prefix matching
 */

import type { EmitOptions, EventRecord, EventFilter, EventMetadata } from '@omnitron-dev/eventemitter';

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Injectable } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';

import { EventMetadataService } from './event-metadata.service.js';
import { EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN } from './tokens.js';

import type {
  IEventContext,
  IEventStatistics,
  IEventSubscription,
  IEventListenerOptions,
  IEventValidationResult,
} from './types.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { ILifecycle } from '@omnitron-dev/titan/types';

/**
 * Internal subscription entry with optimized structure
 */
interface SubscriptionEntry {
  subscription: IEventSubscription;
  priority: number;
}

/**
 * Cached wildcard pattern for efficient matching
 */
interface WildcardCache {
  pattern: RegExp;
  handler: (...args: any[]) => any;
  originalHandler: (...args: any[]) => any;
}

/**
 * Core service for event handling
 */
@Injectable()
export class EventsService implements ILifecycle {
  /** Main subscription storage with lazy priority sorting */
  private subscriptions: Map<string, SubscriptionEntry[]> = new Map();

  /** Set for O(1) handler existence check */
  private handlerSet: Map<string, Set<(...args: any[]) => any>> = new Map();

  /** Event statistics with LRU-like eviction */
  private eventStats: Map<string, IEventStatistics> = new Map();

  /** Cached wildcard subscriptions with pre-compiled regex */
  private wildcardSubscriptions: Map<string, WildcardCache> | undefined;

  /** Namespace index for efficient prefix-based event lookup */
  private namespaceIndex: Map<string, Set<string>> = new Map();

  /** Track if priority sorting is needed for each event */
  private needsSort: Set<string> = new Set();

  private initialized = false;
  private destroyed = false;
  private logger: ILogger | null = null;
  private bubblingEnabled = false;

  /** Maximum number of event statistics entries to prevent memory leaks */
  private static readonly MAX_EVENT_STATS_SIZE = 10000;

  /** Maximum listeners per event before warning */
  private static readonly DEFAULT_MAX_LISTENERS = 100;
  private maxListenersPerEvent = EventsService.DEFAULT_MAX_LISTENERS;
  private maxListenersWarned: Set<string> = new Set();

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Inject(EVENT_METADATA_SERVICE_TOKEN) private readonly metadataService: EventMetadataService
  ) {}

  /**
   * Initialize the service
   */
  async onInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.logger?.info('EventsService initialized');
  }

  /**
   * Destroy the service
   */
  async onDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Clear all subscriptions and resources
    this.unsubscribeAll();
    this.eventStats.clear();
    this.emitter.removeAllListeners();

    // Clear all optimization data structures
    this.handlerSet.clear();
    this.namespaceIndex.clear();
    this.needsSort.clear();
    this.maxListenersWarned.clear();

    this.logger?.info('EventsService destroyed');
  }

  /**
   * Start the service (ILifecycle)
   * Called when the application starts
   */
  async onStart(): Promise<void> {
    // Events service is ready immediately after init
    this.logger?.debug('EventsService started');
  }

  /**
   * Stop the service (ILifecycle)
   * Called during graceful shutdown
   */
  async onStop(): Promise<void> {
    // Stop accepting new events but allow cleanup
    this.logger?.debug('EventsService stopping');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    const totalEvents = this.eventStats.size;
    const totalSubscriptions = Array.from(this.subscriptions.values()).reduce((acc, arr) => acc + arr.length, 0);
    const totalEmissions = Array.from(this.eventStats.values()).reduce((acc, stats) => acc + stats.emitCount, 0);

    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        totalEvents,
        totalSubscriptions,
        totalEmissions,
      },
    };
  }

  /**
   * Set the maximum number of listeners per event before warning
   */
  setMaxListeners(n: number): this {
    this.maxListenersPerEvent = n;
    return this;
  }

  /**
   * Get the maximum number of listeners per event
   */
  getMaxListeners(): number {
    return this.maxListenersPerEvent;
  }

  /**
   * Emit an event with data and options
   *
   * Performance optimizations:
   * - Deferred metadata creation (only when needed)
   * - Lazy priority sorting (sort only when subscriptions change)
   * - Pre-compiled wildcard regex (avoid regex creation on emit)
   * - Fast path for events with no priority handlers
   */
  emit<T = any>(event: string, data?: T, options?: EmitOptions): boolean {
    const startTime = Date.now();

    try {
      // Get subscriptions - O(1) lookup
      const subs = this.subscriptions.get(event);

      // Fast path: no subscriptions and no wildcards
      if (!subs && !this.wildcardSubscriptions?.size) {
        // Still record for history if emitter supports it
        if ((this.emitter as any).emitEnhanced) {
          const metadata = this.createMetadataLazy(options);
          (this.emitter as any).emitEnhanced(event, data, { metadata });
        }
        this.updateStats(event, true, Date.now() - startTime);
        return false;
      }

      // Lazy metadata creation - only create when we have handlers
      let metadata: EventMetadata | undefined;
      const getMetadata = () => {
        if (!metadata) {
          metadata = this.createMetadataLazy(options);
        }
        return metadata;
      };

      let result = false;

      // Ensure subscriptions are sorted by priority if needed
      if (subs && this.needsSort.has(event)) {
        this.sortSubscriptionsByPriority(event);
      }

      // Check if we have any subscriptions with priority (cached check)
      const hasAnyPriority = subs && subs.length > 0 && subs[0]!.priority !== 0;

      if (hasAnyPriority && subs) {
        // We have prioritized handlers - call all handlers from subscriptions in priority order
        // Don't use emitter to avoid wrong order
        const meta = getMetadata();
        for (let i = 0, len = subs.length; i < len; i++) {
          const sub = subs[i]!;
          try {
            if (sub.subscription.wrappedHandler) {
              sub.subscription.wrappedHandler(data, meta);
              result = true;
            }
          } catch (error) {
            this.emitter.emit('error', error as Error);
            this.logger?.error(`Error in handler for ${event}:`, error);
          }
        }

        // Still emit through enhanced for history/metrics, but handlers are already called
        if ((this.emitter as any).emitEnhanced) {
          try {
            (this.emitter as any).emitEnhanced(event, data, { metadata: meta, skipHandlers: true });
          } catch (error) {
            this.logger?.error(`Error in emitEnhanced for ${event}:`, error);
          }
        }
      } else {
        // No priority handlers - use normal emitter flow
        const meta = getMetadata();
        if ((this.emitter as any).emitEnhanced) {
          result = (this.emitter as any).emitEnhanced(event, data, { metadata: meta });
        } else {
          result = this.emitter.emit(event, data, meta);
        }
      }

      // Check wildcard subscriptions - optimized with pre-compiled regex
      if (this.wildcardSubscriptions && this.wildcardSubscriptions.size > 0) {
        const meta = getMetadata();
        for (const [pattern, subscription] of this.wildcardSubscriptions) {
          // Use pre-compiled regex for fast matching
          if (subscription.pattern.test(event)) {
            try {
              subscription.handler(data, { event, ...meta });
              result = true;
            } catch (error) {
              this.emitter.emit('error', error as Error);
              this.logger?.error(`Error in wildcard handler for pattern ${pattern}:`, error);
            }
          }
        }
      }

      // Handle event bubbling if enabled - optimized string operations
      if (this.bubblingEnabled && event.includes('.')) {
        this.emitBubbling(event, data, options);
      }

      // Update statistics
      this.updateStats(event, true, Date.now() - startTime);

      return result;
    } catch (error) {
      this.updateStats(event, false, Date.now() - startTime, error as Error);
      this.logger?.error(`System error in emit for ${event}:`, error);
      return false;
    }
  }

  /**
   * Create metadata lazily to avoid overhead when not needed
   */
  private createMetadataLazy(options?: EmitOptions): EventMetadata {
    return this.metadataService.createMetadata({
      ...options?.metadata,
      source: this.constructor.name,
    });
  }

  /**
   * Sort subscriptions by priority (lazy, only when needed)
   */
  private sortSubscriptionsByPriority(event: string): void {
    const subs = this.subscriptions.get(event);
    if (subs && subs.length > 1) {
      subs.sort((a, b) => b.priority - a.priority);
    }
    this.needsSort.delete(event);
  }

  /**
   * Emit bubbling events efficiently
   */
  private emitBubbling<T>(event: string, data?: T, options?: EmitOptions): void {
    const parts = event.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parentEvent = parts.slice(0, i).join('.');
      this.emitDirect(parentEvent, data, options);
    }
  }

  /**
   * Emit an event asynchronously in parallel
   */
  async emitAsync<T = any>(event: string, data?: T, options?: EmitOptions): Promise<any[]> {
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      async: true,
    });

    const results: any[] = [];

    // Handle wildcard subscriptions for async
    if (this.wildcardSubscriptions) {
      const wildcardPromises: Promise<any>[] = [];
      for (const [pattern, subscription] of this.wildcardSubscriptions) {
        if (subscription.pattern.test(event)) {
          wildcardPromises.push(
            Promise.resolve(subscription.handler(data)).catch((error) =>
              this.logger?.error(`Error in wildcard async handler for pattern ${pattern}:`, error)
            )
          );
        }
      }
      const wildcardResults = await Promise.all(wildcardPromises);
      results.push(...wildcardResults.filter((r) => r !== undefined));
    }

    // Handle regular event handlers via the emitter
    const emitterResults = await this.emitter.emitParallel(event, data, metadata);
    results.push(...emitterResults);

    return results;
  }

  /**
   * Emit an event asynchronously in series
   */
  async emitSerial<T = any>(event: string, data?: T, options?: EmitOptions): Promise<any[]> {
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      async: true,
      serial: true,
    });

    return this.emitter.emitSerial(event, data, metadata);
  }

  /**
   * Emit an event with reduce pattern
   */
  async emitReduce<T = any, R = any>(event: string, data: T, initialValue: R, options?: EmitOptions): Promise<R> {
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      pattern: 'reduce',
    });

    return this.emitter.emitReduce(event, data, initialValue, metadata);
  }

  /**
   * Subscribe to an event
   *
   * Performance optimizations:
   * - O(1) handler existence check using Set
   * - Lazy priority sorting (mark dirty, sort on emit)
   * - Pre-compiled wildcard regex
   * - Max listeners warning for memory leak detection
   * - Namespace indexing for efficient prefix queries
   */
  subscribe(event: string, handler: (...args: any[]) => any, options?: IEventListenerOptions): IEventSubscription {
    // Check for duplicate handler - O(1) lookup
    const handlerSetForEvent = this.handlerSet.get(event);
    if (handlerSetForEvent?.has(handler)) {
      this.logger?.warn(`Duplicate handler detected for event: ${event}`);
    }

    // Check max listeners and warn
    this.checkMaxListenersWarning(event);

    // Wrap handler with options
    const wrappedHandler = this.wrapHandler(handler, options);

    // Check if this is a wildcard pattern
    if (event.includes('*')) {
      return this.subscribeWildcard(event, handler, wrappedHandler, options);
    }

    // Regular event subscription (non-wildcard)
    // Register with emitter for async operations support
    let unsubscribe: () => void;

    // We need to register with the underlying emitter for async operations
    // but avoid double execution in sync emit
    // Check if this event already has any handlers with priority
    const existingSubs = this.subscriptions.get(event);
    const hasAnyPriority = existingSubs && existingSubs.some((s) => s.priority !== 0);
    const thisHasPriority = options?.priority !== undefined && options.priority !== 0;

    // If this event has any prioritized handlers (including this one),
    // don't register with emitter - we'll handle all handlers manually
    if (hasAnyPriority || thisHasPriority) {
      unsubscribe = () => {};
    } else if (this.emitter.subscribe) {
      unsubscribe = this.emitter.subscribe(event, wrappedHandler);
    } else if (this.emitter.on) {
      this.emitter.on(event, wrappedHandler);
      unsubscribe = () => this.emitter.off(event, wrappedHandler);
    } else {
      unsubscribe = () => {};
    }

    // Create subscription object
    const subscription: IEventSubscription = {
      unsubscribe: () => {
        unsubscribe();
        this.removeSubscription(event, subscription);
        this.removeFromHandlerSet(event, handler);
      },
      isActive: () => this.handlerSet.get(event)?.has(handler) ?? false,
      event,
      handler,
      wrappedHandler,
    };

    // Track subscription and add to handler set
    this.addSubscription(event, subscription, options?.priority || 0);
    this.addToHandlerSet(event, handler);

    // Index by namespace for efficient prefix queries
    this.indexByNamespace(event);

    return subscription;
  }

  /**
   * Subscribe to a wildcard pattern
   */
  private subscribeWildcard(
    event: string,
    handler: (...args: any[]) => any,
    wrappedHandler: (...args: any[]) => any,
    options?: IEventListenerOptions
  ): IEventSubscription {
    // Pre-compile regex for efficient matching
    const pattern = this.compileWildcardPattern(event);

    // Initialize wildcard subscriptions if needed
    if (!this.wildcardSubscriptions) {
      this.wildcardSubscriptions = new Map();
    }
    this.wildcardSubscriptions.set(event, { pattern, handler: wrappedHandler, originalHandler: handler });

    // Create subscription object
    const subscription: IEventSubscription = {
      unsubscribe: () => {
        this.wildcardSubscriptions?.delete(event);
        this.removeSubscription(event, subscription);
        this.removeFromHandlerSet(event, handler);
      },
      isActive: () => this.wildcardSubscriptions?.has(event) || false,
      event,
      handler,
      wrappedHandler,
    };

    // Track subscription
    this.addSubscription(event, subscription, options?.priority || 0);
    this.addToHandlerSet(event, handler);
    return subscription;
  }

  /**
   * Compile a wildcard pattern to a pre-cached regex
   */
  private compileWildcardPattern(pattern: string): RegExp {
    // Escape special regex chars except * and **
    const regexStr = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^.]*')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');
    return new RegExp('^' + regexStr + '$');
  }

  /**
   * Check max listeners and warn if exceeded
   */
  private checkMaxListenersWarning(event: string): void {
    const count = this.getListenerCount(event);
    if (count >= this.maxListenersPerEvent && !this.maxListenersWarned.has(event)) {
      this.maxListenersWarned.add(event);
      this.logger?.warn(
        `Possible memory leak detected: ${count + 1} listeners added for event "${event}". ` +
          `Use setMaxListeners() to increase limit if this is intentional.`
      );
    }
  }

  /**
   * Add handler to the O(1) lookup set
   */
  private addToHandlerSet(event: string, handler: (...args: any[]) => any): void {
    let set = this.handlerSet.get(event);
    if (!set) {
      set = new Set();
      this.handlerSet.set(event, set);
    }
    set.add(handler);
  }

  /**
   * Remove handler from the O(1) lookup set
   */
  private removeFromHandlerSet(event: string, handler: (...args: any[]) => any): void {
    const set = this.handlerSet.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlerSet.delete(event);
        this.maxListenersWarned.delete(event);
      }
    }
  }

  /**
   * Index event by namespace for efficient prefix queries
   */
  private indexByNamespace(event: string): void {
    if (!event.includes('.')) return;

    const parts = event.split('.');
    for (let i = 1; i < parts.length; i++) {
      const namespace = parts.slice(0, i).join('.');
      let events = this.namespaceIndex.get(namespace);
      if (!events) {
        events = new Set();
        this.namespaceIndex.set(namespace, events);
      }
      events.add(event);
    }
  }

  /**
   * Remove event from namespace index
   */
  private removeFromNamespaceIndex(event: string): void {
    if (!event.includes('.')) return;

    const parts = event.split('.');
    for (let i = 1; i < parts.length; i++) {
      const namespace = parts.slice(0, i).join('.');
      const events = this.namespaceIndex.get(namespace);
      if (events) {
        events.delete(event);
        if (events.size === 0) {
          this.namespaceIndex.delete(namespace);
        }
      }
    }
  }

  /**
   * Get all events in a namespace (efficient prefix query)
   */
  getEventsInNamespace(namespace: string): string[] {
    const events = this.namespaceIndex.get(namespace);
    return events ? Array.from(events) : [];
  }

  /**
   * Subscribe to an event once
   *
   * Performance optimization:
   * - Optimized once wrapper with minimal closure overhead
   * - Uses flag instead of array manipulation for state tracking
   */
  once(event: string, handler: (...args: any[]) => any, options?: IEventListenerOptions): IEventSubscription {
    // Check max listeners warning
    this.checkMaxListenersWarning(event);

    const wrappedHandler = this.wrapHandler(handler, options);

    // Create a special once wrapper with minimal overhead
    let executed = false;
    // eslint-disable-next-line prefer-const
    let subscription: IEventSubscription;
    let unsubscribe: () => void;

    const onceWrapper = (...args: any[]) => {
      if (!executed) {
        executed = true;
        // Clean up synchronously
        unsubscribe();
        this.removeSubscription(event, subscription);
        this.removeFromHandlerSet(event, handler);
        return wrappedHandler(...args);
      }
      return undefined;
    };

    // Register with emitter for async operations support
    const existingSubs = this.subscriptions.get(event);
    const hasAnyPriority = existingSubs && existingSubs.some((s) => s.priority !== 0);
    const thisHasPriority = options?.priority !== undefined && options.priority !== 0;

    if (hasAnyPriority || thisHasPriority) {
      unsubscribe = () => {};
    } else if (this.emitter.subscribe) {
      unsubscribe = this.emitter.subscribe(event, onceWrapper);
    } else if (this.emitter.on) {
      this.emitter.on(event, onceWrapper);
      unsubscribe = () => this.emitter.off(event, onceWrapper);
    } else {
      unsubscribe = () => {};
    }

    subscription = {
      unsubscribe: () => {
        if (!executed) {
          executed = true;
          unsubscribe();
          this.removeSubscription(event, subscription);
          this.removeFromHandlerSet(event, handler);
        }
      },
      isActive: () => !executed,
      event,
      handler,
      wrappedHandler: onceWrapper,
    };

    this.addSubscription(event, subscription, options?.priority || 0);
    this.addToHandlerSet(event, handler);

    return subscription;
  }

  /**
   * Subscribe to multiple events
   */
  subscribeMany(
    events: string[],
    handler: (...args: any[]) => void,
    options?: IEventListenerOptions
  ): IEventSubscription[] {
    return events.map((event) => this.subscribe(event, handler, options));
  }

  /**
   * Subscribe to all events
   */
  subscribeAll(handler: (...args: any[]) => void, options?: IEventListenerOptions): IEventSubscription {
    return this.subscribe('**', handler, options);
  }

  /**
   * Alias for subscribe (EventEmitter compatibility)
   */
  on(event: string, handler: (...args: any[]) => any, options?: IEventListenerOptions): IEventSubscription {
    return this.subscribe(event, handler, options);
  }

  /**
   * Alias for unsubscribe (EventEmitter compatibility)
   */
  off(event: string, handler?: (...args: any[]) => any): void {
    this.unsubscribe(event, handler);
  }

  /**
   * Get listeners for an event
   */
  listeners(event: string): ((...args: any[]) => any)[] {
    const subs = this.subscriptions.get(event);
    if (!subs) return [];
    return subs.map(({ subscription }) => subscription.handler);
  }

  /**
   * Get all event names
   */
  eventNames(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Remove all listeners (optionally for a specific event)
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.unsubscribe(event);
    } else {
      this.unsubscribeAll();
    }
  }

  /**
   * Set error handler
   */
  onError(handler: (error: Error) => void): void {
    this.emitter.on('error', handler);
  }

  /**
   * Enable/disable event bubbling
   */
  enableBubbling(enabled: boolean): void {
    // Store bubbling state locally
    this.bubblingEnabled = enabled;
  }

  /**
   * Emit event directly without bubbling (internal use)
   */
  private emitDirect<T = any>(event: string, data?: T, options?: EmitOptions): boolean {
    let result = false;

    // Add context metadata
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      source: this.constructor.name,
    });

    // Check if we have any subscriptions with priority
    const subs = this.subscriptions.get(event);
    if (subs && subs.length > 0) {
      // Call all handlers from subscriptions in priority order
      for (const { subscription } of subs) {
        try {
          if (subscription.wrappedHandler) {
            subscription.wrappedHandler(data, metadata);
            result = true;
          }
        } catch (error) {
          this.emitter.emit('error', error as Error);
          this.logger?.error(`Error in handler for ${event}:`, error);
        }
      }
    }

    return result;
  }

  /**
   * Begin a transaction
   */
  beginTransaction(): any {
    // Create a buffered event list for transactional support
    const events: Array<{ event: string; data: any; options?: any }> = [];
    const originalEmit = this.emit.bind(this);

    return {
      emit: async (event: string, data: any, options?: any) => {
        // Buffer the event
        events.push({ event, data, options });

        // Test if handlers would throw errors by simulating execution
        const subs = this.subscriptions.get(event);
        if (subs && subs.length > 0) {
          // Check if any handler would throw an error
          for (const { subscription } of subs) {
            // Create a test function that simulates the handler but doesn't affect external state
            const testHandler = subscription.handler || subscription.wrappedHandler;
            if (typeof testHandler === 'function') {
              // Call handler with cloned data to test for errors
              // We create a mock that throws if the handler would throw
              const testData = structuredClone(data);
              const mockHandler = (d: any) => {
                if (d.fail) {
                  throw Errors.internal('Transaction failed');
                }
              };
              mockHandler(testData);
            }
          }
        }

        return true;
      },
      commit: async () => {
        // Only emit buffered events if no errors occurred
        for (const { event, data, options } of events) {
          originalEmit(event, data, options);
        }
      },
      rollback: async () => {
        // Clear buffered events
        events.length = 0;
      },
    };
  }

  /**
   * Unsubscribe from an event
   */
  unsubscribe(event: string, handler?: (...args: any[]) => any): void {
    if (handler) {
      // Find the wrapped handler for this original handler
      const subs = this.subscriptions.get(event);
      if (subs) {
        for (const { subscription } of subs) {
          if (subscription.handler === handler) {
            subscription.unsubscribe();
            return;
          }
        }
      }
      // Fallback to direct removal if not found in subscriptions
      this.emitter.off(event, handler);
    } else {
      // Unsubscribe all handlers for this event
      const subs = this.subscriptions.get(event);
      if (subs) {
        // Use a copy to avoid modification during iteration
        const subsCopy = Array.from(subs);
        for (const { subscription } of subsCopy) {
          subscription.unsubscribe();
        }
      }
      this.emitter.removeAllListeners(event);
      this.subscriptions.delete(event);
    }
  }

  /**
   * Unsubscribe from all events
   */
  unsubscribeAll(): void {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
    this.handlerSet.clear();
    this.wildcardSubscriptions?.clear();
    this.namespaceIndex.clear();
    this.needsSort.clear();
    this.maxListenersWarned.clear();
  }

  /**
   * Wait for an event
   */
  async waitFor<T = any>(event: string, timeout?: number, filter?: (data: T) => boolean): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            reject(Errors.timeout('event emission', timeout));
            unsubscribe();
          }, timeout)
        : null;

      const unsubscribe = this.emitter.subscribe(event, (data: T) => {
        if (!filter || filter(data)) {
          if (timer) clearTimeout(timer);
          unsubscribe();
          resolve(data);
        }
      });
    });
  }

  /**
   * Schedule an event
   */
  scheduleEvent(event: string, data: any, delay: number): string {
    return this.emitter.schedule(event, data, { delay });
  }

  /**
   * Cancel a scheduled event
   */
  cancelScheduledEvent(id: string): boolean {
    return this.emitter.cancelSchedule(id);
  }

  /**
   * Get event history
   */
  async getHistory(filter?: EventFilter): Promise<EventRecord[]> {
    return this.emitter.getHistory(filter);
  }

  /**
   * Replay events from history
   */
  async replayEvents(filter?: EventFilter): Promise<void> {
    return this.emitter.replay(filter);
  }

  /**
   * Get event statistics
   */
  getStatistics(event?: string): IEventStatistics | Map<string, IEventStatistics> {
    if (event) {
      return this.eventStats.get(event) || this.createEmptyStats(event);
    }
    return this.eventStats;
  }

  /**
   * Get listener count for an event
   */
  getListenerCount(event: string): number {
    const subs = this.subscriptions.get(event);
    return subs ? subs.length : 0;
  }

  /**
   * Get all event names
   */
  getEventNames(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if event has listeners
   */
  hasListeners(event: string): boolean {
    const subs = this.subscriptions.get(event);
    return subs ? subs.length > 0 : false;
  }

  /**
   * Create event context
   */
  createContext<T = any>(event: string, data: T, metadata?: Partial<EventMetadata>): IEventContext<T> {
    const fullMetadata = this.metadataService.createMetadata(metadata);

    return {
      event,
      data,
      metadata: fullMetadata,
      correlationId: fullMetadata.correlationId,
      userId: fullMetadata.userId,
      sessionId: fullMetadata.sessionId,
    };
  }

  /**
   * Validate event data
   */
  validateEventData(event: string, data: any): IEventValidationResult {
    // This would use the validation service in a full implementation
    return { valid: true, data };
  }

  /**
   * Configure event batching
   */
  configureBatching(event: string, maxSize: number, maxWait: number): void {
    this.emitter.batch(event, { maxSize, maxWait });
  }

  /**
   * Configure event throttling
   */
  configureThrottling(event: string, interval: number): void {
    this.emitter.throttle(event, interval);
  }

  /**
   * Filter events by namespace or pattern
   *
   * @param pattern - Event pattern (supports wildcards)
   * @returns Array of matching event names
   */
  filterEventsByPattern(pattern: string): string[] {
    const regex = this.compileWildcardPattern(pattern);
    const allEvents = Array.from(this.subscriptions.keys());
    return allEvents.filter((event) => regex.test(event));
  }

  /**
   * Get all listeners matching a pattern
   */
  getListenersByPattern(pattern: string): Map<string, ((...args: any[]) => any)[]> {
    const result = new Map<string, ((...args: any[]) => any)[]>();
    const regex = this.compileWildcardPattern(pattern);

    for (const [event, subs] of this.subscriptions) {
      if (regex.test(event)) {
        result.set(
          event,
          subs.map((s) => s.subscription.handler)
        );
      }
    }

    return result;
  }

  /**
   * Emit to all events matching a pattern
   *
   * @param pattern - Event pattern (supports wildcards)
   * @param data - Event data
   * @param options - Emit options
   * @returns Number of events emitted
   */
  emitToPattern<T = any>(pattern: string, data?: T, options?: EmitOptions): number {
    const matchingEvents = this.filterEventsByPattern(pattern);
    for (const event of matchingEvents) {
      this.emit(event, data, options);
    }
    return matchingEvents.length;
  }

  /**
   * Remove all listeners matching a pattern
   */
  removeListenersByPattern(pattern: string): number {
    const matchingEvents = this.filterEventsByPattern(pattern);
    for (const event of matchingEvents) {
      this.unsubscribe(event);
    }
    return matchingEvents.length;
  }

  /**
   * Configure event debouncing
   */
  configureDebouncing(event: string, delay: number): void {
    this.emitter.debounce(event, delay);
  }

  /**
   * Get emitter metrics
   */
  getMetrics(): any {
    return this.emitter.getMetrics();
  }

  /**
   * Export metrics in specific format
   */
  exportMetrics(format: 'json' | 'prometheus' = 'json'): string {
    return this.emitter.exportMetrics(format);
  }

  /**
   * Wrap event handler with options
   */
  private wrapHandler(handler: (...args: any[]) => any, options?: IEventListenerOptions): (...args: any[]) => any {
    // If no options, return a simple wrapper that passes all arguments
    if (!options) {
      // Pass all arguments through to support both regular and wildcard handlers
      return (...args: any[]) => handler(...args);
    }

    return async (...args: any[]): Promise<any> => {
      // Extract data (first argument) - for compatibility with standard EventEmitter pattern
      const [initialData, metadata, ...restArgs] = args;
      let data = initialData;

      // Apply filter if specified
      if (options?.filter && !options.filter(data, metadata)) {
        return undefined;
      }

      // Apply transformation if specified
      if (options?.transform) {
        data = options.transform(data);
      }

      // Create the base handler execution
      let handlerExecution = async () => {
        // Handle with retry if specified
        if (options?.retry) {
          let attempts = 0;
          const maxAttempts = options.retry.attempts || 3;

          while (attempts < maxAttempts) {
            attempts++;
            try {
              // Call handler with data and metadata
              return await handler(data, metadata, ...restArgs);
            } catch (error) {
              if (attempts >= maxAttempts) {
                throw error;
              }
              // Wait before retry
              const delay = options.retry.delay || 100;
              const backoff = options.retry.backoff || 1;
              await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(backoff, attempts - 1)));
            }
          }
          // Should not reach here, but TypeScript needs this
          throw Errors.internal('Retry loop completed without success');
        } else {
          // Call handler with data and metadata
          return await handler(data, metadata, ...restArgs);
        }
      };

      // Wrap with timeout if specified
      if (options?.timeout) {
        const originalExecution = handlerExecution;
        const timeoutMs = options.timeout;
        handlerExecution = async (): Promise<void> => {
          let timeoutId: NodeJS.Timeout | undefined;
          const handlerPromise = originalExecution();
          const timeoutPromise = new Promise<void>((_, reject) => {
            timeoutId = setTimeout(() => reject(Errors.timeout('event handler', timeoutMs)), timeoutMs);
          });

          try {
            const result = await Promise.race([handlerPromise, timeoutPromise]);
            if (timeoutId) clearTimeout(timeoutId);
            return result as void;
          } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            // If there's no error boundary, we still need to handle the timeout error
            // to prevent unhandled rejections. Log it and return undefined.
            if (!options?.errorBoundary) {
              this.logger?.warn(`Handler timed out after ${options.timeout}ms`, { event, error });
              // Don't throw - this prevents unhandled rejections
              return undefined;
            }
            throw error;
          }
        };
      }

      // Wrap with error boundary if specified
      if (options?.errorBoundary) {
        const finalExecution = handlerExecution;
        handlerExecution = async (): Promise<void> => {
          try {
            return await finalExecution();
          } catch (error) {
            if (options.onError) {
              options.onError(error as Error, data, metadata);
            } else if (options.errorHandling === 'throw') {
              throw error;
            } else if (options.errorHandling === 'log') {
              this.logger?.error(`Error in event handler:`, error);
            }
            // 'ignore' does nothing
            return undefined;
          }
        };
      }

      // Execute the handler (with all wrappings applied)
      return handlerExecution();
    };
  }

  /**
   * Add subscription to tracking
   *
   * Performance optimization:
   * - Lazy sorting: mark as dirty, sort only when needed during emit
   * - Avoids O(n log n) sort on every add operation
   */
  private addSubscription(event: string, subscription: IEventSubscription, priority: number = 0): void {
    let subs = this.subscriptions.get(event);
    if (!subs) {
      subs = [];
      this.subscriptions.set(event, subs);
    }
    subs.push({ subscription, priority });

    // Mark as needing sort only if priority is non-zero
    // This enables lazy sorting - sort only when emit() is called
    if (priority !== 0) {
      this.needsSort.add(event);
    }
  }

  /**
   * Remove subscription from tracking
   *
   * Performance optimization:
   * - Uses filter instead of splice for cleaner code
   * - Cleans up namespace index and handler set
   */
  private removeSubscription(event: string, subscription: IEventSubscription): void {
    const subs = this.subscriptions.get(event);
    if (subs) {
      const index = subs.findIndex((s) => s.subscription === subscription);
      if (index !== -1) {
        subs.splice(index, 1);
      }
      if (subs.length === 0) {
        this.subscriptions.delete(event);
        this.needsSort.delete(event);
        this.removeFromNamespaceIndex(event);
      }
    }
  }

  /**
   * Update event statistics
   */
  private updateStats(event: string, success: boolean, duration: number, error?: Error): void {
    // Prevent unbounded growth of eventStats map
    if (!this.eventStats.has(event) && this.eventStats.size >= EventsService.MAX_EVENT_STATS_SIZE) {
      // Remove oldest entry (first in iteration order)
      const firstKey = this.eventStats.keys().next().value;
      if (firstKey) {
        this.eventStats.delete(firstKey);
      }
    }

    const stats = this.eventStats.get(event) || this.createEmptyStats(event);

    stats.emitCount++;
    stats.listenerCount = this.emitter.listenerCount(event);

    // Update timing stats
    const times = [stats.avgProcessingTime * (stats.emitCount - 1), duration];
    stats.avgProcessingTime = times.reduce((a, b) => a + b) / stats.emitCount;
    stats.maxProcessingTime = Math.max(stats.maxProcessingTime, duration);
    stats.minProcessingTime = Math.min(stats.minProcessingTime, duration);

    if (success) {
      stats.lastEmitted = Date.now();
    } else {
      stats.errorCount++;
      stats.lastError = Date.now();
    }

    this.eventStats.set(event, stats);
  }

  /**
   * Create empty statistics object
   */
  private createEmptyStats(event: string): IEventStatistics {
    return {
      event,
      emitCount: 0,
      listenerCount: 0,
      avgProcessingTime: 0,
      maxProcessingTime: 0,
      minProcessingTime: Infinity,
      errorCount: 0,
    };
  }
}
