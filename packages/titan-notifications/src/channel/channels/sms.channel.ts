/**
 * Abstract SMS Notification Channel
 *
 * Base implementation for SMS delivery channels.
 * Concrete implementations must provide the sendSMS() method for actual delivery.
 *
 * @example
 * ```typescript
 * class TwilioSMSChannel extends AbstractSMSChannel {
 *   constructor(private client: Twilio) {
 *     super();
 *   }
 *
 *   async sendSMS(to: string, content: SMSContent): Promise<{ messageId: string }> {
 *     const result = await this.client.messages.create({
 *       to,
 *       from: content.from || this.options.from,
 *       body: content.text,
 *     });
 *     return { messageId: result.sid };
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
  type SMSContent,
} from '../channel.interface.js';

/**
 * Configuration options for SMS channel
 */
export interface SMSChannelOptions {
  /**
   * Default sender phone number
   */
  from?: string;

  /**
   * Maximum SMS length (standard is 160 characters for single SMS)
   * @default 160
   */
  maxLength?: number;

  /**
   * Whether to truncate messages that exceed maxLength
   * If false, will return error for long messages
   * @default true
   */
  truncateLongMessages?: boolean;

  /**
   * Truncation suffix to append when truncating
   * @default '...'
   */
  truncationSuffix?: string;

  /**
   * Phone number validation pattern
   */
  phonePattern?: RegExp;

  /**
   * Whether to include notification type prefix in SMS
   * @default false
   */
  includeTypePrefix?: boolean;
}

/**
 * Abstract base class for SMS notification channels
 */
export abstract class AbstractSMSChannel implements NotificationChannel {
  readonly name = 'sms';
  readonly type = ChannelType.SMS;

  protected options: Required<SMSChannelOptions> = {
    from: '',
    maxLength: 160,
    truncateLongMessages: true,
    truncationSuffix: '...',
    // E.164 format: +[country code][number]
    phonePattern: /^\+?[1-9]\d{1,14}$/,
    includeTypePrefix: false,
  };

  /**
   * Configure SMS channel options
   */
  configure(options: SMSChannelOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Initialize the SMS channel
   */
  async initialize(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Shutdown the SMS channel
   */
  async shutdown(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Check if the SMS service is available
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
   * Perform health check on the SMS service
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
          from: this.options.from,
          maxLength: this.options.maxLength,
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
   * Validate that recipient has a valid phone number
   */
  validateRecipient(recipient: NotificationRecipient): boolean {
    return !!recipient.phone && this.isValidPhone(recipient.phone);
  }

  /**
   * Format notification into SMS content
   */
  formatContent(notification: NotificationPayload): SMSContent {
    let text = notification.message;

    // Add type prefix if enabled
    if (this.options.includeTypePrefix) {
      const prefix = this.getTypePrefix(notification.type);
      text = `${prefix}${notification.title}: ${text}`;
    } else {
      text = `${notification.title}: ${text}`;
    }

    // Handle message length
    if (text.length > this.options.maxLength) {
      if (this.options.truncateLongMessages) {
        const truncateAt = this.options.maxLength - this.options.truncationSuffix.length;
        text = text.slice(0, truncateAt) + this.options.truncationSuffix;
      } else {
        throw new Error(`SMS message exceeds maximum length of ${this.options.maxLength} characters`);
      }
    }

    return {
      text,
      from: this.options.from,
    };
  }

  /**
   * Send SMS notification
   */
  async send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult> {
    if (!recipient.phone) {
      return {
        success: false,
        error: 'Recipient does not have a phone number',
      };
    }

    try {
      const smsContent = content as SMSContent;
      const result = await this.sendSMS(recipient.phone, smsContent);

      return {
        success: true,
        messageId: result.messageId,
        metadata: {
          to: recipient.phone,
          length: smsContent.text.length,
          segmentCount: this.calculateSegments(smsContent.text),
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
   * Abstract method: Send SMS using the underlying SMS service
   * Must be implemented by concrete subclasses
   *
   * @param to - Recipient phone number (E.164 format recommended)
   * @param content - SMS content to send
   * @returns Object containing the message ID from the SMS service
   */
  abstract sendSMS(to: string, content: SMSContent): Promise<{ messageId: string }>;

  // Protected helper methods

  /**
   * Validate phone number format
   */
  protected isValidPhone(phone: string): boolean {
    if (!phone) {
      return false;
    }

    // Remove common formatting characters for validation
    const cleaned = phone.replace(/[\s\-()]/g, '');
    return this.options.phonePattern.test(cleaned);
  }

  /**
   * Normalize phone number to E.164 format
   * Override in subclass for country-specific normalization
   */
  protected normalizePhone(phone: string): string {
    // Remove formatting characters
    let normalized = phone.replace(/[\s\-()]/g, '');

    // Add + prefix if missing and starts with country code
    if (!normalized.startsWith('+') && /^[1-9]/.test(normalized)) {
      normalized = `+${normalized}`;
    }

    return normalized;
  }

  /**
   * Calculate number of SMS segments required for message
   * Standard SMS: 160 chars per segment
   * Unicode SMS: 70 chars per segment
   * Concatenated SMS: 153 chars per segment (7 chars used for concatenation headers)
   */
  protected calculateSegments(text: string): number {
    // eslint-disable-next-line no-control-regex
    const hasUnicode = /[^\x00-\x7F]/.test(text);
    const singleLimit = hasUnicode ? 70 : 160;
    const multiLimit = hasUnicode ? 67 : 153;

    if (text.length <= singleLimit) {
      return 1;
    }

    return Math.ceil(text.length / multiLimit);
  }

  /**
   * Get notification type prefix for SMS
   */
  protected getTypePrefix(type: string): string {
    const prefixes: Record<string, string> = {
      urgent: '[URGENT] ',
      critical: '[CRITICAL] ',
      alert: '[ALERT] ',
      warning: '[WARNING] ',
      error: '[ERROR] ',
      success: '[SUCCESS] ',
      info: '[INFO] ',
      reminder: '[REMINDER] ',
    };

    return prefixes[type.toLowerCase()] || '';
  }
}

/**
 * Example implementation using a mock SMS service
 * This can be used for testing or as a template
 */
export class MockSMSChannel extends AbstractSMSChannel {
  private sentMessages: Array<{ to: string; content: SMSContent; messageId: string; timestamp: number }> = [];

  async sendSMS(to: string, content: SMSContent): Promise<{ messageId: string }> {
    const messageId = generateUuidV7();

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.sentMessages.push({
      to,
      content,
      messageId,
      timestamp: Date.now(),
    });

    return { messageId };
  }

  /**
   * Get all sent messages (for testing)
   */
  getSentMessages() {
    return [...this.sentMessages];
  }

  /**
   * Clear sent messages history (for testing)
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }
}
