
/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import { EventEmitter } from './emitter.js';
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
  ErrorHandlingOptions
} from './types.js';

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
  private batchConfigs: Map<string, BatchOptions> = new Map();
  private batchBuffers: Map<string, any[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();

  // Throttle/Debounce configurations
  private throttleConfigs: Map<string, { interval: number; lastEmit: number }> = new Map();
  private debounceConfigs: Map<string, { delay: number; timer?: NodeJS.Timeout }> = new Map();

  // Error handling
  private errorHandlers: Map<string, ErrorHandlingOptions> = new Map();
  private globalErrorHandler?: (error: Error, event: string, data: any, metadata?: EventMetadata) => void;

  // Circuit breakers
  private circuitBreakers: Map<string, {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
    options: any;
  }> = new Map();

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
  emitTyped<K extends keyof TEventMap>(
    event: K,
    data: TEventMap[K],
    options?: EmitOptions
  ): boolean {
    return this.emitEnhanced(event as string, data, options);
  }

  /**
   * Type-safe on for mapped events
   */
  onTyped<K extends keyof TEventMap>(
    event: K,
    listener: ListenerFn<TEventMap[K]>,
    options?: ListenerOptions
  ): this {
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
      if (this.batchConfigs.has(event)) {
        this.addToBatch(event, data, metadata);
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
          duration
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
          duration: Date.now() - startTime
        };
        this.history.record(record);
      }

      throw error;
    }
  }

  /**
   * Enhanced on with options
   */
  onEnhanced(event: string, listener: Function, options?: ListenerOptions): this {
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
      listener = async (...args: any[]) => Promise.race([
        originalListener(...args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Listener timeout')), options.timeout)
        )
      ]);
    }

    return super.on(event, listener);
  }

  /**
   * Emit with wildcard pattern matching
   */
  private emitWithWildcard(event: string, data: any, metadata: EventMetadata): boolean {
    const allEvents = this.eventNames() as string[];
    const matchingPatterns = allEvents.filter(pattern =>
      this.wildcardMatcher.match(event, pattern)
    );

    let handled = false;

    // First emit to wildcard patterns (excluding exact match)
    for (const pattern of matchingPatterns) {
      if (pattern !== event) {  // Skip exact match here
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
  addInterceptor(
    eventOrInterceptor: string | EventInterceptor,
    interceptor?: EventInterceptor
  ): this {
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
    this.batchConfigs.set(event, options);
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
      ...partial
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

  /**
   * Add to batch buffer
   */
  private addToBatch(event: string, data: any, metadata: EventMetadata): void {
    const config = this.batchConfigs.get(event)!;

    // Initialize buffer if needed
    if (!this.batchBuffers.has(event)) {
      this.batchBuffers.set(event, []);
    }

    const buffer = this.batchBuffers.get(event)!;
    buffer.push({ data, metadata });

    // Check if should flush
    if (config.maxSize && buffer.length >= config.maxSize) {
      this.flushBatch(event);
    } else if (config.maxWait && !this.batchTimers.has(event)) {
      // Set timer for max wait
      const timer = setTimeout(() => {
        this.flushBatch(event);
      }, config.maxWait);
      this.batchTimers.set(event, timer);
    }
  }

  /**
   * Flush batch buffer
   */
  private flushBatch(event: string): void {
    const buffer = this.batchBuffers.get(event);
    if (!buffer || buffer.length === 0) return;

    // Clear timer if exists
    const timer = this.batchTimers.get(event);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(event);
    }

    // Emit batch event
    super.emit(`${event}:batch`, buffer);

    // Clear buffer
    this.batchBuffers.set(event, []);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.scheduler.cancelAll();
    this.history.disable();
    this.metrics.disable();

    // Clear batch timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    this.removeAllListeners();
  }
}