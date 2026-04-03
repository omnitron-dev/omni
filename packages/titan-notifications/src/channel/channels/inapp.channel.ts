/**
 * In-App Notification Channel
 *
 * Delivers notifications within the application using Redis for storage and real-time delivery.
 * Supports features like unread counts, marking as read, and dismissing notifications.
 */

import { Injectable, Optional, Inject } from '@omnitron-dev/titan/decorators';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import { safeJsonParse } from '@omnitron-dev/titan/utils';
import type { IRedisClient } from '@omnitron-dev/titan-redis';
import type { NotificationPayload, NotificationRecipient, StoredNotification } from '../../notifications.types.js';
import type { NotificationChannel } from '../channel.interface.js';
import {
  ChannelType,
  type ChannelContent,
  type ChannelSendResult,
  type ChannelHealth,
  type InAppContent,
} from '../channel.interface.js';

/**
 * Configuration options for InAppChannel
 */
export interface InAppChannelOptions {
  /**
   * Redis key prefix for notifications
   * @default 'notifications:inapp'
   */
  keyPrefix?: string;

  /**
   * Default TTL for notifications in seconds
   * @default 2592000 (30 days)
   */
  defaultTTL?: number;

  /**
   * Maximum number of notifications to keep per user
   * @default 100
   */
  maxNotificationsPerUser?: number;

  /**
   * Whether to publish notifications to Redis pub/sub for real-time delivery
   * @default true
   */
  enableRealtime?: boolean;

  /**
   * Whether to use Redis Streams instead of Lists for storage
   * @default false
   */
  useStreams?: boolean;
}

/**
 * Token for injecting Redis client
 */
export const REDIS_CLIENT = Symbol.for('titan:notifications:REDIS_CLIENT');

/**
 * In-app notification channel implementation
 */
