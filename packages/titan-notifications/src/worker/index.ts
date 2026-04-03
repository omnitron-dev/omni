/**
 * Notification Worker
 *
 * Worker abstraction layer for processing notification events from Rotif.
 * App-level code provides implementations of the interfaces; Titan's worker
 * orchestrates them via the consumer loop.
 *
 * @module @omnitron-dev/titan/module/notifications/worker
 */

// Interfaces
export type {
  NotificationRecord,
  PersistedNotification,
  INotificationTargetResolver,
  INotificationPersister,
  INotificationRealtimeSignaler,
} from './worker.interfaces.js';

// DI Tokens
export {
  NOTIFICATION_TARGET_RESOLVER,
  NOTIFICATION_PERSISTER,
  NOTIFICATION_REALTIME_SIGNALER,
} from './worker.tokens.js';

// Worker Service
export { NotificationWorkerService, type NotificationWorkerOptions } from './notification-worker.js';
