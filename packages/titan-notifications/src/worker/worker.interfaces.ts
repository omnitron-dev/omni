/**
 * Notification Worker Interfaces
 *
 * App-level code implements these interfaces.
 * Titan's worker orchestrates them.
 */

import type { NotificationEvent } from '../publisher.js';

export interface NotificationRecord {
  userId: string;
  type: string;
  category: string;
  title: string;
  body: string;
  icon?: string;
  image?: string;
  actionType?: string;
  actionUrl?: string;
  actionData?: Record<string, unknown>;
  channelsInApp: boolean;
  channelsPush: boolean;
  channelsEmail: boolean;
  status: string;
  priority: string;
  sourceApp?: string;
  sourceEventId?: string;
  groupKey?: string;
  data?: Record<string, unknown>;
  dedupKey?: string;
  expiresAt?: Date;
  createdAt: Date;
}

export interface PersistedNotification {
  id: string;
  userId: string;
  [key: string]: unknown;
}

/** Resolves target user IDs from a notification event */
export interface INotificationTargetResolver {
  resolveUsers(event: NotificationEvent): Promise<string[]>;
}

/** Persists notification records to database */
export interface INotificationPersister {
  persistBatch(records: NotificationRecord[]): Promise<PersistedNotification[]>;
}

/** Signals real-time clients (long-poll, WebSocket) */
export interface INotificationRealtimeSignaler {
  signal(userId: string): Promise<void>;
  signalBatch(userIds: string[]): Promise<void>;
}
