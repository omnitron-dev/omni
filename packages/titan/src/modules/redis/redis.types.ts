import type { Constructor, AbstractConstructor, ModuleMetadata, Token } from '../../nexus/index.js';
import type { Redis, Cluster, ClusterNode, RedisOptions, ClusterOptions } from 'ioredis';

/**
 * Redis client connection status.
 * These are the possible states of an ioredis client connection.
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
 * Extended Redis client type with status property.
 * ioredis clients have a status property that isn't in the type definitions.
 */
export interface RedisClientWithStatus extends Redis {
  readonly status: RedisClientStatus;
}

/**
 * Extended Cluster client type with status property.
 */
export interface ClusterWithStatus extends Cluster {
  readonly status: RedisClientStatus;
}

/**
 * Helper to get status from any Redis client type
 */
export function getClientStatus(client: Redis | Cluster): RedisClientStatus {
  return (client as RedisClientWithStatus).status;
}

/**
 * Check if client is ready for commands
 */
export function isClientReady(client: Redis | Cluster): boolean {
  return getClientStatus(client) === 'ready';
}

/**
 * Check if client is still alive (not ended)
 */
export function isClientAlive(client: Redis | Cluster): boolean {
  const status = getClientStatus(client);
  return status !== 'end' && status !== 'close';
}

/**
 * Check if client is connecting or connected
 */
export function isClientConnecting(client: Redis | Cluster): boolean {
  const status = getClientStatus(client);
  return status === 'connecting' || status === 'connect' || status === 'ready';
}

export interface RedisClientOptions extends RedisOptions {
  namespace?: string;
  cluster?: {
    nodes: ClusterNode[];
    options?: ClusterOptions;
  };
  onClientCreated?: (client: Redis | Cluster) => void;
}

export interface RedisModuleOptions {
  config?: RedisClientOptions;
  clients?: RedisClientOptions[];
  commonOptions?: Partial<RedisClientOptions>;
  isGlobal?: boolean;
  closeClient?: boolean;
  readyLog?: boolean;
  errorLog?: boolean;
  onError?: (error: Error, client: Redis | Cluster) => void;
  onClientCreated?: (client: Redis | Cluster) => void;
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

export type RedisClient = Redis | Cluster;

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
