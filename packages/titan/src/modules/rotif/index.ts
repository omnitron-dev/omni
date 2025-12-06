/**
 * Rotif Module
 *
 * Messaging system integration module for Titan Framework.
 * Provides dependency injection integration for the Rotif notification system.
 *
 * @packageDocumentation
 * @module @omnitron-dev/titan/module/rotif
 *
 * @example
 * ```typescript
 * import { RotifModule, ROTIF_MANAGER_TOKEN } from '@omnitron-dev/titan/module/rotif';
 * import { NotificationManager } from '@omnitron-dev/titan/rotif';
 *
 * // Configure the module
 * @Module({
 *   imports: [
 *     RotifModule.forRoot({
 *       redis: { host: 'localhost', port: 6379 },
 *       maxRetries: 5,
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Inject and use
 * @Injectable()
 * class OrderService {
 *   constructor(
 *     @Inject(ROTIF_MANAGER_TOKEN) private rotif: NotificationManager
 *   ) {}
 *
 *   async createOrder(order: Order) {
 *     await this.rotif.publish('orders.created', order);
 *   }
 * }
 * ```
 */

// Export types
export * from './rotif.types.js';

// Export tokens
export {
  ROTIF_MANAGER_TOKEN,
  ROTIF_MODULE_OPTIONS,
  ROTIF_OPTIONS_SYMBOL,
  ROTIF_TOKEN,
} from './rotif.tokens.js';

// Export module
export { RotifModule, GlobalRotifModule } from './rotif.module.js';

// Export service
export { RotifService } from './rotif.service.js';

// Export health indicator
export { RotifHealthIndicator, type RotifHealthStatus } from './rotif.health.js';

// Re-export key types from rotif for convenience
export type {
  RotifMessage,
  Subscription,
  PublishOptions,
  SubscribeOptions,
  SubscriptionStats,
} from '../../rotif/types.js';

// Re-export decorators from rotif for convenience
export {
  Subscribe,
  OnMessage,
  getSubscriptions,
  hasSubscriptions,
  getMethodSubscription,
  isRotifMessage,
  ROTIF_SUBSCRIBE_METADATA,
  ROTIF_SUBSCRIPTIONS_METADATA,
  type SubscribeDecoratorOptions,
  type SubscriptionMetadata,
} from '../../rotif/decorators.js';

// Re-export NotificationManager for type references
export { NotificationManager } from '../../rotif/rotif.js';
