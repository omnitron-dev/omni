/**
 * Notifications Transport Layer
 *
 * Provides messaging transport abstractions and implementations.
 *
 * @module @omnitron-dev/titan/module/notifications/transport
 */

// ============================================================================
// Transport Implementations
// ============================================================================

export { RotifTransport, createRotifTransport } from './rotif.transport.js';

// ============================================================================
// Utilities
// ============================================================================

export { generateUuid } from './transport.interface.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  MessagingTransport,
  TransportPublishOptions,
  TransportPublishResult,
  TransportSubscribeOptions,
  NotificationHandler,
  IncomingNotification,
  NotificationSubscription,
  SubscriptionStats,
  TransportHealth,
  NotificationMessage,
  TransportMiddleware,
  // DLQ types
  DLQStats,
  DLQQueryOptions,
  DLQMessageInfo,
  DLQCleanupConfig,
} from './transport.interface.js';
