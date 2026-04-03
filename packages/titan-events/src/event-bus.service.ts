/**
 * Event Bus Service
 *
 * Provides a message bus for inter-module communication
 *
 * Performance Optimizations:
 * - Cached wildcard regex patterns for O(1) matching after first compile
 * - Optimized priority queue with lazy sorting
 * - Pre-compiled handler arrays for fast iteration
 * - Efficient batch event processing
 * - Bounded message queues with configurable backpressure strategies
 */

import type { EventMetadata } from '@omnitron-dev/eventemitter';

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Injectable, Optional } from '@omnitron-dev/titan/decorators';
import { Errors, toTitanError } from '@omnitron-dev/titan/errors';

import { EVENT_EMITTER_TOKEN } from './tokens.js';
import { LOGGER_TOKEN } from './tokens.js';

import type {
  EventData,
  EventHandler,
  VarArgEventHandler,
  IEventSubscription,
  HealthCheckResult,
} from './event.types.js';
import type { IEventBusMessage, IMessageQueueConfig, IMessageQueueMetrics, IQueueAddResult } from './types.js';

/**
 * Default queue configuration
 */
const DEFAULT_QUEUE_CONFIG: Required<IMessageQueueConfig> = {
  maxSize: 10000,
  strategy: 'DROP_OLDEST',
  blockTimeout: 5000,
  warningThreshold: 0.8,
};

/**
 * Event bus for inter-module communication
 */
@Injectable()
export class EventBusService {
  private channels: Map<string, Set<(...args: any[]) => any>> = new Map();
  private messageQueue: Map<string, IEventBusMessage[]> = new Map();
  private messageIdCounter = 0;
  private subscriptions: Map<string, Set<(...args: any[]) => any>> = new Map();
  private onceHandlers: Set<(...args: any[]) => any> = new Set();
  private emittedEvents = 0;
  private initialized = false;
  private destroyed = false;
  private middlewares: Array<(data: any, next: (data: any) => any) => any> = [];
  private replayEnabled = false;
  /**
   * Circular buffer for replay events - O(1) write instead of O(n) shift
   * Pre-allocated for maxReplayBufferSize entries
   */
  private replayBuffer: Array<{ event: string; data: any; metadata?: EventMetadata } | null> = [];
  private replayBufferWriteIndex = 0;
  private replayBufferSize = 0;
  private maxReplayBufferSize = 100;
  private handlerPriorities: Map<(...args: any[]) => any, number> = new Map();

  /**
   * Maximum number of wildcard patterns to cache.
   * Prevents unbounded memory growth from dynamic event patterns.
   */
  private static readonly MAX_WILDCARD_PATTERN_CACHE_SIZE = 100;

  /** Cached wildcard patterns for O(1) matching after first compile (bounded by MAX_WILDCARD_PATTERN_CACHE_SIZE) */
  private wildcardPatternCache: Map<string, RegExp> = new Map();

  /** Pre-computed list of wildcard subscription patterns for fast lookup */
  private wildcardPatterns: Set<string> = new Set();

  /** Sorted handler arrays - updated lazily when needed */
  private sortedHandlers: Map<string, ((...args: any[]) => any)[]> = new Map();

  /** Track if handler sorting is needed */
  private needsSort: Set<string> = new Set();

  /** Maximum listeners per event before warning */
  private static readonly DEFAULT_MAX_LISTENERS = 100;
  private maxListenersPerEvent = EventBusService.DEFAULT_MAX_LISTENERS;
  private maxListenersWarned: Set<string> = new Set();

  /** Queue configuration for backpressure handling */
  private readonly queueConfig: Required<IMessageQueueConfig>;

  /** Metrics for queue operations */
  private readonly queueMetrics: IMessageQueueMetrics = {
    droppedMessages: 0,
    droppedByTarget: new Map(),
    rejectedMessages: 0,
    blockTimeouts: 0,
    highWaterMark: new Map(),
    totalProcessed: 0,
  };

  /** Track targets that have been warned about capacity */
  private capacityWarned: Set<string> = new Set();

