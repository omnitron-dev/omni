/**
 * Abstract Push Notification Channel
 *
 * Base implementation for push notification delivery channels.
 * Concrete implementations must provide the sendPush() method for actual delivery.
 *
 * @example
 * ```typescript
 * class FCMPushChannel extends AbstractPushChannel {
 *   constructor(private fcm: admin.messaging.Messaging) {
 *     super();
 *   }
 *
 *   async sendPush(tokens: string[], content: PushContent): Promise<{ successCount: number; failureCount: number }> {
 *     const message = {
 *       notification: {
 *         title: content.title,
 *         body: content.body,
 *       },
 *       data: content.data,
 *       tokens,
 *     };
 *     const result = await this.fcm.sendMulticast(message);
 *     return {
 *       successCount: result.successCount,
 *       failureCount: result.failureCount,
 *     };
 *   }
 * }
 * ```
 */

import type { NotificationPayload, NotificationRecipient } from '../../notifications.types.js';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import type { NotificationChannel } from '../channel.interface.js';
import {
  ChannelType,
  type ChannelContent,
  type ChannelSendResult,
  type ChannelHealth,
  type PushContent,
} from '../channel.interface.js';

/**
 * Configuration options for push notification channel
 */
export interface PushChannelOptions {
  /**
   * Maximum number of tokens to send to in a single batch
   * @default 500 (FCM limit)
   */
  batchSize?: number;

  /**
   * Default badge count for notifications
   * @default 1
   */
  defaultBadge?: number;

  /**
   * Default sound for notifications
   * @default 'default'
   */
  defaultSound?: string;

  /**
   * Default icon for notifications (Android)
   */
  defaultIcon?: string;

  /**
   * Time to live for notifications in seconds
   * @default 86400 (24 hours)
   */
  ttl?: number;

  /**
   * Priority for push notifications
   * @default 'high'
   */
  priority?: 'normal' | 'high';

  /**
   * Maximum title length
   * @default 65
   */
  maxTitleLength?: number;

  /**
   * Maximum body length
   * @default 240
   */
  maxBodyLength?: number;

  /**
   * Whether to truncate long text
   * @default true
   */
  truncateLongText?: boolean;

  /**
   * Truncation suffix
   * @default '...'
   */
  truncationSuffix?: string;

  /**
   * Whether to include notification data in payload
   * @default true
   */
  includeData?: boolean;
}

/**
 * Result of sending to multiple tokens
 */
export interface PushSendResult {
  successCount: number;
  failureCount: number;
  invalidTokens?: string[];
}

/**
 * Abstract base class for push notification channels
 */
export abstract class AbstractPushChannel implements NotificationChannel {
  readonly name = 'push';
  readonly type = ChannelType.Push;

  protected options: Required<PushChannelOptions> = {
    batchSize: 500,
    defaultBadge: 1,
    defaultSound: 'default',
    defaultIcon: '',
    ttl: 86400,
    priority: 'high',
    maxTitleLength: 65,
    maxBodyLength: 240,
    truncateLongText: true,
    truncationSuffix: '...',
    includeData: true,
  };

