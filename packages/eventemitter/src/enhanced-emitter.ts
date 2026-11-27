 

import { EventEmitter } from './emitter.js';
import type { ListenerLike } from './types.js';
import { EventHistory } from './history.js';
import { WildcardMatcher } from './wildcard.js';
import { EventScheduler } from './scheduler.js';
import { MetricsCollector } from './metrics.js';

import type {
  EventMap,
  ListenerFn,
  EmitOptions,
  EventFilter,
  EventRecord,
  BatchOptions,
  EventMetadata,
  EmitterMetrics,
  MetricsOptions,
  WildcardOptions,
  ScheduleOptions,
  ListenerOptions,
  EventInterceptor,
  ValidationSchema,
  EventHistoryOptions,
  ErrorHandlingOptions,
} from './types.js';

/** One timer and one detachable buffer per batch destination. */
class EventBatch<T> {
  private items: T[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(public options: BatchOptions, private readonly deliver: (items: T[]) => void) {}

  add(item: T): void {
    this.items.push(item);
    if (this.options.maxSize && this.items.length >= this.options.maxSize) {
      this.flush();
    } else if (this.options.maxWait && this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.options.maxWait);
    }
  }

  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.items = [];
  }

  private flush(): void {
    const items = this.items;
    this.clear();
    this.deliver(items);
  }
}

/**
 * Enhanced EventEmitter with advanced features
 */
export class EnhancedEventEmitter<TEventMap extends EventMap = EventMap> extends EventEmitter {
  // Feature modules
  private wildcardMatcher: WildcardMatcher;
  private history: EventHistory;
  private scheduler: EventScheduler;
  private metrics: MetricsCollector;

  // Configuration
  private wildcardEnabled: boolean;
  private delimiter: string;

  // Interceptors and middleware
  private globalInterceptors: EventInterceptor[] = [];
  private eventInterceptors: Map<string, EventInterceptor[]> = new Map();

  // Validation schemas
  private schemas: Map<string, ValidationSchema> = new Map();

  // Batching configuration
  private batches = new Map<string, EventBatch<{ data: unknown; metadata: EventMetadata }>>();
  private batchSubscriptions = new Map<() => void, string>();

  // Throttle/Debounce configurations
  private throttleConfigs: Map<string, { interval: number; lastEmit: number }> = new Map();
  private debounceConfigs: Map<string, { delay: number; timer?: NodeJS.Timeout }> = new Map();

  // Error handling
  private errorHandlers: Map<string, ErrorHandlingOptions> = new Map();
  private globalErrorHandler?: (error: Error, event: string, data: any, metadata?: EventMetadata) => void;

  // Circuit breakers
  private circuitBreakers: Map<
    string,
    {
      failures: number;
      lastFailure: number;
      state: 'closed' | 'open' | 'half-open';
      options: any;
    }
  > = new Map();

  constructor(options: WildcardOptions & { concurrency?: number } = {}) {
    super(options.concurrency);

    // Initialize wildcard support
    this.delimiter = options.delimiter || '.';
    this.wildcardEnabled = options.wildcard !== false;
    this.wildcardMatcher = new WildcardMatcher(this.delimiter, '*', '**');

    // Initialize feature modules
    this.history = new EventHistory();
    this.scheduler = new EventScheduler();
    this.metrics = new MetricsCollector();
  }

  /**
   * Type-safe emit for mapped events
   */
  emitTyped<K extends keyof TEventMap>(event: K, data: TEventMap[K], options?: EmitOptions): boolean {
    return this.emitEnhanced(event as string, data, options);
  }

  /**
   * Type-safe on for mapped events
   */
  onTyped<K extends keyof TEventMap>(event: K, listener: ListenerFn<TEventMap[K]>, options?: ListenerOptions): this {
    return this.onEnhanced(event as string, listener, options);
  }

  /**
   * Override emit to add throttle/debounce support
   */
  override emit(event: string | symbol, ...args: any[]): boolean {
    const eventName = String(event);

    // Check for throttle config
    if (this.throttleConfigs.has(eventName)) {
      const config = this.throttleConfigs.get(eventName)!;
      const now = Date.now();
      if (now - config.lastEmit < config.interval) {
        return false; // Throttled
      }
      config.lastEmit = now;
    }

    // Check for debounce config
    if (this.debounceConfigs.has(eventName)) {
      const config = this.debounceConfigs.get(eventName)!;
      if (config.timer) {
        clearTimeout(config.timer);
      }
      config.timer = setTimeout(() => {
        super.emit(event, ...args);
        config.timer = undefined;
      }, config.delay);
      return false; // Debounced, will emit later
    }

    return super.emit(event, ...args);
  }