@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly name = 'inApp';
  readonly type = ChannelType.InApp;

  private readonly options: Required<InAppChannelOptions>;

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: IRedisClient) {
    this.options = {
      keyPrefix: 'notifications:inapp',
      defaultTTL: 2592000, // 30 days
      maxNotificationsPerUser: 100,
      enableRealtime: true,
      useStreams: false,
    };
  }

  /**
   * Configure the channel options
   */
  configure(options: InAppChannelOptions): void {
    Object.assign(this.options, options);
  }

  /**
   * Initialize the channel
   */
  async initialize(): Promise<void> {
    if (this.redis) {
      await this.redis.ping();
    }
  }

  /**
   * Shutdown the channel
   */
  async shutdown(): Promise<void> {
    // No cleanup needed for in-app channel
  }

  /**
   * Check if Redis is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.redis) {
      return false;
    }
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<ChannelHealth> {
    const startTime = Date.now();
    try {
      if (!this.redis) {
        return {
          name: this.name,
          type: this.type,
          available: false,
          error: 'Redis client not configured',
        };
      }

      await this.redis.ping();
      const latency = Date.now() - startTime;

      return {
        name: this.name,
        type: this.type,
        available: true,
        latency,
        metadata: {
          keyPrefix: this.options.keyPrefix,
          useStreams: this.options.useStreams,
          realtimeEnabled: this.options.enableRealtime,
        },
      };
    } catch (error) {
      return {
        name: this.name,
        type: this.type,
        available: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate recipient has an ID
   */
  validateRecipient(recipient: NotificationRecipient): boolean {
    return !!recipient.id;
  }

  /**
   * Format notification into in-app content
   */
  formatContent(notification: NotificationPayload): InAppContent {
    return {
      title: notification.title,
      message: notification.message,
      type: notification.type,
      priority: notification.priority,
      data: notification.data,
    };
  }

  /**
   * Send notification to recipient
   */
  async send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult> {
    if (!this.redis) {
      return {
        success: false,
        error: 'Redis client not configured',
      };
    }

    try {
      const notification: StoredNotification = {
        id: generateUuidV7(),
        recipientId: recipient.id,
        payload: content as unknown as NotificationPayload,
        createdAt: Date.now(),
      };

      // Add TTL if specified in metadata
      const ttl = (content.data?.['ttl'] as number) || this.options.defaultTTL;
      if (ttl > 0) {
        notification.expiresAt = Date.now() + ttl * 1000;
      }

      // Store notification
      await this.storeNotification(recipient.id, notification, ttl);

      // Publish for real-time delivery if enabled
      if (this.options.enableRealtime) {
        await this.publishNotification(recipient.id, notification);
      }

      return {
        success: true,
        messageId: notification.id,
        metadata: {
          recipientId: recipient.id,
          expiresAt: notification.expiresAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get unread notifications for a user
   * Uses MGET for O(1) batch fetch instead of O(n) sequential fetches
   */
  async getUnread(recipientId: string, limit?: number): Promise<StoredNotification[]> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const key = this.getNotificationsKey(recipientId);
    const count = limit || this.options.maxNotificationsPerUser;

    // Get all notification IDs
    const notificationIds = await this.redis.lrange(key, 0, count - 1);

    if (notificationIds.length === 0) {
      return [];
    }

    // Batch fetch all notifications with MGET (single Redis call)
    const notifKeys = notificationIds.map((id: string) => this.getNotificationKey(recipientId, id));
    const results = await this.redis.mget(...notifKeys);

    // Filter and parse notifications
    const notifications: StoredNotification[] = [];
    const now = Date.now();
    for (const data of results) {
      if (data) {
        const notification = safeJsonParse<StoredNotification>(data);
        if (!notification) continue; // Skip malformed JSON
        // Only include unread notifications that haven't expired
        if (!notification.readAt && !notification.dismissedAt) {
          if (!notification.expiresAt || notification.expiresAt > now) {
            notifications.push(notification);
          }
        }
      }
    }

    return notifications;
  }

  /**
   * Get all notifications for a user (including read and dismissed)
   * Uses MGET for O(1) batch fetch instead of O(n) sequential fetches
   */
  async getAll(recipientId: string, limit?: number): Promise<StoredNotification[]> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const key = this.getNotificationsKey(recipientId);
    const count = limit || this.options.maxNotificationsPerUser;

    const notificationIds = await this.redis.lrange(key, 0, count - 1);

    if (notificationIds.length === 0) {
      return [];
    }

    // Batch fetch all notifications with MGET (single Redis call)
    const notifKeys = notificationIds.map((id: string) => this.getNotificationKey(recipientId, id));
    const results = await this.redis.mget(...notifKeys);

    // Filter and parse notifications
    const notifications: StoredNotification[] = [];
    const now = Date.now();
    for (const data of results) {
      if (data) {
        const notification = safeJsonParse<StoredNotification>(data);
        if (!notification) continue; // Skip malformed JSON
        // Filter out expired notifications
        if (!notification.expiresAt || notification.expiresAt > now) {
          notifications.push(notification);
        }
      }
    }

    return notifications;
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(recipientId: string, notificationId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const notifKey = this.getNotificationKey(recipientId, notificationId);
    const data = await this.redis.get(notifKey);
    if (!data) {
      throw new Error(`Notification ${notificationId} not found`);
    }

    const notification = safeJsonParse<StoredNotification>(data);
    if (!notification) {
      throw new Error(`Notification ${notificationId} has invalid data`);
    }
    notification.readAt = Date.now();

    await this.redis.set(notifKey, JSON.stringify(notification));
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(recipientId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const notifications = await this.getUnread(recipientId);
    const pipeline = this.redis.pipeline();

    for (const notification of notifications) {
      notification.readAt = Date.now();
      const notifKey = this.getNotificationKey(recipientId, notification.id);
      pipeline.set(notifKey, JSON.stringify(notification));
    }

    await pipeline.exec();
  }

  /**
   * Dismiss a notification (remove from list)
   */
  async dismiss(recipientId: string, notificationId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const notifKey = this.getNotificationKey(recipientId, notificationId);
    const data = await this.redis.get(notifKey);
    if (!data) {
      throw new Error(`Notification ${notificationId} not found`);
    }

    const notification = safeJsonParse<StoredNotification>(data);
    if (!notification) {
      throw new Error(`Notification ${notificationId} has invalid data`);
    }
    notification.dismissedAt = Date.now();

    await this.redis.set(notifKey, JSON.stringify(notification));
  }

  /**
   * Get unread notification count for a user
   */
  async getCount(recipientId: string): Promise<number> {
    const unread = await this.getUnread(recipientId);
    return unread.length;
  }

  /**
   * Delete a notification permanently
   */
  async delete(recipientId: string, notificationId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const notifKey = this.getNotificationKey(recipientId, notificationId);
    const listKey = this.getNotificationsKey(recipientId);

    // Get all notification IDs
    const allIds = await this.redis.lrange(listKey, 0, -1);

    // Filter out the notification to delete
    const filteredIds = allIds.filter((id: string) => id !== notificationId);

    // Delete and recreate the list
    const pipeline = this.redis.pipeline();
    pipeline.del(notifKey);
    pipeline.del(listKey);
    if (filteredIds.length > 0) {
      pipeline.rpush(listKey, ...filteredIds);
    }
    await pipeline.exec();
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAll(recipientId: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Redis client not configured');
    }

    const notifications = await this.getAll(recipientId);
    const pipeline = this.redis.pipeline();

    for (const notification of notifications) {
      const notifKey = this.getNotificationKey(recipientId, notification.id);
      pipeline.del(notifKey);
    }

    const listKey = this.getNotificationsKey(recipientId);
    pipeline.del(listKey);

    await pipeline.exec();
  }

  // Private helper methods

  private async storeNotification(recipientId: string, notification: StoredNotification, ttl: number): Promise<void> {
    if (!this.redis) return;

    const notifKey = this.getNotificationKey(recipientId, notification.id);
    const listKey = this.getNotificationsKey(recipientId);

    const pipeline = this.redis.pipeline();

    // Store notification data
    pipeline.set(notifKey, JSON.stringify(notification));
    if (ttl > 0) {
      pipeline.expire(notifKey, ttl);
    }

    // Add to user's notification list
    pipeline.lpush(listKey, notification.id);

    // Trim list to max size
    pipeline.ltrim(listKey, 0, this.options.maxNotificationsPerUser - 1);

    await pipeline.exec();
  }

  private async publishNotification(recipientId: string, notification: StoredNotification): Promise<void> {
    if (!this.redis) return;

    const channel = this.getPubSubChannel(recipientId);
    await this.redis.publish(channel, JSON.stringify(notification));
  }

  private getNotificationsKey(recipientId: string): string {
    return `${this.options.keyPrefix}:user:${recipientId}:list`;
  }

  private getNotificationKey(recipientId: string, notificationId: string): string {
    return `${this.options.keyPrefix}:user:${recipientId}:notif:${notificationId}`;
  }

  private getPubSubChannel(recipientId: string): string {
    return `${this.options.keyPrefix}:channel:${recipientId}`;
  }
}
