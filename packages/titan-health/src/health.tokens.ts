/**
 * Health Module Tokens
 *
 * Dependency injection tokens for the health check system.
 *
 * @module titan/modules/health
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { IHealthService, HealthModuleOptions } from './health.types.js';
import type { HealthRpcService } from './health.rpc-service.js';

/**
 * Token for the main health service
 */
export const HEALTH_SERVICE_TOKEN: Token<IHealthService> = createToken<IHealthService>('HealthService');

/**
 * Token for health module options
 */
export const HEALTH_MODULE_OPTIONS_TOKEN: Token<HealthModuleOptions> = createToken<HealthModuleOptions>('HealthModuleOptions');

/**
 * Token for memory health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const MEMORY_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('MemoryHealthIndicator');

/**
 * Token for event loop health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const EVENT_LOOP_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('EventLoopHealthIndicator');

/**
 * Token for disk health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const DISK_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('DiskHealthIndicator');

/**
 * Token for database health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const DATABASE_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('DatabaseHealthIndicator');

/**
 * Token for redis health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const REDIS_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('RedisHealthIndicator');

/**
 * Token for health RPC service (Netron)
 */
export const HEALTH_RPC_SERVICE_TOKEN: Token<HealthRpcService> = createToken<HealthRpcService>('HealthRpcService');
