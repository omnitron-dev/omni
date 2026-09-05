import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type {
  INotificationTargetResolver,
  INotificationPersister,
  INotificationRealtimeSignaler,
} from './worker.interfaces.js';
import type { NotificationWorkerOptions } from './notification-worker.js';

export const NOTIFICATION_TARGET_RESOLVER: Token<INotificationTargetResolver> =
  createToken<INotificationTargetResolver>('NotificationTargetResolver');
export const NOTIFICATION_PERSISTER: Token<INotificationPersister> =
  createToken<INotificationPersister>('NotificationPersister');
export const NOTIFICATION_REALTIME_SIGNALER: Token<INotificationRealtimeSignaler> =
  createToken<INotificationRealtimeSignaler>('NotificationRealtimeSignaler');

/**
 * Worker tuning supplied through the module (`forWorker({ workerOptions })`).
 *
 * The module declared that field and dropped it: the worker takes its options
 * as a parameter of `start()`, which the module never calls, so every knob —
 * stream pattern, group and consumer names, block timeout, batch size,
 * autoclaim timings — was inert. Registered here so module-level tuning
 * reaches the worker; anything passed directly to `start()` still wins.
 */
export const NOTIFICATION_WORKER_OPTIONS: Token<NotificationWorkerOptions> =
  createToken<NotificationWorkerOptions>('NotificationWorkerOptions');