  /**
   * Enhanced emit with metadata and options
   */
  emitEnhanced(event: string, data?: any, options?: EmitOptions): boolean {
    const startTime = Date.now();
    const metadata = this.createMetadata(options?.metadata);

    try {
      // Check for throttle config
      if (this.throttleConfigs.has(event)) {
        const config = this.throttleConfigs.get(event)!;
        const now = Date.now();
        if (now - config.lastEmit < config.interval) {
          return false; // Throttled
        }
        config.lastEmit = now;
      }

      // Check for debounce config
      if (this.debounceConfigs.has(event)) {
        const config = this.debounceConfigs.get(event)!;
        if (config.timer) {
          clearTimeout(config.timer);
        }
        config.timer = setTimeout(() => {
          // Emit the event after debounce delay
          this.emitWithMetadata(event, data, metadata);
        }, config.delay);
        return false; // Debounced, will emit later
      }

      // Validate if schema exists
      if (options?.validate !== false && this.schemas.has(event)) {
        const schema = this.schemas.get(event)!;
        const validation = schema.validate(data);
        if (!validation.valid) {
          throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
        }
      }

      // Apply before interceptors
      data = this.applyBeforeInterceptors(event, data, metadata);

      // Check if event should be batched
      const batch = this.batches.get(event);
      if (batch) {
        batch.add({ data, metadata });
        return true;
      }

      // Handle wildcard listeners
      let handled = false;
      if (this.wildcardEnabled) {
        handled = this.emitWithWildcard(event, data, metadata);
      } else {
        handled = this.emitWithMetadata(event, data, metadata);
      }

      // Apply after interceptors
      this.applyAfterInterceptors(event, data, metadata, undefined);

      // Record metrics
      const duration = Date.now() - startTime;
      this.metrics.recordEmission(event, true, duration);

      // Record history
      if (this.history.isEnabled()) {
        const record: EventRecord = {
          event,
          data,
          metadata,
          timestamp: Date.now(),
          duration,
        };
        this.history.record(record);
      }

      return handled;
    } catch (error) {
      // Handle errors
      this.handleError(event, error as Error, data, metadata);

      // Record failed metrics
      this.metrics.recordEmission(event, false);

      // Record error in history
      if (this.history.isEnabled()) {
        const record: EventRecord = {
          event,
          data,
          metadata,
          timestamp: Date.now(),
          error: error as Error,
          duration: Date.now() - startTime,
        };
        this.history.record(record);
      }

      throw error;
    }
  }

  /**
   * Enhanced on with options
   */
  onEnhanced(event: string, listener: ListenerLike, options?: ListenerOptions): this {
    this.subscribeEnhanced(event, listener, options);
    return this;
  }

  /** Subscribe with listener options and detach the exact installed wrapper. */
  subscribeEnhanced(event: string, listener: ListenerLike, options?: ListenerOptions): () => void {
    // Wrap listener with error boundary if requested
    if (options?.errorBoundary) {
      const originalListener = listener;
      listener = async (...args: any[]) => {
        try {
          return await originalListener(...args);
        } catch (error) {
          if (options.onError) {
            options.onError(error as Error, args[0], args[1]);
          }
          // Don't re-throw error when error boundary is enabled
          return undefined;
        }
      };
    }

    // Add timeout if specified
    if (options?.timeout) {
      const originalListener = listener;
      listener = async (...args: any[]) =>
        Promise.race([
          originalListener(...args),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Listener timeout')), options.timeout)),
        ]);
    }

    return super.subscribe(event, listener);
  }

  /**
   * Emit with wildcard pattern matching
   */
  private emitWithWildcard(event: string, data: any, metadata: EventMetadata): boolean {
    const allEvents = this.eventNames() as string[];
    const matchingPatterns = allEvents.filter((pattern) => this.wildcardMatcher.match(event, pattern));

    let handled = false;

    // First emit to wildcard patterns (excluding exact match)
    for (const pattern of matchingPatterns) {
      if (pattern !== event) {
        // Skip exact match here
        // Include the actual event name in metadata for wildcard handlers
        const wildcardMetadata = { ...metadata, event };
        if (super.emit(pattern, data, wildcardMetadata)) {
          handled = true;
        }
      }
    }

    // Then emit to exact match if exists
    if (super.emit(event, data, metadata)) {
      handled = true;
    }

    return handled;
  }

