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

// DI-1: token names are namespaced ('TitanHealth:*'). createToken() caches by
// bare name in a global (Symbol.for) registry, so a generic 'HealthService'
// collides with any app token of the same name — paysys already hit this and
// had to define its own 'AppHealthService' to avoid the conflict. Consumers
// import these CONSTANTS, so the rename only changes the underlying symbol id.

/**
 * Token for the main health service
 */
export const HEALTH_SERVICE_TOKEN: Token<IHealthService> = createToken<IHealthService>('TitanHealth:Service');

/**
 * Token for health module options
 */
export const HEALTH_MODULE_OPTIONS_TOKEN: Token<HealthModuleOptions> = createToken<HealthModuleOptions>('TitanHealth:ModuleOptions');

/**
 * Token for memory health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const MEMORY_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('TitanHealth:MemoryIndicator');

/**
 * Token for event loop health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const EVENT_LOOP_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('TitanHealth:EventLoopIndicator');

/**
 * Token for disk health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const DISK_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('TitanHealth:DiskIndicator');

/**
 * Token for database health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const DATABASE_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('TitanHealth:DatabaseIndicator');

/**
 * Token for redis health indicator
 *
 * @internal
 * Used internally by HealthModule for dependency injection.
 * Apps should access indicators via HealthService.
 */
export const REDIS_HEALTH_INDICATOR_TOKEN: Token<any> = createToken<any>('TitanHealth:RedisIndicator');

/**
 * Token for health RPC service (Netron)
 */
export const HEALTH_RPC_SERVICE_TOKEN: Token<HealthRpcService> = createToken<HealthRpcService>('TitanHealth:RpcService');
