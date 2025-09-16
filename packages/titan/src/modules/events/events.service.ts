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

import { Inject, Injectable } from '@omnitron-dev/nexus';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';

import { EventMetadataService } from './event-metadata.service';
import { EVENT_EMITTER_TOKEN, EVENT_METADATA_SERVICE_TOKEN } from './events.module';

import type {
  EventContext,
  EventStatistics,
  EventSubscription,
  EventListenerOptions,
  EventValidationResult
} from './types';

/**
 * Core service for event handling
 */
@Injectable()
export class EventsService {
  private subscriptions: Map<string, Set<EventSubscription>> = new Map();
  private eventStats: Map<string, EventStatistics> = new Map();

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Inject(EVENT_METADATA_SERVICE_TOKEN) private readonly metadataService: EventMetadataService
  ) { }

  /**
   * Emit an event with data and options
   */
  async emit<T = any>(
    event: string,
    data?: T,
    options?: EmitOptions
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Add context metadata
      const metadata = this.metadataService.createMetadata({
        ...options?.metadata,
        source: this.constructor.name
      });

      // Emit the event
      const result = this.emitter.emitEnhanced(event, data, {
        ...options,
        metadata
      });

      // Update statistics
      this.updateStats(event, true, Date.now() - startTime);

      return result;
    } catch (error) {
      // Update error statistics
      this.updateStats(event, false, Date.now() - startTime, error as Error);
      throw error;
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

    return this.emitter.emitParallel(event, data, metadata);
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
    handler: (...args: any[]) => void,
    options?: EventListenerOptions
  ): EventSubscription {
    // Wrap handler with options
    const wrappedHandler = this.wrapHandler(handler, options);

    // Register with emitter
    const unsubscribe = this.emitter.subscribe(event, wrappedHandler);

    // Create subscription object
    const subscription: EventSubscription = {
      unsubscribe: () => {
        unsubscribe();
        this.removeSubscription(event, subscription);
      },
      isActive: () => this.emitter.listeners(event).includes(wrappedHandler),
      event,
      handler,
      wrappedHandler // Store wrapped handler for unsubscribe
    };

    // Track subscription
    this.addSubscription(event, subscription);

    return subscription;
  }

  /**
   * Subscribe to an event once
   */
  once(
    event: string,
    handler: (...args: any[]) => void,
    options?: EventListenerOptions
  ): EventSubscription {
    const wrappedHandler = this.wrapHandler(handler, options);

    this.emitter.once(event, wrappedHandler);

    const subscription: EventSubscription = {
      unsubscribe: () => {
        this.emitter.off(event, wrappedHandler);
        this.removeSubscription(event, subscription);
      },
      isActive: () => this.emitter.listeners(event).includes(wrappedHandler),
      event,
      handler
    };

    this.addSubscription(event, subscription);

    return subscription;
  }

  /**
   * Subscribe to multiple events
   */
  subscribeMany(
    events: string[],
    handler: (...args: any[]) => void,
    options?: EventListenerOptions
  ): EventSubscription[] {
    return events.map(event => this.subscribe(event, handler, options));
  }

  /**
   * Subscribe to all events
   */
  subscribeAll(
    handler: (...args: any[]) => void,
    options?: EventListenerOptions
  ): EventSubscription {
    return this.subscribe('**', handler, options);
  }

  /**
   * Unsubscribe from an event
   */
  unsubscribe(event: string, handler?: Function): void {
    if (handler) {
      // Find the wrapped handler for this original handler
      const subs = this.subscriptions.get(event);
      if (subs) {
        for (const sub of subs) {
          if (sub.handler === handler) {
            sub.unsubscribe();
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
        for (const sub of subsCopy) {
          sub.unsubscribe();
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
  getStatistics(event?: string): EventStatistics | Map<string, EventStatistics> {
    if (event) {
      return this.eventStats.get(event) || this.createEmptyStats(event);
    }
    return this.eventStats;
  }

  /**
   * Get listener count for an event
   */
  getListenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Get all event names
   */
  getEventNames(): string[] {
    return this.emitter.eventNames() as string[];
  }

  /**
   * Check if event has listeners
   */
  hasListeners(event: string): boolean {
    return this.emitter.listenerCount(event) > 0;
  }

  /**
   * Create event context
   */
  createContext<T = any>(
    event: string,
    data: T,
    metadata?: Partial<EventMetadata>
  ): EventContext<T> {
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
  validateEventData(event: string, data: any): EventValidationResult {
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
    handler: (...args: any[]) => void,
    options?: EventListenerOptions
  ): (...args: any[]) => void {
    return async (...args: any[]) => {
      // Extract standard args
      let [data, metadata, ...restArgs] = args;

      // Apply filter if specified
      if (options?.filter && !options.filter(data, metadata)) {
        return;
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
              return await handler(data, metadata, ...restArgs);
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
        } else {
          return await handler(data, metadata, ...restArgs);
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
              console.error(`Error in event handler:`, error);
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
    handler: Function,
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
  private addSubscription(event: string, subscription: EventSubscription): void {
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }
    this.subscriptions.get(event)!.add(subscription);
  }

  /**
   * Remove subscription from tracking
   */
  private removeSubscription(event: string, subscription: EventSubscription): void {
    const subs = this.subscriptions.get(event);
    if (subs) {
      subs.delete(subscription);
      if (subs.size === 0) {
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
  private createEmptyStats(event: string): EventStatistics {
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