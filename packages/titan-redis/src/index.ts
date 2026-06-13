/**
 * Redis Module for Titan Framework
 *
 * Provides Redis client management with:
 * - Connection pooling and clustering support
 * - Health monitoring
 * - Caching, locking, and rate limiting decorators
 * - Type-safe Redis operations
 *
 * @module @omnitron-dev/titan/module/redis
 *
 * @example
 * ```typescript
 * import {
 *   RedisModule,
 *   RedisService,
 *   InjectRedis,
 *   REDIS_MANAGER
 * } from '@omnitron-dev/titan/module/redis';
 *
 * // Configure module
 * @Module({
 *   imports: [RedisModule.forRoot({ host: 'localhost', port: 6379 })]
 * })
 * class AppModule {}
 *
 * // Inject Redis client
 * @Injectable()
 * class MyService {
 *   constructor(@InjectRedis() private redis: IRedisClient) {}
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { TitanRedisModule } from './redis.module.js';

/**
 * Alias for TitanRedisModule for consistent naming convention.
 * Recommended: Use `RedisModule` for consistency with other modules.
 */
export { TitanRedisModule as RedisModule } from './redis.module.js';

// ============================================================================
// Services
// ============================================================================

export { RedisService } from './redis.service.js';
export { RedisManager } from './redis.manager.js';

// NOTE: Redis health indicators live in `@omnitron-dev/titan-health`
// (standard healthy/degraded/unhealthy format). The former non-standard
// up/down RedisHealthIndicator/HealthIndicator/HealthIndicatorResult that
// shipped here were deprecated and have been removed (RD-1).

// ============================================================================
// Decorators
// ============================================================================

export { InjectRedis, InjectRedisManager, RedisCache, RedisLock, RedisRateLimit } from './redis.decorators.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  REDIS_MANAGER,
  REDIS_MODULE_OPTIONS,
  REDIS_DEFAULT_NAMESPACE,
  getRedisClientToken,
} from './redis.constants.js';

// ============================================================================
// Types & Interfaces (Public API)
// ============================================================================

// Public interface types (abstraction layer)
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

// Public type aliases (for backward compatibility)
export type {
  RedisClient,
  RedisClientOptions,
  RedisPipeline,
  RedisModuleOptions,
  RedisModuleAsyncOptions,
  RedisOptionsFactory,
  CacheOptions,
  LockOptions,
  RateLimitOptions,
} from './redis.types.js';

// ============================================================================
// Type Guards (Public API)
// ============================================================================

export { isRedisClientReady, isRedisClientAlive, isRedisClientConnecting } from './redis.interfaces.js';

// ============================================================================
// Utilities (Public API)
// ============================================================================

export { getClientNamespace, createRetryStrategy } from './redis.utils.js';

export type { RetryStrategyOptions } from './redis.utils.js';

// ============================================================================
// Internal Exports (for use within titan package only)
// These are NOT part of the public API and may change without notice.
// ============================================================================

// Internal types for module implementation (prefixed with Internal)
export type {
  InternalRedisClient,
  InternalRedisPipeline,
  InternalRedisClientOptions,
  InternalRedisModuleOptions,
  RedisClientStatus,
  RedisClientWithStatus,
  ClusterWithStatus,
} from './redis.types.js';

// Internal type guards and utilities
export {
  getClientStatus,
  isClientReady,
  isClientAlive,
  isClientConnecting,
  toInternalClientOptions,
  toInternalModuleOptions,
} from './redis.types.js';

// Internal utilities
export {
  isCluster,
  createRedisClient,
  generateScriptSha,
  loadScriptContent,
  mergeOptions,
  waitForConnection,
} from './redis.utils.js';
