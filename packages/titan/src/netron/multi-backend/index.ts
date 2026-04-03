/**
 * Multi-Backend Client System
 *
 * Provides intelligent routing, load balancing, and failover across
 * multiple Netron backend servers. Isomorphic API design compatible
 * with the browser version.
 *
 * @module @omnitron-dev/titan/netron/multi-backend
 *
 * @example
 * ```typescript
 * import {
 *   MultiBackendClient,
 *   createMultiBackendClient
 * } from '@omnitron-dev/titan/netron/multi-backend';
 *
 * // Create client with multiple backends
 * const client = createMultiBackendClient({
 *   backends: [
 *     { id: 'primary', url: 'http://primary:3000', services: ['UserService'] },
 *     { id: 'secondary', url: 'http://secondary:3000', services: ['OrderService'] },
 *     { id: 'fallback', url: 'http://fallback:3000' },
 *   ],
 *   router: {
 *     routes: [
 *       { service: 'UserService', backends: ['primary'], fallback: ['fallback'] },
 *       { service: 'OrderService', backends: ['secondary'], fallback: ['fallback'] },
 *     ],
 *     defaultBackends: ['fallback'],
 *     defaultStrategy: 'round-robin',
 *   },
 *   healthChecks: true,
 *   failover: true,
 * });
 *
 * // Connect and use
 * await client.connect();
 *
 * // Invoke service method (automatically routed)
 * const user = await client.invoke('UserService', 'getUser', [userId]);
 *
 * // Or use type-safe service proxy
 * const userService = client.service<UserServiceInterface>('UserService');
 * const user = await userService.getUser(userId);
 *
 * // Get metrics
 * const metrics = client.getMetrics();
 * console.log(`Total requests: ${metrics.totalRequests}`);
 * console.log(`Total failovers: ${metrics.totalFailovers}`);
 *
 * // Cleanup
 * await client.dispose();
 * ```
 */

// Main client
export { MultiBackendClient, createMultiBackendClient } from './multi-backend-client.js';

// Backend management
export { BackendClient } from './backend-client.js';
export { BackendPool } from './backend-pool.js';

// Routing
export { ServiceRouter } from './service-router.js';

// Types
export * from './types.js';

// Re-export event types
export type { BackendClientEvents } from './backend-client.js';
export type { BackendPoolEvents } from './backend-pool.js';
export type { MultiBackendClientEvents } from './multi-backend-client.js';
