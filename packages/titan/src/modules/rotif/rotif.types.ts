/**
 * Rotif Module Types
 *
 * Type definitions for the Rotif messaging module integration.
 */

import type { RedisOptions } from 'ioredis';
import type { Constructor, AbstractConstructor, ModuleMetadata, Token } from '../../nexus/index.js';
import type { RotifConfig, RotifLogger, RotifMessage, Subscription, SubscribeOptions } from '../../rotif/types.js';
import type { RetryStrategyConfig } from '../../rotif/retry-strategies.js';
import type { DLQCleanupConfig } from '../../rotif/dlq-manager.js';

/**
 * Options for configuring the Rotif module.
 * Extends the base RotifConfig with module-specific options.
 */
export interface RotifModuleOptions {
  /**
   * Redis connection configuration.
   * Can be a Redis options object or a connection string.
   */
  redis: RedisOptions | string;

  /**
   * Custom logger implementation
   */
  logger?: RotifLogger;

  /**
   * Disable delayed message delivery
   * @default false
   */
  disableDelayed?: boolean;

  /**
   * Interval in milliseconds to check for delayed messages
   * @default 1000
   */
  checkDelayInterval?: number;

  /**
   * Maximum number of retry attempts for failed messages
   * @default 5
   */
  maxRetries?: number;

  /**
   * Maximum length of Redis streams
   */
  maxStreamLength?: number;

  /**
   * Minimum stream ID to keep when trimming
   */
  minStreamId?: string;

  /**
   * Block interval in milliseconds for stream reading
   * @default 5000
   */
  blockInterval?: number;

  /**
   * Deduplication TTL (seconds) for exactly-once delivery
   * @default 3600
   */
  deduplicationTTL?: number;

  /**
   * Maximum number of messages to move from scheduled to stream
   * @default 1000
   */
  scheduledBatchSize?: number;

  /**
   * Retry delay in milliseconds or function to calculate delay
   * @default 1000
   */
  retryDelay?: number | ((attempt: number, msg: RotifMessage) => number);

  /**
   * Retry strategy configuration
   */
  retryStrategy?: RetryStrategyConfig;

  /**
   * Enable local round-robin among subscribers
   * @default false
   */
  localRoundRobin?: boolean;

  /**
   * Disable pending message recovery
   * @default false
   */
  disablePendingMessageRecovery?: boolean;

  /**
   * Pending message recovery check interval
   * @default 30000
   */
  pendingCheckInterval?: number;

  /**
   * Pending message recovery idle threshold
   * @default 60000
   */
  pendingIdleThreshold?: number;

  /**
   * Custom function to generate consumer group names
   */
  groupNameFn?: (pattern: string) => string;

  /**
   * Custom function to generate consumer names
   */
  consumerNameFn?: () => string;

  /**
   * Custom function to generate deduplication keys
   */
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

  /**
   * DLQ cleanup configuration
   */
  dlqCleanup?: DLQCleanupConfig;

  /**
   * Whether to register this module globally
   * @default false
   */
  isGlobal?: boolean;

  /**
   * Whether to automatically discover and register decorated handlers
   * @default true
   */
  autoRegisterHandlers?: boolean;
}

/**
 * Factory interface for creating Rotif options asynchronously.
 */
export interface RotifOptionsFactory {
  createRotifOptions(): Promise<RotifModuleOptions> | RotifModuleOptions;
}

/**
 * Async options for configuring the Rotif module.
 */
export interface RotifModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Whether to register this module globally
   */
  isGlobal?: boolean;

  /**
   * Use an existing provider that implements RotifOptionsFactory
   */
  useExisting?: Constructor<RotifOptionsFactory>;

  /**
   * Create a new instance of a class that implements RotifOptionsFactory
   */
  useClass?: Constructor<RotifOptionsFactory>;

  /**
   * Factory function to create options
   */
  useFactory?: (...args: any[]) => Promise<RotifModuleOptions> | RotifModuleOptions;

  /**
   * Dependencies to inject into the factory function
   */
  inject?: (Constructor<any> | AbstractConstructor<any> | Token<any> | string | symbol)[];
}

/**
 * Handler metadata for decorated subscription methods.
 */
export interface RotifHandlerMetadata {
  /**
   * The class instance containing the handler
   */
  instance: any;

  /**
   * The method name on the instance
   */
  methodName: string;

  /**
   * Channel pattern to subscribe to
   */
  pattern: string;

  /**
   * Subscription options
   */
  options: SubscribeOptions;

  /**
   * The active subscription (set after subscription is created)
   */
  subscription?: Subscription;
}

/**
 * Interface for handler discovery service.
 */
export interface IRotifHandlerDiscovery {
  /**
   * Discover all handlers decorated with @Subscribe
   */
  discoverHandlers(): RotifHandlerMetadata[];

  /**
   * Register all discovered handlers with the NotificationManager
   */
  registerHandlers(manager: any): Promise<void>;
}

/**
 * Type for the RotifConfig used internally.
 * Converts RotifModuleOptions to RotifConfig format.
 */
export type InternalRotifConfig = RotifConfig;
