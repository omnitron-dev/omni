/**
 * Notifications Service
 *
 * High-level notification API providing send, broadcast, and schedule operations.
 * Integrates with optional rate limiting, preference management, and channel routing.
 */

import { Injectable, Optional, Inject } from '@omnitron-dev/titan/decorators';
import type { ILifecycle } from '@omnitron-dev/titan/types';
import type {
  MessagingTransport,
  TransportMiddleware,
  NotificationHandler,
  DLQStats,
  DLQQueryOptions,
  DLQMessageInfo,
  DLQCleanupConfig,
} from './transport/transport.interface.js';
import type {
  NotificationPayload,
  NotificationRecipient,
  SendOptions,
  SendResult,
  BroadcastOptions,
  BroadcastResult,
  ScheduleResult,
  IRateLimiter,
  IPreferenceStore,
  IChannelRouter,
  ChannelResult,
  StoredNotification,
} from './notifications.types.js';
import {
  NOTIFICATIONS_TRANSPORT,
  NOTIFICATIONS_RATE_LIMITER,
  NOTIFICATIONS_PREFERENCE_STORE,
  NOTIFICATIONS_CHANNEL_ROUTER,
  NOTIFICATIONS_CHANNEL_REGISTRY,
} from './notifications.tokens.js';
import { ChannelRegistry } from './channel/channel-registry.js';
import type { InAppChannel } from './channel/channels/inapp.channel.js';
import { generateUuid } from '@omnitron-dev/titan/utils';

/**
 * Main service for sending notifications.
 * Orchestrates transport, rate limiting, preferences, and channel routing.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class UserService {
 *   constructor(
 *     @Inject(NOTIFICATIONS_SERVICE) private notifications: NotificationsService
 *   ) {}
 *
 *   async notifyUser(userId: string, message: string) {
 *     const recipient = { id: userId, email: 'user@example.com' };
 *     const notification = {
 *       type: 'info',
 *       title: 'Notification',
 *       message,
 *     };
 *     return this.notifications.send(recipient, notification);
 *   }
 * }
 * ```
 */
@Injectable()
export class NotificationsService implements ILifecycle {
  constructor(
    @Inject(NOTIFICATIONS_TRANSPORT) private readonly transport: MessagingTransport,
    @Optional() @Inject(NOTIFICATIONS_RATE_LIMITER) private readonly rateLimiter?: IRateLimiter,
    @Optional() @Inject(NOTIFICATIONS_PREFERENCE_STORE) private readonly preferenceStore?: IPreferenceStore,
    @Optional() @Inject(NOTIFICATIONS_CHANNEL_ROUTER) private readonly channelRouter?: IChannelRouter,
    @Optional() @Inject(NOTIFICATIONS_CHANNEL_REGISTRY) private readonly channelRegistry?: ChannelRegistry
  ) {}

