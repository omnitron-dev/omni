/**
 * Health Module Tokens
 *
 * Dependency injection tokens for the health check system.
 *
 * @module titan/modules/health
 */

import { createToken } from '../../nexus/index.js';
import type { IHealthService, HealthModuleOptions } from './health.types.js';

/**
 * Token for the main health service
 */
export const HEALTH_SERVICE_TOKEN = createToken<IHealthService>('HealthService');

/**
 * Token for health module options
 */
export const HEALTH_MODULE_OPTIONS_TOKEN = createToken<HealthModuleOptions>('HealthModuleOptions');

/**
 * Token for health indicators registry
 */
export const HEALTH_INDICATORS_TOKEN = createToken<Map<string, any>>('HealthIndicators');

/**
 * Token for memory health indicator
 */
export const MEMORY_HEALTH_INDICATOR_TOKEN = createToken<any>('MemoryHealthIndicator');

/**
 * Token for event loop health indicator
 */
export const EVENT_LOOP_HEALTH_INDICATOR_TOKEN = createToken<any>('EventLoopHealthIndicator');

/**
 * Token for disk health indicator
 */
export const DISK_HEALTH_INDICATOR_TOKEN = createToken<any>('DiskHealthIndicator');

/**
 * Token for health controller
 */
export const HEALTH_CONTROLLER_TOKEN = createToken<any>('HealthController');
