/**
 * Notifications Decorators
 *
 * Provides decorator-based subscription to notification patterns,
 * integrating with the Nexus DI system for automatic subscription management.
 *
 * @module @omnitron-dev/titan/module/notifications
 */

import 'reflect-metadata';
import type { TransportSubscribeOptions } from './transport/transport.interface.js';

/**
 * Metadata key for storing notification handler information
 */
const NOTIFICATIONS_HANDLER_METADATA = 'notifications:handlers';

/**
 * Options for the @OnNotification decorator
 */
export interface OnNotificationOptions extends TransportSubscribeOptions {
  /**
   * Whether to enable exactly-once processing
   * @default false
   */
  exactlyOnce?: boolean;
}

/**
 * Notification handler metadata stored on class methods
 */
export interface NotificationHandlerMetadata {
  pattern: string;
  methodName: string;
  options: OnNotificationOptions;
}

/**
 * @OnNotification decorator - marks a method as a notification handler.
 *
 * Use this decorator on class methods to automatically subscribe to
 * notification patterns when the class is registered in the DI container.
 *
 * @param pattern - Notification pattern to subscribe to
 * @param options - Subscription options
 *
 * @example
 * ```typescript
 * @Injectable()
 * class NotificationHandler {
 *   @OnNotification('user.registered', { groupId: 'user-handlers' })
 *   async handleUserRegistered(notification: IncomingNotification) {
 *     console.log('User registered:', notification.payload);
 *   }
 *
 *   @OnNotification('order.*', { maxRetries: 5, exactlyOnce: true })
 *   async handleOrderEvents(notification: IncomingNotification) {
 *     // Process all order notification events
 *   }
 * }
 * ```
 */
export function OnNotification(pattern: string, options: OnNotificationOptions = {}): MethodDecorator {
  return function onNotificationDecorator(
    target: object,
    propertyKey: string | symbol,
    _descriptor: PropertyDescriptor
  ): PropertyDescriptor | void {
    const methodName = String(propertyKey);

    // Get existing handlers for this class or create new array
    const existingHandlers: NotificationHandlerMetadata[] =
      Reflect.getMetadata(NOTIFICATIONS_HANDLER_METADATA, target.constructor) || [];

    // Add this handler
    const handlerMetadata: NotificationHandlerMetadata = {
      pattern,
      methodName,
      options,
    };

    existingHandlers.push(handlerMetadata);

    // Store updated handlers array on the class
    Reflect.defineMetadata(NOTIFICATIONS_HANDLER_METADATA, existingHandlers, target.constructor);

    return _descriptor;
  };
}

/**
 * Get all notification handler metadata from a class.
 *
 * @param target - The class constructor
 * @returns Array of handler metadata
 *
 * @example
 * ```typescript
 * const handlers = getNotificationHandlers(MyHandlerClass);
 * for (const handler of handlers) {
 *   console.log(`Pattern: ${handler.pattern}, Method: ${handler.methodName}`);
 * }
 * ```
 */
export function getNotificationHandlers(target: new (...args: unknown[]) => unknown): NotificationHandlerMetadata[] {
  return Reflect.getMetadata(NOTIFICATIONS_HANDLER_METADATA, target) || [];
}

/**
 * Check if a class has any notification handlers.
 *
 * @param target - The class constructor
 * @returns True if the class has notification handlers
 *
 * @example
 * ```typescript
 * if (hasNotificationHandlers(MyClass)) {
 *   // Set up subscriptions
 * }
 * ```
 */
export function hasNotificationHandlers(target: new (...args: unknown[]) => unknown): boolean {
  const handlers = getNotificationHandlers(target);
  return handlers.length > 0;
}
