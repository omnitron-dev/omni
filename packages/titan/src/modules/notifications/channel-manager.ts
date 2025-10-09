import { Injectable } from '../../decorators/index.js';
import { Errors } from '../../errors/index.js';
import { NotificationPayload, Recipient, SendOptions } from './notifications.service.js';

export enum ChannelType {
  Email = 'email',
  SMS = 'sms',
  Push = 'push',
  Webhook = 'webhook',
  InApp = 'inApp'
}

export interface ChannelContent {
  subject?: string;
  html?: string;
  text?: string;
  message?: string;
  data?: any;
}

export interface NotificationChannel {
  name: string;
  type: ChannelType;
  isAvailable(): Promise<boolean>;
  send(recipient: Recipient, content: ChannelContent): Promise<void>;
  validateRecipient(recipient: Recipient): boolean;
  formatContent(notification: NotificationPayload): ChannelContent;
}

export interface RecipientGroup {
  channel: NotificationChannel;
  recipients: Recipient[];
}

export interface DeliveryRecord {
  recipientId: string;
  channel: ChannelType;
  messageId: string;
  timestamp: number;
}

export interface FailureRecord {
  recipientId: string;
  channel: ChannelType;
  error: string;
  timestamp: number;
}

export interface DeliveryResults {
  successful: DeliveryRecord[];
  failed: FailureRecord[];
}

export interface ProcessedNotification {
  id: string;
  recipientId: string;
  channel: string;
  content: any;
}

@Injectable()
export class ChannelManager {
  private channels = new Map<string, NotificationChannel>();
  private channelPriorities = new Map<string, number>();

  constructor() {
    // Register default channels
    this.registerDefaultChannels();
  }

  /**
   * Register default notification channels
   */
  private registerDefaultChannels(): void {
    // Register InApp channel as default
    const inAppChannel = new InAppChannel();
    this.registerChannel(inAppChannel, 0);

    // Register Email channel if available
    const emailChannel = new EmailChannel();
    this.registerChannel(emailChannel, 1);
  }

  /**
   * Register a notification channel
   */
  registerChannel(channel: NotificationChannel, priority: number = 0): void {
    this.channels.set(channel.name, channel);
    this.channelPriorities.set(channel.name, priority);
  }

  /**
   * Plan delivery across available channels
   */
  async planDelivery(
    recipients: Recipient[],
    notification: NotificationPayload,
    options: SendOptions
  ): Promise<Map<string, { recipients: Recipient[] }>> {
    const plan = new Map<string, { recipients: Recipient[] }>();

    for (const recipient of recipients) {
      const channels = await this.selectChannels(recipient, notification, options);

      for (const channel of channels) {
        const channelName = channel.name;
        if (!plan.has(channelName)) {
          plan.set(channelName, { recipients: [] });
        }
        plan.get(channelName)!.recipients.push(recipient);
      }
    }

    return plan;
  }

  /**
   * Select appropriate channels for a recipient
   */
  private async selectChannels(
    recipient: Recipient,
    notification: NotificationPayload,
    options: SendOptions
  ): Promise<NotificationChannel[]> {
    const availableChannels: NotificationChannel[] = [];
    const requestedChannels = options.channels || [ChannelType.InApp];

    // Filter channels based on request and availability
    for (const channelType of requestedChannels) {
      const channel = Array.from(this.channels.values()).find(c => c.type === channelType);

      if (channel && await this.isChannelSuitable(channel, recipient, notification)) {
        availableChannels.push(channel);
      }
    }

    // Apply channel strategy
    return this.applyChannelStrategy(
      availableChannels,
      options.channelStrategy || 'first-available'
    );
  }

  /**
   * Check if channel is suitable for recipient
   */
  private async isChannelSuitable(
    channel: NotificationChannel,
    recipient: Recipient,
    notification: NotificationPayload
  ): Promise<boolean> {
    // Check if channel is available
    const available = await channel.isAvailable();
    if (!available) {
      return false;
    }

    // Validate recipient for this channel
    return channel.validateRecipient(recipient);
  }

  /**
   * Apply channel selection strategy
   */
  private applyChannelStrategy(
    channels: NotificationChannel[],
    strategy: 'first-available' | 'all' | 'fallback'
  ): NotificationChannel[] {
    if (channels.length === 0) {
      // Default to InApp if no channels available
      const inAppChannel = this.channels.get('inApp');
      return inAppChannel ? [inAppChannel] : [];
    }

    // Sort by priority
    const sorted = channels.sort((a, b) => {
      const priorityA = this.channelPriorities.get(a.name) || 999;
      const priorityB = this.channelPriorities.get(b.name) || 999;
      return priorityA - priorityB;
    });

    switch (strategy) {
      case 'first-available':
        return sorted[0] ? [sorted[0]] : [];
      case 'all':
        return sorted;
      case 'fallback':
        // In real implementation, would try channels in order until one succeeds
        return sorted[0] ? [sorted[0]] : [];
      default:
        return sorted[0] ? [sorted[0]] : [];
    }
  }
}

/**
 * In-App notification channel implementation
 */
export class InAppChannel implements NotificationChannel {
  name = 'inApp';
  type = ChannelType.InApp;

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    // In real implementation, would store in database
    // For now, just log
    console.log(`InApp notification sent to ${recipient.id}:`, content);
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.id;
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    return {
      subject: notification.title,
      text: notification.body,
      data: notification.data
    };
  }
}

/**
 * Email notification channel implementation
 */
export class EmailChannel implements NotificationChannel {
  name = 'email';
  type = ChannelType.Email;

  async isAvailable(): Promise<boolean> {
    // In real implementation, would check email service health
    return true;
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    if (!recipient.email) {
      throw Errors.badRequest('Recipient email not provided');
    }

    // In real implementation, would send via email service
    console.log(`Email sent to ${recipient.email}:`, content);
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.email && this.isValidEmail(recipient.email);
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    return {
      subject: notification.title,
      html: `<h1>${notification.title}</h1><p>${notification.body}</p>`,
      text: `${notification.title}\n\n${notification.body}`
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

/**
 * SMS notification channel implementation
 */
export class SMSChannel implements NotificationChannel {
  name = 'sms';
  type = ChannelType.SMS;

  async isAvailable(): Promise<boolean> {
    // In real implementation, would check SMS service availability
    return true;
  }

  async send(recipient: Recipient, content: ChannelContent): Promise<void> {
    if (!recipient.phone) {
      throw Errors.badRequest('Recipient phone not provided');
    }

    // In real implementation, would send via SMS service
    console.log(`SMS sent to ${recipient.phone}:`, content.message);
  }

  validateRecipient(recipient: Recipient): boolean {
    return !!recipient.phone && this.isValidPhone(recipient.phone);
  }

  formatContent(notification: NotificationPayload): ChannelContent {
    const message = `${notification.title}: ${notification.body}`.slice(0, 160);
    return { message };
  }

  private isValidPhone(phone: string): boolean {
    // Simple phone validation
    const phoneRegex = /^\+?[1-9]\d{7,14}$/;
    return phoneRegex.test(phone.replace(/\s+/g, ''));
  }
}