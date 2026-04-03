import type { Constructor, AbstractConstructor, ModuleMetadata, Token } from '@omnitron-dev/titan/nexus';
import type { Redis, Cluster, ClusterNode, RedisOptions, ClusterOptions, ChainableCommander } from 'ioredis';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

// Re-export public interfaces
export type {
  IRedisClient,
  IRedisClientStatus,
  IRedisClientOptions,
  IRedisClusterNode,
  IRedisClusterOptions,
  IRedisTlsOptions,
  IRedisPipeline,
  IRedisPipelineResult,
  IRedisClientEvents,
} from './redis.interfaces.js';

export { isRedisClientReady, isRedisClientAlive, isRedisClientConnecting } from './redis.interfaces.js';

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL TYPES - Not exported from module index
// These types are for internal use within the redis module implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @internal
 * Internal Redis client type that directly exposes ioredis types.
 * Use IRedisClient for public API.
 */
export type InternalRedisClient = Redis | Cluster;

/**
 * @internal
 * Internal Redis pipeline type from ioredis.
 * Use IRedisPipeline for public API.
 */
export type InternalRedisPipeline = ChainableCommander;

/**
 * @internal
 * Redis client connection status (matches ioredis status).
 */
export type RedisClientStatus =
  | 'wait' // Not connected, waiting to connect
  | 'reconnecting' // Reconnecting after disconnect
  | 'connecting' // Currently connecting
  | 'connect' // Connected but not ready
  | 'ready' // Connected and ready for commands
  | 'close' // Connection closed normally
  | 'end'; // Connection ended (will not reconnect)

/**
 * @internal
 * Extended Redis client type with status property.
 * ioredis clients have a status property that isn't in the type definitions.
 */
export interface RedisClientWithStatus extends Redis {
  readonly status: RedisClientStatus;
}

/**
 * @internal
 * Extended Cluster client type with status property.
 */
export interface ClusterWithStatus extends Cluster {
  readonly status: RedisClientStatus;
}

/**
 * @internal
 * Helper to get status from any Redis client type
 */
export function getClientStatus(client: InternalRedisClient): RedisClientStatus {
  return (client as RedisClientWithStatus).status;
}

/**
 * @internal
 * Check if client is ready for commands
 */
export function isClientReady(client: InternalRedisClient): boolean {
  return getClientStatus(client) === 'ready';
}

/**
 * @internal
 * Check if client is still alive (not ended)
 */
export function isClientAlive(client: InternalRedisClient): boolean {
  const status = getClientStatus(client);
  return status !== 'end' && status !== 'close';
}

/**
 * @internal
 * Check if client is connecting or connected
 */
export function isClientConnecting(client: InternalRedisClient): boolean {
  const status = getClientStatus(client);
  return status === 'connecting' || status === 'connect' || status === 'ready';
}

/**
 * @internal
 * Internal client options that extend ioredis RedisOptions.
 * Use IRedisClientOptions for public API.
 */
export interface InternalRedisClientOptions extends RedisOptions {
  namespace?: string;
  cluster?: {
    nodes: ClusterNode[];
    options?: ClusterOptions;
  };
  onClientCreated?: (client: InternalRedisClient) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES - These use abstraction interfaces
// ═══════════════════════════════════════════════════════════════════════════

import type { IRedisClient, IRedisClientOptions, IRedisPipeline } from './redis.interfaces.js';

/**
 * Public RedisClient type alias using the abstraction interface.
 * @public
 */
export type RedisClient = IRedisClient;

/**
 * Public RedisClientOptions type alias using the abstraction interface.
 * @public
 */
export type RedisClientOptions = IRedisClientOptions;

/**
 * Public RedisPipeline type alias using the abstraction interface.
 * @public
 */
export type RedisPipeline = IRedisPipeline;

/**
 * Redis module configuration options.
 * Uses abstraction interfaces for client-related types.
 */
export interface RedisModuleOptions {
  config?: IRedisClientOptions;
  clients?: IRedisClientOptions[];
  commonOptions?: Partial<IRedisClientOptions>;
  isGlobal?: boolean;
  closeClient?: boolean;
  readyLog?: boolean;
  errorLog?: boolean;
  /** Logger instance for RedisManager. Required for proper logging integration */
  logger?: ILogger;
  onError?: (error: Error, client: IRedisClient) => void;
  onClientCreated?: (client: IRedisClient) => void;
  onClientDestroyed?: (namespace: string) => void;
  healthCheck?: {
    enabled?: boolean;
    timeout?: number;
    interval?: number;
  };
  scripts?: Array<{
    name: string;
    path?: string;
    content?: string;
  }>;
  pool?: {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
    idleTimeoutMillis?: number;
  };
}

/**
 * @internal
 * Internal module options that use ioredis types directly.
 * Used within the module implementation.
 */
export interface InternalRedisModuleOptions {
  config?: InternalRedisClientOptions;
  clients?: InternalRedisClientOptions[];
  commonOptions?: Partial<InternalRedisClientOptions>;
  isGlobal?: boolean;
  closeClient?: boolean;
  readyLog?: boolean;
  errorLog?: boolean;
  logger?: ILogger;
  onError?: (error: Error, client: InternalRedisClient) => void;
  onClientCreated?: (client: InternalRedisClient) => void;
  onClientDestroyed?: (namespace: string) => void;
  healthCheck?: {
    enabled?: boolean;
    timeout?: number;
    interval?: number;
  };
  scripts?: Array<{
    name: string;
    path?: string;
    content?: string;
  }>;
  pool?: {
    min?: number;
    max?: number;
    acquireTimeoutMillis?: number;
    idleTimeoutMillis?: number;
  };
}

export interface RedisModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  isGlobal?: boolean;
  useExisting?: Constructor<RedisOptionsFactory>;
  useClass?: Constructor<RedisOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<RedisModuleOptions> | RedisModuleOptions;
  inject?: (Constructor<any> | AbstractConstructor<any> | Token<any> | string | symbol)[];
}

