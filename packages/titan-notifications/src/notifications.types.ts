import type { RedisOptions } from 'ioredis';
import type { MessagingTransport } from './transport/transport.interface.js';
import type { RetryStrategyConfig } from '@omnitron-dev/titan/utils';
import type { NotificationChannel } from './channel/channel.interface.js';

// Module configuration
export interface NotificationsModuleOptions {
  transport?: {
    useTransport?: MessagingTransport;
    rotif?: RotifTransportOptions;
  };
  redis?: RedisOptions | string;
  rateLimiter?: IRateLimiter;
  preferenceStore?: IPreferenceStore;
  channelRouter?: IChannelRouter;
  defaultChannels?: string[];
  isGlobal?: boolean;

  /** Pre-configured notification channels */
  channels?: NotificationChannel[];

  /** Enable in-app notifications (requires Redis) */
  enableInApp?: boolean;

  /** Enable webhook delivery */
  enableWebhook?: boolean;

  /** In-app channel configuration */
  inAppConfig?: {
    keyPrefix?: string;
    defaultTTL?: number;
    maxNotificationsPerUser?: number;
    enableRealtime?: boolean;
  };

  /** Webhook channel configuration */
  webhookConfig?: {
    timeout?: number;
    retries?: number;
    signatureSecret?: string;
    signatureHeader?: string;
  };

  /** Template engine configuration */
  templates?: {
    enabled?: boolean;
    cacheEnabled?: boolean;
    cacheTTL?: number;
  };

  /** Rate limiter configuration (uses built-in RedisRateLimiter if not provided) */
  rateLimiterConfig?: {
    keyPrefix?: string;
    defaultLimits?: {
      perMinute?: number;
      perHour?: number;
      perDay?: number;
      burstLimit?: number;
    };
    channelLimits?: Record<
      string,
      {
        perMinute?: number;
        perHour?: number;
        perDay?: number;
      }
    >;
    enableBurstDetection?: boolean;
  };

  /** Preference store configuration (uses built-in RedisPreferenceStore if not provided) */
  preferenceStoreConfig?: {
    keyPrefix?: string;
    defaultPreferences?: Partial<NotificationPreferences>;
  };
}

export interface NotificationsModuleAsyncOptions {
  imports?: any[];
  useFactory?: (...args: any[]) => Promise<NotificationsModuleOptions> | NotificationsModuleOptions;
  inject?: any[];
  useExisting?: any;
  useClass?: any;
  isGlobal?: boolean;
}

export interface NotificationsOptionsFactory {
  createNotificationsOptions(): Promise<NotificationsModuleOptions> | NotificationsModuleOptions;
}

export interface RotifTransportOptions {
  maxRetries?: number;
  retryDelay?: number | ((attempt: number) => number);
  retryStrategy?: RetryStrategyConfig;
  deduplicationTTL?: number;
  maxStreamLength?: number;
  disableDelayed?: boolean;
}

// Notification types
export interface NotificationPayload {
  id?: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority?: NotificationPriority;
  metadata?: NotificationMetadata;
}

export type NotificationType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'reminder'
  | 'announcement';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationMetadata {
  category?: string;
  tags?: string[];
  ttl?: number;
  deduplicationKey?: string;
}

export interface NotificationRecipient {
  id: string;
  email?: string;
  phone?: string;
  pushTokens?: string[];
  webhookUrl?: string;
  locale?: string;
}

// Operation options and results
export interface SendOptions {
  channels?: string[];
  scheduledAt?: Date | number;
  retries?: number;
  timeout?: number;
  fallbackChannels?: string[];
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  notificationId: string;
  status: 'sent' | 'scheduled' | 'failed' | 'queued';
  channels: ChannelResult[];
  timestamp: number;
  error?: string;
}

export interface ChannelResult {
  channel: string;
  status: 'success' | 'failed' | 'skipped';
  deliveredAt?: number;
  messageId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface BroadcastOptions {
  channels?: string[];
  filters?: RecipientFilter[];
  batchSize?: number;
  throttle?: number;
  metadata?: Record<string, unknown>;
}

export interface RecipientFilter {
  field: string;
  operator: 'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'lt' | 'gte' | 'lte';
  value: any;
}

export interface BroadcastResult {
  broadcastId: string;
  totalRecipients: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  timestamp: number;
  errors?: Array<{ recipientId: string; error: string }>;
}

export interface ScheduleResult extends SendResult {
  scheduledAt: number;
  jobId: string;
}

// High-level notification transport interface
// This handles sending notifications to recipients through various channels
// Note: This is separate from the low-level MessagingTransport in ./transport/transport.interface.ts
export interface NotificationTransport {
  send(recipient: NotificationRecipient, payload: NotificationPayload, options?: SendOptions): Promise<SendResult>;

  broadcast(
    recipients: NotificationRecipient[],
    payload: NotificationPayload,
    options?: BroadcastOptions
  ): Promise<BroadcastResult>;

  schedule(
    recipient: NotificationRecipient,
    payload: NotificationPayload,
    scheduledAt: Date | number,
    options?: SendOptions
  ): Promise<ScheduleResult>;

  cancel(notificationId: string): Promise<boolean>;

  getStatus(notificationId: string): Promise<SendResult | null>;
}

// Feature interfaces
export interface IRateLimiter {
  checkLimit(
    recipientId: string,
    channel: string,
    type?: NotificationType
  ): Promise<{ allowed: boolean; retryAfter?: number }>;

  recordSent(recipientId: string, channel: string, type?: NotificationType): Promise<void>;

  reset(recipientId: string, channel?: string): Promise<void>;
}

export interface IPreferenceStore {
  getPreferences(recipientId: string): Promise<NotificationPreferences | null>;

  setPreferences(recipientId: string, preferences: Partial<NotificationPreferences>): Promise<void>;

  updatePreferences(recipientId: string, updates: Partial<NotificationPreferences>): Promise<void>;

  deletePreferences(recipientId: string): Promise<void>;
}

export interface NotificationPreferences {
  channels: {
    [channel: string]: {
      enabled: boolean;
      types?: NotificationType[];
      quietHours?: { start: string; end: string };
    };
  };
  globalMute?: boolean;
  locale?: string;
  timezone?: string;
}

export interface IChannelRouter {
  route(
    recipient: NotificationRecipient,
    payload: NotificationPayload,
    requestedChannels?: string[]
  ): Promise<string[]>;

  canSendViaChannel(recipient: NotificationRecipient, channel: string, payload: NotificationPayload): Promise<boolean>;
}

// Health check types
export interface NotificationsHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  transport: {
    connected: boolean;
    latency?: number;
    error?: string;
  };
  redis?: {
    connected: boolean;
    latency?: number;
    error?: string;
  };
  features: {
    rateLimiter: boolean;
    preferenceStore: boolean;
    channelRouter: boolean;
  };
  metrics?: {
    totalSent: number;
    totalFailed: number;
    queuedCount: number;
    averageLatency: number;
  };
  timestamp: number;
}

// Event types
export interface NotificationEvent {
  type: 'sent' | 'failed' | 'scheduled' | 'cancelled' | 'delivered';
  notificationId: string;
  recipientId: string;
  channel: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

// In-app notification storage
export interface StoredNotification {
  id: string;
  recipientId: string;
  payload: NotificationPayload;
  createdAt: number;
  readAt?: number;
  dismissedAt?: number;
  expiresAt?: number;
}
