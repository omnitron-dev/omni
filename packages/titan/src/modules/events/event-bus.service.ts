/**
 * Event Bus Service
 *
 * Provides a message bus for inter-module communication
 */

import type { EventMetadata } from '@omnitron-dev/eventemitter';

import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Injectable, Optional } from '../../decorators/index.js';
import { Errors } from '../../errors/index.js';

import { EVENT_EMITTER_TOKEN } from './tokens.js';
import { LOGGER_TOKEN } from './tokens.js';

import type {
  EventData,
  EventHandler,
  VarArgEventHandler,
  IEventSubscription,
  HealthCheckResult
} from './event.types.js';
import type { IEventBusMessage } from './types.js';

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
  private replayBuffer: Array<{ event: string; data: any; metadata?: EventMetadata }> = [];
  private maxReplayBufferSize = 100;
  private handlerPriorities: Map<(...args: any[]) => any, number> = new Map();

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter,
    @Optional() @Inject(LOGGER_TOKEN) private readonly logger?: any
  ) { }

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
      this.replayBuffer = [];
    }
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

    // Clear all subscriptions
    this.channels.clear();
    this.messageQueue.clear();
    this.subscriptions.clear();
    this.onceHandlers.clear();
    this.emitter.removeAllListeners();

    this.logger?.info('EventBusService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<HealthCheckResult> {
    const listenerCount = Array.from(this.subscriptions.values())
      .reduce((acc, handlers) => acc + handlers.size, 0);

    const eventCount = this.subscriptions.size;

    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        eventCount,  // Number of unique events with handlers
        listenerCount  // Total number of listeners
      }
    };
  }

  /**
   * Subscribe to an event (alias for subscribe)
   */
  on(event: string, handler: VarArgEventHandler): IEventSubscription {
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }
    this.subscriptions.get(event)!.add(handler);

    // Don't duplicate subscription to internal emitter - we handle it ourselves

    return {
      unsubscribe: () => {
        this.off(event, handler);
      },
      isActive: () => this.subscriptions.get(event)?.has(handler) || false
    };
  }

  /**
   * Subscribe to an event with options
   */
  subscribe(event: string, handler: VarArgEventHandler, options?: { priority?: number; replay?: boolean }): IEventSubscription {
    // Store handler priority if provided
    if (options?.priority !== undefined) {
      this.handlerPriorities.set(handler, options.priority);
    }

    // Add handler to subscriptions
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }

    // Get the set and convert to array to sort by priority
    const handlers = this.subscriptions.get(event)!;
    handlers.add(handler);

    // If priority is set, re-sort all handlers for this event
    if (options?.priority !== undefined) {
      const sortedHandlers = Array.from(handlers).sort((a, b) => {
        const priorityA = this.handlerPriorities.get(a) ?? 0;
        const priorityB = this.handlerPriorities.get(b) ?? 0;
        return priorityB - priorityA; // Higher priority first
      });
      handlers.clear();
      sortedHandlers.forEach(h => handlers.add(h));
    }

    // Replay events if requested
    if (options?.replay && this.replayEnabled) {
      const eventsToReplay = this.replayBuffer.filter(item => item.event === event);
      eventsToReplay.forEach(item => {
        try {
          handler(item.data);  // Only pass data, not metadata for event replay
        } catch (err) {
          this.logger?.error({ err, event }, 'Error replaying event');
        }
      });
    }

    return {
      unsubscribe: () => {
        this.off(event, handler);
      },
      isActive: () => this.subscriptions.get(event)?.has(handler) || false
    };
  }

  /**
   * Unsubscribe from an event
   */
  off(event: string, handler?: VarArgEventHandler): void {
    if (!handler) {
      // Remove all handlers for this event
      const handlers = this.subscriptions.get(event);
      if (handlers) {
        handlers.forEach(h => this.handlerPriorities.delete(h));
      }
      this.subscriptions.delete(event);
      this.emitter.removeAllListeners(event);
      return;
    }

    const handlers = this.subscriptions.get(event);
    if (handlers) {
      handlers.delete(handler);
      this.handlerPriorities.delete(handler);
      if (handlers.size === 0) {
        this.subscriptions.delete(event);
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
   */
  async emit(event: string, data?: EventData, metadata?: Partial<EventMetadata>): Promise<void> {
    this.emittedEvents++;

    // Apply middleware chain to data
    const processedData = data !== undefined ? this.applyMiddleware(data) : undefined;

    const fullMetadata: EventMetadata = {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      ...metadata
    } as EventMetadata;

    // Store in replay buffer if enabled
    if (this.replayEnabled) {
      this.replayBuffer.push({ event, data: processedData, metadata: fullMetadata });
      if (this.replayBuffer.length > this.maxReplayBufferSize) {
        this.replayBuffer.shift();
      }
    }

    // Call registered handlers directly (not through emitter to avoid duplication)
    const handlers = this.subscriptions.get(event);
    if (handlers) {
      const handlerPromises = Array.from(handlers).map(async handler => {
        try {
          await Promise.resolve(handler(processedData, fullMetadata));
        } catch (err) {
          this.logger?.error({ err, event }, 'Error in event handler');
          // Emit error event to error handlers
          if (event !== 'error') {
            // Use direct emit to ensure error handlers are called
            const errorHandlers = this.subscriptions.get('error');
            if (errorHandlers) {
              errorHandlers.forEach(errorHandler => {
                try {
                  errorHandler(err);
                } catch (errorHandlerErr) {
                  // Ignore errors in error handlers to prevent infinite loops
                  this.logger?.error({ err: errorHandlerErr }, 'Error in error handler');
                }
              });
            }
          }
        }
      });

      await Promise.all(handlerPromises);
    }

    // Handle wildcard patterns
    for (const [pattern, patternHandlers] of this.subscriptions.entries()) {
      if (pattern.includes('*') && this.matchesPattern(event, pattern)) {
        const wildcardPromises = Array.from(patternHandlers).map(async handler => {
          try {
            await Promise.resolve(handler(processedData, fullMetadata));
          } catch (err) {
            this.logger?.error({ err, event, pattern }, 'Error in wildcard handler');
            // Emit error event to error handlers
            if (event !== 'error') {
              // Use direct emit to ensure error handlers are called
              const errorHandlers = this.subscriptions.get('error');
              if (errorHandlers) {
                errorHandlers.forEach(errorHandler => {
                  try {
                    errorHandler(err);
                  } catch (errorHandlerErr) {
                    // Ignore errors in error handlers to prevent infinite loops
                    this.logger?.error({ err: errorHandlerErr }, 'Error in error handler');
                  }
                });
              }
            }
          }
        });

        await Promise.all(wildcardPromises);
      }
    }
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
      ...metadata
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
            await this.emit('error', { error: err instanceof Error ? err : new Error(String(err)), event });
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
      ...metadata
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
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Check if event matches pattern
   */
  private matchesPattern(event: string, pattern: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(event);
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
        ...options?.metadata
      },
      timestamp: Date.now(),
      source: options?.source,
      target: options?.target
    };

    // If target is specified, add to queue
    if (options?.target) {
      this.queueMessage(options.target, message);
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
      isActive: () => this.channels.get(channel)?.has(wrappedHandler) || false
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

    return new Promise((resolve, reject) => {
      const timer = options?.timeout
        ? setTimeout(() => {
          unsubscribe();
          reject(new Error(`Request timeout for channel: ${channel}`));
        }, options.timeout)
        : null;

      // Subscribe to response
      const unsubscribe = this.emitter.subscribe(
        `bus:${responseChannel}`,
        (message: IEventBusMessage<TResponse>) => {
          if (timer) clearTimeout(timer);
          unsubscribe();
          resolve(message.data);
        }
      );

      // Publish request
      this.publish(channel, data, {
        metadata: {
          ...options?.metadata,
          requestId,
          responseChannel
        }
      });
    });
  }

  /**
   * Reply to a request
   */
  async reply<T = EventData>(
    message: IEventBusMessage,
    data: T
  ): Promise<void> {
    const responseChannel = message.metadata?.['responseChannel'];
    if (!responseChannel) {
      throw Errors.badRequest('Cannot reply to message without responseChannel');
    }

    await this.publish(responseChannel, data, {
      source: message.target,
      target: message.source,
      metadata: {
        requestId: message.metadata['requestId'],
        inReplyTo: message.id
      }
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
        metadata: transformed.metadata
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
          metadata: transformed.metadata
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
   * Clear queued messages for a target
   */
  clearQueue(target: string): void {
    this.messageQueue.delete(target);
  }


  /**
   * Get channel statistics
   */
  getChannelStats(): Map<string, { subscribers: number; queued: number }> {
    const stats = new Map<string, { subscribers: number; queued: number }>();

    for (const [channel, handlers] of this.channels.entries()) {
      const queuedCount = Array.from(this.messageQueue.values())
        .flat()
        .filter(m => m.event === channel).length;

      stats.set(channel, {
        subscribers: handlers.size,
        queued: queuedCount
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
   * Queue a message for a target
   */
  private queueMessage(target: string, message: IEventBusMessage): void {
    if (!this.messageQueue.has(target)) {
      this.messageQueue.set(target, []);
    }
    this.messageQueue.get(target)!.push(message);

    // Limit queue size
    const queue = this.messageQueue.get(target)!;
    if (queue.length > 1000) {
      queue.shift(); // Remove oldest
    }
  }
}