  /**
   * Emit with metadata
   */
  private emitWithMetadata(event: string, data: any, metadata: EventMetadata): boolean {
    return super.emit(event, data, metadata);
  }

  /**
   * Emit event with reduce pattern
   */
  override async emitReduce<T = any, R = any>(
    event: string,
    data: T,
    initialValue: R,
    metadata?: EventMetadata
  ): Promise<R> {
    const listeners = this.listeners(event);
    if (listeners.length === 0) return initialValue;

    let accumulator = initialValue;

    for (const listener of listeners) {
      try {
        // Call listener with data, metadata, and accumulator
        const result = await Promise.resolve(listener(data, metadata, accumulator));
        accumulator = result !== undefined ? result : accumulator;
      } catch (error) {
        // Handle errors, continue with current accumulator
        this.handleError(event, error as Error, data, metadata || ({} as EventMetadata));
      }
    }

    return accumulator;
  }

  /**
   * Add interceptor
   */
  addInterceptor(interceptor: EventInterceptor): this;
  addInterceptor(event: string, interceptor: EventInterceptor): this;
  addInterceptor(eventOrInterceptor: string | EventInterceptor, interceptor?: EventInterceptor): this {
    if (typeof eventOrInterceptor === 'string') {
      // Event-specific interceptor
      const event = eventOrInterceptor;
      let interceptors = this.eventInterceptors.get(event);
      if (!interceptors) {
        interceptors = [];
        this.eventInterceptors.set(event, interceptors);
      }
      interceptors.push(interceptor!);
    } else {
      // Global interceptor
      this.globalInterceptors.push(eventOrInterceptor);
    }
    return this;
  }

  /**
   * Enable event history
   */
  enableHistory(options?: EventHistoryOptions): this {
    this.history = new EventHistory(options);
    this.history.enable();
    return this;
  }

  /**
   * Get event history
   */
  async getHistory(filter?: EventFilter): Promise<EventRecord[]> {
    return this.history.getHistory(filter);
  }

  /**
   * Clear event history
   */
  async clearHistory(): Promise<void> {
    return this.history.clear();
  }

  /**
   * Export event history
   */
  async exportHistory(): Promise<EventRecord[]> {
    return this.history.export();
  }

  /**
   * Import event history
   */
  async importHistory(records: EventRecord[]): Promise<void> {
    return this.history.import(records);
  }

  /**
   * Replay events from history
   */
  async replay(filter?: EventFilter): Promise<void> {
    const records = await this.history.getHistory(filter);
    for (const record of records) {
      this.emit(record.event, record.data);
    }
  }

  /**
   * Schedule an event
   */
  schedule(event: string, data: any, options: ScheduleOptions): string {
    return this.scheduler.schedule(event, data, options, (e, d) => {
      this.emitEnhanced(e, d);
    });
  }

  /**
   * Cancel scheduled event
   */
  cancelSchedule(id: string): boolean {
    return this.scheduler.cancel(id);
  }

  /**
   * Get scheduled events
   */
  getScheduledEvents() {
    return this.scheduler.getScheduledEvents();
  }

  /**
   * Configure event batching
   */
  batch(event: string, options: BatchOptions): this {
    const existing = this.batches.get(event);
    if (existing) existing.options = options;
    else this.batches.set(event, new EventBatch(options, items => super.emit(`${event}:batch`, items)));
    return this;
  }

  /**
   * Register validation schema
   */
  registerSchema(event: string, schema: ValidationSchema): this {
    this.schemas.set(event, schema);
    return this;
  }

  /**
   * Enable metrics collection
   */
  enableMetrics(options?: MetricsOptions): this {
    this.metrics = new MetricsCollector(options);
    this.metrics.enable();
    return this;
  }

  /**
   * Get metrics
   */
  getMetrics(): EmitterMetrics {
    return this.metrics.getMetrics();
  }

  /**
   * Export metrics
   */
  exportMetrics(format: 'json' | 'prometheus' = 'json'): string {
    return this.metrics.export(format);
  }

  /**
   * Get metrics summary
   */
  getMetricsSummary(): string {
    return this.metrics.getSummary();
  }

