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

export { randomUUID as generateUuid } from 'node:crypto';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  MessagingTransport,
  ScheduledDeliveryTransport,
  ScheduledNotification,
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
