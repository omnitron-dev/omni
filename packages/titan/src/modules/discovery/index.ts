/**
 * Discovery Module Exports
 *
 * Public API for the Titan Discovery Module
 */

// Types
export type { NodeInfo, ServiceInfo, DiscoveryOptions, DiscoveryEvent, IDiscoveryService } from './types.js';

// Tokens
export { DISCOVERY_SERVICE_TOKEN, REDIS_TOKEN, LOGGER_TOKEN, DISCOVERY_OPTIONS_TOKEN } from './types.js';

// Service and Module
export { DiscoveryService } from './discovery.service.js';

export {
  DiscoveryModule,
  DiscoveryModuleToken,
  NETRON_DISCOVERY_INTEGRATION_TOKEN,
  createDiscoveryModule,
  type DiscoveryModuleOptions,
} from './discovery.module.js';

// Netron-Discovery Integration
export { NetronDiscoveryIntegration, type NetronDiscoveryIntegrationOptions } from './netron-integration.js';
