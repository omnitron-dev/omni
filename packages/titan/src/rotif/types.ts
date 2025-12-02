// src/types.ts
import { RedisOptions } from 'ioredis';
import type { StatsTracker } from './stats.js';
import type { RetryStrategyConfig } from './retry-strategies.js';
import type { DLQCleanupConfig } from './dlq-manager.js';

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
  /** Disable delayed message delivery */
  disableDelayed?: boolean;
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
  /** Retry strategy configuration */
  retryStrategy?: RetryStrategyConfig;
  /** Enable local round-robin among subscribers */
  localRoundRobin?: boolean;
  /** Enable pending message recovery */
  disablePendingMessageRecovery?: boolean;
  /** Pending message recovery check interval */
  pendingCheckInterval?: number;
  /** Pending message recovery idle threshold */
  pendingIdleThreshold?: number;
  /** Custom function to generate consumer group names */
  groupNameFn?: (pattern: string) => string;
  /** Custom function to generate consumer names */
  consumerNameFn?: () => string;
  /** Generate dedup key */
  generateDedupKey?: ({
    channel,
    payload,
    group,
    pattern,
  }: {
    channel: string;
    payload: any;
    group?: string;
    pattern?: string;
  }) => string;
  /** DLQ cleanup configuration */
  dlqCleanup?: DLQCleanupConfig;
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
  unsubscribe(removePattern?: boolean): Promise<void>;
  /** Pause message processing */
  pause(): void;
  /** Resume message processing */
  resume(): void;
  /** Whether the subscription is currently paused */
  isPaused: boolean;
  /** Get subscription statistics */
  stats(): SubscriptionStats;
  /** Stats tracker instance (internal) */
  statsTracker?: StatsTracker;
  /** Number of messages currently being processed (internal) */
  inflightCount: number;
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
  /**
   * Explicit deduplication key. When provided, this key is used instead of
   * generating a hash from the payload. This allows deduplication based on
   * business logic (e.g., order ID) rather than exact payload matching.
   *
   * @example
   * // Deduplicate by order ID instead of payload content
   * await manager.publish('orders.created', orderData, {
   *   exactlyOnce: true,
   *   dedupKey: `order-${orderData.orderId}`,
   * });
   */
  dedupKey?: string;
}

/**
 * Result of a publish operation.
 * Provides consistent return type for all publish scenarios.
 * @interface PublishResult
 */
export interface PublishResult {
  /** Whether the publish was successful */
  success: boolean;
  /** Message IDs of published messages (one per matching pattern) */
  messageIds: string[];
  /** Status of the publish operation */
  status: 'published' | 'scheduled' | 'duplicate' | 'no_subscribers';
  /** Number of patterns the message was published to */
  patternCount: number;
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
  /** Retry strategy configuration */
  retryStrategy?: RetryStrategyConfig;
}
