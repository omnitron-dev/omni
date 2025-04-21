import { SetMetadata } from '@nestjs/common';
import { SubscribeOptions } from '@devgrid/rotif';

import { ROTIF_SUBSCRIBE_METADATA } from '../constants';

/**
 * Metadata interface for the RotifSubscribe decorator.
 * Contains the pattern to subscribe to and optional configuration options.
 */
export interface RotifSubscribeMetadata {
  /** Pattern to match message channels against (e.g., 'orders.*') */
  pattern: string;
  /** Optional configuration for the subscription */
  options?: SubscribeOptions;
}

/**
 * Decorator that marks a method as a Rotif message handler.
 * When applied to a method, this decorator registers the method as a handler
 * for messages matching the specified pattern. The decorated method will be
 * automatically discovered and registered by the RotifDiscoveryService during
 * application startup.
 *
 * The decorated method should accept a single parameter of type RotifMessage.
 *
 * @param pattern - The pattern to subscribe to. Can include wildcards,
 *                 e.g., 'orders.*' will match 'orders.created', 'orders.updated', etc.
 * @param options - Optional configuration for the subscription including:
 *                 - group: Consumer group name
 *                 - maxRetries: Maximum retry attempts
 *                 - retryDelay: Delay between retries
 *                 - exactlyOnce: Enable exactly-once processing
 *
 * @example
 * // Basic usage
 * ＠Injectable()
 * export class OrdersHandler {
 *   ＠RotifSubscribe('orders.created')
 *   async handleOrder(message: RotifMessage) {
 *     const order = message.payload;
 *     await this.processOrder(order);
 *   }
 * }
 *
 * @example
 * // With configuration options
 * ＠Injectable()
 * export class PaymentsHandler {
 *   ＠RotifSubscribe('payments.*', {
 *     group: 'payment-processor',
 *     maxRetries: 3,
 *     retryDelay: 1000,
 *     exactlyOnce: true
 *   })
 *   async handlePayment(message: RotifMessage) {
 *     await this.processPayment(message.payload);
 *   }
 * }
 *
 * @example
 * // With wildcards and middleware
 * ＠Injectable()
 * export class UserHandler {
 *   ＠RotifSubscribe('user.*', {
 *     middleware: [LoggingMiddleware],
 *     group: 'user-service'
 *   })
 *   async handleUserEvents(message: RotifMessage) {
 *     switch(message.channel) {
 *       case 'user.created':
 *         await this.handleUserCreated(message.payload);
 *         break;
 *       case 'user.updated':
 *         await this.handleUserUpdated(message.payload);
 *         break;
 *     }
 *   }
 * }
 */
export const RotifSubscribe = (
  pattern: string,
  options?: SubscribeOptions,
): MethodDecorator => SetMetadata(ROTIF_SUBSCRIBE_METADATA, { pattern, options });
