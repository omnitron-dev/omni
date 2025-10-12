import type { Constructor, AbstractConstructor, ModuleMetadata, Token } from '../../nexus/index.js';
import type { Redis, Cluster, ClusterNode, RedisOptions, ClusterOptions } from 'ioredis';

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