  /**
   * Set global error handler
   */
  onError(handler: (error: Error, event: string, data: any, metadata?: EventMetadata) => void): this {
    this.globalErrorHandler = handler;
    return this;
  }

  /**
   * Throttle event emission
   */
  throttle(event: string, interval: number): this {
    this.throttleConfigs.set(event, { interval, lastEmit: 0 });
    return this;
  }

  /**
   * Debounce event emission
   */
  debounce(event: string, delay: number): this {
    this.debounceConfigs.set(event, { delay });
    return this;
  }

  /**
   * Create metadata object
   */
  private createMetadata(partial?: Partial<EventMetadata>): EventMetadata {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      ...partial,
    };
  }

  /**
   * Apply before interceptors
   */
  private applyBeforeInterceptors(event: string, data: any, metadata: EventMetadata): any {
    // Apply global interceptors
    for (const interceptor of this.globalInterceptors) {
      if (interceptor.before) {
        data = interceptor.before(event, data, metadata);
      }
    }

    // Apply event-specific interceptors (including wildcard patterns)
    for (const [pattern, interceptors] of this.eventInterceptors.entries()) {
      // Check if the pattern matches the event (handles wildcards)
      if (this.wildcardMatcher.match(event, pattern)) {
        for (const interceptor of interceptors) {
          if (interceptor.before) {
            data = interceptor.before(event, data, metadata);
          }
        }
      }
    }

    return data;
  }

  /**
   * Apply after interceptors
   */
  private applyAfterInterceptors(event: string, data: any, metadata: EventMetadata, result?: any): void {
    // Apply global interceptors
    for (const interceptor of this.globalInterceptors) {
      if (interceptor.after) {
        interceptor.after(event, data, metadata, result);
      }
    }

    // Apply event-specific interceptors (including wildcard patterns)
    for (const [pattern, interceptors] of this.eventInterceptors.entries()) {
      // Check if the pattern matches the event (handles wildcards)
      if (this.wildcardMatcher.match(event, pattern)) {
        for (const interceptor of interceptors) {
          if (interceptor.after) {
            interceptor.after(event, data, metadata, result);
          }
        }
      }
    }
  }

  /**
   * Handle errors
   */
  private handleError(event: string, error: Error, data: any, metadata: EventMetadata): void {
    // Apply error interceptors
    for (const interceptor of this.globalInterceptors) {
      if (interceptor.error) {
        interceptor.error(event, error, metadata);
      }
    }

    const eventInterceptors = this.eventInterceptors.get(event);
    if (eventInterceptors) {
      for (const interceptor of eventInterceptors) {
        if (interceptor.error) {
          interceptor.error(event, error, metadata);
        }
      }
    }

    // Call global error handler
    if (this.globalErrorHandler) {
      this.globalErrorHandler(error, event, data, metadata);
    }
  }

  /** Batch payloads for one listener while other subscribers continue receiving individual events. */
  subscribeBatch<T>(event: string, options: Pick<BatchOptions, 'maxSize' | 'maxWait'>, listener: (items: T[]) => void): () => void {
    if (options.maxSize === undefined && options.maxWait === undefined)
      throw new RangeError('Batch subscriptions require maxSize or maxWait');
    for (const limit of [options.maxSize, options.maxWait]) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
        throw new RangeError('Batch limits must be positive integers');
    }
    const batch = new EventBatch<T>({ ...options }, listener);
    const detach = super.subscribe(event, (data: T) => batch.add(data));
    const unsubscribe = () => {
      detach();
      batch.clear();
      this.batchSubscriptions.delete(unsubscribe);
    };
    this.batchSubscriptions.set(unsubscribe, event);
    return unsubscribe;
  }

  override removeAllListeners(event?: string | symbol): this {
    for (const [unsubscribe, source] of this.batchSubscriptions) {
      if (event === undefined || source === event) unsubscribe();
    }
    return super.removeAllListeners(event);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Emit events sequentially (alias for emitSerial from base class)
   * This method ensures that event handlers are executed one after another
   */
  emitSequential(event: string | symbol, ...args: any[]): Promise<any[]> {
    return this.emitSerial(event, ...args);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.scheduler.cancelAll();
    this.history.disable();
    this.metrics.disable();

    for (const batch of this.batches.values()) batch.clear();
    this.batches.clear();

    this.removeAllListeners();
  }
}
