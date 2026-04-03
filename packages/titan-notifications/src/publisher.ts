/**
 * Notification Publisher
 *
 * Lightweight Rotif-based publisher for cross-service notification events.
 * Any backend service can use this to publish typed notification events
 * without coupling to the main app's DI container.
 *
 * Events are published to Redis Streams via Rotif and consumed by
 * the notification worker in the main app.
 */

import type { NotificationManager } from './rotif/rotif.js';

// =============================================================================
// NOTIFICATION EVENT SCHEMA
// =============================================================================

export type NotificationPriorityLevel = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationEventAction {
  type: 'link' | 'deep_link';
  url: string;
  data?: Record<string, unknown>;
}

/**
 * Cross-service notification event published to Rotif.
 * All backend services conform to this schema.
 */
export interface NotificationEvent {
  /** Rotif channel, e.g. 'notify.paysys.deposit_confirmed' */
  channel: string;

  // --- Targeting (one of) ---

  /** Single target user */
  userId?: string;
  /** Multiple target users */
  userIds?: string[];
  /** Target all users with this role (e.g. 'admin', 'moderator') */
  role?: string;
  /** Broadcast to all active users */
  broadcast?: boolean;

  // --- Content ---

  /** Notification type enum value (e.g. 'payment_received') */
  type: string;
  /** Category for grouping (e.g. 'commerce', 'social', 'system') */
  category: string;
  /** Human-readable title */
  title: string;
  /** Human-readable body */
  body: string;

  // --- Optional ---

  icon?: string;
  image?: string;
  priority?: NotificationPriorityLevel;
  action?: NotificationEventAction;
  /** Arbitrary payload stored as JSONB */
  data?: Record<string, unknown>;
  /** For grouping/batching similar notifications */
  groupKey?: string;
  /** Prevent duplicate delivery (unique constraint) */
  deduplicationKey?: string;
  /** Time-to-live in milliseconds */
  ttlMs?: number;

  // --- Source identification ---

  /** Originating app: 'main' | 'paysys' | 'messaging' | 'storage' | 'priceverse' */
  sourceApp: string;
  /** Original event ID for distributed tracing */
  sourceEventId?: string;
}

// =============================================================================
// PUBLISHER
// =============================================================================

/**
 * Publishes notification events to Rotif for cross-service delivery.
 * Wraps NotificationManager with typed notification events.
 */
export class NotificationPublisher {
  constructor(private readonly manager: NotificationManager) {}

  /**
   * Publish a single notification event.
   */
  async publish(event: NotificationEvent): Promise<void> {
    await this.manager.publish(event.channel, event, {
      exactlyOnce: !!event.deduplicationKey,
      dedupKey: event.deduplicationKey,
      deduplicationTTL: 3600,
    });
  }

  /**
   * Publish multiple notification events in a batch.
   */
  async publishBatch(events: NotificationEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
