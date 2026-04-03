/**
 * Tests for ServiceRouter class
 * @module @omnitron-dev/titan/netron/multi-backend
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceRouter } from '../../../src/netron/multi-backend/service-router.js';
import type { ServiceRouterConfig, ServiceRoute, BackendStatus } from '../../../src/netron/multi-backend/types.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';

describe('ServiceRouter', () => {
  let router: ServiceRouter;

  // Helper to create mock backend status
  const createBackendStatus = (
    id: string,
    health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'healthy',
    region?: string,
    services: string[] = [],
    activeConnections = 0
  ): BackendStatus => ({
    id,
    url: `http://backend-${id}.example.com`,
    health,
    state: ConnectionState.CONNECTED,
    activeConnections,
    requestsSent: 0,
    responsesReceived: 0,
    errors: 0,
    services,
    region,
  });

  describe('Constructor and Initialization', () => {
    it('should create router with default configuration', () => {
      router = new ServiceRouter();
      const routes = router.getRoutes();
      expect(routes).toEqual([]);
    });

    it('should create router with custom configuration', () => {
      const config: ServiceRouterConfig = {
        routes: [
          { service: 'users', backends: ['backend-1'] },
          { service: 'orders', backends: ['backend-2'] },
        ],
        defaultBackends: ['backend-1'],
        defaultStrategy: 'random',
        localityAware: true,
        clientRegion: 'us-east-1',
      };

      router = new ServiceRouter(config);
      const routes = router.getRoutes();

      expect(routes).toHaveLength(2);
      expect(routes[0]?.service).toBe('users');
      expect(routes[1]?.service).toBe('orders');
    });
  });

  describe('Explicit Service Route Resolution', () => {
    beforeEach(() => {
      const config: ServiceRouterConfig = {
        routes: [
          { service: 'users', backends: ['backend-1', 'backend-2'] },
          { service: 'orders', backends: ['backend-3'] },
        ],
        defaultBackends: ['backend-1'],
      };
      router = new ServiceRouter(config);
    });

    it('should resolve by explicit service route', () => {
      const backends = [
        createBackendStatus('backend-1'),
        createBackendStatus('backend-2'),
        createBackendStatus('backend-3'),
      ];

      const selection = router.selectBackend('users', backends);

      expect(selection).not.toBeNull();
      expect(selection?.reason).toBe('route');
      expect(['backend-1', 'backend-2']).toContain(selection?.backendId);
    });

    it('should return null when no healthy backends available', () => {
      const backends = [createBackendStatus('backend-1', 'unhealthy'), createBackendStatus('backend-2', 'unhealthy')];

      const selection = router.selectBackend('users', backends);

      expect(selection).toBeNull();
    });

    it('should skip unhealthy backends in route', () => {
      const backends = [createBackendStatus('backend-1', 'unhealthy'), createBackendStatus('backend-2', 'healthy')];

      const selection = router.selectBackend('users', backends);

      expect(selection).not.toBeNull();
      expect(selection?.backendId).toBe('backend-2');
    });
  });

  describe('Wildcard Pattern Matching', () => {
    beforeEach(() => {
      const config: ServiceRouterConfig = {
        routes: [
          { service: 'api.*', backends: ['api-backend'] },
          { service: 'internal.*', backends: ['internal-backend'] },
          { service: '*.legacy', backends: ['legacy-backend'] },
        ],
        defaultBackends: ['default-backend'],
      };
      router = new ServiceRouter(config);
    });

    it('should handle wildcard patterns with prefix', () => {
      const backends = [createBackendStatus('api-backend'), createBackendStatus('default-backend')];

      const selection = router.selectBackend('api.users', backends);

      expect(selection?.backendId).toBe('api-backend');
      expect(selection?.reason).toBe('route');
    });

    it('should handle wildcard patterns with suffix', () => {
      const backends = [createBackendStatus('legacy-backend'), createBackendStatus('default-backend')];

      const selection = router.selectBackend('orders.legacy', backends);

      expect(selection?.backendId).toBe('legacy-backend');
      expect(selection?.reason).toBe('route');
    });

    it('should not match non-matching patterns', () => {
      const backends = [
        createBackendStatus('api-backend'),
        createBackendStatus('internal-backend'),
        createBackendStatus('default-backend'),
      ];

      const selection = router.selectBackend('external.service', backends);

      expect(selection?.backendId).toBe('default-backend');
      expect(selection?.reason).toBe('default');
    });
  });

  describe('Default Backend Fallback', () => {
    beforeEach(() => {
      const config: ServiceRouterConfig = {
        routes: [{ service: 'users', backends: ['backend-1'] }],
        defaultBackends: ['default-1', 'default-2'],
      };
      router = new ServiceRouter(config);
    });

    it('should fall back to default backends for unmatched services', () => {
      const backends = [
        createBackendStatus('backend-1'),
        createBackendStatus('default-1'),
        createBackendStatus('default-2'),
      ];

      const selection = router.selectBackend('unknown-service', backends);

      expect(selection).not.toBeNull();
      expect(selection?.reason).toBe('default');
      expect(['default-1', 'default-2']).toContain(selection?.backendId);
    });

    it('should fall back when route backends are unhealthy', () => {
      const backends = [createBackendStatus('backend-1', 'unhealthy'), createBackendStatus('default-1')];

      const config: ServiceRouterConfig = {
        routes: [{ service: 'users', backends: ['backend-1'], fallback: ['default-1'] }],
        defaultBackends: ['default-1'],
      };
      router = new ServiceRouter(config);

      const selection = router.selectBackend('users', backends);

      expect(selection?.backendId).toBe('default-1');
      expect(selection?.reason).toBe('fallback');
    });

    it('should use all available backends when defaultBackends is empty', () => {
      const config: ServiceRouterConfig = {
        routes: [],
        defaultBackends: [],
      };
      router = new ServiceRouter(config);

      const backends = [createBackendStatus('any-backend-1'), createBackendStatus('any-backend-2')];

      const selection = router.selectBackend('any-service', backends);

      expect(selection?.reason).toBe('default');
      expect(['any-backend-1', 'any-backend-2']).toContain(selection?.backendId);
    });
  });

  describe('Load Balancing Strategies', () => {
    describe('Round-Robin', () => {
      beforeEach(() => {
        const config: ServiceRouterConfig = {
          routes: [
            {
              service: 'test',
              backends: ['backend-1', 'backend-2', 'backend-3'],
              strategy: 'round-robin',
            },
          ],
        };
        router = new ServiceRouter(config);
      });

      it('should distribute requests in round-robin order', () => {
        const backends = [
          createBackendStatus('backend-1'),
          createBackendStatus('backend-2'),
          createBackendStatus('backend-3'),
        ];

        const selections: string[] = [];
        for (let i = 0; i < 6; i++) {
          const selection = router.selectBackend('test', backends);
          if (selection) {
            selections.push(selection.backendId);
          }
        }

        // Should cycle through all backends
        expect(selections).toHaveLength(6);
        expect(selections.filter((s) => s === 'backend-1')).toHaveLength(2);
        expect(selections.filter((s) => s === 'backend-2')).toHaveLength(2);
        expect(selections.filter((s) => s === 'backend-3')).toHaveLength(2);
      });
    });

    describe('Random', () => {
      beforeEach(() => {
        const config: ServiceRouterConfig = {
          routes: [
            {
              service: 'test',
              backends: ['backend-1', 'backend-2'],
              strategy: 'random',
            },
          ],
        };
        router = new ServiceRouter(config);
      });

      it('should select from available backends randomly', () => {
        const backends = [createBackendStatus('backend-1'), createBackendStatus('backend-2')];

        // Make multiple selections and verify all are valid
        for (let i = 0; i < 10; i++) {
          const selection = router.selectBackend('test', backends);
          expect(selection).not.toBeNull();
          expect(['backend-1', 'backend-2']).toContain(selection?.backendId);
        }
      });
    });

    describe('Least Connections', () => {
      beforeEach(() => {
        const config: ServiceRouterConfig = {
          routes: [
            {
              service: 'test',
              backends: ['backend-1', 'backend-2', 'backend-3'],
              strategy: 'least-connections',
            },
          ],
        };
        router = new ServiceRouter(config);
      });

      it('should select backend with least connections', () => {
        const backends = [
          createBackendStatus('backend-1', 'healthy', undefined, [], 10),
          createBackendStatus('backend-2', 'healthy', undefined, [], 5),
          createBackendStatus('backend-3', 'healthy', undefined, [], 15),
        ];

        const selection = router.selectBackend('test', backends);

        expect(selection?.backendId).toBe('backend-2');
      });

      it('should use tracked connection counts', () => {
        const backends = [
          createBackendStatus('backend-1', 'healthy', undefined, [], 0),
          createBackendStatus('backend-2', 'healthy', undefined, [], 0),
        ];

        // Update connection counts via router
        router.updateConnectionCount('backend-1', 10);
        router.updateConnectionCount('backend-2', 5);

        const selection = router.selectBackend('test', backends);

        expect(selection?.backendId).toBe('backend-2');
      });
    });

    describe('Weighted', () => {
      beforeEach(() => {
        const config: ServiceRouterConfig = {
          routes: [
            {
              service: 'test',
              backends: ['backend-1', 'backend-2'],
              strategy: 'weighted',
            },
          ],
        };
        router = new ServiceRouter(config);
      });

      it('should select from available backends', () => {
        const backends = [createBackendStatus('backend-1'), createBackendStatus('backend-2')];

        // Weighted falls back to random currently
        const selection = router.selectBackend('test', backends);

        expect(selection).not.toBeNull();
        expect(['backend-1', 'backend-2']).toContain(selection?.backendId);
      });
    });
  });

  describe('Locality-Aware Routing', () => {
    beforeEach(() => {
      const config: ServiceRouterConfig = {
        routes: [
          {
            service: 'test',
            backends: ['us-east-1', 'us-west-2', 'eu-west-1'],
          },
        ],
        localityAware: true,
        clientRegion: 'us-east-1',
      };
      router = new ServiceRouter(config);
    });

    it('should prefer backends in same region when locality-aware', () => {
      const backends = [
        createBackendStatus('us-east-1', 'healthy', 'us-east-1'),
        createBackendStatus('us-west-2', 'healthy', 'us-west-2'),
        createBackendStatus('eu-west-1', 'healthy', 'eu-west-1'),
      ];

      const selection = router.selectBackend('test', backends, { clientRegion: 'us-east-1' });

      expect(selection?.backendId).toBe('us-east-1');
    });

    it('should fall back to other regions when local backends unavailable', () => {
      const backends = [
        createBackendStatus('us-east-1', 'unhealthy', 'us-east-1'),
        createBackendStatus('us-west-2', 'healthy', 'us-west-2'),
        createBackendStatus('eu-west-1', 'healthy', 'eu-west-1'),
      ];

      const selection = router.selectBackend('test', backends, { clientRegion: 'us-east-1' });

      expect(selection).not.toBeNull();
      expect(['us-west-2', 'eu-west-1']).toContain(selection?.backendId);
    });
  });

  describe('Dynamic Route Updates', () => {
    beforeEach(() => {
      router = new ServiceRouter();
    });

    it('should add routes dynamically', () => {
      const route: ServiceRoute = {
        service: 'new-service',
        backends: ['backend-1'],
      };

      router.addRoute(route);
      const routes = router.getRoutes();

      expect(routes).toHaveLength(1);
      expect(routes[0]?.service).toBe('new-service');
    });

    it('should remove routes dynamically', () => {
      router.addRoute({ service: 'service-1', backends: ['backend-1'] });
      router.addRoute({ service: 'service-2', backends: ['backend-2'] });

      const removed = router.removeRoute('service-1');
      const routes = router.getRoutes();

      expect(removed).toBe(true);
      expect(routes).toHaveLength(1);
      expect(routes[0]?.service).toBe('service-2');
    });

    it('should return false when removing non-existent route', () => {
      const removed = router.removeRoute('non-existent');
      expect(removed).toBe(false);
    });

    it('should update configuration', () => {
      const backends = [createBackendStatus('backend-1'), createBackendStatus('backend-2')];

      router.updateConfig({
        defaultBackends: ['backend-2'],
        defaultStrategy: 'random',
      });

      const selection = router.selectBackend('any-service', backends);

      expect(selection?.backendId).toBe('backend-2');
    });
  });

  describe('Counter Reset', () => {
    it('should reset round-robin and connection counters', () => {
      const config: ServiceRouterConfig = {
        routes: [
          {
            service: 'test',
            backends: ['backend-1', 'backend-2'],
            strategy: 'round-robin',
          },
        ],
      };
      router = new ServiceRouter(config);

      const backends = [createBackendStatus('backend-1'), createBackendStatus('backend-2')];

      // Make some selections to increment counter
      router.selectBackend('test', backends);
      router.selectBackend('test', backends);

      // Update connection counts
      router.incrementConnections('backend-1');
      router.incrementConnections('backend-1');

      // Reset counters
      router.resetCounters();

      // Next selection should start from beginning
      const selection = router.selectBackend('test', backends);
      expect(selection?.backendId).toBe('backend-1');
    });
  });

  describe('Connection Count Management', () => {
    beforeEach(() => {
      router = new ServiceRouter();
    });

    it('should increment connection count', () => {
      router.incrementConnections('backend-1');
      router.incrementConnections('backend-1');

      // Verify by using least-connections strategy
      const config: ServiceRouterConfig = {
        routes: [
          {
            service: 'test',
            backends: ['backend-1', 'backend-2'],
            strategy: 'least-connections',
          },
        ],
      };
      router.updateConfig(config);

      const backends = [
        createBackendStatus('backend-1', 'healthy', undefined, [], 0),
        createBackendStatus('backend-2', 'healthy', undefined, [], 0),
      ];

      const selection = router.selectBackend('test', backends);
      expect(selection?.backendId).toBe('backend-2');
    });

    it('should decrement connection count', () => {
      router.updateConnectionCount('backend-1', 5);
      router.decrementConnections('backend-1');
      router.decrementConnections('backend-1');

      // Connection count should be 3 now
      const config: ServiceRouterConfig = {
        routes: [
          {
            service: 'test',
            backends: ['backend-1', 'backend-2'],
            strategy: 'least-connections',
          },
        ],
      };
      router.updateConfig(config);

      const backends = [
        createBackendStatus('backend-1', 'healthy', undefined, [], 0),
        createBackendStatus('backend-2', 'healthy', undefined, [], 4),
      ];

      const selection = router.selectBackend('test', backends);
      expect(selection?.backendId).toBe('backend-1');
    });

    it('should not decrement below zero', () => {
      router.decrementConnections('backend-1');
      router.decrementConnections('backend-1');

      // Should remain at 0
      const config: ServiceRouterConfig = {
        routes: [
          {
            service: 'test',
            backends: ['backend-1', 'backend-2'],
            strategy: 'least-connections',
          },
        ],
      };
      router.updateConfig(config);

      const backends = [
        createBackendStatus('backend-1', 'healthy', undefined, [], 0),
        createBackendStatus('backend-2', 'healthy', undefined, [], 1),
      ];

      const selection = router.selectBackend('test', backends);
      expect(selection?.backendId).toBe('backend-1');
    });
  });

  describe('Forced Backend Selection', () => {
    beforeEach(() => {
      const config: ServiceRouterConfig = {
        routes: [{ service: 'test', backends: ['backend-1', 'backend-2'] }],
      };
      router = new ServiceRouter(config);
    });

    it('should use forced backend when specified', () => {
      const backends = [
        createBackendStatus('backend-1'),
        createBackendStatus('backend-2'),
        createBackendStatus('backend-3'),
      ];

      const selection = router.selectBackend('test', backends, {
        forcedBackendId: 'backend-3',
      });

      expect(selection?.backendId).toBe('backend-3');
      expect(selection?.reason).toBe('forced');
    });

    it('should ignore forced backend if unhealthy', () => {
      const backends = [
        createBackendStatus('backend-1'),
        createBackendStatus('backend-2'),
        createBackendStatus('backend-3', 'unhealthy'),
      ];

      const selection = router.selectBackend('test', backends, {
        forcedBackendId: 'backend-3',
      });

      // Should fall back to route selection since forced backend is unhealthy
      expect(selection?.reason).toBe('route');
      expect(['backend-1', 'backend-2']).toContain(selection?.backendId);
    });

    it('should provide alternatives for forced backend', () => {
      const backends = [
        createBackendStatus('backend-1'),
        createBackendStatus('backend-2'),
        createBackendStatus('backend-3'),
      ];

      const selection = router.selectBackend('test', backends, {
        forcedBackendId: 'backend-1',
      });

      expect(selection?.alternatives).toBeDefined();
      expect(selection?.alternatives).toContain('backend-2');
    });
  });
});
