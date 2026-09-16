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

  /**
   * Optional: yield the audience in batches instead of all at once.
   *
   * `resolveUsers` returns an array, and for a targeted notification that is
   * the whole story — one user, or a handful named by the caller. A BROADCAST
   * is a different shape wearing the same signature: the audience is every
   * active account, so the array, the records built from it, the insert and
   * the signal are all the size of the platform. Three of those are bounded
   * by chunking downstream (the worker does that below whichever method is
   * implemented); the array itself can only be bounded here, by the
   * implementation that knows how to page its own user table.
   *
   * `batchSize` is what the worker will chunk by anyway — an implementation
   * that yields larger batches is not wrong, only less useful.
   *
   * Implementations that omit this keep working unchanged.
   */
  resolveUserBatches?(event: NotificationEvent, batchSize: number): AsyncIterable<string[]>;
}

/** Persists notification records to database */
export interface INotificationPersister {
  persistBatch(records: NotificationRecord[]): Promise<PersistedNotification[]>;
}

/**
 * Signals real-time clients (long-poll, WebSocket).
 *
 * The signal is the INTERRUPTION — the row is already persisted by the time
 * this runs, so declining to signal loses nothing and only decides whether to
 * disturb someone now. That makes this the layer where a quiet-hours
 * preference belongs, and a signaler that receives only user ids cannot make
 * that decision: whether to interrupt depends on WHAT is being signalled. A
 * security alert is exactly the thing quiet hours must not silence.
 *
 * `event` is therefore passed through, optional so existing implementations
 * that signal unconditionally keep compiling and keep behaving identically.
 */
export interface INotificationRealtimeSignaler {
  signal(userId: string, event?: NotificationEvent): Promise<void>;
  signalBatch(userIds: string[], event?: NotificationEvent): Promise<void>;
}
