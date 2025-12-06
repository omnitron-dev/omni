import { Injectable } from '../../decorators/index.js';
import { NotificationManager } from '../../rotif/rotif.js';
import { ChannelManager, ChannelType, DeliveryResults } from './channel-manager.js';
import { PreferenceManager } from './preference-manager.js';
import { RateLimiter } from './rate-limiter.js';
import { generateUuid } from './utils.js';

export interface NotificationMetadata {
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  ttl?: number;
  deduplicationKey?: string;
  category?: string;
  tags?: string[];
  tracking?: {
    impressions?: boolean;
    clicks?: boolean;
    conversions?: boolean;
  };
}

export interface NotificationPayload {
  id?: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  data?: Record<string, any>;
  metadata?: NotificationMetadata;
}

export interface Recipient {
  id: string;
  email?: string;
  phone?: string;
  pushTokens?: string[];
  webhookUrl?: string;
  locale?: string;
}

export interface SendOptions {
  channels?: ChannelType[];
  templateId?: string;
  delay?: number;
  scheduledTime?: number | Date;
  exactlyOnce?: boolean;
  deduplicationTTL?: number;
  channelStrategy?: 'first-available' | 'all' | 'fallback';
}

export interface NotificationResult {
  id: string;
  sent: number;
  failed: number;
  filtered: number;
  details?: DeliveryResults;
}

export interface BroadcastTarget {
  id: string;
  segment?: string;
  userIds?: string[];
}

export interface BroadcastOptions extends SendOptions {
  batchSize?: number;
}

export interface BroadcastResult {
  recipients: number;
  batches?: number;
  results?: NotificationResult[];
}

export interface ScheduleOptions extends SendOptions {
  recurrence?: {
    pattern: string;
    endDate?: Date;
  };
}

export interface ScheduleResult {
  scheduleId: string;
  scheduled: boolean;
  deliveryTime: number;
}

@Injectable()
export class NotificationService {
  private deduplicationCache = new Map<string, { timestamp: number }>();
  private scheduleStorage = new Map<string, any>();
  private readonly DEDUP_MAX_SIZE = 10000;
  private readonly DEDUP_TTL = 86400000; // 24 hours

  constructor(
    private rotif: NotificationManager,
    private channelManager: ChannelManager,
    private preferenceManager: PreferenceManager,
    private rateLimiter: RateLimiter
  ) {}

  /**
   * Send a notification to specified recipients
   */
  async send(
    recipients: Recipient | Recipient[],
    notification: NotificationPayload,
    options: SendOptions = {}
  ): Promise<NotificationResult> {
    // Generate unique ID if not provided
    const notificationId = notification.id || generateUuid();

    // Check deduplication
    if (notification.metadata?.deduplicationKey) {
      const dedupKey = notification.metadata.deduplicationKey;
      const lastSent = this.deduplicationCache.get(dedupKey);
      const ttl = options.deduplicationTTL || 86400000; // 24 hours default

      if (lastSent && Date.now() - lastSent.timestamp < ttl) {
        return {
          id: notificationId,
          sent: 0,
          failed: 0,
          filtered: Array.isArray(recipients) ? recipients.length : 1,
        };
      }
      this.deduplicationCache.set(dedupKey, { timestamp: Date.now() });

      // Cleanup cache periodically
      this.cleanupDeduplicationCache();
    }

    // Normalize recipients
    const recipientList = Array.isArray(recipients) ? recipients : [recipients];

    // Filter by preferences
    const filteredRecipients = await this.filterByPreferences(recipientList, notification, options);

    // Apply rate limiting
    const allowedRecipients: Recipient[] = [];
    for (const recipient of filteredRecipients) {
      const allowed = await this.rateLimiter.checkLimit(recipient.id, notification.type);
      if (allowed) {
        allowedRecipients.push(recipient);
      }
    }

    // Determine delivery channels
    const deliveryPlan = await this.channelManager.planDelivery(allowedRecipients, notification, options);

    // Send through Rotif
    const results = await this.sendViaRotif(deliveryPlan, notification, options);

    return {
      id: notificationId,
      sent: results.successful.length,
      failed: results.failed.length,
      filtered: recipientList.length - allowedRecipients.length,
      details: results,
    };
  }

  /**
   * Filter recipients based on preferences
   */
  private async filterByPreferences(
    recipients: Recipient[],
    notification: NotificationPayload,
    options: SendOptions
  ): Promise<Recipient[]> {
    const filtered: Recipient[] = [];

    for (const recipient of recipients) {
      const shouldSend = await this.preferenceManager.shouldSendNotification(
        recipient.id,
        notification,
        options.channels?.[0] || 'inApp'
      );

      if (shouldSend) {
        filtered.push(recipient);
      }
    }

    return filtered;
  }

