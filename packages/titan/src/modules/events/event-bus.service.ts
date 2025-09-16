/**
 * Event Bus Service
 * 
 * Provides a message bus for inter-module communication
 */

import { Inject, Injectable } from '@omnitron-dev/nexus';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';

import { EVENT_EMITTER_TOKEN } from './events.module';

import type { EventBusMessage, EventSubscription } from './types';

/**
 * Event bus for inter-module communication
 */
@Injectable()
export class EventBusService {
  private channels: Map<string, Set<Function>> = new Map();
  private messageQueue: Map<string, EventBusMessage[]> = new Map();
  private messageIdCounter = 0;

  constructor(
    @Inject(EVENT_EMITTER_TOKEN) private readonly emitter: EnhancedEventEmitter
  ) { }

  /**
   * Publish a message to the bus
   */
  async publish<T = any>(
    channel: string,
    data: T,
    options?: {
      target?: string;
      source?: string;
      metadata?: any;
    }
  ): Promise<void> {
    const message: EventBusMessage<T> = {
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
  subscribe<T = any>(
    channel: string,
    handler: (message: EventBusMessage<T>) => void | Promise<void>,
    options?: {
      filter?: (message: EventBusMessage<T>) => boolean;
      target?: string;
    }
  ): EventSubscription {
    const wrappedHandler = async (message: EventBusMessage<T>) => {
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
      isActive: () => this.channels.get(channel)?.has(wrappedHandler) || false,
      event: channel,
      handler: wrappedHandler
    };
  }

  /**
   * Request-response pattern
   */
  async request<TRequest = any, TResponse = any>(
    channel: string,
    data: TRequest,
    options?: {
      timeout?: number;
      metadata?: any;
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
        (message: EventBusMessage<TResponse>) => {
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
  async reply<T = any>(
    message: EventBusMessage,
    data: T
  ): Promise<void> {
    const responseChannel = message.metadata?.['responseChannel'];
    if (!responseChannel) {
      throw new Error('Cannot reply to message without responseChannel');
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
      filter?: (message: EventBusMessage) => boolean;
      transform?: (message: EventBusMessage) => EventBusMessage;
    }
  ): void {
    // Forward local to remote
    this.subscribe(localChannel, async (message) => {
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
      remoteBus.subscribe(remoteChannel, async (message) => {
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
  getQueuedMessages(target: string): EventBusMessage[] {
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
  private queueMessage(target: string, message: EventBusMessage): void {
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