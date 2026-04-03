/**
 * Health Module - Unified Health Check System
 *
 * Provides centralized health monitoring with built-in and custom indicators.
 * Uses Netron RPC for exposing health endpoints.
 *
 * @module @omnitron-dev/titan/module/health
 *
 * @example
 * ```typescript
 * import {
 *   HealthModule,
 *   HealthService,
 *   HealthIndicator,
 *   HealthRpcService,
 *   HEALTH_SERVICE_TOKEN
 * } from '@omnitron-dev/titan/module/health';
 *
 * // Configure module
 * @Module({
 *   imports: [
 *     HealthModule.forRoot({
 *       enableMemoryIndicator: true,
 *       enableEventLoopIndicator: true,
 *       enableDatabaseIndicator: true,
 *       databaseConnection: db,
 *       enableRedisIndicator: true,
 *       redisClient: redis,
 *       version: '1.0.0',
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Access via Netron RPC
 * const health = await peer.queryInterface<HealthRpcService>('Health@1.0.0');
 * const result = await health.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 *
 * // Kubernetes probes
 * const live = await health.live();   // liveness
 * const ready = await health.ready(); // readiness
 *
 * // Create custom indicator
 * class CustomHealthIndicator extends HealthIndicator {
 *   readonly name = 'custom';
 *
 *   async check(): Promise<HealthIndicatorResult> {
 *     const start = Date.now();
 *     try {
 *       await this.doCheck();
 *       return this.healthy('Custom check passed', { latency: Date.now() - start });
 *     } catch (error) {
 *       return this.unhealthy('Custom check failed', {}, error);
 *     }
 *   }
 * }
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export { TitanHealthModule } from './health.module.js';

/**
 * Alias for TitanHealthModule for consistent naming convention.
 * Recommended: Use `HealthModule` for consistency with other modules.
 */
export { TitanHealthModule as HealthModule } from './health.module.js';

// ============================================================================
// Services
// ============================================================================

export { HealthService } from './health.service.js';

// ============================================================================
// RPC Service (Netron-native)
// ============================================================================

export {
  HealthRpcService,
  type LivenessResponse,
  type ReadinessResponse,
  type HealthResponse,
  type IndicatorResponse,
  type UptimeResponse,
} from './health.rpc-service.js';

// ============================================================================
// Base Classes
// ============================================================================

export { HealthIndicator, CompositeHealthIndicator } from './health.indicator.js';

// ============================================================================
// Built-in Indicators
// ============================================================================

export {
  // System indicators
  MemoryHealthIndicator,
  EventLoopHealthIndicator,
  HighResEventLoopIndicator,
  DiskHealthIndicator,
  // Infrastructure indicators
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  // Types
  type DatabaseHealthOptions,
  type IDatabaseConnection,
  type RedisHealthOptions,
  type IRedisClient,
} from './indicators/index.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

export {
  HEALTH_SERVICE_TOKEN,
  HEALTH_MODULE_OPTIONS_TOKEN,
  HEALTH_RPC_SERVICE_TOKEN,
  // The following tokens are exported for advanced use cases but are primarily
  // intended for internal use by the HealthModule. Apps should typically access
  // indicators through the HealthService.
  MEMORY_HEALTH_INDICATOR_TOKEN,
  EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
  DISK_HEALTH_INDICATOR_TOKEN,
  DATABASE_HEALTH_INDICATOR_TOKEN,
  REDIS_HEALTH_INDICATOR_TOKEN,
} from './health.tokens.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  // Status types
  HealthStatus,

  // Result types
  HealthIndicatorResult,
  HealthCheckResult,

  // Module options
  HealthModuleOptions,
  HealthModuleAsyncOptions,
  DatabaseIndicatorOptions,
  RedisIndicatorOptions,

  // Threshold configuration
  MemoryThresholds,
  EventLoopThresholds,
  DiskThresholds,

  // Interfaces
  IHealthIndicator,
  IHealthService,
} from './health.types.js';
