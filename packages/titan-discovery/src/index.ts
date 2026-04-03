/**
 * Discovery Module for Titan Framework
 *
 * Provides service discovery and registration capabilities with:
 * - Redis-based service registry
 * - Health-based service filtering
 * - Netron RPC integration
 *
 * @module @omnitron-dev/titan/module/discovery
 *
 * @example
 * ```typescript
 * import {
 *   DiscoveryModule,
 *   DiscoveryService,
 *   DISCOVERY_SERVICE_TOKEN
 * } from '@omnitron-dev/titan/module/discovery';
 *
 * // Configure module
 * @Module({
 *   imports: [
 *     DiscoveryModule.forRoot({
 *       serviceName: 'my-service',
 *       redis: { host: 'localhost', port: 6379 }
 *     })
 *   ]
 * })
 * class AppModule {}
 * ```
 */

// ============================================================================
// Module
// ============================================================================

export {
  DiscoveryModule,
  DiscoveryModuleToken,
  NETRON_DISCOVERY_INTEGRATION_TOKEN,
  createDiscoveryModule,
} from './discovery.module.js';

// ============================================================================
// Services
// ============================================================================

export { DiscoveryService } from './discovery.service.js';

// ============================================================================
// Integrations
// ============================================================================

export { NetronDiscoveryIntegration } from './netron-integration.js';

// ============================================================================
// Tokens (for DI)
// ============================================================================

// Note: LOGGER_TOKEN is NOT exported here to maintain module isolation.
// Import LOGGER_TOKEN from '@omnitron-dev/titan/module/logger' instead.
export { DISCOVERY_SERVICE_TOKEN, REDIS_TOKEN, DISCOVERY_OPTIONS_TOKEN } from './types.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type {
  // Core types
  NodeInfo,
  ServiceInfo,
  DiscoveryOptions,
  DiscoveryEvent,

  // Service interface
  IDiscoveryService,
} from './types.js';

export type { DiscoveryModuleOptions } from './discovery.module.js';

export type { NetronDiscoveryIntegrationOptions } from './netron-integration.js';