  /**
   * Send a notification to a single recipient.
   */
  async send(
    recipient: NotificationRecipient,
    payload: NotificationPayload,
    options?: SendOptions
  ): Promise<SendResult> {
    // Check rate limits
    if (this.rateLimiter && options?.channels) {
      for (const channel of options.channels) {
        const limit = await this.rateLimiter.checkLimit(recipient.id, channel, payload.type);
        if (!limit.allowed) {
          return {
            notificationId: payload.id || this.generateId(),
            status: 'failed',
            channels: [],
            timestamp: Date.now(),
            error: 'Rate limit exceeded for channel ' + channel + '. Retry after ' + limit.retryAfter + 'ms',
          };
        }
      }
    }

    // Check preferences
    if (this.preferenceStore) {
      const preferences = await this.preferenceStore.getPreferences(recipient.id);
      if (preferences?.globalMute) {
        return {
          notificationId: payload.id || this.generateId(),
          status: 'failed',
          channels: [],
          timestamp: Date.now(),
          error: 'Recipient has notifications muted',
        };
      }

      // Filter channels based on preferences
      if (preferences && options?.channels) {
        options.channels = options.channels.filter((channel) => {
          const channelPref = preferences.channels[channel];
          if (!channelPref) return true;
          if (!channelPref.enabled) return false;
          if (channelPref.types && !channelPref.types.includes(payload.type)) return false;
          return true;
        });

        if (options.channels.length === 0) {
          return {
            notificationId: payload.id || this.generateId(),
            status: 'failed',
            channels: [],
            timestamp: Date.now(),
            error: 'No enabled channels for recipient',
          };
        }
      }
    }

    // Route through channel router
    let channels = options?.channels;
    if (this.channelRouter) {
      channels = await this.channelRouter.route(recipient, payload, options?.channels);
      if (channels.length === 0) {
        return {
          notificationId: payload.id || this.generateId(),
          status: 'failed',
          channels: [],
          timestamp: Date.now(),
          error: 'No available channels for recipient',
        };
      }
    }

    // Send through transport using publish
    const notificationId = payload.id || this.generateId();
    const targetChannel = this.buildChannel(recipient, payload);

    const publishResult = await this.transport.publish(
      targetChannel,
      {
        type: payload.type,
        data: {
          recipient,
          payload,
          options: { ...options, channels },
        },
        id: notificationId,
      },
      {
        delayMs: options?.scheduledAt
          ? typeof options.scheduledAt === 'number'
            ? options.scheduledAt - Date.now()
            : options.scheduledAt.getTime() - Date.now()
          : undefined,
        priority: payload.priority,
        metadata: options?.metadata,
      }
    );

    const result: SendResult = {
      notificationId: publishResult.messageIds[0] || notificationId,
      status:
        publishResult.status === 'published'
          ? 'sent'
          : publishResult.status === 'scheduled'
            ? 'scheduled'
            : publishResult.status === 'duplicate'
              ? 'queued'
              : 'failed',
      channels:
        channels?.map((ch) => ({
          channel: ch,
          status: publishResult.success ? 'success' : 'failed',
          error: publishResult.error,
        })) || [],
      timestamp: publishResult.timestamp,
      error: publishResult.error,
    };

    // Deliver through registered channels
    if (channels?.length && this.channelRegistry) {
      const channelResults = await this.deliverToChannels(recipient, payload, channels);
      // Merge channel results with publish result
      result.channels = channelResults;
    }

    // Record rate limit usage on success
    if (this.rateLimiter && result.status === 'sent' && channels) {
      for (const channel of channels) {
        await this.rateLimiter.recordSent(recipient.id, channel, payload.type);
      }
    }

    return result;
  }

