/**
 * Rotif Service
 *
 * High-level service wrapper around NotificationManager providing
 * simplified API for common messaging operations.
 */

import type { NotificationManager } from '../../rotif/rotif.js';
import type {
  RotifMessage,
  Subscription,
  PublishOptions,
  SubscribeOptions,
} from '../../rotif/types.js';
import type { Middleware } from '../../rotif/middleware.js';

/**
 * RotifService provides a simplified interface for messaging operations.
 * It wraps the NotificationManager and can be injected via DI.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class OrderService {
 *   constructor(
 *     @Inject(ROTIF_SERVICE_TOKEN) private rotif: RotifService
 *   ) {}
 *
 *   async createOrder(order: Order) {
 *     // Publish order created event
 *     await this.rotif.publish('orders.created', { orderId: order.id, data: order });
 *   }
 * }
 * ```
 */
export class RotifService {
  constructor(private readonly manager: NotificationManager) {}

  /**
   * Publish a message to a channel.
   *
   * @param channel - The channel to publish to
   * @param payload - The message payload
   * @param options - Publishing options
   * @returns Message ID(s) or null if no subscribers
   */
  async publish(
    channel: string,
    payload: any,
    options?: PublishOptions
  ): Promise<string[] | string | null> {
    return this.manager.publish(channel, payload, options);
  }

  /**
   * Subscribe to messages on a channel pattern.
   *
   * @param pattern - Channel pattern to subscribe to
   * @param handler - Message handler function
   * @param options - Subscription options
   * @returns Subscription instance
   */
  async subscribe(
    pattern: string,
    handler: (msg: RotifMessage) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<Subscription> {
    return this.manager.subscribe(pattern, handler, options);
  }

  /**
   * Add middleware to the notification manager.
   *
   * @param middleware - Middleware to add
   */
  use(middleware: Middleware): void {
    this.manager.use(middleware);
  }

  /**
   * Subscribe to the Dead Letter Queue.
   *
   * @param handler - DLQ message handler
   */
  async subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>): Promise<void> {
    await this.manager.subscribeToDLQ(handler);
  }

  /**
   * Requeue messages from DLQ back to their original streams.
   *
   * @param count - Maximum number of messages to requeue
   * @returns Number of requeued messages
   */
  async requeueFromDLQ(count?: number): Promise<number> {
    return this.manager.requeueFromDLQ(count);
  }

  /**
   * Get DLQ statistics.
   */
  async getDLQStats() {
    return this.manager.getDLQStats();
  }

  /**
   * Get messages from DLQ with filtering.
   */
  async getDLQMessages(options?: {
    channel?: string;
    limit?: number;
    offset?: number;
    maxAge?: number;
  }) {
    return this.manager.getDLQMessages(options);
  }

  /**
   * Manually trigger DLQ cleanup.
   */
  async cleanupDLQ(): Promise<number> {
    return this.manager.cleanupDLQ();
  }

  /**
   * Clear all DLQ messages.
   */
  async clearDLQ(): Promise<void> {
    return this.manager.clearDLQ();
  }

  /**
   * Wait until the service is ready.
   */
  async waitUntilReady(): Promise<void> {
    return this.manager.waitUntilReady();
  }

  /**
   * Get the underlying NotificationManager instance.
   * Use this for advanced operations not exposed by the service.
   */
  getManager(): NotificationManager {
    return this.manager;
  }

  /**
   * Get the Redis client from the manager.
   */
  get redis() {
    return this.manager.redis;
  }

  /**
   * Get the current configuration.
   */
  get config() {
    return this.manager.config;
  }
}
