/**
 * Abstract Email Notification Channel
 *
 * Base implementation for email delivery channels.
 * Concrete implementations must provide the sendEmail() method for actual delivery.
 *
 * @example
 * ```typescript
 * class NodemailerEmailChannel extends AbstractEmailChannel {
 *   constructor(private transporter: nodemailer.Transporter) {
 *     super();
 *   }
 *
 *   async sendEmail(to: string, content: EmailContent): Promise<{ messageId: string }> {
 *     const result = await this.transporter.sendMail({
 *       to,
 *       subject: content.subject,
 *       text: content.text,
 *       html: content.html,
 *     });
 *     return { messageId: result.messageId };
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
  type EmailContent,
} from '../channel.interface.js';

/**
 * Configuration options for email channel
 */
export interface EmailChannelOptions {
  /**
   * Default sender email address
   */
  from?: string;

  /**
   * Default reply-to email address
   */
  replyTo?: string;

  /**
   * Whether to generate HTML from text if not provided
   * @default true
   */
  autoGenerateHtml?: boolean;

  /**
   * Maximum email length (for validation)
   * @default 320 (RFC 5321)
   */
  maxEmailLength?: number;

  /**
   * Email address regex pattern for validation
   */
  emailPattern?: RegExp;
}

/**
 * Abstract base class for email notification channels
 */
export abstract class AbstractEmailChannel implements NotificationChannel {
  readonly name = 'email';
  readonly type = ChannelType.Email;

  protected options: Required<EmailChannelOptions> = {
    from: '',
    replyTo: '',
    autoGenerateHtml: true,
    maxEmailLength: 320,
    emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  };

  /**
   * Configure email channel options
   */
  configure(options: EmailChannelOptions): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Initialize the email channel
   */
  async initialize(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Shutdown the email channel
   */
  async shutdown(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Check if the email service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Attempt to send a test email or check service status
      // Override in subclass for actual implementation
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform health check on the email service
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
   * Validate that recipient has a valid email address
   */
  validateRecipient(recipient: NotificationRecipient): boolean {
    return !!recipient.email && this.isValidEmail(recipient.email);
  }

  /**
   * Format notification into email content
   */
  formatContent(notification: NotificationPayload): EmailContent {
    const text = notification.message;
    const html = this.options.autoGenerateHtml ? this.renderHtml(notification) : undefined;

    return {
      subject: notification.title,
      text,
      html,
      from: this.options.from,
      replyTo: this.options.replyTo,
    };
  }

  /**
   * Send email notification
   */
  async send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult> {
    if (!recipient.email) {
      return {
        success: false,
        error: 'Recipient does not have an email address',
      };
    }

    try {
      const emailContent = content as EmailContent;
      const result = await this.sendEmail(recipient.email, emailContent);

      return {
        success: true,
        messageId: result.messageId,
        metadata: {
          to: recipient.email,
          subject: emailContent.subject,
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
   * Abstract method: Send email using the underlying email service
   * Must be implemented by concrete subclasses
   *
   * @param to - Recipient email address
   * @param content - Email content to send
   * @returns Object containing the message ID from the email service
   */
  abstract sendEmail(to: string, content: EmailContent): Promise<{ messageId: string }>;

  // Protected helper methods

  /**
   * Validate email address format
   */
  protected isValidEmail(email: string): boolean {
    if (!email || email.length > this.options.maxEmailLength) {
      return false;
    }
    return this.options.emailPattern.test(email);
  }

  /**
   * Render HTML from notification payload
   * Override in subclass for custom HTML templates
   */
  protected renderHtml(notification: NotificationPayload): string {
    const priority = notification.priority || 'normal';
    const type = notification.type;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(notification.title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .notification {
      background: #f9f9f9;
      border-left: 4px solid #007bff;
      padding: 20px;
      margin: 20px 0;
    }
    .notification.urgent {
      border-left-color: #dc3545;
      background: #fff5f5;
    }
    .notification.high {
      border-left-color: #ffc107;
      background: #fffbf0;
    }
    .notification.info {
      border-left-color: #17a2b8;
    }
    .notification.success {
      border-left-color: #28a745;
      background: #f0fff4;
    }
    .notification.warning {
      border-left-color: #ffc107;
    }
    .notification.error {
      border-left-color: #dc3545;
    }
    .title {
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 10px 0;
    }
    .message {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .footer {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="notification ${this.escapeHtml(priority)} ${this.escapeHtml(type)}">
    <div class="title">${this.escapeHtml(notification.title)}</div>
    <div class="message">${this.escapeHtml(notification.message)}</div>
  </div>
  <div class="footer">
    <p>This is an automated notification. Please do not reply to this email.</p>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Escape HTML special characters
   */
  protected escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char] || char);
  }
}

/**
 * Example implementation using a mock email service
 * This can be used for testing or as a template
 */
export class MockEmailChannel extends AbstractEmailChannel {
  private sentEmails: Array<{ to: string; content: EmailContent; messageId: string; timestamp: number }> = [];

  async sendEmail(to: string, content: EmailContent): Promise<{ messageId: string }> {
    const messageId = generateUuidV7();

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.sentEmails.push({
      to,
      content,
      messageId,
      timestamp: Date.now(),
    });

    return { messageId };
  }

  /**
   * Get all sent emails (for testing)
   */
  getSentEmails() {
    return [...this.sentEmails];
  }

  /**
   * Clear sent emails history (for testing)
   */
  clearSentEmails(): void {
    this.sentEmails = [];
  }
}