  /**
   * Broadcast a notification to multiple recipients.
   */
  async broadcast(
    recipients: NotificationRecipient[],
    payload: NotificationPayload,
    options?: BroadcastOptions
  ): Promise<BroadcastResult> {
    // Filter recipients based on preferences
    let filteredRecipients = recipients;
    if (this.preferenceStore) {
      // preferenceStore is guaranteed to exist within this block
      const store = this.preferenceStore;
      const prefPromises = recipients.map((r) => store.getPreferences(r.id));
      const preferences = await Promise.all(prefPromises);

      filteredRecipients = recipients.filter((recipient, index) => {
        const pref = preferences[index];
        if (!pref) return true;
        if (pref.globalMute) return false;

        // Check channel preferences
        if (options?.channels) {
          const hasEnabledChannel = options.channels.some((channel) => {
            const channelPref = pref.channels[channel];
            if (!channelPref) return true;
            if (!channelPref.enabled) return false;
            if (channelPref.types && !channelPref.types.includes(payload.type)) return false;
            return true;
          });
          return hasEnabledChannel;
        }

        return true;
      });
    }

    // Broadcast using individual sends
    const broadcastId = this.generateId();
    const timestamp = Date.now();
    const results: SendResult[] = [];
    const errors: Array<{ recipientId: string; error: string }> = [];

    const batchSize = options?.batchSize || 100;
    const throttle = options?.throttle || 0;

    for (let i = 0; i < filteredRecipients.length; i += batchSize) {
      const batch = filteredRecipients.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((recipient) => this.send(recipient, payload, { channels: options?.channels }))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const recipient = batch[j];
        if (!result || !recipient) continue;

        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.error) {
            errors.push({
              recipientId: recipient.id,
              error: result.value.error,
            });
          }
        } else {
          const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push({
            recipientId: recipient.id,
            error,
          });
        }
      }

      // Throttle between batches
      if (throttle > 0 && i + batchSize < filteredRecipients.length) {
        await new Promise((resolve) => setTimeout(resolve, throttle));
      }
    }

    const successCount = results.filter((r) => r.status === 'sent').length;
    const failureCount = results.filter((r) => r.status === 'failed').length;

    return {
      broadcastId,
      totalRecipients: filteredRecipients.length,
      successCount,
      failureCount,
      skippedCount: recipients.length - filteredRecipients.length,
      timestamp,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Schedule a notification for future delivery.
   */
  async schedule(
    recipient: NotificationRecipient,
    payload: NotificationPayload,
    scheduledAt: Date | number,
    options?: SendOptions
  ): Promise<ScheduleResult> {
    // Use send with scheduledAt option
    const result = await this.send(recipient, payload, {
      ...options,
      scheduledAt,
    });

    return {
      ...result,
      scheduledAt: typeof scheduledAt === 'number' ? scheduledAt : scheduledAt.getTime(),
      jobId: 'scheduled:' + result.notificationId,
    };
  }

  /**
   * Cancel a scheduled notification.
   * Note: Cancellation is not currently supported by the underlying transport.
   */
  async cancel(notificationId: string): Promise<boolean> {
    // Cancellation would require tracking scheduled jobs separately
    // For now, return false indicating cancellation is not supported
    return false;
  }

  /**
   * Get the status of a notification.
   * Note: Status tracking is not currently supported by the underlying transport.
   */
  async getStatus(notificationId: string): Promise<SendResult | null> {
    // Status tracking would require a separate store
    // For now, return null indicating status is not available
    return null;
  }

  /**
   * Get the underlying transport.
   */
  getTransport(): MessagingTransport {
    return this.transport;
  }

  /**
   * Perform a health check on the notification system.
   *
   * @returns Health status from transport
   */
  async healthCheck() {
    return this.transport.healthCheck();
  }

  /**
   * Wait until the notification service is fully ready
   */
  async waitUntilReady(): Promise<void> {
    if (this.transport.waitUntilReady) {
      await this.transport.waitUntilReady();
    }
  }

  /**
   * Initialize the notifications service (ILifecycle)
   */
  async onInit(): Promise<void> {
    // Notifications service is ready after constructor
  }

  /**
   * Start the notifications service (ILifecycle)
   */
  async onStart(): Promise<void> {
    await this.waitUntilReady();
  }

  /**
   * Stop the notifications service (ILifecycle)
   */
  async onStop(): Promise<void> {
    // Stop accepting new notifications
  }

  /**
   * Destroy the notifications service (ILifecycle)
   */
  async onDestroy(): Promise<void> {
    if (this.transport.destroy) {
      await this.transport.destroy();
    }
  }

  // ============================================================================
  // Middleware
  // ============================================================================

  /**
   * Register middleware for intercepting message flow.
   * Middleware hooks into beforePublish, afterPublish, beforeProcess, afterProcess, onError.
   *
   * @example
   * ```typescript
   * notifications.use({
   *   beforePublish: async (channel, message) => {
   *     console.log(`Publishing to ${channel}`);
   *   },
   *   onError: async (notification, error) => {
   *     console.error(`Error processing ${notification.id}:`, error);
   *   },
   * });
   * ```
   */
  use(middleware: TransportMiddleware): void {
    this.transport.use(middleware);
  }

  // ============================================================================
  // Dead Letter Queue (DLQ) Management
  // ============================================================================

  /**
   * Subscribe to Dead Letter Queue for handling failed messages.
   * Messages that exceed retry limits are moved to DLQ.
   *
   * @example
   * ```typescript
   * await notifications.subscribeToDLQ(async (notification) => {
   *   console.error('Failed notification:', notification.payload);
   *   // Investigate or alert
   * });
   * ```
   */
  async subscribeToDLQ(handler: NotificationHandler): Promise<void> {
    if (!this.transport.subscribeToDLQ) {
      throw new Error('DLQ subscription not supported by transport');
    }
    await this.transport.subscribeToDLQ(handler);
  }

  /**
   * Requeue messages from DLQ back to original channels for retry.
   *
   * @param count - Maximum number of messages to requeue
   * @returns Number of messages requeued
   */
  async requeueFromDLQ(count?: number): Promise<number> {
    if (!this.transport.requeueFromDLQ) {
      throw new Error('DLQ requeue not supported by transport');
    }
    return this.transport.requeueFromDLQ(count);
  }

  /**
   * Get Dead Letter Queue statistics.
   *
   * @returns DLQ stats including total messages, by channel breakdown, age info
   */
  async getDLQStats(): Promise<DLQStats> {
    if (!this.transport.getDLQStats) {
      throw new Error('DLQ stats not supported by transport');
    }
    return this.transport.getDLQStats();
  }

  /**
   * Query messages from the Dead Letter Queue.
   *
   * @param options - Query filters (channel, limit, offset, maxAge)
   * @returns Array of DLQ message info
   */
  async getDLQMessages(options?: DLQQueryOptions): Promise<DLQMessageInfo[]> {
    if (!this.transport.getDLQMessages) {
      throw new Error('DLQ message query not supported by transport');
    }
    return this.transport.getDLQMessages(options);
  }

  /**
   * Manually trigger DLQ cleanup.
   * Removes old messages based on configured maxAge and maxSize.
   *
   * @returns Number of messages cleaned up
   */
  async cleanupDLQ(): Promise<number> {
    if (!this.transport.cleanupDLQ) {
      throw new Error('DLQ cleanup not supported by transport');
    }
    return this.transport.cleanupDLQ();
  }

  /**
   * Clear all messages from the Dead Letter Queue.
   * Use with caution - this permanently removes all failed messages.
   */
  async clearDLQ(): Promise<void> {
    if (!this.transport.clearDLQ) {
      throw new Error('DLQ clear not supported by transport');
    }
    await this.transport.clearDLQ();
  }

  /**
   * Update DLQ cleanup configuration.
   *
   * @param config - Partial cleanup configuration to update
   */
  updateDLQConfig(config: Partial<DLQCleanupConfig>): void {
    if (!this.transport.updateDLQConfig) {
      throw new Error('DLQ config update not supported by transport');
    }
    this.transport.updateDLQConfig(config);
  }

  /**
   * Deliver notification through registered channels.
   * Called after publishing to transport.
   */
  private async deliverToChannels(
    recipient: NotificationRecipient,
    payload: NotificationPayload,
    channelNames: string[]
  ): Promise<ChannelResult[]> {
    if (!this.channelRegistry) {
      return [];
    }

    const results: ChannelResult[] = [];

    for (const channelName of channelNames) {
      const channel = this.channelRegistry.get(channelName);
      if (!channel) {
        results.push({
          channel: channelName,
          status: 'skipped',
          error: "Channel '" + channelName + "' not registered",
        });
        continue;
      }

      if (!channel.validateRecipient(recipient)) {
        results.push({
          channel: channelName,
          status: 'skipped',
          error: 'Recipient missing required fields for ' + channelName,
        });
        continue;
      }

      try {
        const content = channel.formatContent(payload);
        const sendResult = await channel.send(recipient, content);
        results.push({
          channel: channelName,
          status: sendResult.success ? 'success' : 'failed',
          messageId: sendResult.messageId,
          error: sendResult.error,
        });
      } catch (error) {
        results.push({
          channel: channelName,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  // =============================================================================
  // In-App Notification Methods (convenience wrappers)
  // =============================================================================

  /**
   * Get unread in-app notifications for a recipient.
   */
  async getUnreadNotifications(recipientId: string, limit?: number): Promise<StoredNotification[]> {
    const inApp = this.channelRegistry?.get('inApp') as InAppChannel | undefined;
    if (!inApp || !('getUnread' in inApp)) {
      return [];
    }
    return inApp.getUnread(recipientId, limit);
  }

  /**
   * Mark an in-app notification as read.
   */
  async markNotificationAsRead(recipientId: string, notificationId: string): Promise<void> {
    const inApp = this.channelRegistry?.get('inApp') as InAppChannel | undefined;
    if (!inApp || !('markAsRead' in inApp)) {
      return;
    }
    await inApp.markAsRead(recipientId, notificationId);
  }

  /**
   * Mark all in-app notifications as read for a recipient.
   */
  async markAllNotificationsAsRead(recipientId: string): Promise<void> {
    const inApp = this.channelRegistry?.get('inApp') as InAppChannel | undefined;
    if (!inApp || !('markAllAsRead' in inApp)) {
      return;
    }
    await inApp.markAllAsRead(recipientId);
  }

  /**
   * Get unread notification count for a recipient.
   */
  async getUnreadCount(recipientId: string): Promise<number> {
    const inApp = this.channelRegistry?.get('inApp') as InAppChannel | undefined;
    if (!inApp || !('getCount' in inApp)) {
      return 0;
    }
    return inApp.getCount(recipientId);
  }

  /**
   * Get the channel registry.
   */
  getChannelRegistry(): ChannelRegistry | undefined {
    return this.channelRegistry;
  }

  /**
   * Get health status of all channels.
   */
  async getChannelsHealth(): Promise<Map<string, any> | undefined> {
    if (!this.channelRegistry) {
      return undefined;
    }
    return this.channelRegistry.healthCheck();
  }

  private generateId(): string {
    return generateUuid();
  }

  private buildChannel(recipient: NotificationRecipient, payload: NotificationPayload): string {
    // Build channel pattern: notifications.{type}.{recipientId}
    return 'notifications.' + payload.type + '.' + recipient.id;
  }
}

// Re-export interfaces for convenience
export type { IRateLimiter, IPreferenceStore, IChannelRouter };
