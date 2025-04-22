// src/types.ts
import { RedisOptions } from 'ioredis';

/**
 * Logger interface for Rotif. Provides methods for different log levels.
 * @interface RotifLogger
 */
export interface RotifLogger {
  debug: (msg: string, meta?: any) => void;
  info: (msg: string, meta?: any) => void;
  warn: (msg: string, meta?: any) => void;
  error: (msg: string, meta?: any) => void;
}

/**
 * Represents a message in the Rotif system.
 * @interface RotifMessage
 */
export interface RotifMessage {
  /** Unique identifier of the message */
  id: string;
  /** Channel name the message was published to */
  channel: string;
  /** Message payload */
  payload: any;
  /** Timestamp when the message was created */
  timestamp: number;
  /** Current processing attempt number */
  attempt: number;
  /** Acknowledges the message, marking it as processed */
  ack: () => Promise<void>;
}

/**
 * Configuration options for Rotif.
 * @interface RotifConfig
 */
export interface RotifConfig {
  /** Redis connection options or connection string */
  redis: RedisOptions | string;
  /** Custom logger implementation */
  logger?: RotifLogger;
  /** Enable delayed message delivery */
  enableDelayed?: boolean;
  /** Interval in milliseconds to check for delayed messages */
  checkDelayInterval?: number;
  /** Maximum number of retry attempts for failed messages */
  maxRetries?: number;
  /** Maximum length of Redis streams */
  maxStreamLength?: number;
  /** Minimum stream ID to keep when trimming */
  minStreamId?: string;
  /** Block interval in milliseconds for stream reading */
  blockInterval?: number;
  /** Deduplication TTL (seconds) for exactly-once delivery */
  deduplicationTTL?: number;
  /** Maximum number of messages to move from scheduled to stream */
  scheduledBatchSize?: number;
  /** Retry delay in milliseconds or function to calculate delay */
  retryDelay?: number | ((attempt: number, msg: RotifMessage) => number);
  /** Custom function to generate consumer group names */
  groupNameFn?: (pattern: string) => string;
  /** Custom function to generate consumer names */
  consumerNameFn?: () => string;
}

/**
 * Represents an active subscription to a message channel.
 * @interface Subscription
 */
export interface Subscription {
  /** Unique subscription identifier */
  id: string;
  /** Channel pattern being subscribed to */
  pattern: string;
  /** Consumer group name */
  group: string;
  /** Message handler function */
  handler: (msg: RotifMessage) => Promise<void>;
  /** Subscribe options */
  options?: SubscribeOptions;
  /** Unsubscribe from the channel */
  unsubscribe(): Promise<void>;
  /** Pause message processing */
  pause(): void;
  /** Resume message processing */
  resume(): void;
  /** Whether the subscription is currently paused */
  isPaused: boolean;
  /** Get subscription statistics */
  stats(): SubscriptionStats;
}


/**
 * Statistics for a subscription.
 * @interface SubscriptionStats
 */
export interface SubscriptionStats {
  /** Number of successfully processed messages */
  messages: number;
  /** Number of retry attempts */
  retries: number;
  /** Number of failed messages (moved to DLQ) */
  failures?: number;
  /** Timestamp of the last processed message */
  lastMessageAt?: number;
}

/**
 * Options for publishing messages.
 * @interface PublishOptions
 */
export interface PublishOptions {
  /** Delay in milliseconds before delivery */
  delayMs?: number;
  /** Absolute timestamp for message delivery */
  deliverAt?: number | Date;
  /** Initial attempt number */
  attempt?: number;
  /** Enable exactly-once deduplication */
  exactlyOnce?: boolean;
  /** Deduplication TTL in seconds */
  deduplicationTTL?: number;
}

/**
 * Options for subscribing to messages.
 * @interface SubscribeOptions
 */
export interface SubscribeOptions {
  /** Custom consumer group name */
  groupName?: string;
  /** Custom consumer name */
  consumerName?: string;
  /** Starting position in the stream ('$' for new messages, '0' for all messages) */
  startFrom?: '$' | '0' | string;
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Retry delay in milliseconds or function to calculate delay */
  retryDelay?: number | ((attempt: number, msg: RotifMessage) => number);
  /** Enable exactly-once processing */
  exactlyOnce?: boolean;
}