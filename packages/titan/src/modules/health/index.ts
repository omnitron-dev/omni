/**
 * Health Module - Unified Health Check System
 *
 * Provides centralized health monitoring with built-in and custom indicators.
 *
 * @module titan/modules/health
 *
 * @example
 * ```typescript
 * // Import the module
 * import { TitanHealthModule, HealthService, HealthIndicator } from '@omnitron-dev/titan/module/health';
 *
 * // Use in your application module
 * @Module({
 *   imports: [
 *     TitanHealthModule.forRoot({
 *       enableMemoryIndicator: true,
 *       enableEventLoopIndicator: true,
 *       memoryThresholds: {
 *         heapDegradedThreshold: 0.7,
 *         heapUnhealthyThreshold: 0.9,
 *       },
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Create custom indicators
 * class DatabaseHealthIndicator extends HealthIndicator {
 *   readonly name = 'database';
 *
 *   async check(): Promise<HealthIndicatorResult> {
 *     const start = Date.now();
 *     try {
 *       await this.db.ping();
 *       return this.healthy('Database is connected', { latency: Date.now() - start });
 *     } catch (error) {
 *       return this.unhealthy('Database connection failed', {}, error);
 *     }
 *   }
 * }
 *
 * // Register custom indicators
 * healthService.registerIndicator(new DatabaseHealthIndicator());
 *
 * // Check health
 * const result = await healthService.check();
 * console.log(result.status); // 'healthy' | 'degraded' | 'unhealthy'
 * ```
 */

// Types
export type {
  HealthStatus,
  HealthIndicatorResult,
  HealthCheckResult,
  HealthModuleOptions,
  HealthModuleAsyncOptions,
  MemoryThresholds,
  EventLoopThresholds,
  DiskThresholds,
  IHealthIndicator,
  IHealthService,
  HealthHttpResponse,
} from './health.types.js';

// Tokens
export {
  HEALTH_SERVICE_TOKEN,
  HEALTH_MODULE_OPTIONS_TOKEN,
  HEALTH_INDICATORS_TOKEN,
  HEALTH_CONTROLLER_TOKEN,
  MEMORY_HEALTH_INDICATOR_TOKEN,
  EVENT_LOOP_HEALTH_INDICATOR_TOKEN,
  DISK_HEALTH_INDICATOR_TOKEN,
} from './health.tokens.js';

// Base classes
export { HealthIndicator, CompositeHealthIndicator } from './health.indicator.js';

// Services
export { HealthService } from './health.service.js';

// Controller
export { HealthController } from './health.controller.js';

// Module
export { TitanHealthModule } from './health.module.js';

// Built-in indicators
export {
  MemoryHealthIndicator,
  EventLoopHealthIndicator,
  HighResEventLoopIndicator,
  DiskHealthIndicator,
} from './indicators/index.js';
