/**
 * Low-level transport interface for notification delivery.
 * Abstracts the underlying messaging system (Rotif, RabbitMQ, NATS, Kafka, etc.)
 *
 * This layer provides a standardized interface for pub/sub messaging patterns
 * and sits below the high-level notification system.
 */

import type { RetryStrategyConfig } from '@omnitron-dev/titan/utils';

/**
 * Core messaging transport interface for low-level message delivery.
 * This is separate from the high-level NotificationTransport in notifications.types.ts
 */
export interface MessagingTransport {
  /** Unique identifier for this transport instance */
  readonly id: string;

  /** Transport type identifier (e.g., 'rotif', 'rabbitmq', 'nats') */
  readonly type: string;

  /**
   * Publish a message to a channel
   * @param channel - Channel name to publish to
   * @param message - Message to publish
   * @param options - Optional publishing options
   * @returns Result of the publish operation
   */
  publish(
    channel: string,
    message: NotificationMessage,
    options?: TransportPublishOptions
  ): Promise<TransportPublishResult>;

  /**
   * Subscribe to messages on a channel pattern
   * @param pattern - Channel pattern to subscribe to (supports wildcards)
   * @param handler - Function to handle incoming messages
   * @param options - Optional subscription options
   * @returns Active subscription handle
   */
  subscribe(
    pattern: string,
    handler: NotificationHandler,
    options?: TransportSubscribeOptions
  ): Promise<NotificationSubscription>;

  /**
   * Register middleware for message processing
   * @param middleware - Middleware to register
   */
  use(middleware: TransportMiddleware): void;

  /**
   * Check transport health and connectivity
   * @returns Health status information
   */
  healthCheck(): Promise<TransportHealth>;

  /**
   * Gracefully shutdown the transport
   */
  shutdown(): Promise<void>;

  /**
   * Wait until transport is fully initialized and ready
   */
  waitUntilReady?(): Promise<void>;

  /**
   * Destroy the transport and release all resources
   */
  destroy?(): Promise<void>;

  /**
   * Subscribe to Dead Letter Queue for handling failed messages
   */
  subscribeToDLQ?(handler: NotificationHandler): Promise<void>;

  /**
   * Requeue messages from DLQ back to original channels
   * @returns Number of requeued messages
   */
  requeueFromDLQ?(count?: number): Promise<number>;

  /**
   * Get DLQ statistics
   */
  getDLQStats?(): Promise<DLQStats>;

  /**
   * Get messages from DLQ with optional filtering
   */
  getDLQMessages?(options?: DLQQueryOptions): Promise<DLQMessageInfo[]>;

  /**
   * Manually trigger DLQ cleanup
   * @returns Number of cleaned messages
   */
  cleanupDLQ?(): Promise<number>;

  /**
   * Clear all messages from DLQ
   */
  clearDLQ?(): Promise<void>;

  /**
   * Update DLQ cleanup configuration
   */
  updateDLQConfig?(config: Partial<DLQCleanupConfig>): void;
}

/**
 * Options for publishing messages
 */
export interface TransportPublishOptions {
  /** Delay in milliseconds before delivery */
  delayMs?: number;

  /** Absolute timestamp for message delivery */
  deliverAt?: number | Date;

  /** Enable exactly-once delivery semantics */
  exactlyOnce?: boolean;

  /** Deduplication TTL in seconds */
  deduplicationTTL?: number;

  /** Custom deduplication key */
  dedupKey?: string;

  /** Priority level for message routing */
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  /** Maximum number of retry attempts */
  maxRetries?: number;

  /** Additional metadata to attach to the message */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a publish operation
 */
export interface TransportPublishResult {
  /** Whether the publish was successful */
  success: boolean;

  /** Message IDs of published messages */
  messageIds: string[];

  /** Status of the publish operation */
  status: 'published' | 'scheduled' | 'duplicate' | 'no_subscribers' | 'failed';

  /** Number of patterns/subscribers the message was published to */
  patternCount: number;

  /** Error message if publish failed */
  error?: string;

  /** Timestamp when the message was published */
  timestamp: number;
}

/**
 * Options for subscribing to messages
 */
export interface TransportSubscribeOptions {
  /** Custom consumer group name for load balancing */
  groupName?: string;

  /** Custom consumer name identifier */
  consumerName?: string;

  /** Starting position in the message stream */
  startFrom?: '$' | '0' | string;

  /** Maximum number of retry attempts for failed messages */
  maxRetries?: number;

  /** Retry delay in milliseconds or function to calculate delay */
  retryDelay?: number | ((attempt: number) => number);