  /**
   * Send notifications through Rotif
   */
  private async sendViaRotif(
    deliveryPlan: Map<string, { recipients: Recipient[] }>,
    notification: NotificationPayload,
    options: SendOptions
  ): Promise<DeliveryResults> {
    const results: DeliveryResults = {
      successful: [],
      failed: [],
    };

    for (const [channel, group] of deliveryPlan) {
      for (const recipient of group.recipients) {
        const channelName = `notifications.${channel}.${recipient.id}`;

        try {
          await this.rotif.publish(
            channelName,
            {
              ...notification,
              recipientId: recipient.id,
              channel,
            },
            {
              delayMs: options.delay,
              deliverAt: options.scheduledTime,
              exactlyOnce: options.exactlyOnce ?? true,
            }
          );

          results.successful.push({
            recipientId: recipient.id,
            channel: channel as ChannelType,
            messageId: notification.id || generateUuid(),
            timestamp: Date.now(),
          });
        } catch (error: any) {
          results.failed.push({
            recipientId: recipient.id,
            channel: channel as ChannelType,
            error: error.message,
            timestamp: Date.now(),
          });
        }
      }
    }

    return results;
  }

  /**
   * Broadcast notification to a target audience
   */
  async broadcast(
    target: BroadcastTarget,
    notification: NotificationPayload,
    options: BroadcastOptions = {}
  ): Promise<BroadcastResult> {
    // Resolve recipients from target
    const recipients = await this.resolveAudience(target);

    // Check if batching is needed
    const batchSize = options.batchSize || 1000;
    if (recipients.length > batchSize) {
      return this.sendBatched(recipients, notification, options);
    }

    // Send normally
    const result = await this.send(recipients, notification, options);

    return {
      recipients: recipients.length,
      results: [result],
    };
  }

  /**
   * Send notifications in batches
   */
  private async sendBatched(
    recipients: Recipient[],
    notification: NotificationPayload,
    options: BroadcastOptions
  ): Promise<BroadcastResult> {
    const batchSize = options.batchSize || 1000;
    const batches = Math.ceil(recipients.length / batchSize);
    const results: NotificationResult[] = [];

    for (let i = 0; i < batches; i++) {
      const batch = recipients.slice(i * batchSize, (i + 1) * batchSize);
      const result = await this.send(batch, notification, options);
      results.push(result);

      // Add delay between batches to avoid overwhelming the system
      if (i < batches - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return {
      recipients: recipients.length,
      batches,
      results,
    };
  }

  /**
   * Resolve audience from broadcast target
   */
  private async resolveAudience(target: BroadcastTarget): Promise<Recipient[]> {
    if (target.userIds) {
      return target.userIds.map((id) => ({ id }));
    }

    // In real implementation, would resolve from segment service
    return [];
  }

  /**
   * Schedule a notification for future delivery
   */
  async schedule(
    recipients: Recipient | Recipient[],
    notification: NotificationPayload,
    deliveryTime: Date | number,
    options: ScheduleOptions = {}
  ): Promise<ScheduleResult> {
    const scheduleId = generateUuid();
    const timestamp = typeof deliveryTime === 'number' ? deliveryTime : deliveryTime.getTime();

    // Store schedule metadata
    this.scheduleStorage.set(scheduleId, {
      id: scheduleId,
      recipients,
      notification,
      deliveryTime: timestamp,
      options,
      status: 'scheduled',
      createdAt: Date.now(),
    });

    // Schedule through send with scheduledTime
    await this.send(recipients, notification, {
      ...options,
      scheduledTime: timestamp,
    });

    return {
      scheduleId,
      scheduled: true,
      deliveryTime: timestamp,
    };
  }

  /**
   * Cancel a scheduled notification
   */
  async cancelScheduled(scheduleId: string): Promise<boolean> {
    const schedule = this.scheduleStorage.get(scheduleId);
    if (!schedule) {
      return false;
    }

    // Mark as cancelled
    schedule.status = 'cancelled';
    this.scheduleStorage.set(scheduleId, schedule);

    // In real implementation, would cancel in Rotif
    return true;
  }

  /**
   * Cleanup expired entries from deduplication cache
   */
  private cleanupDeduplicationCache(): void {
    const now = Date.now();

    // Remove expired entries
    for (const [key, value] of this.deduplicationCache.entries()) {
      if (now - value.timestamp > this.DEDUP_TTL) {
        this.deduplicationCache.delete(key);
      }
    }

    // Limit cache size to prevent unbounded growth
    if (this.deduplicationCache.size > this.DEDUP_MAX_SIZE) {
      const excess = this.deduplicationCache.size - this.DEDUP_MAX_SIZE;
      const keys = Array.from(this.deduplicationCache.keys()).slice(0, excess);
      keys.forEach(k => this.deduplicationCache.delete(k));
    }
  }
}
