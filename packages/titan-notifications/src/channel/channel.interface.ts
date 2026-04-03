import type { NotificationPayload, NotificationRecipient } from '../notifications.types.js';

/**
 * Channel interface for delivery endpoint abstraction.
 * Each channel represents a delivery method (email, SMS, push, in-app, webhook).
 */
export interface NotificationChannel {
  readonly name: string;
  readonly type: ChannelType;

  /**
   * Initialize the channel (e.g., connect to external services, validate configuration)
   */
  initialize?(): Promise<void>;

  /**
   * Shutdown the channel and cleanup resources
   */
  shutdown?(): Promise<void>;

  /**
   * Check if the channel is available and healthy
   */
  isAvailable(): Promise<boolean>;

  /**
   * Perform a health check on the channel
   */
  healthCheck(): Promise<ChannelHealth>;

  /**
   * Validate that a recipient can receive notifications via this channel
   */
  validateRecipient(recipient: NotificationRecipient): boolean;

  /**
   * Format notification payload into channel-specific content
   */
  formatContent(notification: NotificationPayload): ChannelContent;

  /**
   * Send a notification to a recipient
   */
  send(recipient: NotificationRecipient, content: ChannelContent): Promise<ChannelSendResult>;
}

/**
 * Channel types supported by Notifications
 */
export enum ChannelType {
  Email = 'email',
  SMS = 'sms',
  Push = 'push',
  InApp = 'inApp',
  Webhook = 'webhook',
}

/**
 * Base channel content interface
 */
export interface ChannelContent {
  subject?: string;
  html?: string;
  text?: string;
  data?: Record<string, unknown>;
}

/**
 * Email-specific content
 */
export interface EmailContent extends ChannelContent {
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

/**
 * SMS-specific content
 */
export interface SMSContent extends ChannelContent {
  text: string;
  from?: string;
}

/**
 * Push notification content
 */
export interface PushContent extends ChannelContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: string;
  icon?: string;
  image?: string;
  clickAction?: string;
}

/**
 * In-app notification content
 */
export interface InAppContent extends ChannelContent {
  title: string;
  message: string;
  type: string;
  priority?: string;
  data?: Record<string, unknown>;
}

/**
 * Webhook content
 */
export interface WebhookContent extends ChannelContent {
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Result of a channel send operation
 */
export interface ChannelSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Channel health status
 */
export interface ChannelHealth {
  name: string;
  type: ChannelType;
  available: boolean;
  latency?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
