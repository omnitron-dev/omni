/**
 * Service mesh infrastructure
 *
 * Components for service discovery, routing, and health checks
 */

export {
  MeshNode,
  createMeshNode,
  type MeshNodeEvents,
  type HealthStatus,
  type HealthCheck,
  type NodeMetrics,
} from './node.js';
export { Router, createRouter, type RouterEvents, type RouterStats } from './router.js';
export {
  Discovery,
  createDiscovery,
  type DiscoveryEvents,
  type DiscoveryStats,
  type ServiceInfo,
} from './discovery.js';
