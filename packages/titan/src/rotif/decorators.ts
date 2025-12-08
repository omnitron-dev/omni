/**
 * Rotif Decorators for DI Integration
 *
 * Provides decorator-based subscription to Rotif channels,
 * integrating with the Nexus DI system for automatic subscription management.
 */

import 'reflect-metadata';
import type { SubscribeOptions, RotifMessage, ILogger } from './types.js';

/**
 * Get logger from instance if available.
 * Looks for common logger property names on the class instance.
 */
function getInstanceLogger(instance: any): ILogger | undefined {
  return instance.logger || instance._logger || instance.log;
}

/**
 * Metadata key for storing subscription information
 */
export const ROTIF_SUBSCRIBE_METADATA = 'rotif:subscribe';
export const ROTIF_SUBSCRIPTIONS_METADATA = 'rotif:subscriptions';

/**
 * Options for the @Subscribe decorator
 */
export interface SubscribeDecoratorOptions extends SubscribeOptions {
  /**
   * Channel pattern to subscribe to (e.g., 'orders.*', 'notifications/**')
   */
  pattern: string;

  /**
   * Whether to enable exactly-once processing
   * @default false
   */
  exactlyOnce?: boolean;

  /**
   * Deduplication TTL in seconds (for exactlyOnce mode)
   */
  deduplicationTTL?: number;
}

/**
 * Subscription metadata stored on class methods
 */
export interface SubscriptionMetadata {
  pattern: string;
  methodName: string;
  options: Omit<SubscribeDecoratorOptions, 'pattern'>;
}

/**
 * @Subscribe decorator - marks a method as a Rotif message handler.
 *
 * Use this decorator on class methods to automatically subscribe to
 * Rotif channels when the class is registered in the DI container.
 *
 * @param pattern - Channel pattern to subscribe to
 * @param options - Subscription options
 *
 * @example
 * ```typescript
 * @Injectable()
 * class OrderHandler {
 *   @Subscribe('orders.created', { groupName: 'order-processors' })
 *   async handleOrderCreated(msg: RotifMessage) {
 *     console.log('New order:', msg.payload);
 *   }
 *
 *   @Subscribe('orders.*', { maxRetries: 5, exactlyOnce: true })
 *   async handleAllOrders(msg: RotifMessage) {
 *     // Process all order events
 *   }
 * }
 * ```
 */
export function Subscribe(
  pattern: string,
  options: Omit<SubscribeDecoratorOptions, 'pattern'> = {}
): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    _descriptor: PropertyDescriptor
  ): void {
    const methodName = String(propertyKey);

    // Get existing subscriptions for this class or create new array
    const existingSubscriptions: SubscriptionMetadata[] =
      Reflect.getMetadata(ROTIF_SUBSCRIPTIONS_METADATA, target.constructor) || [];

    // Add this subscription
    const subscriptionMetadata: SubscriptionMetadata = {
      pattern,
      methodName,
      options,
    };

    existingSubscriptions.push(subscriptionMetadata);

    // Store updated subscriptions array on the class
    Reflect.defineMetadata(
      ROTIF_SUBSCRIPTIONS_METADATA,
      existingSubscriptions,
      target.constructor
    );

    // Also store on the method itself for direct access
    Reflect.defineMetadata(
      ROTIF_SUBSCRIBE_METADATA,
      subscriptionMetadata,
      target,
      propertyKey
    );
  };
}

/**
 * Get all subscription metadata from a class
 */
export function getSubscriptions(target: Function): SubscriptionMetadata[] {
  return Reflect.getMetadata(ROTIF_SUBSCRIPTIONS_METADATA, target) || [];
}

/**
 * Check if a class has any Rotif subscriptions
 */
export function hasSubscriptions(target: Function): boolean {
  const subscriptions = getSubscriptions(target);
  return subscriptions.length > 0;
}

/**
 * Get subscription metadata for a specific method
 */
export function getMethodSubscription(
  target: object,
  propertyKey: string | symbol
): SubscriptionMetadata | undefined {
  return Reflect.getMetadata(ROTIF_SUBSCRIBE_METADATA, target, propertyKey);
}

/**
 * @OnMessage decorator - alias for @Subscribe for semantic clarity.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class NotificationService {
 *   @OnMessage('notifications.send')
 *   async handleSendNotification(msg: RotifMessage) {
 *     // Send notification
 *   }
 * }
 * ```
 */
export const OnMessage = Subscribe;

/**
 * Type guard for RotifMessage
 */
export function isRotifMessage(value: unknown): value is RotifMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Record<string, unknown>;
  return (
    typeof msg['id'] === 'string' &&
    typeof msg['channel'] === 'string' &&
    typeof msg['timestamp'] === 'number' &&
    typeof msg['attempt'] === 'number' &&
    typeof msg['ack'] === 'function'
  );
}
