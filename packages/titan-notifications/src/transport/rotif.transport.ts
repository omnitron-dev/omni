import { NotificationManager } from '../rotif/rotif.js';
import type { RotifMessage, Subscription, PublishOptions } from '../rotif/types.js';
import type { Middleware } from '../rotif/middleware.js';
import type { DLQCleanupConfig } from '../rotif/dlq-manager.js';
import type {
  MessagingTransport,
  NotificationMessage,
  TransportPublishOptions,
  TransportPublishResult,
  TransportSubscribeOptions,
  NotificationHandler,
  IncomingNotification,
  NotificationSubscription,
  SubscriptionStats,
  TransportHealth,
  DLQQueryOptions,
  TransportMiddleware,
} from './transport.interface.js';
import { generateUuid } from './transport.interface.js';
import { createNullLogger, type ILogger } from '@omnitron-dev/titan/types';

/**
 * Rotif-based messaging transport implementation.
 * Wraps core Rotif's NotificationManager to provide the standard messaging transport interface.
 */
export class RotifTransport implements MessagingTransport {
  readonly id: string;
  readonly type = 'rotif';
  private middlewares: TransportMiddleware[] = [];
  private readonly logger: ILogger;

  /**
   * Create a new RotifTransport instance
   * @param manager - The underlying Rotif NotificationManager
   */
  constructor(
    private readonly manager: NotificationManager,
    logger?: ILogger
  ) {
    this.logger = logger ?? createNullLogger();
    this.id = generateUuid();
  }

