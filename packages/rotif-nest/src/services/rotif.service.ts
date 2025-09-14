import { Inject, Logger, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  RotifMessage,
  Subscription,
  PublishOptions,
  SubscribeOptions,
  NotificationManager,
} from '@omnitron-dev/rotif';

import { ROTIF_MANAGER } from '../constants';

/**
 * Primary service for interacting with the Rotif notification system in a NestJS application.
 * This service provides methods for publishing messages, subscribing to channels, and managing
 * the Dead Letter Queue (DLQ). It wraps the NotificationManager from @omnitron-dev/rotif and
 * provides a NestJS-friendly interface.
 *
 * @example
 * // Publishing a message
 * ＠Injectable()
 * export class OrderService {
 *   constructor(private readonly rotifService: RotifService) {}
 *
 *   async createOrder(order: Order) {
 *     await this.rotifService.publish('orders.created', order);
 *   }
 * }
 *
 * @example
 * // Subscribing to messages
 * ＠Injectable()
 * export class OrderProcessor {
 *   constructor(private readonly rotifService: RotifService) {
 *     this.rotifService.subscribe('orders.created', 
 *       async (msg) => this.processOrder(msg.payload),
 *       { group: 'order-processor' }
 *     );
 *   }
 * }
 */
@Injectable()
export class RotifService implements OnModuleDestroy {
  private readonly logger = new Logger(RotifService.name);

  constructor(
    @Inject(ROTIF_MANAGER)
    private readonly rotifManager: NotificationManager,
  ) { }

  /**
   * Publishes a message to a specified channel.
   * This method sends a message to the specified channel using the underlying Redis
   * infrastructure. Messages can be delivered immediately or scheduled for later
   * delivery using the options parameter.
   *
   * @param channel - The channel to publish the message to. This should be a descriptive
   *                 string that identifies the type of message, e.g., 'orders.created'
   * @param payload - The message payload. Can be any serializable value that will be
   *                 delivered to subscribers
   * @param options - Optional publishing configuration:
   *                 - delayMs: Delay delivery by specified milliseconds
   *                 - deliverAt: Deliver at specific timestamp
   *                 - dedupKey: Key for deduplication
   * @returns Promise resolving to the message ID (string) that can be used to track the message
   * 
   * @throws Error if Redis connection fails or serialization fails
   * 
   * @example
   * // Immediate publish
   * await rotifService.publish('notifications', { userId: 1, message: 'Hello' });
   * 
   * // Delayed publish
   * await rotifService.publish('reminders', { type: 'meeting' }, { delayMs: 3600000 });
   */
  async publish(
    channel: string,
    payload: any,
    options?: PublishOptions,
  ): Promise<string[] | string | null> {
    this.logger.debug(`Publishing to channel "${channel}" with payload:`, payload);
    return this.rotifManager.publish(channel, payload, options);
  }

  /**
   * Subscribes to messages matching a pattern.
   * Sets up a subscription to receive messages from channels matching the specified pattern.
   * The handler function will be called for each message received.
   *
   * @param pattern - The pattern to match channel names against. Can include wildcards,
   *                 e.g., 'user.*' will match 'user.created', 'user.updated', etc.
   * @param handler - Async function that will be called with each message. The function
   *                 receives a RotifMessage object containing the message details
   * @param options - Subscription configuration:
   *                 - group: Consumer group name for Redis Streams
   *                 - maxRetries: Maximum retry attempts for failed messages
   *                 - retryDelay: Delay between retries
   *                 - exactlyOnce: Enable exactly-once processing
   * @returns Promise resolving to a Subscription object that can be used to manage
   *          the subscription (pause, resume, unsubscribe)
   * 
   * @throws Error if subscription setup fails or pattern is invalid
   * 
   * @example
   * // Basic subscription
   * const sub = await rotifService.subscribe('orders.*', 
   *   async (msg) => console.log('Received:', msg.payload)
   * );
   * 
   * // Advanced subscription with options
   * const sub = await rotifService.subscribe('payments.*',
   *   async (msg) => processPayment(msg.payload),
   *   {
   *     group: 'payment-processor',
   *     maxRetries: 3,
   *     retryDelay: 1000
   *   }
   * );
   */
  async subscribe(
    pattern: string,
    handler: (msg: RotifMessage) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    this.logger.debug(`Subscribing to pattern "${pattern}"`);
    return this.rotifManager.subscribe(pattern, handler, options);
  }

  /**
   * Subscribes to messages from the Dead Letter Queue (DLQ).
   * Sets up a handler for messages that have failed processing and been moved to the DLQ.
   * This is useful for monitoring and recovering from failures.
   *
   * @param handler - Async function that will be called with each DLQ message.
   *                 The function can attempt to reprocess the message or perform
   *                 error recovery
   * 
   * @example
   * await rotifService.subscribeToDLQ(async (msg) => {
   *   this.logger.error(`Failed message in DLQ:`, msg);
   *   // Attempt recovery or notify administrators
   * });
   */
  async subscribeToDLQ(
    handler: (msg: RotifMessage) => Promise<void>,
  ): Promise<void> {
    this.logger.debug(`Subscribing to DLQ`);
    await this.rotifManager.subscribeToDLQ(handler);
  }

  /**
   * Requeues messages from DLQ back to their original streams.
   * This method can be used to retry processing of failed messages that were
   * moved to the DLQ.
   *
   * @param count - Maximum number of messages to requeue. Defaults to 10 to
   *               prevent overwhelming the system
   * 
   * @example
   * // Requeue up to 5 messages from DLQ
   * await rotifService.requeueFromDLQ(5);
   */
  async requeueFromDLQ(count: number = 10): Promise<void> {
    this.logger.debug(`Requeuing ${count} messages from DLQ`);
    await this.rotifManager.requeueFromDLQ(count);
  }

  /**
   * Lifecycle hook called when the module is being destroyed.
   * Ensures proper cleanup of resources by stopping all subscriptions and
   * closing Redis connections.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.debug(`Stopping RotifService and cleaning up resources.`);
    await this.rotifManager.stopAll();
  }
}