  /** Pending block resolvers for BLOCK strategy */
  private blockWaiters: Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>> = new Map();

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Optional() @Inject(LOGGER_TOKEN) private readonly logger?: any,
    queueConfig?: IMessageQueueConfig
  ) {
    this.queueConfig = { ...DEFAULT_QUEUE_CONFIG, ...queueConfig };
  }

  /**
   * Configure the message queue backpressure settings
   */
  configureQueue(config: IMessageQueueConfig): void {
    Object.assign(this.queueConfig, config);
    this.logger?.info({ config: this.queueConfig }, 'Message queue configuration updated');
  }

  /**
   * Get current queue configuration
   */
  getQueueConfig(): Required<IMessageQueueConfig> {
    return { ...this.queueConfig };
  }

  /**
   * Get queue metrics
   */
  getQueueMetrics(): IMessageQueueMetrics {
    return {
      ...this.queueMetrics,
      droppedByTarget: new Map(this.queueMetrics.droppedByTarget),
      highWaterMark: new Map(this.queueMetrics.highWaterMark),
    };
  }

  /**
   * Reset queue metrics
   */
  resetQueueMetrics(): void {
    this.queueMetrics.droppedMessages = 0;
    this.queueMetrics.droppedByTarget.clear();
    this.queueMetrics.rejectedMessages = 0;
    this.queueMetrics.blockTimeouts = 0;
    this.queueMetrics.highWaterMark.clear();
    this.queueMetrics.totalProcessed = 0;
    this.capacityWarned.clear();
  }

  /**
   * Initialize the service
   */
  async onInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.logger?.info('EventBusService initialized');
  }

  /**
   * Add middleware to the event bus
   */
  use(middleware: (data: any, next: (data: any) => any) => any): void {
    this.middlewares.push(middleware);
  }

  /**
   * Enable event replay
   */
  enableReplay(enabledOrBufferSize: boolean | number = true, maxBufferSize?: number): void {
    // If a number is passed as the first argument, treat it as buffer size and enable replay
    if (typeof enabledOrBufferSize === 'number') {
      this.replayEnabled = true;
      this.maxReplayBufferSize = enabledOrBufferSize;
    } else {
      this.replayEnabled = enabledOrBufferSize;
      if (maxBufferSize !== undefined) {
        this.maxReplayBufferSize = maxBufferSize;
      }
    }
    if (!this.replayEnabled) {
      // Clear circular buffer efficiently
      this.replayBuffer = new Array(this.maxReplayBufferSize).fill(null);
      this.replayBufferWriteIndex = 0;
      this.replayBufferSize = 0;
    }
  }

  /**
   * Get events from circular replay buffer in chronological order
   * Returns non-null entries only
   */
  private getReplayBufferEvents(): Array<{ event: string; data: any; metadata?: EventMetadata }> {
    if (this.replayBufferSize === 0) {
      return [];
    }

    const result: Array<{ event: string; data: any; metadata?: EventMetadata }> = [];

    // Calculate start index (oldest entry)
    const startIndex = this.replayBufferSize < this.maxReplayBufferSize ? 0 : this.replayBufferWriteIndex;

    // Iterate through buffer in chronological order
    for (let i = 0; i < this.replayBufferSize; i++) {
      const index = (startIndex + i) % this.maxReplayBufferSize;
      const entry = this.replayBuffer[index];
      if (entry != null) {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Apply middleware chain to data
   */
  private applyMiddleware(data: EventData): EventData {
    let index = 0;
    const middlewares = this.middlewares;

    function next(currentData: EventData): EventData | void | Promise<EventData | void> {
      if (index >= middlewares.length) {
        return currentData;
      }
      const middleware = middlewares[index++];
      return middleware ? middleware(currentData, next) : currentData;
    }

    return (next(data) as EventData) || data;
  }

  /**
   * Destroy the service
   */
  async onDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Reject any pending block waiters
    for (const [_target, waiters] of this.blockWaiters) {
      for (const waiter of waiters) {
        waiter.reject(new Error('EventBusService destroyed while waiting for queue space'));
      }
    }
    this.blockWaiters.clear();

    // Clear all subscriptions and caches
    this.channels.clear();
    this.messageQueue.clear();
    this.subscriptions.clear();
    this.onceHandlers.clear();
    this.handlerPriorities.clear();
    this.sortedHandlers.clear();
    this.needsSort.clear();
    this.wildcardPatterns.clear();
    this.wildcardPatternCache.clear();
    this.maxListenersWarned.clear();
    this.capacityWarned.clear();
    this.emitter.removeAllListeners();

    this.logger?.info('EventBusService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<HealthCheckResult> {
    const listenerCount = Array.from(this.subscriptions.values()).reduce((acc, handlers) => acc + handlers.size, 0);

    const eventCount = this.subscriptions.size;

    // Check queue health
    let queueStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const queueDetails: Record<string, unknown> = {};

    for (const [target, queue] of this.messageQueue) {
      const utilization = queue.length / this.queueConfig.maxSize;
      if (utilization >= 1) {
        queueStatus = 'unhealthy';
        queueDetails[`queue_${target}_full`] = true;
      } else if (utilization >= this.queueConfig.warningThreshold && queueStatus === 'healthy') {
        queueStatus = 'degraded';
        queueDetails[`queue_${target}_high`] = Math.round(utilization * 100) + '%';
      }
    }

    const baseStatus = this.initialized && !this.destroyed ? 'healthy' : 'unhealthy';
    const finalStatus = baseStatus === 'unhealthy' ? 'unhealthy' : queueStatus;

    return {
      status: finalStatus,
      details: {
        eventCount, // Number of unique events with handlers
        listenerCount, // Total number of listeners
        droppedMessages: this.queueMetrics.droppedMessages,
        rejectedMessages: this.queueMetrics.rejectedMessages,
        blockTimeouts: this.queueMetrics.blockTimeouts,
        ...queueDetails,
      },
    };
  }

  /**
   * Subscribe to an event (alias for subscribe)
   */
  on(event: string, handler: VarArgEventHandler): IEventSubscription {
    // Check max listeners warning
    this.checkMaxListenersWarning(event);

    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }
    this.subscriptions.get(event)!.add(handler);

    // Invalidate sorted handlers cache
    this.sortedHandlers.delete(event);

    // Track wildcard patterns for fast lookup during emit
    if (event.includes('*')) {
      this.wildcardPatterns.add(event);
    }

    // Don't duplicate subscription to internal emitter - we handle it ourselves

    return {
      unsubscribe: () => {
        this.off(event, handler);
      },
      isActive: () => this.subscriptions.get(event)?.has(handler) || false,
    };
  }

  /**
   * Subscribe to an event with options
   *
   * Performance optimizations:
   * - Lazy priority sorting (mark dirty, sort on emit)
   * - Track wildcard patterns for fast lookup
   * - Max listeners warning for memory leak detection
   */
  subscribe(
    event: string,
    handler: VarArgEventHandler,
    options?: { priority?: number; replay?: boolean }
  ): IEventSubscription {
    // Check max listeners warning
    this.checkMaxListenersWarning(event);

    // Store handler priority if provided
    if (options?.priority !== undefined) {
      this.handlerPriorities.set(handler, options.priority);
      // Mark for lazy sorting instead of sorting now
      this.needsSort.add(event);
    }

    // Add handler to subscriptions
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }

    const handlers = this.subscriptions.get(event)!;
    handlers.add(handler);

    // Invalidate sorted handlers cache
    this.sortedHandlers.delete(event);

    // Track wildcard patterns for fast lookup during emit
    if (event.includes('*')) {
      this.wildcardPatterns.add(event);
    }

    // Replay events if requested
    if (options?.replay && this.replayEnabled) {
      const eventsToReplay = this.getReplayBufferEvents().filter((item) => item.event === event);
      for (let i = 0, len = eventsToReplay.length; i < len; i++) {
        const item = eventsToReplay[i]!;
        try {
          handler(item.data);
        } catch (err) {
          this.logger?.error({ err, event }, 'Error replaying event');
        }
      }
    }

    return {
      unsubscribe: () => {
        this.off(event, handler);
      },
      isActive: () => this.subscriptions.get(event)?.has(handler) || false,
    };
  }

  /**
   * Unsubscribe from an event
   *
   * Performance optimization:
   * - Clean up caches and wildcard tracking
   */
  off(event: string, handler?: VarArgEventHandler): void {
    if (!handler) {
      // Remove all handlers for this event
      const handlers = this.subscriptions.get(event);
      if (handlers) {
        handlers.forEach((h) => this.handlerPriorities.delete(h));
      }
      this.subscriptions.delete(event);
      this.sortedHandlers.delete(event);
      this.needsSort.delete(event);
      this.maxListenersWarned.delete(event);

      // Clean up wildcard tracking
      if (event.includes('*')) {
        this.wildcardPatterns.delete(event);
        this.wildcardPatternCache.delete(event);
      }

      this.emitter.removeAllListeners(event);
      return;
    }

    const handlers = this.subscriptions.get(event);
    if (handlers) {
      handlers.delete(handler);
      this.handlerPriorities.delete(handler);
      // Invalidate sorted handlers cache
      this.sortedHandlers.delete(event);

      if (handlers.size === 0) {
        this.subscriptions.delete(event);
        this.needsSort.delete(event);
        this.maxListenersWarned.delete(event);

        // Clean up wildcard tracking
        if (event.includes('*')) {
          this.wildcardPatterns.delete(event);
          this.wildcardPatternCache.delete(event);
        }
      }
    }

    // Remove from emitter as well
    this.emitter.off(event, handler as EventHandler);
  }

  /**
   * Subscribe to an event once
   */
  once(event: string, handler: VarArgEventHandler): IEventSubscription {
    const wrappedHandler: VarArgEventHandler = async (...args: unknown[]) => {
      this.off(event, wrappedHandler);
      this.onceHandlers.delete(wrappedHandler);
      return handler(...args);
    };

    this.onceHandlers.add(wrappedHandler);
    return this.on(event, wrappedHandler);
  }

  /**
   * Emit an event
   *
   * Performance optimizations:
   * - Fast path for events with no wildcard patterns
   * - Cached wildcard pattern matching
   * - Parallel handler execution with Promise.all
   * - Lazy sorted handler retrieval
   */
  async emit(event: string, data?: EventData, metadata?: Partial<EventMetadata>): Promise<void> {
    this.emittedEvents++;

    // Apply middleware chain to data
    const processedData = data !== undefined ? this.applyMiddleware(data) : undefined;

    const fullMetadata: EventMetadata = {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      ...metadata,
    } as EventMetadata;

    // Store in replay buffer if enabled - O(1) circular buffer write
    if (this.replayEnabled) {
      // Ensure buffer is initialized
      if (this.replayBuffer.length !== this.maxReplayBufferSize) {
        this.replayBuffer = new Array(this.maxReplayBufferSize).fill(null);
      }
      // Write to current position (overwrites oldest entry when full)
      this.replayBuffer[this.replayBufferWriteIndex] = { event, data: processedData, metadata: fullMetadata };
      this.replayBufferWriteIndex = (this.replayBufferWriteIndex + 1) % this.maxReplayBufferSize;
      if (this.replayBufferSize < this.maxReplayBufferSize) {
        this.replayBufferSize++;
      }
    }

    // Collect all promises for parallel execution
    const allPromises: Promise<void>[] = [];

    // Get sorted handlers for this event (lazy sorting)
    const handlers = this.getSortedHandlers(event);
    if (handlers.length > 0) {
      for (let i = 0, len = handlers.length; i < len; i++) {
        const handler = handlers[i]!;
        allPromises.push(this.executeHandler(handler, processedData, fullMetadata, event));
      }
    }

    // Handle wildcard patterns - only iterate if we have wildcards
    if (this.wildcardPatterns.size > 0) {
      for (const pattern of this.wildcardPatterns) {
        if (this.matchesPattern(event, pattern)) {
          const patternHandlers = this.getSortedHandlers(pattern);
          for (let i = 0, len = patternHandlers.length; i < len; i++) {
            const handler = patternHandlers[i]!;
            allPromises.push(this.executeHandler(handler, processedData, fullMetadata, event, pattern));
          }
        }
      }
    }

    // Execute all handlers in parallel
    if (allPromises.length > 0) {
      await Promise.all(allPromises);
    }
  }

  /**
   * Execute a single handler with error handling
   */
  private async executeHandler(
    handler: (...args: any[]) => any,
    data: EventData | undefined,
    metadata: EventMetadata,
    event: string,
    pattern?: string
  ): Promise<void> {
    try {
      await Promise.resolve(handler(data, metadata));
    } catch (err) {
      if (pattern) {
        this.logger?.error({ err, event, pattern }, 'Error in wildcard handler');
      } else {
        this.logger?.error({ err, event }, 'Error in event handler');
      }
      // Emit error event to error handlers
      if (event !== 'error') {
        this.emitError(err);
      }
    }
  }

  /**
   * Emit error to error handlers
   */
  private emitError(err: unknown): void {
    const errorHandlers = this.subscriptions.get('error');
    if (errorHandlers) {
      for (const errorHandler of errorHandlers) {
        try {
          errorHandler(err);
        } catch (errorHandlerErr) {
          this.logger?.error({ err: errorHandlerErr }, 'Error in error handler');
        }
      }
    }
  }

  /**
   * Get sorted handlers for an event (lazy sorting)
   */
  private getSortedHandlers(event: string): ((...args: any[]) => any)[] {
    const handlers = this.subscriptions.get(event);
    if (!handlers || handlers.size === 0) {
      return [];
    }

    // Check if we need to sort
    if (this.needsSort.has(event)) {
      const handlersArray = Array.from(handlers);
      handlersArray.sort((a, b) => {
        const priorityA = this.handlerPriorities.get(a) ?? 0;
        const priorityB = this.handlerPriorities.get(b) ?? 0;
        return priorityB - priorityA;
      });
      this.sortedHandlers.set(event, handlersArray);
      this.needsSort.delete(event);
      return handlersArray;
    }

    // Return cached sorted array or create one
    let sorted = this.sortedHandlers.get(event);
    if (!sorted) {
      sorted = Array.from(handlers);
      this.sortedHandlers.set(event, sorted);
    }
    return sorted;
  }

  /**
   * Emit an event asynchronously (parallel)
   */
  async emitAsync(event: string, data?: EventData, metadata?: Partial<EventMetadata>): Promise<void> {
    return this.emit(event, data, metadata);
  }

  /**
   * Emit an event in parallel (alias for emitAsync)
   */
  async emitParallel(event: string, data?: EventData, metadata?: Partial<EventMetadata>): Promise<void> {
    return this.emit(event, data, metadata);
  }

  /**
   * Emit an event sequentially (alias for emitSync)
   */
  async emitSequential(event: string, data?: EventData, metadata?: Partial<EventMetadata>): Promise<void> {
    return this.emitSync(event, data, metadata);
  }

  /**
   * Emit an event synchronously (sequential)
   */
  async emitSync(event: string, data?: EventData, metadata?: Partial<EventMetadata>): Promise<void> {
    this.emittedEvents++;

    const fullMetadata: EventMetadata = {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      ...metadata,
    } as EventMetadata;

    // Emit through internal emitter sequentially
    await this.emitter.emitSequential(event, data);

    // Also call registered handlers sequentially
    const handlers = this.subscriptions.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(data, fullMetadata);
        } catch (err) {
          this.logger?.error({ err, event }, 'Error in event handler');
          // Emit error event
          if (event !== 'error') {
            await this.emit('error', { error: toTitanError(err), event });
          }
        }
      }
    }
  }

  /**
   * Emit an event with reduce pattern
   */
  async emitReduce<T, R>(
    event: string,
    data: T,
    reducer: (acc: R, result: unknown) => R,
    initialValue: R,
    metadata?: Partial<EventMetadata>
  ): Promise<R> {
    this.emittedEvents++;

    const fullMetadata: EventMetadata = {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      ...metadata,
    } as EventMetadata;

    // Get handlers
    const handlers = this.subscriptions.get(event);
    if (!handlers || handlers.size === 0) {
      return initialValue;
    }

    // Reduce results
    let accumulator = initialValue;
    for (const handler of handlers) {
      try {
        const result = await handler(data, fullMetadata);
        accumulator = reducer(accumulator, result);
      } catch (err) {
        this.logger?.error({ err, event }, 'Error in reduce handler');
      }
    }

    return accumulator;
  }

  /**
   * Get all event names
   */
  eventNames(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.subscriptions.get(event)?.size || 0;
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.off(event);
    } else {
      this.subscriptions.clear();
      this.handlerPriorities.clear();
      this.sortedHandlers.clear();
      this.needsSort.clear();
      this.wildcardPatterns.clear();
      this.wildcardPatternCache.clear();
      this.maxListenersWarned.clear();
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Check if event matches pattern
   *
   * Performance optimization:
   * - Uses cached regex patterns to avoid recompilation on every emit
   * - LRU eviction ensures frequently used patterns stay in cache
   * - O(1) lookup after first compilation
   */
  private matchesPattern(event: string, pattern: string): boolean {
    // Use cached regex with LRU promotion on hit
    let regex = this.wildcardPatternCache.get(pattern);
    if (regex) {
      // LRU: Move to end by deleting and re-inserting (promotes recently used entries)
      this.wildcardPatternCache.delete(pattern);
      this.wildcardPatternCache.set(pattern, regex);
    } else {
      regex = this.compileWildcardPattern(pattern);

      // Apply LRU eviction to bound memory growth
      if (this.wildcardPatternCache.size >= EventBusService.MAX_WILDCARD_PATTERN_CACHE_SIZE) {
        // Remove least recently used entry (first key in Map iteration order)
        const firstKey = this.wildcardPatternCache.keys().next().value;
        if (firstKey !== undefined) {
          this.wildcardPatternCache.delete(firstKey);
        }
      }

      this.wildcardPatternCache.set(pattern, regex);
    }
    return regex.test(event);
  }

  /**
   * Compile a wildcard pattern to regex
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
   * Set maximum listeners per event
   */
  setMaxListeners(n: number): this {
    this.maxListenersPerEvent = n;
    return this;
  }

  /**
   * Get maximum listeners per event
   */
  getMaxListeners(): number {
    return this.maxListenersPerEvent;
  }

  /**
   * Check max listeners and warn if exceeded
   */
  private checkMaxListenersWarning(event: string): void {
    const count = this.subscriptions.get(event)?.size || 0;
    if (count >= this.maxListenersPerEvent && !this.maxListenersWarned.has(event)) {
      this.maxListenersWarned.add(event);
      this.logger?.warn(
        `Possible memory leak detected: ${count + 1} listeners added for event "${event}". ` +
          `Use setMaxListeners() to increase limit if this is intentional.`
      );
    }
  }

  /**
   * Publish a message to the bus (alternative API)
   */
  async publish<T = EventData>(
    channel: string,
    data: T,
    options?: {
      target?: string;
      source?: string;
      metadata?: Partial<EventMetadata>;
    }
  ): Promise<void> {
    const message: IEventBusMessage<T> = {
      id: this.generateMessageId(),
      event: channel,
      data,
      metadata: {
        id: this.generateMessageId(),
        timestamp: Date.now(),
        ...options?.metadata,
      },
      timestamp: Date.now(),
      source: options?.source,
      target: options?.target,
    };

    // If target is specified, add to queue with backpressure handling
    if (options?.target) {
      await this.queueMessageWithBackpressure(options.target, message);
    }

    // Emit to channel
    await this.emitter.emitParallel(`bus:${channel}`, message);
  }

  /**
   * Subscribe to a channel
   */
  subscribeToChannel<T = EventData>(
    channel: string,
    handler: (message: IEventBusMessage<T>) => void | Promise<void>,
    options?: {
      filter?: (message: IEventBusMessage<T>) => boolean;
      target?: string;
    }
  ): IEventSubscription {
    const wrappedHandler = async (message: IEventBusMessage<T>) => {
      // Filter by target if specified
      if (options?.target && message.target !== options.target) {
        return;
      }

      // Apply custom filter
      if (options?.filter && !options.filter(message)) {
        return;
      }

      await handler(message);
      this.queueMetrics.totalProcessed++;
    };

    // Track channel subscription
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(wrappedHandler);

    // Subscribe to emitter
    const unsubscribe = this.emitter.subscribe(`bus:${channel}`, wrappedHandler);

    return {
      unsubscribe: () => {
        unsubscribe();
        const handlers = this.channels.get(channel);
        if (handlers) {
          handlers.delete(wrappedHandler);
          if (handlers.size === 0) {
            this.channels.delete(channel);
          }
        }
      },
      isActive: () => this.channels.get(channel)?.has(wrappedHandler) || false,
    };
  }

  /**
   * Request-response pattern
   */
  async request<TRequest = EventData, TResponse = EventData>(
    channel: string,
    data: TRequest,
    options?: {
      timeout?: number;
      metadata?: Partial<EventMetadata>;
    }
  ): Promise<TResponse> {
    const requestId = this.generateMessageId();
    const responseChannel = `${channel}.response.${requestId}`;
    const timeout = options?.timeout;

    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            unsubscribe();
            reject(Errors.timeout(`channel request: ${channel}`, timeout));
          }, timeout)
        : null;

      // Subscribe to response
      const unsubscribe = this.emitter.subscribe(`bus:${responseChannel}`, (message: IEventBusMessage<TResponse>) => {
        if (timer) clearTimeout(timer);
        unsubscribe();
        resolve(message.data);
      });

      // Publish request
      this.publish(channel, data, {
        metadata: {
          ...options?.metadata,
          requestId,
          responseChannel,
        },
      });
    });
  }

  /**
   * Reply to a request
   */
  async reply<T = EventData>(message: IEventBusMessage, data: T): Promise<void> {
    const responseChannel = message.metadata?.['responseChannel'];
    if (!responseChannel) {
      throw Errors.badRequest('Cannot reply to message without responseChannel');
    }

    await this.publish(responseChannel, data, {
      source: message.target,
      target: message.source,
      metadata: {
        requestId: message.metadata['requestId'],
        inReplyTo: message.id,
      },
    });
  }

  /**
   * Create a channel bridge to another bus
   */
  bridge(
    localChannel: string,
    remoteBus: EventBusService,
    remoteChannel: string,
    options?: {
      bidirectional?: boolean;
      filter?: (message: IEventBusMessage) => boolean;
      transform?: (message: IEventBusMessage) => IEventBusMessage;
    }
  ): void {
    // Forward local to remote
    this.subscribeToChannel(localChannel, async (message: IEventBusMessage) => {
      if (options?.filter && !options.filter(message)) {
        return;
      }

      const transformed = options?.transform ? options.transform(message) : message;
      await remoteBus.publish(remoteChannel, transformed.data, {
        source: transformed.source,
        target: transformed.target,
        metadata: transformed.metadata,
      });
    });

    // Forward remote to local if bidirectional
    if (options?.bidirectional) {
      remoteBus.subscribeToChannel(remoteChannel, async (message: IEventBusMessage) => {
        if (options?.filter && !options.filter(message)) {
          return;
        }

        const transformed = options?.transform ? options.transform(message) : message;
        await this.publish(localChannel, transformed.data, {
          source: transformed.source,
          target: transformed.target,
          metadata: transformed.metadata,
        });
      });
    }
  }

  /**
   * Get queued messages for a target
   */
  getQueuedMessages(target: string): IEventBusMessage[] {
    return this.messageQueue.get(target) || [];
  }

  /**
   * Get queue size for a target
   */
  getQueueSize(target: string): number {
    return this.messageQueue.get(target)?.length || 0;
  }

  /**
   * Get total queue size across all targets
   */
  getTotalQueueSize(): number {
    let total = 0;
    for (const queue of this.messageQueue.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Clear queued messages for a target
   */
  clearQueue(target: string): void {
    this.messageQueue.delete(target);
    this.capacityWarned.delete(target);

    // Notify any pending block waiters
    const waiters = this.blockWaiters.get(target);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve();
      }
    }
  }

  /**
   * Get channel statistics
   */
  getChannelStats(): Map<string, { subscribers: number; queued: number }> {
    const stats = new Map<string, { subscribers: number; queued: number }>();

    // Pre-compute queue counts in single pass - O(n+c) instead of O(c*n)
    const queueCounts = new Map<string, number>();
    for (const queue of this.messageQueue.values()) {
      for (const msg of queue) {
        queueCounts.set(msg.event, (queueCounts.get(msg.event) ?? 0) + 1);
      }
    }

    for (const [channel, handlers] of this.channels.entries()) {
      stats.set(channel, {
        subscribers: handlers.size,
        queued: queueCounts.get(channel) ?? 0,
      });
    }

    return stats;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    this.messageIdCounter++;
    return `msg_${Date.now()}_${this.messageIdCounter}`;
  }

  /**
   * Check and warn about queue capacity
   */
  private checkQueueCapacity(target: string, queueSize: number): void {
    const threshold = Math.floor(this.queueConfig.maxSize * this.queueConfig.warningThreshold);

    if (queueSize >= threshold && !this.capacityWarned.has(target)) {
      this.capacityWarned.add(target);
      const utilization = Math.round((queueSize / this.queueConfig.maxSize) * 100);
      this.logger?.warn(
        {
          target,
          queueSize,
          maxSize: this.queueConfig.maxSize,
          utilization: `${utilization}%`,
          strategy: this.queueConfig.strategy,
        },
        `Message queue for target "${target}" is at ${utilization}% capacity (${queueSize}/${this.queueConfig.maxSize}). ` +
          `Consider increasing maxSize or processing messages faster.`
      );
    }

    // Update high watermark
    const currentHighWaterMark = this.queueMetrics.highWaterMark.get(target) || 0;
    if (queueSize > currentHighWaterMark) {
      this.queueMetrics.highWaterMark.set(target, queueSize);
    }
  }

  /**
   * Track dropped message metrics
   */
  private trackDroppedMessage(target: string): void {
    this.queueMetrics.droppedMessages++;
    const current = this.queueMetrics.droppedByTarget.get(target) || 0;
    this.queueMetrics.droppedByTarget.set(target, current + 1);
  }

  /**
   * Queue a message with backpressure handling
   */
  private async queueMessageWithBackpressure(target: string, message: IEventBusMessage): Promise<IQueueAddResult> {
    if (!this.messageQueue.has(target)) {
      this.messageQueue.set(target, []);
    }

    const queue = this.messageQueue.get(target)!;

    // Check capacity warning
    this.checkQueueCapacity(target, queue.length);

    // Check if queue is full
    if (queue.length >= this.queueConfig.maxSize) {
      switch (this.queueConfig.strategy) {
        case 'DROP_OLDEST': {
          const droppedMessage = queue.shift();
          this.trackDroppedMessage(target);
          this.logger?.debug(
            { target, droppedMessageId: droppedMessage?.id, queueSize: queue.length },
            'Dropped oldest message due to queue backpressure'
          );
          queue.push(message);
          return {
            success: true,
            droppedMessageId: droppedMessage?.id,
          };
        }

        case 'DROP_NEWEST': {
          this.trackDroppedMessage(target);
          this.logger?.debug(
            { target, messageId: message.id, queueSize: queue.length },
            'Dropped incoming message due to queue backpressure'
          );
          return {
            success: false,
            dropReason: 'queue_full_drop_newest',
          };
        }

        case 'BLOCK': {
          const blockResult = await this.waitForQueueSpace(target);
          if (!blockResult) {
            this.queueMetrics.blockTimeouts++;
            this.logger?.warn(
              { target, messageId: message.id, timeout: this.queueConfig.blockTimeout },
              'Block timeout while waiting for queue space'
            );
            return {
              success: false,
              dropReason: 'block_timeout',
            };
          }
          // Space is now available, add the message
          queue.push(message);
          return { success: true };
        }

        case 'REJECT': {
          this.queueMetrics.rejectedMessages++;
          this.logger?.warn(
            { target, messageId: message.id, queueSize: queue.length },
            'Message rejected due to full queue'
          );
          throw Errors.tooManyRequests();
        }

        default: {
          // Default to DROP_OLDEST for safety
          const droppedMessage = queue.shift();
          this.trackDroppedMessage(target);
          queue.push(message);
          return {
            success: true,
            droppedMessageId: droppedMessage?.id,
          };
        }
      }
    }

    // Queue has space, add the message
    queue.push(message);
    return { success: true };
  }

  /**
   * Wait for space in the queue (for BLOCK strategy)
   */
  private waitForQueueSpace(target: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the list
        const waiters = this.blockWaiters.get(target);
        if (waiters) {
          const index = waiters.findIndex((w) => w.resolve === resolveWrapper);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
        }
        resolve(false);
      }, this.queueConfig.blockTimeout);

      const resolveWrapper = () => {
        clearTimeout(timer);
        resolve(true);
      };

      const rejectWrapper = () => {
        clearTimeout(timer);
        resolve(false);
      };

      if (!this.blockWaiters.has(target)) {
        this.blockWaiters.set(target, []);
      }
      this.blockWaiters.get(target)!.push({ resolve: resolveWrapper, reject: rejectWrapper });
    });
  }

  /**
   * Notify waiters that queue space is available
   */
  private notifyQueueSpaceAvailable(target: string): void {
    const waiters = this.blockWaiters.get(target);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve();
      }
    }
  }

  /**
   * Consume a message from the queue (for processing)
   * This should be called by consumers to properly track metrics and notify waiters
   */
  consumeMessage(target: string): IEventBusMessage | undefined {
    const queue = this.messageQueue.get(target);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const message = queue.shift();
    this.queueMetrics.totalProcessed++;

    // Reset capacity warning if queue drops below threshold
    if (queue.length < Math.floor(this.queueConfig.maxSize * this.queueConfig.warningThreshold)) {
      this.capacityWarned.delete(target);
    }

    // Notify any pending block waiters that space is available
    this.notifyQueueSpaceAvailable(target);

    return message;
  }

  /**
   * Consume multiple messages from the queue (batch processing)
   */
  consumeMessages(target: string, count: number): IEventBusMessage[] {
    const queue = this.messageQueue.get(target);
    if (!queue || queue.length === 0) {
      return [];
    }

    const messages = queue.splice(0, Math.min(count, queue.length));
    this.queueMetrics.totalProcessed += messages.length;

    // Reset capacity warning if queue drops below threshold
    if (queue.length < Math.floor(this.queueConfig.maxSize * this.queueConfig.warningThreshold)) {
      this.capacityWarned.delete(target);
    }

    // Notify waiters for each consumed message
    for (let i = 0; i < messages.length; i++) {
      this.notifyQueueSpaceAvailable(target);
    }

    return messages;
  }
}