  /**
   * Publish a message to a channel
   * @param channel - Channel name to publish to
   * @param message - Message to publish
   * @param options - Optional publishing options
   * @returns Result of the publish operation
   */
  async publish(
    channel: string,
    message: NotificationMessage,
    options?: TransportPublishOptions
  ): Promise<TransportPublishResult> {
    try {
      // Wait for the manager to be ready
      await this.manager.waitUntilReady();

      // Convert transport options to Rotif PublishOptions
      const rotifOptions = {
        delayMs: options?.delayMs,
        deliverAt: options?.deliverAt,
        exactlyOnce: options?.exactlyOnce,
        deduplicationTTL: options?.deduplicationTTL,
        dedupKey: options?.dedupKey,
        attempt: 1,
      };

      // Publish the message
      const result = await this.manager.publish(channel, message, rotifOptions);

      // Handle the different return types from Rotif
      if (result === null) {
        // No subscribers
        return {
          success: false,
          messageIds: [],
          status: 'no_subscribers',
          patternCount: 0,
          timestamp: Date.now(),
        };
      }

      if (result === 'DUPLICATE') {
        // Duplicate message detected
        return {
          success: true,
          messageIds: [],
          status: 'duplicate',
          patternCount: 0,
          timestamp: Date.now(),
        };
      }

      // Determine if message was scheduled or published
      const status = options?.delayMs || options?.deliverAt ? 'scheduled' : 'published';

      // Handle single or multiple message IDs
      const messageIds = Array.isArray(result) ? result : [result];

      return {
        success: true,
        messageIds,
        status,
        patternCount: messageIds.length,
        timestamp: Date.now(),
      };
    } catch (error) {
      // Handle publish errors
      return {
        success: false,
        messageIds: [],
        status: 'failed',
        patternCount: 0,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Subscribe to messages on a channel pattern
   * @param pattern - Channel pattern to subscribe to (supports wildcards)
   * @param handler - Function to handle incoming messages
   * @param options - Optional subscription options
   * @returns Active subscription handle
   */
  async subscribe(
    pattern: string,
    handler: NotificationHandler,
    options?: TransportSubscribeOptions
  ): Promise<NotificationSubscription> {
    // Wait for the manager to be ready
    await this.manager.waitUntilReady();

    // Convert transport options to Rotif SubscribeOptions
    const rotifOptions = {
      groupName: options?.groupName,
      consumerName: options?.consumerName,
      startFrom: options?.startFrom,
      maxRetries: options?.maxRetries,
      retryDelay: options?.retryDelay,
    };

    // Create a wrapper handler that converts RotifMessage to IncomingNotification
    const wrapperHandler = async (msg: RotifMessage): Promise<void> => {
      const incomingNotification: IncomingNotification = {
        id: msg.id,
        channel: msg.channel,
        payload: msg.payload as NotificationMessage,
        timestamp: msg.timestamp,
        attempt: msg.attempt,
        metadata: {},
        ack: async () => {
          await msg.ack();
        },
        nack: async (requeue = true) => {
          // Rotif doesn't have explicit nack - we simply don't ack
          // If we want to retry, we just don't call ack() and let Rotif handle retries
          if (!requeue) {
            // If we don't want to requeue, we acknowledge the message
            await msg.ack();
          }
          // Otherwise, do nothing and let Rotif retry
        },
      };

      await handler(incomingNotification);
    };

    // Subscribe using the Rotif manager
    const subscription: Subscription = await this.manager.subscribe(pattern, wrapperHandler, rotifOptions);

    // Create a wrapper subscription that implements NotificationSubscription
    const notificationSubscription: NotificationSubscription = {
      id: subscription.id,
      pattern: subscription.pattern,
      group: subscription.group,
      get isPaused() {
        return subscription.isPaused;
      },

      unsubscribe: async (removePattern = false) => {
        await subscription.unsubscribe(removePattern);
      },

      pause: () => {
        subscription.pause();
      },

      resume: () => {
        subscription.resume();
      },

      stats: (): SubscriptionStats => {
        const rotifStats = subscription.stats();
        return {
          messages: rotifStats.messages,
          retries: rotifStats.retries,
          failures: rotifStats.failures,
          lastMessageAt: rotifStats.lastMessageAt,
          inflightCount: subscription.inflightCount,
        };
      },
    };

    return notificationSubscription;
  }

  /**
   * Check transport health and connectivity
   * @returns Health status information
   */
  async healthCheck(): Promise<TransportHealth> {
    try {
      // Check Redis connection status
      const redisStatus = this.manager.redis.status;
      const connected = redisStatus === 'ready' || redisStatus === 'connect';

      if (!connected) {
        return {
          status: 'unhealthy',
          connected: false,
          error: `Redis connection is ${redisStatus}`,
          timestamp: Date.now(),
        };
      }

      // Measure latency with a simple PING command
      const start = Date.now();
      await this.manager.redis.ping();
      const latency = Date.now() - start;

      // Determine health status based on latency
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (latency > 1000) {
        status = 'unhealthy';
      } else if (latency > 500) {
        status = 'degraded';
      }

      // Get subscription statistics
      const subscriptionStats = this.manager.getSubscriptionStats();

      return {
        status,
        connected: true,
        latency,
        details: {
          redisStatus,
          subscriptions: subscriptionStats,
        },
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Gracefully shutdown the transport
   */
  async shutdown(): Promise<void> {
    try {
      // Stop all active subscriptions and clean up resources
      await this.manager.stopAll();
    } catch (error) {
      // Log error but don't throw - shutdown should be best-effort
      this.logger.error({ error }, 'Error during RotifTransport shutdown');
    }
  }

  /**
   * Wait until transport is fully initialized and ready
   */
  async waitUntilReady(): Promise<void> {
    await this.manager.waitUntilReady();
  }

  /**
   * Destroy the transport and release all resources
   */
  async destroy(): Promise<void> {
    await this.manager.destroy();
  }

  /**
   * Subscribe to Dead Letter Queue for handling failed messages
   */
  async subscribeToDLQ(handler: NotificationHandler): Promise<void> {
    await this.manager.waitUntilReady();

    // Create a wrapper handler that converts RotifMessage to IncomingNotification
    const wrapperHandler = async (msg: RotifMessage): Promise<void> => {
      const incomingNotification: IncomingNotification = {
        id: msg.id,
        channel: msg.channel,
        payload: msg.payload as NotificationMessage,
        timestamp: msg.timestamp,
        attempt: msg.attempt,
        metadata: {},
        ack: async () => {
          await msg.ack();
        },
        nack: async (requeue = true) => {
          if (!requeue) {
            await msg.ack();
          }
        },
      };

      await handler(incomingNotification);
    };

    await this.manager.subscribeToDLQ(wrapperHandler);
  }

  /**
   * Requeue messages from DLQ back to original channels
   * @returns Number of requeued messages
   */
  async requeueFromDLQ(count?: number): Promise<number> {
    await this.manager.waitUntilReady();
    return this.manager.requeueFromDLQ(count);
  }

  /**
   * Get DLQ statistics
   */
  async getDLQStats() {
    await this.manager.waitUntilReady();
    return this.manager.getDLQStats();
  }

  /**
   * Get messages from DLQ with optional filtering
   */
  async getDLQMessages(options?: DLQQueryOptions) {
    await this.manager.waitUntilReady();
    return this.manager.getDLQMessages(options);
  }

  /**
   * Manually trigger DLQ cleanup
   * @returns Number of cleaned messages
   */
  async cleanupDLQ(): Promise<number> {
    await this.manager.waitUntilReady();
    return this.manager.cleanupDLQ();
  }

  /**
   * Clear all messages from DLQ
   */
  async clearDLQ(): Promise<void> {
    await this.manager.waitUntilReady();
    return this.manager.clearDLQ();
  }

  /**
   * Update DLQ cleanup configuration
   */
  updateDLQConfig(config: Partial<DLQCleanupConfig>): void {
    this.manager.updateDLQConfig(config);
  }

  /**
   * Register middleware for message processing
   * @param middleware - Transport middleware to register
   */
  use(middleware: TransportMiddleware): void {
    // Convert TransportMiddleware to Rotif Middleware format
    const rotifMiddleware: Middleware = {
      beforePublish: middleware.beforePublish
        ? async (channel: string, payload: unknown, options?: PublishOptions) => {
            await middleware.beforePublish!(channel, payload as NotificationMessage, options);
          }
        : undefined,

      afterPublish: middleware.afterPublish
        ? async (channel: string, payload: unknown, id: string[] | string | null, options?: PublishOptions) => {
            // Convert Rotif publish result to TransportPublishResult
            const result: TransportPublishResult = {
              success: id !== null,
              messageIds: id === null ? [] : Array.isArray(id) ? id : [id],
              status: id === null ? 'no_subscribers' : 'published',
              patternCount: id === null ? 0 : Array.isArray(id) ? id.length : 1,
              timestamp: Date.now(),
            };

            await middleware.afterPublish!(channel, payload as NotificationMessage, result, options);
          }
        : undefined,

      beforeProcess: middleware.beforeProcess
        ? async (msg: RotifMessage) => {
            const notification: IncomingNotification = {
              id: msg.id,
              channel: msg.channel,
              payload: msg.payload as NotificationMessage,
              timestamp: msg.timestamp,
              attempt: msg.attempt,
              metadata: {},
              ack: async () => {
                await msg.ack();
              },
            };

            await middleware.beforeProcess!(notification);
          }
        : undefined,

      afterProcess: middleware.afterProcess
        ? async (msg: RotifMessage) => {
            const notification: IncomingNotification = {
              id: msg.id,
              channel: msg.channel,
              payload: msg.payload as NotificationMessage,
              timestamp: msg.timestamp,
              attempt: msg.attempt,
              metadata: {},
              ack: async () => {
                await msg.ack();
              },
            };

            await middleware.afterProcess!(notification);
          }
        : undefined,

      onError: middleware.onError
        ? async (msg: RotifMessage, error: Error) => {
            const notification: IncomingNotification = {
              id: msg.id,
              channel: msg.channel,
              payload: msg.payload as NotificationMessage,
              timestamp: msg.timestamp,
              attempt: msg.attempt,
              metadata: {},
              ack: async () => {
                await msg.ack();
              },
            };

            await middleware.onError!(notification, error);
          }
        : undefined,
    };

    // Register with the underlying Rotif manager
    this.manager.use(rotifMiddleware);

    // Also store locally for reference
    this.middlewares.push(middleware);
  }

  /**
   * Get the underlying Rotif NotificationManager instance
   * This can be useful for advanced use cases that need direct access to Rotif features
   * @returns The Rotif NotificationManager
   */
  getManager(): NotificationManager {
    return this.manager;
  }
}

/**
 * Factory function to create a RotifTransport instance
 * @param manager - The Rotif NotificationManager to wrap
 * @returns A new RotifTransport instance
 */
export function createRotifTransport(manager: NotificationManager): RotifTransport {
  return new RotifTransport(manager);
}
