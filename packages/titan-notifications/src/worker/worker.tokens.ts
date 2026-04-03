import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type {
  INotificationTargetResolver,
  INotificationPersister,
  INotificationRealtimeSignaler,
} from './worker.interfaces.js';

export const NOTIFICATION_TARGET_RESOLVER: Token<INotificationTargetResolver> =
  createToken<INotificationTargetResolver>('NotificationTargetResolver');
export const NOTIFICATION_PERSISTER: Token<INotificationPersister> =
  createToken<INotificationPersister>('NotificationPersister');
export const NOTIFICATION_REALTIME_SIGNALER: Token<INotificationRealtimeSignaler> =
  createToken<INotificationRealtimeSignaler>('NotificationRealtimeSignaler');
