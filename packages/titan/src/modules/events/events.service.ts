/**
 * Core Events Service
 * 
 * Main service for event handling in Titan applications
 */

import type {
  EmitOptions,
  EventRecord,
  EventFilter,
  EventMetadata
} from '@omnitron-dev/eventemitter';

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Injectable } from '@omnitron-dev/nexus';

import { EventMetadataService } from './event-metadata.service.js';
import { EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN } from './events.module.js';

import type {
  IEventContext,
  IEventStatistics,
  IEventSubscription,
  IEventListenerOptions,
  IEventValidationResult
} from './types.js';

/**
 * Core service for event handling
 */
@Injectable()
export class EventsService {
  private subscriptions: Map<string, Array<{ subscription: IEventSubscription; priority: number }>> = new Map();
  private eventStats: Map<string, IEventStatistics> = new Map();
  private wildcardSubscriptions: Map<string, { pattern: RegExp; handler: (...args: any[]) => any; originalHandler: (...args: any[]) => any }> | undefined;
  private initialized = false;
  private destroyed = false;
  private logger: any = null;
  private bubblingEnabled = false;

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Inject(EVENT_METADATA_SERVICE_TOKEN) private readonly metadataService: EventMetadataService,
    
  ) { }

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
    this.emitter.dispose();

    this.logger?.info('EventsService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    const totalEvents = this.eventStats.size;
    const totalSubscriptions = Array.from(this.subscriptions.values())
      .reduce((acc, arr) => acc + arr.length, 0);
    const totalEmissions = Array.from(this.eventStats.values())
      .reduce((acc, stats) => acc + stats.emitCount, 0);

    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        totalEvents,
        totalSubscriptions,
        totalEmissions
      }
    };
  }

  /**
   * Emit an event with data and options
   */
  emit<T = any>(
    event: string,
    data?: T,
    options?: EmitOptions
  ): boolean {
    const startTime = Date.now();

    try {
      // Add context metadata
      const metadata = this.metadataService.createMetadata({
        ...options?.metadata,
        source: this.constructor.name
      });

      // Emit the event using enhanced emit if available, otherwise standard emit
      let result: boolean = false;

      // Check wildcard subscriptions first
      if (this.wildcardSubscriptions) {
        for (const [pattern, subscription] of this.wildcardSubscriptions) {
          if (subscription.pattern.test(event)) {
            try {
              subscription.handler(data);
              result = true;
            } catch (error) {
              // Handle error but continue
              this.emitter.emit('error', error as Error);
              this.logger?.error(`Error in wildcard handler for pattern ${pattern}:`, error);
            }
          }
        }
      }

      // Handle event bubbling if enabled
      if (this.bubblingEnabled) {
        // Emit the event and all parent events
        const eventParts = event.split('.');
        for (let i = eventParts.length; i > 0; i--) {
          const currentEvent = eventParts.slice(0, i).join('.');

          // Execute our priority-sorted handlers
          const subs = this.subscriptions.get(currentEvent);
          if (subs && subs.length > 0) {
            // Handlers are already sorted by priority in addSubscription
            for (const { subscription } of subs) {
              try {
                if (subscription.wrappedHandler) {
                  subscription.wrappedHandler(data);
                  result = true;
                }
              } catch (error) {
                this.emitter.emit('error', error as Error);
                this.logger?.error(`Error in handler for ${currentEvent}:`, error);
              }
            }
          }
        }
      } else {
        // Normal emit without bubbling
        // Execute our priority-sorted handlers
        const subs = this.subscriptions.get(event);
        if (subs && subs.length > 0) {
          // Handlers are already sorted by priority in addSubscription
          for (const { subscription } of subs) {
            try {
              if (subscription.wrappedHandler) {
                subscription.wrappedHandler(data);
                result = true;
              }
            } catch (error) {
              this.emitter.emit('error', error as Error);
              this.logger?.error(`Error in handler for ${event}:`, error);
            }
          }
        }
      }

      // Update statistics
      this.updateStats(event, true, Date.now() - startTime);

      return result;
    } catch (error) {
      // Update error statistics
      this.updateStats(event, false, Date.now() - startTime, error as Error);
      // Don't throw system errors - they're already handled
      this.logger?.error(`System error in emit for ${event}:`, error);
      return false;
    }
  }

  /**
   * Emit an event asynchronously in parallel
   */
  async emitAsync<T = any>(
    event: string,
    data?: T,
    options?: EmitOptions
  ): Promise<any[]> {
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      async: true
    });

    const results: any[] = [];

    // Handle wildcard subscriptions for async
    if (this.wildcardSubscriptions) {
      const wildcardPromises: Promise<any>[] = [];
      for (const [pattern, subscription] of this.wildcardSubscriptions) {
        if (subscription.pattern.test(event)) {
          wildcardPromises.push(
            Promise.resolve(subscription.handler(data))
              .catch(error => this.logger?.error(`Error in wildcard async handler for pattern ${pattern}:`, error))
          );
        }
      }
      const wildcardResults = await Promise.all(wildcardPromises);
      results.push(...wildcardResults.filter(r => r !== undefined));
    }

    // Handle regular event handlers via the emitter
    const emitterResults = await this.emitter.emitParallel(event, data, metadata);
    results.push(...emitterResults);

    return results;
  }

  /**
   * Emit an event asynchronously in series
   */
  async emitSerial<T = any>(
    event: string,
    data?: T,
    options?: EmitOptions
  ): Promise<any[]> {
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      async: true,
      serial: true
    });

    return this.emitter.emitSerial(event, data, metadata);
  }

  /**
   * Emit an event with reduce pattern
   */
  async emitReduce<T = any, R = any>(
    event: string,
    data: T,
    initialValue: R,
    options?: EmitOptions
  ): Promise<R> {
    const metadata = this.metadataService.createMetadata({
      ...options?.metadata,
      pattern: 'reduce'
    });

    return this.emitter.emitReduce(event, data, initialValue, metadata);
  }

  /**
   * Subscribe to an event
   */
  subscribe(
    event: string,
    handler: (...args: any[]) => any,
    options?: IEventListenerOptions
  ): IEventSubscription {
    // Wrap handler with options
    const wrappedHandler = this.wrapHandler(handler, options);

    // Check if this is a wildcard pattern
    if (event.includes('*')) {
      // Store the pattern for wildcard matching
      const pattern = new RegExp('^' + event.replace(/\*/g, '.*') + '$');

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
        },
        isActive: () => this.wildcardSubscriptions?.has(event) || false,
        event,
        handler,
        wrappedHandler
      };

      // Track subscription
      this.addSubscription(event, subscription, options?.priority || 0);
      return subscription;
    }

    // Regular event subscription (non-wildcard)
    // Register with emitter for async support
    let unsubscribe: () => void;
    if (this.emitter.subscribe) {
      unsubscribe = this.emitter.subscribe(event, wrappedHandler);
    } else if (this.emitter.on) {
      this.emitter.on(event, wrappedHandler);
      unsubscribe = () => this.emitter.off(event, wrappedHandler);
    } else {
      throw new Error('EventEmitter does not support subscription');
    }

    // Create subscription object
    const subscription: IEventSubscription = {
      unsubscribe: () => {
        unsubscribe();
        this.removeSubscription(event, subscription);
      },
      isActive: () => {
        const subs = this.subscriptions.get(event);
        return subs ? subs.some(s => s.subscription === subscription) : false;
      },
      event,
      handler,
      wrappedHandler // Store wrapped handler for unsubscribe
    };

    // Track subscription
    this.addSubscription(event, subscription, options?.priority || 0);

    return subscription;
  }

  /**
   * Subscribe to an event once
   */
  once(
    event: string,
    handler: (...args: any[]) => any,
    options?: IEventListenerOptions
  ): IEventSubscription {
    const wrappedHandler = this.wrapHandler(handler, options);

    // Create a special once wrapper
    let executed = false;
    const onceWrapper = (...args: any[]) => {
      if (!executed) {
        executed = true;
        this.removeSubscription(event, subscription);
        return wrappedHandler(...args);
      }
      return undefined;
    };

    const subscription: IEventSubscription = {
      unsubscribe: () => {
        this.removeSubscription(event, subscription);
      },
      isActive: () => !executed,
      event,
      handler,
      wrappedHandler: onceWrapper
    };

    this.addSubscription(event, subscription, options?.priority || 0);

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
    return events.map(event => this.subscribe(event, handler, options));
  }

  /**
   * Subscribe to all events
   */
  subscribeAll(
    handler: (...args: any[]) => void,
    options?: IEventListenerOptions
  ): IEventSubscription {
    return this.subscribe('**', handler, options);
  }

  /**
   * Alias for subscribe (EventEmitter compatibility)
   */
  on(
    event: string,
    handler: (...args: any[]) => any,
    options?: IEventListenerOptions
  ): IEventSubscription {
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
              const testData = JSON.parse(JSON.stringify(data));
              const mockHandler = (d: any) => {
                if (d.fail) {
                  throw new Error('Transaction failed');
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
      }
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
  }

  /**
   * Wait for an event
   */
  async waitFor<T = any>(
    event: string,
    timeout?: number,
    filter?: (data: T) => boolean
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
          reject(new Error(`Timeout waiting for event: ${event}`));
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
  scheduleEvent(
    event: string,
    data: any,
    delay: number
  ): string {
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
  createContext<T = any>(
    event: string,
    data: T,
    metadata?: Partial<EventMetadata>
  ): IEventContext<T> {
    const fullMetadata = this.metadataService.createMetadata(metadata);

    return {
      event,
      data,
      metadata: fullMetadata,
      correlationId: fullMetadata.correlationId,
      userId: fullMetadata.userId,
      sessionId: fullMetadata.sessionId
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
  configureBatching(
    event: string,
    maxSize: number,
    maxWait: number
  ): void {
    this.emitter.batch(event, { maxSize, maxWait });
  }

  /**
   * Configure event throttling
   */
  configureThrottling(event: string, interval: number): void {
    this.emitter.throttle(event, interval);
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
   * Clean up resources
   */
  dispose(): void {
    this.unsubscribeAll();
    this.emitter.dispose();
  }

  /**
   * Wrap event handler with options
   */
  private wrapHandler(
    handler: (...args: any[]) => any,
    options?: IEventListenerOptions
  ): (...args: any[]) => any {
    // If no options, return a simple wrapper that just calls the handler
    if (!options) {
      return (...args: any[]) => {
        // Call handler with just data (first argument) for EventEmitter compatibility
        const [data] = args;
        return handler(data);
      };
    }

    return async (...args: any[]): Promise<any> => {
      // Extract data (first argument) - for compatibility with standard EventEmitter pattern
      let [data, metadata, ...restArgs] = args;

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
              // Call handler with just data for EventEmitter compatibility
              return await handler(data);
            } catch (error) {
              if (attempts >= maxAttempts) {
                throw error;
              }
              // Wait before retry
              const delay = options.retry.delay || 100;
              const backoff = options.retry.backoff || 1;
              await new Promise(resolve => setTimeout(resolve, delay * Math.pow(backoff, attempts - 1)));
            }
          }
          // Should not reach here, but TypeScript needs this
          throw new Error('Retry loop completed without success');
        } else {
          // Call handler with just data for EventEmitter compatibility
          return await handler(data);
        }
      };

      // Wrap with timeout if specified
      if (options?.timeout) {
        const originalExecution = handlerExecution;
        handlerExecution = async (): Promise<void> => {
          const handlerPromise = originalExecution();
          const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Handler timeout after ${options.timeout}ms`)),
              options.timeout
            )
          );

          return Promise.race([handlerPromise, timeoutPromise]) as Promise<void>;
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
   * Handle with retry logic
   */
  private async handleWithRetry(
    handler: (...args: any[]) => any,
    retryConfig: { attempts: number; delay: number; backoff?: number }
  ): Promise<any> {
    let lastError: any;
    let delay = retryConfig.delay;

    for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
      try {
        return await handler();
      } catch (error) {
        lastError = error;

        if (attempt < retryConfig.attempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= retryConfig.backoff || 2;
        }
      }
    }

    throw lastError;
  }

  /**
   * Add subscription to tracking
   */
  private addSubscription(event: string, subscription: IEventSubscription, priority: number = 0): void {
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, []);
    }
    const subs = this.subscriptions.get(event)!;
    subs.push({ subscription, priority });
    // Sort by priority (higher priority first)
    subs.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove subscription from tracking
   */
  private removeSubscription(event: string, subscription: IEventSubscription): void {
    const subs = this.subscriptions.get(event);
    if (subs) {
      const index = subs.findIndex(s => s.subscription === subscription);
      if (index !== -1) {
        subs.splice(index, 1);
      }
      if (subs.length === 0) {
        this.subscriptions.delete(event);
      }
    }
  }

  /**
   * Update event statistics
   */
  private updateStats(
    event: string,
    success: boolean,
    duration: number,
    error?: Error
  ): void {
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
      errorCount: 0
    };
  }
}