  /**
   * Configure push channel options
   */
  configure(options: PushChannelOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Initialize the push channel
   */
  async initialize(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Shutdown the push channel
   */
  async shutdown(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Check if the push service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Override in subclass for actual implementation
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform health check on the push service
   */
  async healthCheck(): Promise<ChannelHealth> {
    const startTime = Date.now();
    try {
      const available = await this.isAvailable();
      const latency = Date.now() - startTime;

      return {
        name: this.name,
        type: this.type,
        available,
        latency,
        metadata: {
          batchSize: this.options.batchSize,
          priority: this.options.priority,
          ttl: this.options.ttl,
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
   * Validate that recipient has push tokens
   */
  validateRecipient(recipient: NotificationRecipient): boolean {
    return !!recipient.pushTokens?.length;
  }

  /**
   * Format notification into push content
   */
  formatContent(notification: NotificationPayload): PushContent {
    let title = notification.title;
    let body = notification.message;

    // Truncate if needed
    if (this.options.truncateLongText) {
      title = this.truncate(title, this.options.maxTitleLength);
      body = this.truncate(body, this.options.maxBodyLength);
    }

    const content: PushContent = {
      title,
      body,
      badge: this.options.defaultBadge,
      sound: this.options.defaultSound,
    };

    // Add data payload if enabled
    if (this.options.includeData) {
      content.data = {
        notificationId: notification.id || generateUuidV7(),
        type: notification.type,
        priority: notification.priority,
        ...notification.data,
      };
    }

    // Add icon for Android
    if (this.options.defaultIcon) {
      content.icon = this.options.defaultIcon;
    }

    // Add custom fields from notification
    if (notification.data?.['image']) {
      content.image = notification.data['image'] as string;
    }

    if (notification.data?.['clickAction']) {
      content.clickAction = notification.data['clickAction'] as string;
    }

    return content;
  }

  /**
   * Send push notification
   */
  async send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult> {
    if (!recipient.pushTokens?.length) {
      return {
        success: false,
        error: 'Recipient does not have push tokens',
      };
    }

    try {
      const pushContent = content as PushContent;
      const result = await this.sendPush(recipient.pushTokens, pushContent);

      const success = result.successCount > 0;
      const messageId = success ? generateUuidV7() : undefined;

      return {
        success,
        messageId,
        metadata: {
          recipientId: recipient.id,
          tokenCount: recipient.pushTokens.length,
          successCount: result.successCount,
          failureCount: result.failureCount,
          invalidTokens: result.invalidTokens,
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
   * Abstract method: Send push notification to multiple tokens
   * Must be implemented by concrete subclasses
   *
   * @param tokens - Array of push notification tokens
   * @param content - Push notification content
   * @returns Result with success/failure counts and any invalid tokens
   */
  abstract sendPush(tokens: string[], content: PushContent): Promise<PushSendResult>;

  // Protected helper methods

  /**
   * Truncate text to maximum length
   */
  protected truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    const truncateAt = maxLength - this.options.truncationSuffix.length;
    return text.slice(0, truncateAt) + this.options.truncationSuffix;
  }

  /**
   * Split tokens into batches for sending
   */
  protected batchTokens(tokens: string[]): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < tokens.length; i += this.options.batchSize) {
      batches.push(tokens.slice(i, i + this.options.batchSize));
    }
    return batches;
  }

  /**
   * Validate push token format
   * Override in subclass for service-specific validation
   */
  protected isValidToken(token: string): boolean {
    return typeof token === 'string' && token.length > 0;
  }

  /**
   * Filter out invalid tokens
   */
  protected filterValidTokens(tokens: string[]): string[] {
    return tokens.filter((token) => this.isValidToken(token));
  }
}

/**
 * Example implementation using a mock push service
 * This can be used for testing or as a template
 */
export class MockPushChannel extends AbstractPushChannel {
  private sentNotifications: Array<{
    tokens: string[];
    content: PushContent;
    timestamp: number;
    result: PushSendResult;
  }> = [];

  async sendPush(tokens: string[], content: PushContent): Promise<PushSendResult> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate some failures (tokens starting with 'invalid')
    const validTokens = tokens.filter((token) => !token.startsWith('invalid'));
    const invalidTokens = tokens.filter((token) => token.startsWith('invalid'));

    const result: PushSendResult = {
      successCount: validTokens.length,
      failureCount: invalidTokens.length,
      invalidTokens: invalidTokens.length > 0 ? invalidTokens : undefined,
    };

    this.sentNotifications.push({
      tokens,
      content,
      timestamp: Date.now(),
      result,
    });

    return result;
  }

  /**
   * Get all sent notifications (for testing)
   */
  getSentNotifications() {
    return [...this.sentNotifications];
  }

  /**
   * Clear sent notifications history (for testing)
   */
  clearSentNotifications(): void {
    this.sentNotifications = [];
  }
}