  /** Retry strategy configuration (alternative to retryDelay) */
  retryStrategy?: RetryStrategyConfig;

  /** Whether to auto-acknowledge messages on successful processing */
  autoAck?: boolean;

  /** Prefetch count for message batching */
  prefetchCount?: number;
}

/**
 * Handler function for incoming messages
 */
export type NotificationHandler = (message: IncomingNotification) => Promise<void>;

/**
 * Incoming notification message
 */
export interface IncomingNotification {
  /** Unique message identifier */
  id: string;

  /** Channel the message was published to */
  channel: string;

  /** Message payload */
  payload: NotificationMessage;

  /** Timestamp when the message was created */
  timestamp: number;

  /** Current processing attempt number */
  attempt: number;

  /** Additional metadata attached to the message */
  metadata?: Record<string, unknown>;

  /**
   * Acknowledge the message as successfully processed
   */
  ack(): Promise<void>;

  /**
   * Negative acknowledge - reject and requeue the message
   * @param requeue - Whether to requeue the message for retry
   */
  nack?(requeue?: boolean): Promise<void>;
}

/**
 * Active subscription handle
 */
export interface NotificationSubscription {
  /** Unique subscription identifier */
  id: string;

  /** Channel pattern being subscribed to */
  pattern: string;

  /** Consumer group name */
  group: string;

  /** Whether the subscription is currently paused */
  isPaused: boolean;

  /**
   * Unsubscribe from the channel
   * @param removePattern - Whether to remove the pattern from the transport
   */
  unsubscribe(removePattern?: boolean): Promise<void>;

  /**
   * Pause message processing
   */
  pause(): void;

  /**
   * Resume message processing
   */
  resume(): void;

  /**
   * Get subscription statistics
   */
  stats(): SubscriptionStats;
}

/**
 * Statistics for a subscription
 */
export interface SubscriptionStats {
  /** Number of successfully processed messages */
  messages: number;

  /** Number of retry attempts */
  retries: number;

  /** Number of failed messages */
  failures?: number;

  /** Timestamp of the last processed message */
  lastMessageAt?: number;

  /** Number of messages currently being processed */
  inflightCount?: number;
}

/**
 * Transport health status
 */
export interface TransportHealth {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Whether the transport is connected */
  connected: boolean;

  /** Connection latency in milliseconds */
  latency?: number;

  /** Error message if unhealthy */
  error?: string;

  /** Additional transport-specific details */
  details?: Record<string, unknown>;

  /** Timestamp of the health check */
  timestamp: number;
}

/**
 * Internal message format for transport layer
 */
export interface NotificationMessage {
  /** Message type/event name */
  type: string;

  /** Message payload data */
  data: unknown;

  /** Message identifier (optional, will be generated if not provided) */
  id?: string;

  /** Message metadata */
  metadata?: Record<string, unknown>;
}

/**
 * DLQ statistics
 */
export interface DLQStats {
  totalMessages: number;
  messagesByChannel: Record<string, number>;
  oldestMessage?: number;
  newestMessage?: number;
  messagesCleanedUp: number;
  messagesArchived: number;
}

/**
 * Options for querying DLQ messages
 */
export interface DLQQueryOptions {
  channel?: string;
  limit?: number;
  offset?: number;
  maxAge?: number;
}

/**
 * DLQ message information
 */
export interface DLQMessageInfo {
  id: string;
  channel: string;
  payload: unknown;
  error?: string;
  timestamp: number;
  attempt: number;
  age: number;
}

/**
 * DLQ cleanup configuration
 */
export interface DLQCleanupConfig {
  enabled?: boolean;
  maxAge?: number;
  maxSize?: number;
  cleanupInterval?: number;
  batchSize?: number;
  archiveBeforeDelete?: boolean;
  archivePrefix?: string;
}

/**
 * Transport middleware hooks for intercepting message flow
 */
export interface TransportMiddleware {
  /** Called before publishing a message */
  beforePublish?(
    channel: string,
    message: NotificationMessage,
    options?: TransportPublishOptions
  ): void | Promise<void>;

  /** Called after publishing a message */
  afterPublish?(
    channel: string,
    message: NotificationMessage,
    result: TransportPublishResult,
    options?: TransportPublishOptions
  ): void | Promise<void>;

  /** Called before processing a received message */
  beforeProcess?(notification: IncomingNotification): void | Promise<void>;

  /** Called after successfully processing a message */
  afterProcess?(notification: IncomingNotification): void | Promise<void>;

  /** Called when an error occurs during processing */
  onError?(notification: IncomingNotification, error: Error): void | Promise<void>;
}

/**
 * Utility function to generate a UUID
 * @returns A new UUID string
 */
export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
