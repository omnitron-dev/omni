export * from './rotif.js';
export * from './types.js';
export * from './middleware.js';
export * from './retry-strategies.js';
export { DLQManager, type DLQCleanupConfig, type DLQStats, type DLQMessageInfo } from './dlq-manager.js';

// Decorators for DI integration
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
} from './decorators.js';