export interface RedisOptionsFactory {
  createRedisOptions(): Promise<RedisModuleOptions> | RedisModuleOptions;
}

export interface CacheOptions {
  ttl?: number;
  namespace?: string;
  key?: string | ((...args: any[]) => string);
  keyFn?: (...args: any[]) => string; // Alias for key function
  condition?: (...args: any[]) => boolean;
  refresh?: boolean;
}

export interface LockOptions {
  ttl?: number;
  namespace?: string;
  key?: string | ((...args: any[]) => string);
  keyFn?: (...args: any[]) => string; // Alias for key function
  retries?: number;
  retryDelay?: number;
}

export interface RateLimitOptions {
  points: number;
  duration: number;
  namespace?: string;
  keyPrefix?: string;
  blockDuration?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE CONVERSION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @internal
 * Convert public IRedisClientOptions to internal ioredis options
 */
export function toInternalClientOptions(options: IRedisClientOptions): InternalRedisClientOptions {
  const internal: InternalRedisClientOptions = {
    namespace: options.namespace,
    host: options.host,
    port: options.port,
    password: options.password,
    username: options.username,
    db: options.db,
    name: options.name,
    lazyConnect: options.lazyConnect,
    enableReadyCheck: options.enableReadyCheck,
    enableOfflineQueue: options.enableOfflineQueue,
    connectTimeout: options.connectTimeout,
    commandTimeout: options.commandTimeout,
    keepAlive: options.keepAlive,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    retryStrategy: options.retryStrategy,
    autoResendUnfulfilledCommands: options.autoResendUnfulfilledCommands,
    autoResubscribe: options.autoResubscribe,
    showFriendlyErrorStack: options.showFriendlyErrorStack,
    path: options.path,
  };

  // Handle TLS options
  if (options.tls) {
    internal.tls = {
      rejectUnauthorized: options.tls.rejectUnauthorized,
      ca: options.tls.ca,
      cert: options.tls.cert,
      key: options.tls.key,
    };
  }

  // Handle cluster options
  if (options.cluster) {
    internal.cluster = {
      nodes: options.cluster.nodes.map((n) => ({ host: n.host, port: n.port })),
      options: {
        enableReadyCheck: options.cluster.enableReadyCheck,
        maxRedirections: options.cluster.maxRedirections,
        retryDelayOnClusterDown: options.cluster.retryDelayOnClusterDown,
        retryDelayOnFailover: options.cluster.retryDelayOnFailover,
        retryDelayOnTryAgain: options.cluster.retryDelayOnTryAgain,
        scaleReads: options.cluster.scaleReads,
        lazyConnect: options.cluster.lazyConnect,
      },
    };
  }

  // Handle sentinel options
  if (options.sentinels) {
    internal.sentinels = options.sentinels;
    if (options.sentinelName) {
      internal.name = options.sentinelName;
    }
  }

  // Convert onClientCreated callback (internal type to public)
  if (options.onClientCreated) {
    const publicCallback = options.onClientCreated;
    internal.onClientCreated = (client: InternalRedisClient) => {
      // Cast internal client to public interface
      publicCallback(client as unknown as IRedisClient);
    };
  }

  return internal;
}

/**
 * @internal
 * Convert public RedisModuleOptions to internal options
 */
export function toInternalModuleOptions(options: RedisModuleOptions): InternalRedisModuleOptions {
  const internal: InternalRedisModuleOptions = {
    isGlobal: options.isGlobal,
    closeClient: options.closeClient,
    readyLog: options.readyLog,
    errorLog: options.errorLog,
    logger: options.logger,
    healthCheck: options.healthCheck,
    scripts: options.scripts,
    pool: options.pool,
  };

  if (options.config) {
    internal.config = toInternalClientOptions(options.config);
  }

  if (options.clients) {
    internal.clients = options.clients.map(toInternalClientOptions);
  }

  if (options.commonOptions) {
    internal.commonOptions = toInternalClientOptions(options.commonOptions as IRedisClientOptions);
  }

  // Convert callbacks
  if (options.onError) {
    const publicCallback = options.onError;
    internal.onError = (error: Error, client: InternalRedisClient) => {
      publicCallback(error, client as unknown as IRedisClient);
    };
  }

  if (options.onClientCreated) {
    const publicCallback = options.onClientCreated;
    internal.onClientCreated = (client: InternalRedisClient) => {
      publicCallback(client as unknown as IRedisClient);
    };
  }

  if (options.onClientDestroyed) {
    internal.onClientDestroyed = options.onClientDestroyed;
  }

  return internal;
}
