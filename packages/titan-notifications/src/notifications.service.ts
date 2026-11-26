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
  NotificationSubscription,
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
  NotificationPreferences,
  NotificationsModuleOptions,
  SendOptions,
  SendResult,
  BroadcastOptions,
  RecipientFilter,
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
  NOTIFICATIONS_MODULE_OPTIONS,
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
  private scheduledConsumer?: Promise<NotificationSubscription>;

  constructor(
    @Inject(NOTIFICATIONS_TRANSPORT) private readonly transport: MessagingTransport,
    @Optional() @Inject(NOTIFICATIONS_RATE_LIMITER) private readonly rateLimiter?: IRateLimiter,
    @Optional() @Inject(NOTIFICATIONS_PREFERENCE_STORE) private readonly preferenceStore?: IPreferenceStore,
    @Optional() @Inject(NOTIFICATIONS_CHANNEL_ROUTER) private readonly channelRouter?: IChannelRouter,
    @Optional() @Inject(NOTIFICATIONS_CHANNEL_REGISTRY) private readonly channelRegistry?: ChannelRegistry,
    @Optional() @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly moduleOptions?: NotificationsModuleOptions
  ) {}

  /**
   * Send a notification to a single recipient.
   */
  async send(
    recipient: NotificationRecipient,
    payload: NotificationPayload,
    options?: SendOptions
  ): Promise<SendResult> {
    const id = payload.id ?? this.generateId();
    if (typeof id !== 'string' || !id || Buffer.byteLength(id) > 1024) throw new RangeError('Invalid notification ID');
    const notification = { ...payload, id };
    const { scheduledAt, ...deliveryOptions } = options ?? {};
    const due = scheduledAt instanceof Date ? scheduledAt.getTime() : scheduledAt;
    if (due !== undefined && !Number.isSafeInteger(due)) throw new RangeError('Invalid notification delivery time');
    if (due !== undefined) {
      if (this.transport.scheduledDelivery) {
        await this.startScheduledConsumer();
        return this.transport.scheduledDelivery.schedule(this.deliveryScope, {
          recipient, payload: notification, scheduledAt: due, options: deliveryOptions,
        });
      }
      if (due > Date.now() && this.channelRegistry && (deliveryOptions.channels?.length || this.moduleOptions?.defaultChannels?.length || this.channelRouter || deliveryOptions.fallbackChannels?.length)) {
        return this.failure(id, 'Transport does not support scheduling registered channels');
      }
      return this.dispatch(recipient, notification, deliveryOptions, due > Date.now() ? due : undefined);
    }
    return this.dispatch(recipient, notification, deliveryOptions);
  }

  private get deliveryScope(): string {
    return this.moduleOptions?.deliveryScope ?? 'default';
  }

  private startScheduledConsumer(): Promise<NotificationSubscription> | undefined {
    const scheduler = this.transport.scheduledDelivery;
    if (!scheduler) return undefined;
    this.scheduledConsumer ??= scheduler.consume(this.deliveryScope, job =>
      this.dispatch(job.recipient, job.payload, job.options)
    ).catch(error => {
      this.scheduledConsumer = undefined;
      throw error;
    });
    return this.scheduledConsumer;
  }

  private failure(notificationId: string, error: string): SendResult {
    return { notificationId, status: 'failed', channels: [], timestamp: Date.now(), error };
  }

  private async dispatch(
    recipient: NotificationRecipient, payload: NotificationPayload & { id: string }, options: SendOptions, due?: number
  ): Promise<SendResult> {
    const preferences = await this.preferenceStore?.getPreferences(recipient.id);
    if (preferences?.globalMute) return this.failure(payload.id, 'Recipient has notifications muted');

    const requested = options.channels ?? this.moduleOptions?.defaultChannels;
    const routed = this.channelRouter ? await this.channelRouter.route(recipient, payload, requested) : requested;
    if (this.channelRouter && !routed?.length) return this.failure(payload.id, 'No available channels for recipient');

    const channels = routed && [...new Set(routed.filter(channel => channelEnabled(preferences, channel, payload.type)))];
    const fallbacks = [...new Set(options.fallbackChannels)].filter(channel =>
      !channels?.includes(channel) && channelEnabled(preferences, channel, payload.type)
    );
    if (channels && !channels.length && !fallbacks.length) return this.failure(payload.id, 'No enabled channels for recipient');
    const localDelivery = this.channelRegistry && Boolean(channels?.length || fallbacks.length);
    const allowed: string[] = [];
    const skipped: ChannelResult[] = [];
    for (const channel of channels ?? []) {
      const limit = await this.rateLimiter?.checkLimit(recipient.id, channel, payload.type);
      if (limit && !limit.allowed) {
        const error = 'Rate limit exceeded for channel ' + channel;
        if (!localDelivery) return this.failure(payload.id, error);
        skipped.push({ channel, status: 'skipped', error });
      } else {
        allowed.push(channel);
      }
    }
    if (skipped.length && !allowed.length && !fallbacks.length) {
      return { ...this.failure(payload.id, skipped[0]!.error!), channels: skipped };
    }

    const publication = await this.transport.publish(this.buildChannel(recipient, payload), {
      type: payload.type, id: payload.id, data: { recipient, payload, options: { ...options, channels: channels && allowed, fallbackChannels: fallbacks } },
    }, {
      deliverAt: due, priority: payload.priority, metadata: options.metadata,
      exactlyOnce: Boolean(payload.metadata?.deduplicationKey), dedupKey: payload.metadata?.deduplicationKey,
    });
    const result: SendResult = { notificationId: payload.id, status: 'queued', timestamp: publication.timestamp, channels: [] };
    if (publication.status === 'duplicate') return result;
    if (publication.status === 'scheduled' && publication.success) return { ...result, status: 'scheduled' };
    // A registered channel is a local recipient even when the broker has no subscribers.
    if (!(publication.status === 'published' && publication.success) && !(localDelivery && publication.status === 'no_subscribers')) {
      return this.failure(payload.id, publication.error ?? 'Notification publication ' + publication.status);
    }
    if (due !== undefined) return this.failure(payload.id, 'Transport did not confirm delayed publication');

    if (localDelivery) {
      result.channels = skipped;
      for (const channel of allowed) result.channels.push(await this.deliverChannel(recipient, payload, channel));
      let fallbackDelivered = false;
      if (!result.channels.some(receipt => receipt.status === 'success' || receipt.status === 'unconfirmed')) {
        for (const channel of fallbacks) {
          if (this.channelRouter && !await this.channelRouter.canSendViaChannel(recipient, channel, payload)) {
            result.channels.push({ channel, status: 'skipped', error: 'Channel rejected by router' });
            continue;
          }
          const limit = await this.rateLimiter?.checkLimit(recipient.id, channel, payload.type);
          if (limit && !limit.allowed) {
            result.channels.push({ channel, status: 'skipped', error: 'Rate limit exceeded' });
            continue;
          }
          const receipt = await this.deliverChannel(recipient, payload, channel);
          result.channels.push(receipt);
          fallbackDelivered = receipt.status === 'success';
          if (fallbackDelivered || receipt.status === 'unconfirmed') break;
        }
      }
      const confirmed = result.channels.filter(channel => channel.status === 'success');
      if (fallbackDelivered || (confirmed.length > 0 && confirmed.length === result.channels.length)) result.status = 'sent';
      else if (confirmed.length) result.status = 'partial';
      else if (result.channels.some(channel => channel.status === 'unconfirmed')) result.status = 'unconfirmed';
      else result.status = 'failed';
      if (result.status !== 'sent') result.error = result.channels.find(channel => channel.error)?.error ?? 'No confirmed delivery';
    }
    // A broker confirms admission. Registered providers confirm their individual
    // deliveries. Preserve admission quotas when a downstream worker owns delivery.
    if (this.rateLimiter) {
      const charged = localDelivery ? result.channels.filter(c => c.status === 'success').map(c => c.channel) : allowed;
      for (const channel of charged) {
        try {
          await this.rateLimiter.recordSent(recipient.id, channel, payload.type);
        } catch (error) {
          (result.accountingErrors ??= []).push({ channel, error: error instanceof Error ? error.message : String(error) });
        }
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
    // Apply the caller's recipient filters FIRST: they express who the
    // broadcast is for, and excluding here also spares a preference lookup per
    // dropped recipient.
    let filteredRecipients = options?.filters?.length
      ? recipients.filter((r) => options.filters!.every((f) => matchesRecipientFilter(r, f)))
      : recipients;

    // Then narrow further by preferences
    if (this.preferenceStore) {
      // preferenceStore is guaranteed to exist within this block
      const store = this.preferenceStore;
      const candidates = filteredRecipients;
      const prefPromises = candidates.map((r) => store.getPreferences(r.id));
      const preferences = await Promise.all(prefPromises);

      filteredRecipients = candidates.filter((recipient, index) => {
        const pref = preferences[index];
        if (!pref) return true;
        if (pref.globalMute) return false;

        return !options?.channels || options.channels.some(channel => channelEnabled(pref, channel, payload.type));
      });
    }

    // Broadcast using individual sends
    const broadcastId = this.generateId();
    const timestamp = Date.now();
    const results: SendResult[] = [];
    const errors: Array<{ recipientId: string; error: string }> = [];

    const batchSize = options?.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new RangeError('batchSize must be a positive integer');
    let rejected = 0;
    const throttle = options?.throttle || 0;

    for (let i = 0; i < filteredRecipients.length; i += batchSize) {
      const batch = filteredRecipients.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((recipient) => this.send(recipient, payload, { channels: options?.channels, metadata: options?.metadata }))
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
          rejected++;
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
    const failureCount = rejected + results.filter((r) => r.status === 'failed' || r.status === 'cancelled').length;

    return {
      broadcastId,
      totalRecipients: filteredRecipients.length,
      successCount,
      failureCount,
      partialCount: results.filter(r => r.status === 'partial').length,
      pendingCount: results.filter(r => ['queued', 'scheduled', 'unconfirmed'].includes(r.status)).length,
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
   */
  async cancel(notificationId: string): Promise<boolean> {
    return this.transport.scheduledDelivery?.cancel(this.deliveryScope, notificationId) ?? false;
  }

  /** Look up the durable receipt of a scheduled notification. */
  async getStatus(notificationId: string): Promise<SendResult | null> {
    return this.transport.scheduledDelivery?.status(this.deliveryScope, notificationId) ?? null;
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
    await this.startScheduledConsumer();
  }

  /**
   * Stop the notifications service (ILifecycle)
   */
  async onStop(): Promise<void> {
    const consumer = await this.scheduledConsumer;
    await consumer?.unsubscribe(true);
    this.scheduledConsumer = undefined;
  }

  /**
   * Destroy the notifications service (ILifecycle)
   */
  async onDestroy(): Promise<void> {
    // `NotificationChannel.shutdown()` is documented as "Shutdown the channel
    // and cleanup resources" and the built-ins leave it empty for subclasses to
    // override — but nothing in this package ever called `shutdownAll()`, so a
    // subclass closing an SMTP pool or an APNs connection there was never asked
    // to. Channels stop delivering before the bus underneath them goes away.
    await this.onStop();
    await this.channelRegistry?.shutdownAll();

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

  private async deliverChannel(recipient: NotificationRecipient, payload: NotificationPayload, name: string): Promise<ChannelResult> {
    const channel = this.channelRegistry?.get(name);
    if (!channel) return { channel: name, status: 'skipped', error: 'Channel not registered' };
    let submitted = false;
    try {
      if (!await channel.isAvailable() || !channel.validateRecipient(recipient)) {
        return { channel: name, status: 'skipped', error: 'Channel unavailable or recipient missing required fields' };
      }
      const content = channel.formatContent(payload);
      submitted = true;
      const outcome = await channel.send(recipient, content);
      return {
        channel: name, status: outcome.success ? 'success' : outcome.unconfirmed ? 'unconfirmed' : 'failed',
        deliveredAt: outcome.success ? Date.now() : undefined, messageId: outcome.messageId,
        metadata: outcome.metadata, error: outcome.error,
      };
    } catch (error) {
      return { channel: name, status: submitted ? 'unconfirmed' : 'failed', error: error instanceof Error ? error.message : String(error) };
    }
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

function channelEnabled(preferences: NotificationPreferences | null | undefined, channel: string, type: NotificationPayload['type']): boolean {
  const rule = preferences?.channels[channel];
  return !rule || (rule.enabled && (!rule.types || rule.types.includes(type)));
}

/**
 * Does a recipient satisfy one `RecipientFilter`?
 *
 * A missing field must NOT satisfy an equality filter: this option's failure
 * mode is sending to people the caller meant to exclude, so every unknown case
 * resolves to "excluded" rather than "included".
 */
function matchesRecipientFilter(recipient: NotificationRecipient, filter: RecipientFilter): boolean {
  const actual = (recipient as unknown as Record<string, unknown>)[filter.field];
  const expected = filter.value;

  switch (filter.operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'nin':
      return Array.isArray(expected) && !expected.includes(actual as never);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // Ordering comparisons on undefined are all false in JS, which is the
      // answer we want anyway — an absent field orders against nothing.
      if (actual === undefined || actual === null) return false;
      const a = actual as string | number;
      const b = expected as string | number;
      if (filter.operator === 'gt') return a > b;
      if (filter.operator === 'gte') return a >= b;
      if (filter.operator === 'lt') return a < b;
      return a <= b;
    }
    default:
      // An operator we do not implement must not silently pass everyone.
      return false;
  }
}

// Re-export interfaces for convenience
export type { IRateLimiter, IPreferenceStore, IChannelRouter };
