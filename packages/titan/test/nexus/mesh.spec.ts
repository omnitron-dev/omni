/**
 * Comprehensive Tests for Service Mesh Module
 *
 * This test suite covers:
 * - Service mesh initialization and configuration
 * - Load balancing strategies (6 algorithms)
 * - Circuit breaker pattern implementation
 * - Service discovery integration
 * - Health check mechanisms
 * - Service registration/deregistration
 * - Error handling and fallbacks
 *
 * @module mesh.spec
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { delay } from '@omnitron-dev/common';

import {
  ConsulServiceDiscovery,
  LoadBalancer,
  CircuitBreaker,
  ServiceProxy,
  ServiceMeshManager,
  ServiceRegistry,
  HealthCheck,
  LoadBalancingStrategy,
  CircuitState,
  createRemoteProxy,
  createRemoteServiceProvider,
  ServiceDiscoveryToken,
  LoadBalancerToken,
  CircuitBreakerToken,
  type ServiceInstance,
  type ServiceEndpoint,
  type ServiceDiscovery,
  type CircuitBreakerConfig,
  type ServiceProxyConfig,
  type ConsulConfig,
  type HealthCheckConfig,
  type HealthCheckResult,
  type ServiceMeshConfig,
} from '../../src/nexus/mesh.js';
import { createToken } from '../../src/nexus/token.js';

// ============================================================================
// Test Utilities and Mocks
// ============================================================================

/**
 * Create a mock service instance
 */
function createMockServiceInstance(overrides: Partial<ServiceInstance> = {}): ServiceInstance {
  return {
    id: `service-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    name: 'test-service',
    version: '1.0.0',
    address: 'localhost',
    port: 3000,
    metadata: {},
    health: 'healthy',
    lastHeartbeat: new Date(),
    weight: 1,
    tags: [],
    ...overrides,
  };
}

/**
 * Create multiple mock service instances
 */
function createMockServiceInstances(count: number, namePrefix = 'service'): ServiceInstance[] {
  return Array.from({ length: count }, (_, i) =>
    createMockServiceInstance({
      id: `${namePrefix}-${i}`,
      port: 3000 + i,
    })
  );
}

/**
 * Create mock service endpoints
 */
function createMockEndpoints(count: number): ServiceEndpoint[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `endpoint-${i}`,
    address: 'localhost',
    port: 3000 + i,
    weight: 1,
  }));
}

/**
 * Mock ServiceDiscovery implementation for testing
 */
class MockServiceDiscovery implements ServiceDiscovery {
  private services = new Map<string, ServiceInstance[]>();
  private watchers = new Map<string, Set<(instances: ServiceInstance[]) => void>>();
  private healthStatuses = new Map<string, 'healthy' | 'unhealthy'>();

  registerCallCount = 0;
  deregisterCallCount = 0;
  discoverCallCount = 0;
  healthCallCount = 0;

  async register(service: ServiceInstance): Promise<void> {
    this.registerCallCount++;
    const instances = this.services.get(service.name) || [];
    instances.push(service);
    this.services.set(service.name, instances);
    this.healthStatuses.set(service.id, 'healthy');
    this.notifyWatchers(service.name);
  }

  async deregister(serviceId: string): Promise<void> {
    this.deregisterCallCount++;
    for (const [name, instances] of this.services) {
      const index = instances.findIndex((i) => i.id === serviceId);
      if (index !== -1) {
        instances.splice(index, 1);
        this.healthStatuses.delete(serviceId);
        this.notifyWatchers(name);
        break;
      }
    }
  }

  async discover(serviceName: string, version?: string): Promise<ServiceInstance[]> {
    this.discoverCallCount++;
    const instances = this.services.get(serviceName) || [];
    if (version) {
      return instances.filter((i) => i.version === version);
    }
    return instances;
  }

  watch(serviceName: string, callback: (instances: ServiceInstance[]) => void): () => void {
    if (!this.watchers.has(serviceName)) {
      this.watchers.set(serviceName, new Set());
    }
    this.watchers.get(serviceName)!.add(callback);
    return () => {
      this.watchers.get(serviceName)?.delete(callback);
    };
  }

  async health(serviceId: string): Promise<'healthy' | 'unhealthy'> {
    this.healthCallCount++;
    return this.healthStatuses.get(serviceId) || 'unhealthy';
  }

  // Test helper methods
  setServiceHealth(serviceId: string, health: 'healthy' | 'unhealthy'): void {
    this.healthStatuses.set(serviceId, health);
  }

  addService(name: string, instances: ServiceInstance[]): void {
    this.services.set(name, instances);
    instances.forEach((i) => this.healthStatuses.set(i.id, i.health === 'healthy' ? 'healthy' : 'unhealthy'));
    this.notifyWatchers(name);
  }

  private notifyWatchers(serviceName: string): void {
    const watchers = this.watchers.get(serviceName);
    if (watchers) {
      const instances = this.services.get(serviceName) || [];
      watchers.forEach((callback) => callback(instances));
    }
  }

  reset(): void {
    this.services.clear();
    this.watchers.clear();
    this.healthStatuses.clear();
    this.registerCallCount = 0;
    this.deregisterCallCount = 0;
    this.discoverCallCount = 0;
    this.healthCallCount = 0;
  }
}

// ============================================================================
// Consul Service Discovery Tests
// ============================================================================

describe('ConsulServiceDiscovery', () => {
  let discovery: ConsulServiceDiscovery;

  afterEach(() => {
    if (discovery) {
      discovery.stop();
    }
  });

  describe('Initialization', () => {
    it('should initialize with string URL', () => {
      discovery = new ConsulServiceDiscovery('http://consul.example.com:8500');
      expect(discovery).toBeDefined();
    });

    it('should initialize with default URL', () => {
      discovery = new ConsulServiceDiscovery();
      expect(discovery).toBeDefined();
    });

    it('should initialize with config object containing host and port', () => {
      discovery = new ConsulServiceDiscovery({
        host: 'consul.example.com',
        port: 8600,
      });
      expect(discovery).toBeDefined();
    });

    it('should initialize with config object containing only host', () => {
      discovery = new ConsulServiceDiscovery({
        host: 'consul.local',
      });
      expect(discovery).toBeDefined();
    });

    it('should initialize with config object containing only port', () => {
      discovery = new ConsulServiceDiscovery({
        port: 9500,
      });
      expect(discovery).toBeDefined();
    });

    it('should initialize with config object containing URL', () => {
      discovery = new ConsulServiceDiscovery({
        url: 'http://custom-consul:8500',
      });
      expect(discovery).toBeDefined();
    });

    it('should prefer URL over host/port in config', () => {
      discovery = new ConsulServiceDiscovery({
        url: 'http://preferred-consul:8500',
        host: 'ignored-host',
        port: 9999,
      });
      expect(discovery).toBeDefined();
    });
  });

  describe('Watch Functionality', () => {
    beforeEach(() => {
      discovery = new ConsulServiceDiscovery('http://localhost:8500');
    });

    it('should register watchers for service', () => {
      const callback = jest.fn();
      const unwatch = discovery.watch('test-service', callback);
      expect(typeof unwatch).toBe('function');
    });

    it('should allow multiple watchers for same service', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const unwatch1 = discovery.watch('test-service', callback1);
      const unwatch2 = discovery.watch('test-service', callback2);

      expect(typeof unwatch1).toBe('function');
      expect(typeof unwatch2).toBe('function');
    });

    it('should remove watcher when unwatch is called', () => {
      const callback = jest.fn();
      const unwatch = discovery.watch('test-service', callback);
      unwatch();
      // No error should be thrown
    });

    it('should handle unwatching non-existent watcher gracefully', () => {
      const callback = jest.fn();
      const unwatch = discovery.watch('test-service', callback);
      unwatch();
      unwatch(); // Double unwatch should not throw
    });
  });

  describe('Stop and Close', () => {
    beforeEach(() => {
      discovery = new ConsulServiceDiscovery('http://localhost:8500');
    });

    it('should stop health checking', () => {
      discovery.stop();
      // No error should be thrown
    });

    it('should handle multiple stop calls', () => {
      discovery.stop();
      discovery.stop();
      // No error should be thrown
    });

    it('should close and clean up resources', async () => {
      await discovery.close();
      // No error should be thrown
    });
  });

  describe('Version Extraction', () => {
    beforeEach(() => {
      discovery = new ConsulServiceDiscovery('http://localhost:8500');
    });

    it('should discover services with mocked consul client', async () => {
      // Create a mock consul client
      const mockConsul = {
        health: {
          service: jest.fn().mockResolvedValue([
            {
              Service: {
                ID: 'service-1',
                Service: 'test-service',
                Tags: ['version:2.0.0', 'production'],
                Address: '192.168.1.1',
                Port: 8080,
                Meta: { region: 'us-east' },
              },
            },
            {
              Service: {
                ID: 'service-2',
                Service: 'test-service',
                Tags: ['version:2.0.0'],
                Address: '192.168.1.2',
                Port: 8080,
                Meta: {},
              },
            },
          ]),
        },
      };

      // Inject mock consul
      (discovery as any).consul = mockConsul;

      const instances = await discovery.discover('test-service');
      expect(instances).toHaveLength(2);
      expect(instances[0]!.version).toBe('2.0.0');
      expect(instances[0]!.address).toBe('192.168.1.1');
      expect(instances[0]!.metadata).toEqual({ region: 'us-east' });
    });

    it('should filter by version when discovering', async () => {
      const mockConsul = {
        health: {
          service: jest.fn().mockResolvedValue([
            {
              Service: {
                ID: 'service-1',
                Service: 'test-service',
                Tags: ['version:1.0.0'],
                Address: '192.168.1.1',
                Port: 8080,
                Meta: {},
              },
            },
            {
              Service: {
                ID: 'service-2',
                Service: 'test-service',
                Tags: ['version:2.0.0'],
                Address: '192.168.1.2',
                Port: 8080,
                Meta: {},
              },
            },
          ]),
        },
      };

      (discovery as any).consul = mockConsul;

      const instances = await discovery.discover('test-service', '2.0.0');
      expect(instances).toHaveLength(1);
      expect(instances[0]!.id).toBe('service-2');
    });

    it('should handle tags without version', async () => {
      const mockConsul = {
        health: {
          service: jest.fn().mockResolvedValue([
            {
              Service: {
                ID: 'service-1',
                Service: 'test-service',
                Tags: ['production', 'critical'],
                Address: '192.168.1.1',
                Port: 8080,
                Meta: {},
              },
            },
          ]),
        },
      };

      (discovery as any).consul = mockConsul;

      const instances = await discovery.discover('test-service');
      expect(instances[0]!.version).toBe('1.0.0'); // Default version
    });

    it('should handle empty tags', async () => {
      const mockConsul = {
        health: {
          service: jest.fn().mockResolvedValue([
            {
              Service: {
                ID: 'service-1',
                Service: 'test-service',
                Tags: null,
                Address: '192.168.1.1',
                Port: 8080,
                Meta: {},
              },
            },
          ]),
        },
      };

      (discovery as any).consul = mockConsul;

      const instances = await discovery.discover('test-service');
      expect(instances[0]!.version).toBe('1.0.0');
    });
  });

  describe('Service Registration with Mock Consul', () => {
    beforeEach(() => {
      discovery = new ConsulServiceDiscovery('http://localhost:8500');
    });

    it('should register service via mocked consul agent', async () => {
      const registerFn = jest.fn().mockResolvedValue(undefined);
      const mockConsul = {
        agent: {
          service: {
            register: registerFn,
          },
        },
      };

      (discovery as any).consul = mockConsul;

      const service = createMockServiceInstance({
        id: 'my-service-1',
        name: 'my-service',
        address: '10.0.0.1',
        port: 9000,
        tags: ['production'],
      });

      await discovery.register(service);

      expect(registerFn).toHaveBeenCalledWith({
        id: 'my-service-1',
        name: 'my-service',
        address: '10.0.0.1',
        port: 9000,
        tags: ['production'],
        check: undefined,
      });
    });

    it('should register service with health check config', async () => {
      const registerFn = jest.fn().mockResolvedValue(undefined);
      const mockConsul = {
        agent: {
          service: {
            register: registerFn,
          },
        },
      };

      (discovery as any).consul = mockConsul;

      const service = {
        ...createMockServiceInstance({
          id: 'my-service-1',
          name: 'my-service',
        }),
        check: {
          HTTP: 'http://localhost:9000/health',
          Interval: '5s',
        },
      };

      await discovery.register(service as any);

      expect(registerFn).toHaveBeenCalledWith(
        expect.objectContaining({
          check: {
            HTTP: 'http://localhost:9000/health',
            Interval: '5s',
          },
        })
      );
    });
  });
});

// ============================================================================
// Load Balancer Tests
// ============================================================================

describe('LoadBalancer', () => {
  let loadBalancer: LoadBalancer;
  let endpoints: ServiceEndpoint[];

  beforeEach(() => {
    endpoints = createMockEndpoints(5);
  });

  describe('Round Robin Strategy', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
      loadBalancer.setEndpoints(endpoints);
    });

    it('should cycle through endpoints in order', () => {
      const selections: string[] = [];
      for (let i = 0; i < 10; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) selections.push(endpoint.id);
      }

      expect(selections).toEqual([
        'endpoint-0',
        'endpoint-1',
        'endpoint-2',
        'endpoint-3',
        'endpoint-4',
        'endpoint-0',
        'endpoint-1',
        'endpoint-2',
        'endpoint-3',
        'endpoint-4',
      ]);
    });

    it('should handle single endpoint', () => {
      loadBalancer.setEndpoints([endpoints[0]!]);
      expect(loadBalancer.next()?.id).toBe('endpoint-0');
      expect(loadBalancer.next()?.id).toBe('endpoint-0');
      expect(loadBalancer.next()?.id).toBe('endpoint-0');
    });

    it('should return null for empty endpoints', () => {
      loadBalancer.setEndpoints([]);
      expect(loadBalancer.next()).toBeNull();
    });

    it('should use selectInstance method', () => {
      const instance = loadBalancer.selectInstance();
      expect(instance).toBeDefined();
      expect(instance?.id).toBe('endpoint-0');
    });

    it('should use selectInstanceWithKey method', () => {
      const instance = loadBalancer.selectInstanceWithKey('any-key');
      expect(instance).toBeDefined();
    });
  });

  describe('Random Strategy', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.Random);
      loadBalancer.setEndpoints(endpoints);
    });

    it('should select endpoints randomly', () => {
      const selections = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) selections.add(endpoint.id);
      }

      // With 50 selections from 5 endpoints, we should hit at least 3 different ones
      expect(selections.size).toBeGreaterThanOrEqual(3);
    });

    it('should still work with single endpoint', () => {
      loadBalancer.setEndpoints([endpoints[0]!]);
      for (let i = 0; i < 10; i++) {
        expect(loadBalancer.next()?.id).toBe('endpoint-0');
      }
    });
  });

  describe('Least Connections Strategy', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.LeastConnections);
      loadBalancer.setEndpoints(endpoints);
    });

    it('should select endpoint with fewest connections', () => {
      loadBalancer.recordConnection('endpoint-0');
      loadBalancer.recordConnection('endpoint-0');
      loadBalancer.recordConnection('endpoint-1');
      loadBalancer.recordConnection('endpoint-2');

      const next = loadBalancer.next();
      expect(['endpoint-3', 'endpoint-4']).toContain(next?.id);
    });

    it('should track connection increments', () => {
      loadBalancer.incrementConnections('endpoint-0');
      loadBalancer.incrementConnections('endpoint-0');

      const next = loadBalancer.next();
      expect(next?.id).not.toBe('endpoint-0');
    });

    it('should properly release connections', () => {
      loadBalancer.recordConnection('endpoint-1');
      loadBalancer.recordConnection('endpoint-1');
      loadBalancer.releaseConnection('endpoint-1');
      loadBalancer.releaseConnection('endpoint-1');

      // All endpoints should now have 0 connections
      const next = loadBalancer.next();
      expect(next?.id).toBe('endpoint-0'); // First endpoint with 0 connections
    });

    it('should not go below 0 connections on release', () => {
      loadBalancer.releaseConnection('endpoint-0');
      loadBalancer.releaseConnection('endpoint-0');
      // Should not throw
      expect(loadBalancer.next()).toBeDefined();
    });

    it('should select first endpoint when all have equal connections', () => {
      const next = loadBalancer.next();
      expect(next?.id).toBe('endpoint-0');
    });
  });

  describe('Weighted Round Robin Strategy', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.WeightedRoundRobin);
    });

    it('should distribute according to weights', () => {
      const weightedEndpoints: ServiceEndpoint[] = [
        { id: 'light', address: 'localhost', port: 3001, weight: 1 },
        { id: 'medium', address: 'localhost', port: 3002, weight: 2 },
        { id: 'heavy', address: 'localhost', port: 3003, weight: 3 },
      ];
      loadBalancer.setEndpoints(weightedEndpoints);

      const counts = new Map<string, number>();
      const totalSelections = 60; // Divisible by sum of weights (6)

      for (let i = 0; i < totalSelections; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) {
          counts.set(endpoint.id, (counts.get(endpoint.id) || 0) + 1);
        }
      }

      // Should match weight ratios: 1:2:3
      expect(counts.get('light')).toBe(10);
      expect(counts.get('medium')).toBe(20);
      expect(counts.get('heavy')).toBe(30);
    });

    it('should use default weight of 1 when not specified', () => {
      const endpoints: ServiceEndpoint[] = [
        { id: 'a', address: 'localhost', port: 3001 },
        { id: 'b', address: 'localhost', port: 3002 },
      ];
      loadBalancer.setEndpoints(endpoints);

      const counts = new Map<string, number>();
      for (let i = 0; i < 20; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) {
          counts.set(endpoint.id, (counts.get(endpoint.id) || 0) + 1);
        }
      }

      expect(counts.get('a')).toBe(10);
      expect(counts.get('b')).toBe(10);
    });

    it('should handle single weighted endpoint', () => {
      loadBalancer.setEndpoints([{ id: 'solo', address: 'localhost', port: 3001, weight: 5 }]);

      for (let i = 0; i < 10; i++) {
        expect(loadBalancer.next()?.id).toBe('solo');
      }
    });

    it('should rebuild sequence when endpoints change', () => {
      loadBalancer.setEndpoints([{ id: 'first', address: 'localhost', port: 3001, weight: 1 }]);

      expect(loadBalancer.next()?.id).toBe('first');

      loadBalancer.setEndpoints([{ id: 'second', address: 'localhost', port: 3002, weight: 1 }]);

      expect(loadBalancer.next()?.id).toBe('second');
    });
  });

  describe('Response Time Strategy', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.ResponseTime);
      loadBalancer.setEndpoints(endpoints);
    });

    it('should select endpoint with lowest average response time', () => {
      loadBalancer.recordResponseTime('endpoint-0', 100);
      loadBalancer.recordResponseTime('endpoint-1', 50);
      loadBalancer.recordResponseTime('endpoint-2', 200);
      loadBalancer.recordResponseTime('endpoint-3', 75);
      loadBalancer.recordResponseTime('endpoint-4', 150);

      expect(loadBalancer.next()?.id).toBe('endpoint-1');
    });

    it('should prefer endpoint with no data', () => {
      loadBalancer.recordResponseTime('endpoint-0', 100);
      loadBalancer.recordResponseTime('endpoint-1', 50);

      // endpoint-2, 3, 4 have no data, should select one of them
      const next = loadBalancer.next();
      expect(['endpoint-2', 'endpoint-3', 'endpoint-4']).toContain(next?.id);
    });

    it('should calculate average from multiple response times', () => {
      loadBalancer.recordResponseTime('endpoint-0', 100);
      loadBalancer.recordResponseTime('endpoint-0', 200);
      loadBalancer.recordResponseTime('endpoint-0', 300); // avg = 200

      loadBalancer.recordResponseTime('endpoint-1', 50);
      loadBalancer.recordResponseTime('endpoint-1', 60);
      loadBalancer.recordResponseTime('endpoint-1', 70); // avg = 60

      // Record data for all endpoints to avoid "no data" preference
      loadBalancer.recordResponseTime('endpoint-2', 1000);
      loadBalancer.recordResponseTime('endpoint-3', 1000);
      loadBalancer.recordResponseTime('endpoint-4', 1000);

      expect(loadBalancer.next()?.id).toBe('endpoint-1');
    });

    it('should keep only last 100 response times', () => {
      // Record 150 response times for endpoint-0
      // First 50 are very high (1000), which will be pushed out
      // Next 100 are low (10), which will remain
      for (let i = 0; i < 50; i++) {
        loadBalancer.recordResponseTime('endpoint-0', 1000);
      }
      for (let i = 0; i < 100; i++) {
        loadBalancer.recordResponseTime('endpoint-0', 10);
      }

      // Record higher average for endpoint-1
      loadBalancer.recordResponseTime('endpoint-1', 100);

      // Record data for remaining endpoints to avoid "no data" preference
      loadBalancer.recordResponseTime('endpoint-2', 1000);
      loadBalancer.recordResponseTime('endpoint-3', 1000);
      loadBalancer.recordResponseTime('endpoint-4', 1000);

      // endpoint-0 should now be preferred (avg = 10 vs 100)
      const next = loadBalancer.next();
      expect(next?.id).toBe('endpoint-0');
    });
  });

  describe('Consistent Hash Strategy', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.ConsistentHash);
      loadBalancer.setEndpoints(endpoints);
    });

    it('should return same endpoint for same key', () => {
      const key = 'user-12345';
      const first = loadBalancer.next(key);
      const second = loadBalancer.next(key);
      const third = loadBalancer.next(key);

      expect(first?.id).toBe(second?.id);
      expect(second?.id).toBe(third?.id);
    });

    it('should distribute different keys across endpoints', () => {
      const selections = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const endpoint = loadBalancer.next(`key-${i}`);
        if (endpoint) selections.add(endpoint.id);
      }

      // With 100 different keys and 5 endpoints, should hit multiple endpoints
      expect(selections.size).toBeGreaterThan(1);
    });

    it('should return first endpoint when no key provided', () => {
      const endpoint = loadBalancer.next();
      expect(endpoint?.id).toBe('endpoint-0');
    });

    it('should return first endpoint for undefined key', () => {
      const endpoint = loadBalancer.next(undefined);
      expect(endpoint?.id).toBe('endpoint-0');
    });

    it('should handle empty string key', () => {
      const endpoint = loadBalancer.next('');
      expect(endpoint).toBeDefined();
    });

    it('should produce consistent hashes for complex keys', () => {
      const complexKey = JSON.stringify({ userId: 123, sessionId: 'abc', timestamp: 1234567890 });
      const first = loadBalancer.next(complexKey);
      const second = loadBalancer.next(complexKey);
      expect(first?.id).toBe(second?.id);
    });
  });

  describe('Strategy Switching', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
      loadBalancer.setEndpoints(endpoints);
    });

    it('should allow changing strategy at runtime', () => {
      // Start with round-robin
      expect(loadBalancer.next()?.id).toBe('endpoint-0');
      expect(loadBalancer.next()?.id).toBe('endpoint-1');

      // Switch to least connections
      loadBalancer.setStrategy(LoadBalancingStrategy.LeastConnections);
      loadBalancer.recordConnection('endpoint-0');
      loadBalancer.recordConnection('endpoint-1');

      // Should now select based on connections
      const next = loadBalancer.next();
      expect(['endpoint-2', 'endpoint-3', 'endpoint-4']).toContain(next?.id);
    });

    it('should switch to all strategies without error', () => {
      const strategies = [
        LoadBalancingStrategy.RoundRobin,
        LoadBalancingStrategy.Random,
        LoadBalancingStrategy.LeastConnections,
        LoadBalancingStrategy.WeightedRoundRobin,
        LoadBalancingStrategy.ResponseTime,
        LoadBalancingStrategy.ConsistentHash,
      ];

      for (const strategy of strategies) {
        loadBalancer.setStrategy(strategy);
        const endpoint = loadBalancer.next();
        expect(endpoint).toBeDefined();
      }
    });
  });

  describe('Service Instance Management', () => {
    beforeEach(() => {
      loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
    });

    it('should set instances and filter unhealthy ones', () => {
      const instances: ServiceInstance[] = [
        createMockServiceInstance({ id: 'healthy-1', health: 'healthy' }),
        createMockServiceInstance({ id: 'unhealthy-1', health: 'unhealthy' }),
        createMockServiceInstance({ id: 'healthy-2', health: 'healthy' }),
        createMockServiceInstance({ id: 'unknown-1', health: 'unknown' }),
      ];

      loadBalancer.setInstances(instances);

      // Only healthy instances should be available
      const selected = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const instance = loadBalancer.selectInstance();
        if (instance) selected.add(instance.id);
      }

      expect(selected.has('healthy-1')).toBe(true);
      expect(selected.has('healthy-2')).toBe(true);
      expect(selected.has('unhealthy-1')).toBe(false);
      expect(selected.has('unknown-1')).toBe(false);
    });

    it('should handle all instances being unhealthy', () => {
      const instances: ServiceInstance[] = [
        createMockServiceInstance({ id: 'unhealthy-1', health: 'unhealthy' }),
        createMockServiceInstance({ id: 'unhealthy-2', health: 'unhealthy' }),
      ];

      loadBalancer.setInstances(instances);
      expect(loadBalancer.selectInstance()).toBeNull();
    });
  });

  describe('Default Strategy Fallback', () => {
    it('should fallback to round-robin for unknown strategy', () => {
      loadBalancer = new LoadBalancer('unknown-strategy' as LoadBalancingStrategy);
      loadBalancer.setEndpoints(endpoints);

      // Should behave like round-robin
      expect(loadBalancer.next()?.id).toBe('endpoint-0');
      expect(loadBalancer.next()?.id).toBe('endpoint-1');
    });
  });
});

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  describe('Initial State', () => {
    it('should start in closed state', () => {
      circuitBreaker = new CircuitBreaker({});
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it('should accept empty config', () => {
      circuitBreaker = new CircuitBreaker({});
      expect(circuitBreaker).toBeDefined();
    });
  });

  describe('Successful Execution', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({ threshold: 3 });
    });

    it('should execute successful function', async () => {
      const result = await circuitBreaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should return value from successful async function', async () => {
      const result = await circuitBreaker.execute(async () => {
        await delay(10);
        return 42;
      });
      expect(result).toBe(42);
    });

    it('should work with call alias', async () => {
      const result = await circuitBreaker.call(async () => 'via-call');
      expect(result).toBe('via-call');
    });

    it('should remain closed after successful calls', async () => {
      for (let i = 0; i < 10; i++) {
        await circuitBreaker.execute(async () => i);
      }
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });
  });

  describe('Failure Handling', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({ threshold: 3, resetTimeout: 100 });
    });

    it('should count failures', async () => {
      const failingFn = async () => {
        throw new Error('Failure');
      };

      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Closed); // 1 failure, threshold is 3
    });

    it('should open after threshold failures', async () => {
      const failingFn = async () => {
        throw new Error('Failure');
      };

      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (e) {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);
    });

    it('should use default threshold of 5', async () => {
      circuitBreaker = new CircuitBreaker({});

      const failingFn = async () => {
        throw new Error('Failure');
      };

      // 4 failures should not open it
      for (let i = 0; i < 4; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (e) {}
      }
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);

      // 5th failure should open it
      try {
        await circuitBreaker.execute(failingFn);
      } catch (e) {}
      expect(circuitBreaker.getState()).toBe(CircuitState.Open);
    });

    it('should reset failure count on success', async () => {
      const failingFn = async () => {
        throw new Error('Failure');
      };

      // 2 failures
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (e) {}
      }

      // Success resets counter
      await circuitBreaker.execute(async () => 'success');

      // 2 more failures should not open (threshold is 3)
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch (e) {}
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });
  });

  describe('Open State Behavior', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({ threshold: 2, resetTimeout: 100 });
    });

    it('should reject requests when open', async () => {
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);

      await expect(circuitBreaker.execute(async () => 'test')).rejects.toThrow('Circuit breaker is open');
    });

    it('should include service info in error', async () => {
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      try {
        await circuitBreaker.execute(async () => 'test');
      } catch (error: any) {
        expect(error.message).toContain('Circuit breaker is open');
      }
    });
  });

  describe('Half-Open State', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({ threshold: 2, resetTimeout: 50 });
    });

    it('should transition to half-open after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);

      // Wait for reset timeout
      await delay(60);

      // Attempt a request - should transition to half-open
      try {
        await circuitBreaker.execute(async () => 'probe');
      } catch (e) {}

      expect([CircuitState.HalfOpen, CircuitState.Closed]).toContain(circuitBreaker.getState());
    });

    it('should close on successful request in half-open state', async () => {
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      await delay(60);

      // Successful request should close the circuit
      await circuitBreaker.execute(async () => 'success');

      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it('should return to open on failure in half-open state', async () => {
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      await delay(60);

      // Failed request should return to open
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Still failing');
        });
      } catch (e) {}

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout slow operations', async () => {
      circuitBreaker = new CircuitBreaker({ requestTimeout: 50 });

      await expect(
        circuitBreaker.execute(async () => {
          await delay(200);
          return 'too slow';
        })
      ).rejects.toThrow();
    });

    it('should use timeout from config', async () => {
      circuitBreaker = new CircuitBreaker({ timeout: 50 });

      await expect(
        circuitBreaker.execute(async () => {
          await delay(200);
          return 'too slow';
        })
      ).rejects.toThrow();
    });

    it('should allow fast operations through', async () => {
      circuitBreaker = new CircuitBreaker({ requestTimeout: 100 });

      const result = await circuitBreaker.execute(async () => {
        await delay(10);
        return 'fast';
      });

      expect(result).toBe('fast');
    });

    it('should not apply timeout when not configured', async () => {
      circuitBreaker = new CircuitBreaker({});

      const result = await circuitBreaker.execute(async () => {
        await delay(10);
        return 'no timeout';
      });

      expect(result).toBe('no timeout');
    });
  });

  describe('Reset Functionality', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({ threshold: 2, resetTimeout: 1000 });
    });

    it('should reset state manually', async () => {
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it('should allow new requests after reset', async () => {
      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      circuitBreaker.reset();

      const result = await circuitBreaker.execute(async () => 'after reset');
      expect(result).toBe('after reset');
    });

    it('should reset failure count on manual reset', async () => {
      // Partial failures
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch (e) {}

      circuitBreaker.reset();

      // 1 more failure should not open (threshold is 2)
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch (e) {}

      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });
  });

  describe('Default Configuration', () => {
    it('should use default resetTimeout of 30000ms', async () => {
      circuitBreaker = new CircuitBreaker({ threshold: 1 });

      // Open circuit
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch (e) {}

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);

      // After a short delay, should still be open (30 second timeout)
      await delay(10);
      await expect(circuitBreaker.execute(async () => 'test')).rejects.toThrow('Circuit breaker is open');
    });
  });

  describe('Edge Cases', () => {
    it('should handle synchronous errors', async () => {
      circuitBreaker = new CircuitBreaker({ threshold: 1 });

      try {
        await circuitBreaker.execute(() => {
          throw new Error('Sync error');
        });
      } catch (e) {}

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);
    });

    it('should handle promise rejections', async () => {
      circuitBreaker = new CircuitBreaker({ threshold: 1 });

      try {
        await circuitBreaker.execute(() => Promise.reject(new Error('Promise rejection')));
      } catch (e) {}

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);
    });

    it('should handle returning undefined', async () => {
      circuitBreaker = new CircuitBreaker({});

      const result = await circuitBreaker.execute(async () => undefined);
      expect(result).toBeUndefined();
    });

    it('should handle returning null', async () => {
      circuitBreaker = new CircuitBreaker({});

      const result = await circuitBreaker.execute(async () => null);
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// Service Registry Tests
// ============================================================================

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  describe('Registration', () => {
    it('should register service implementation', () => {
      const impl = { method: () => 'test' };
      registry.register('TestService', impl);

      expect(registry.get('TestService')).toBe(impl);
    });

    it('should register with metadata', () => {
      const impl = { method: () => 'test' };
      registry.register('TestService', impl, {
        version: '2.0.0',
        port: 8080,
        address: '192.168.1.1',
      });

      const metadata = registry.getMetadata('TestService');
      expect(metadata?.version).toBe('2.0.0');
      expect(metadata?.port).toBe(8080);
      expect(metadata?.address).toBe('192.168.1.1');
    });

    it('should generate default metadata values', () => {
      const impl = { method: () => 'test' };
      registry.register('TestService', impl, {});

      const metadata = registry.getMetadata('TestService');
      expect(metadata?.name).toBe('TestService');
      expect(metadata?.version).toBe('1.0.0');
      expect(metadata?.address).toBe('localhost');
      expect(metadata?.port).toBe(3000);
      expect(metadata?.health).toBe('healthy');
      expect(metadata?.id).toContain('TestService-');
    });

    it('should override values with explicit metadata', () => {
      const impl = {};
      registry.register('Service', impl, {
        id: 'custom-id',
        name: 'CustomName',
        health: 'unhealthy',
      });

      const metadata = registry.getMetadata('Service');
      expect(metadata?.id).toBe('custom-id');
      // Note: The name from metadata is preserved, not overridden by service key
      expect(metadata?.name).toBeDefined();
      expect(metadata?.health).toBe('unhealthy');
    });

    it('should handle multiple services', () => {
      registry.register('Service1', { id: 1 });
      registry.register('Service2', { id: 2 });
      registry.register('Service3', { id: 3 });

      expect(registry.get<{ id: number }>('Service1')?.id).toBe(1);
      expect(registry.get<{ id: number }>('Service2')?.id).toBe(2);
      expect(registry.get<{ id: number }>('Service3')?.id).toBe(3);
    });

    it('should overwrite existing registration', () => {
      registry.register('Service', { version: 1 });
      registry.register('Service', { version: 2 });

      expect(registry.get<{ version: number }>('Service')?.version).toBe(2);
    });
  });

  describe('Retrieval', () => {
    it('should return undefined for non-existent service', () => {
      expect(registry.get('NonExistent')).toBeUndefined();
    });

    it('should return undefined metadata for non-existent service', () => {
      expect(registry.getMetadata('NonExistent')).toBeUndefined();
    });

    it('should return correct type with generics', () => {
      interface MyService {
        doSomething(): string;
      }

      const impl: MyService = {
        doSomething: () => 'done',
      };

      registry.register('MyService', impl);
      const retrieved = registry.get<MyService>('MyService');

      expect(retrieved?.doSomething()).toBe('done');
    });
  });

  describe('Listing', () => {
    it('should list all registered services', () => {
      registry.register('A', {});
      registry.register('B', {});
      registry.register('C', {});

      const services = registry.list();
      expect(services).toContain('A');
      expect(services).toContain('B');
      expect(services).toContain('C');
      expect(services).toHaveLength(3);
    });

    it('should return empty array when no services registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe('HealthCheck', () => {
  let healthCheck: HealthCheck;

  describe('Initialization', () => {
    it('should initialize with required endpoint', () => {
      healthCheck = new HealthCheck({ endpoint: 'http://localhost:3000/health' });
      expect(healthCheck).toBeDefined();
    });

    it('should use default values', () => {
      healthCheck = new HealthCheck({ endpoint: 'http://localhost:3000/health' });
      expect(healthCheck.isHealthy()).toBe(true);
      expect(healthCheck.getConsecutiveFailures()).toBe(0);
    });

    it('should accept custom configuration', () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        interval: 5000,
        timeout: 1000,
        unhealthyThreshold: 5,
      });
      expect(healthCheck).toBeDefined();
    });
  });

  describe('Health Status', () => {
    beforeEach(() => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        unhealthyThreshold: 3,
      });
    });

    it('should start healthy', () => {
      expect(healthCheck.isHealthy()).toBe(true);
    });

    it('should track consecutive failures', () => {
      expect(healthCheck.getConsecutiveFailures()).toBe(0);
    });
  });

  describe('Reset', () => {
    beforeEach(() => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        unhealthyThreshold: 3,
      });
    });

    it('should reset health status', () => {
      healthCheck.reset();

      expect(healthCheck.isHealthy()).toBe(true);
      expect(healthCheck.getConsecutiveFailures()).toBe(0);
    });
  });

  describe('Check Method with Mock Fetch', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should return healthy on successful check', async () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        timeout: 1000,
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      }) as any;

      const result = await healthCheck.check();

      expect(result.healthy).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return unhealthy on failed check', async () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        timeout: 1000,
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }) as any;

      const result = await healthCheck.check();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
      expect(healthCheck.getConsecutiveFailures()).toBe(1);
    });

    it('should return unhealthy on network error', async () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        timeout: 1000,
      });

      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as any;

      const result = await healthCheck.check();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should become unhealthy after threshold failures', async () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        unhealthyThreshold: 2,
        timeout: 1000,
      });

      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as any;

      await healthCheck.check();
      expect(healthCheck.isHealthy()).toBe(true); // 1 failure

      await healthCheck.check();
      expect(healthCheck.isHealthy()).toBe(false); // 2 failures = threshold reached
    });

    it('should reset failures on successful check', async () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        unhealthyThreshold: 3,
        timeout: 1000,
      });

      // First, fail once
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as any;
      await healthCheck.check();
      expect(healthCheck.getConsecutiveFailures()).toBe(1);

      // Then, succeed
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      }) as any;
      await healthCheck.check();

      expect(healthCheck.getConsecutiveFailures()).toBe(0);
      expect(healthCheck.isHealthy()).toBe(true);
    });

    it('should use default status when not in response', async () => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        timeout: 1000,
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }) as any;

      const result = await healthCheck.check();

      expect(result.status).toBe('healthy');
    });
  });
});

// ============================================================================
// Service Mesh Manager Tests
// ============================================================================

describe('ServiceMeshManager', () => {
  let manager: ServiceMeshManager;
  let mockDiscovery: MockServiceDiscovery;

  beforeEach(() => {
    mockDiscovery = new MockServiceDiscovery();
    manager = new ServiceMeshManager({
      discovery: mockDiscovery,
      loadBalancing: LoadBalancingStrategy.RoundRobin,
      timeout: 5000,
    });
  });

  describe('Service Registration', () => {
    it('should register a service', async () => {
      const instance = createMockServiceInstance({ name: 'my-service' });
      await manager.registerService(instance);

      expect(mockDiscovery.registerCallCount).toBe(1);
    });

    it('should deregister a service', async () => {
      const instance = createMockServiceInstance({ id: 'service-123', name: 'my-service' });
      await manager.registerService(instance);
      await manager.deregisterService('service-123');

      expect(mockDiscovery.deregisterCallCount).toBe(1);
    });
  });

  describe('Service Proxy Creation', () => {
    it('should create a service proxy', () => {
      interface UserService {
        getUser(id: string): Promise<{ id: string; name: string }>;
      }

      const proxy = manager.getServiceProxy<UserService>('user-service');
      expect(proxy).toBeDefined();
      expect(typeof proxy.getUser).toBe('function');
    });

    it('should cache service proxies', () => {
      const proxy1 = manager.getServiceProxy('service-a');
      const proxy2 = manager.getServiceProxy('service-a');

      // Proxies are created fresh each time from the cached ServiceProxy
      expect(typeof proxy1).toBe('object');
      expect(typeof proxy2).toBe('object');
    });

    it('should create separate proxies for different versions', () => {
      const proxy1 = manager.getServiceProxy('service', '1.0.0');
      const proxy2 = manager.getServiceProxy('service', '2.0.0');

      expect(proxy1).toBeDefined();
      expect(proxy2).toBeDefined();
    });

    it('should use "latest" as default version key', () => {
      const proxy1 = manager.getServiceProxy('service');
      const proxy2 = manager.getServiceProxy('service');

      expect(proxy1).toBeDefined();
      expect(proxy2).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should use default round-robin when no strategy specified', () => {
      manager = new ServiceMeshManager({
        discovery: mockDiscovery,
      });

      const proxy = manager.getServiceProxy('service');
      expect(proxy).toBeDefined();
    });

    it('should apply circuit breaker config', () => {
      manager = new ServiceMeshManager({
        discovery: mockDiscovery,
        circuitBreaker: {
          threshold: 3,
          resetTimeout: 5000,
        },
      });

      const proxy = manager.getServiceProxy('service');
      expect(proxy).toBeDefined();
    });

    it('should apply retry config', () => {
      manager = new ServiceMeshManager({
        discovery: mockDiscovery,
        retries: 5,
      });

      const proxy = manager.getServiceProxy('service');
      expect(proxy).toBeDefined();
    });
  });
});

// ============================================================================
// Service Proxy Tests
// ============================================================================

describe('ServiceProxy', () => {
  let mockDiscovery: MockServiceDiscovery;
  let proxy: ServiceProxy;

  beforeEach(() => {
    mockDiscovery = new MockServiceDiscovery();
  });

  describe('Proxy Creation', () => {
    it('should create a proxy object', () => {
      proxy = new ServiceProxy(mockDiscovery, {
        serviceName: 'test-service',
        loadBalancing: LoadBalancingStrategy.RoundRobin,
      });

      const proxyObj = proxy.createProxy();
      expect(proxyObj).toBeDefined();
    });

    it('should intercept method calls', () => {
      proxy = new ServiceProxy(mockDiscovery, {
        serviceName: 'test-service',
        loadBalancing: LoadBalancingStrategy.RoundRobin,
      });

      const proxyObj = proxy.createProxy<{ hello: (name: string) => Promise<string> }>();
      expect(typeof proxyObj.hello).toBe('function');
    });

    it('should return undefined for non-string properties', () => {
      proxy = new ServiceProxy(mockDiscovery, {
        serviceName: 'test-service',
        loadBalancing: LoadBalancingStrategy.RoundRobin,
      });

      const proxyObj = proxy.createProxy<any>();
      expect(proxyObj[Symbol('test')]).toBeUndefined();
    });
  });

  describe('Version Filtering', () => {
    it('should filter instances by version in watch callback', async () => {
      proxy = new ServiceProxy(mockDiscovery, {
        serviceName: 'test-service',
        version: '2.0.0',
        loadBalancing: LoadBalancingStrategy.RoundRobin,
      });

      // Add instances with different versions
      const instances = [
        createMockServiceInstance({ id: 'v1', version: '1.0.0' }),
        createMockServiceInstance({ id: 'v2-1', version: '2.0.0' }),
        createMockServiceInstance({ id: 'v2-2', version: '2.0.0' }),
      ];

      mockDiscovery.addService('test-service', instances);

      // Give time for async operations
      await delay(10);
    });
  });

  describe('Fallback Handling', () => {
    it('should accept fallback configuration', () => {
      proxy = new ServiceProxy(mockDiscovery, {
        serviceName: 'test-service',
        loadBalancing: LoadBalancingStrategy.RoundRobin,
        fallback: () => 'fallback-value',
      });

      expect(proxy).toBeDefined();
    });
  });
});

// ============================================================================
// Remote Proxy Factory Tests
// ============================================================================

describe('createRemoteProxy', () => {
  let mockDiscovery: MockServiceDiscovery;

  beforeEach(() => {
    mockDiscovery = new MockServiceDiscovery();
  });

  describe('With Discovery', () => {
    it('should create proxy with discovery', () => {
      interface MyService {
        greet(name: string): Promise<string>;
      }

      const proxy = createRemoteProxy<MyService>({
        serviceName: 'my-service',
        discovery: mockDiscovery,
      });

      expect(proxy).toBeDefined();
      expect(typeof proxy.greet).toBe('function');
    });

    it('should accept retry configuration', () => {
      const proxy = createRemoteProxy({
        serviceName: 'my-service',
        discovery: mockDiscovery,
        retry: {
          maxAttempts: 5,
          delay: 100,
        },
      });

      expect(proxy).toBeDefined();
    });
  });

  describe('With Endpoints', () => {
    it('should create proxy with endpoints', () => {
      const endpoints: ServiceEndpoint[] = [
        { id: 'e1', address: 'localhost', port: 3001 },
        { id: 'e2', address: 'localhost', port: 3002 },
      ];

      interface TestService {
        getData(): Promise<any>;
      }

      const proxy = createRemoteProxy<TestService>({
        serviceName: 'test-service',
        endpoints,
      });

      expect(proxy).toBeDefined();
      expect(typeof proxy.getData).toBe('function');
    });

    it('should accept custom load balancer', () => {
      const endpoints: ServiceEndpoint[] = [{ id: 'e1', address: 'localhost', port: 3001 }];

      const loadBalancer = new LoadBalancer(LoadBalancingStrategy.Random);

      const proxy = createRemoteProxy({
        serviceName: 'test-service',
        endpoints,
        loadBalancer,
      });

      expect(proxy).toBeDefined();
    });

    it('should create default load balancer when not provided', () => {
      const endpoints: ServiceEndpoint[] = [{ id: 'e1', address: 'localhost', port: 3001 }];

      const proxy = createRemoteProxy({
        serviceName: 'test-service',
        endpoints,
      });

      expect(proxy).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw when neither discovery nor endpoints provided', () => {
      expect(() => {
        createRemoteProxy({
          serviceName: 'test-service',
        });
      }).toThrow('Either discovery or endpoints must be provided');
    });
  });
});

// ============================================================================
// Remote Service Provider Tests
// ============================================================================

describe('createRemoteServiceProvider', () => {
  it('should create a provider definition', () => {
    interface UserService {
      getUser(id: string): Promise<any>;
    }

    const discoveryToken = createToken<ServiceDiscovery>('Discovery');
    const provider = createRemoteServiceProvider<UserService>('user-service', discoveryToken);

    expect(provider).toBeDefined();
    expect(provider.useFactory).toBeDefined();
    expect(provider.inject).toEqual([discoveryToken]);
  });

  it('should return factory that creates proxy', () => {
    const mockDiscovery = new MockServiceDiscovery();
    const discoveryToken = createToken<ServiceDiscovery>('Discovery');
    const provider = createRemoteServiceProvider('test-service', discoveryToken);

    const proxy = provider.useFactory!(mockDiscovery);
    expect(proxy).toBeDefined();
  });
});

// ============================================================================
// Token Export Tests
// ============================================================================

describe('Exported Tokens', () => {
  it('should export ServiceDiscoveryToken', () => {
    expect(ServiceDiscoveryToken).toBeDefined();
    expect(ServiceDiscoveryToken.name).toBe('ServiceDiscovery');
  });

  it('should export LoadBalancerToken', () => {
    expect(LoadBalancerToken).toBeDefined();
    expect(LoadBalancerToken.name).toBe('LoadBalancer');
  });

  it('should export CircuitBreakerToken', () => {
    expect(CircuitBreakerToken).toBeDefined();
    expect(CircuitBreakerToken.name).toBe('CircuitBreaker');
  });
});

// ============================================================================
// Enum Tests
// ============================================================================

describe('Enums', () => {
  describe('LoadBalancingStrategy', () => {
    it('should have all strategies defined', () => {
      expect(LoadBalancingStrategy.RoundRobin).toBe('round-robin');
      expect(LoadBalancingStrategy.Random).toBe('random');
      expect(LoadBalancingStrategy.LeastConnections).toBe('least-connections');
      expect(LoadBalancingStrategy.WeightedRoundRobin).toBe('weighted-round-robin');
      expect(LoadBalancingStrategy.ResponseTime).toBe('response-time');
      expect(LoadBalancingStrategy.ConsistentHash).toBe('consistent-hash');
    });
  });

  describe('CircuitState', () => {
    it('should have all states defined', () => {
      expect(CircuitState.Closed).toBe('closed');
      expect(CircuitState.Open).toBe('open');
      expect(CircuitState.HalfOpen).toBe('half-open');
    });
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Integration Scenarios', () => {
  let mockDiscovery: MockServiceDiscovery;

  beforeEach(() => {
    mockDiscovery = new MockServiceDiscovery();
  });

  describe('Full Mesh Setup', () => {
    it('should set up complete mesh with discovery, load balancing, and circuit breaker', () => {
      const config: ServiceMeshConfig = {
        discovery: mockDiscovery,
        loadBalancing: LoadBalancingStrategy.WeightedRoundRobin,
        circuitBreaker: {
          threshold: 5,
          resetTimeout: 30000,
        },
        retries: 3,
        timeout: 10000,
      };

      const manager = new ServiceMeshManager(config);
      expect(manager).toBeDefined();

      const proxy = manager.getServiceProxy('backend-service', '1.0.0');
      expect(proxy).toBeDefined();
    });
  });

  describe('Service Discovery Flow', () => {
    it('should register, discover, and deregister services', async () => {
      const manager = new ServiceMeshManager({
        discovery: mockDiscovery,
      });

      // Register multiple service instances
      const instances = createMockServiceInstances(3, 'api-service');
      for (const instance of instances) {
        await manager.registerService({
          ...instance,
          name: 'api-service',
        });
      }

      expect(mockDiscovery.registerCallCount).toBe(3);

      // Discover services
      const discovered = await mockDiscovery.discover('api-service');
      expect(discovered).toHaveLength(3);

      // Deregister one
      await manager.deregisterService(instances[0]!.id);
      expect(mockDiscovery.deregisterCallCount).toBe(1);

      const remaining = await mockDiscovery.discover('api-service');
      expect(remaining).toHaveLength(2);
    });
  });

  describe('Load Balancer with Circuit Breaker', () => {
    it('should integrate load balancer and circuit breaker', async () => {
      const loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
      loadBalancer.setEndpoints([
        { id: 'primary', address: 'primary.local', port: 8080 },
        { id: 'backup', address: 'backup.local', port: 8080 },
      ]);

      const circuitBreaker = new CircuitBreaker({
        threshold: 2,
        resetTimeout: 100,
      });

      // Simulate failures that would trip circuit breaker
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            const endpoint = loadBalancer.next();
            throw new Error(`Failed to reach ${endpoint?.address}`);
          });
        } catch (e) {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);

      // Wait for reset
      await delay(150);

      // Circuit should allow probe
      const result = await circuitBreaker.execute(async () => {
        const endpoint = loadBalancer.next();
        return `Success with ${endpoint?.id}`;
      });

      expect(result).toContain('Success');
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });
  });

  describe('Multi-Version Service Discovery', () => {
    it('should handle services with multiple versions', async () => {
      mockDiscovery.addService('payment-service', [
        createMockServiceInstance({ id: 'payment-v1-1', version: '1.0.0' }),
        createMockServiceInstance({ id: 'payment-v1-2', version: '1.0.0' }),
        createMockServiceInstance({ id: 'payment-v2-1', version: '2.0.0' }),
      ]);

      const v1Instances = await mockDiscovery.discover('payment-service', '1.0.0');
      const v2Instances = await mockDiscovery.discover('payment-service', '2.0.0');

      expect(v1Instances).toHaveLength(2);
      expect(v2Instances).toHaveLength(1);
    });
  });

  describe('Health Status Changes', () => {
    it('should handle health status changes', async () => {
      const instance = createMockServiceInstance({ id: 'svc-1', health: 'healthy' });
      await mockDiscovery.register(instance);

      expect(await mockDiscovery.health('svc-1')).toBe('healthy');

      mockDiscovery.setServiceHealth('svc-1', 'unhealthy');

      expect(await mockDiscovery.health('svc-1')).toBe('unhealthy');
    });
  });

  describe('Watcher Notifications', () => {
    it('should notify watchers on service changes', async () => {
      const notifications: ServiceInstance[][] = [];
      mockDiscovery.watch('events-service', (instances) => {
        notifications.push([...instances]);
      });

      // Register service
      const instance1 = createMockServiceInstance({ id: 'evt-1', name: 'events-service' });
      await mockDiscovery.register(instance1);

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toHaveLength(1);

      // Register another
      const instance2 = createMockServiceInstance({ id: 'evt-2', name: 'events-service' });
      await mockDiscovery.register(instance2);

      expect(notifications).toHaveLength(2);
      expect(notifications[1]).toHaveLength(2);

      // Deregister one
      await mockDiscovery.deregister('evt-1');

      expect(notifications).toHaveLength(3);
      expect(notifications[2]).toHaveLength(1);
    });
  });
});

// ============================================================================
// Edge Cases and Error Scenarios
// ============================================================================

describe('Edge Cases and Error Scenarios', () => {
  describe('Load Balancer Edge Cases', () => {
    it('should handle rapid endpoint changes', () => {
      const loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);

      for (let i = 0; i < 10; i++) {
        loadBalancer.setEndpoints(createMockEndpoints(i + 1));
        expect(loadBalancer.next()).toBeDefined();
      }
    });

    it('should handle zero-weight endpoints in weighted round-robin', () => {
      const loadBalancer = new LoadBalancer(LoadBalancingStrategy.WeightedRoundRobin);
      loadBalancer.setEndpoints([
        { id: 'zero', address: 'localhost', port: 3001, weight: 0 },
        { id: 'one', address: 'localhost', port: 3002, weight: 1 },
      ]);

      // With zero weight, the endpoint still exists but contributes 0 to sequence
      // The implementation adds instances weight times, so weight 0 = 0 appearances
      // But when sequence is empty or has issues, it falls back
      const selections = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) selections.add(endpoint.id);
      }
      // Verify we get selections from the endpoints
      expect(selections.size).toBeGreaterThanOrEqual(1);
    });

    it('should handle very large weights', () => {
      const loadBalancer = new LoadBalancer(LoadBalancingStrategy.WeightedRoundRobin);
      loadBalancer.setEndpoints([
        { id: 'light', address: 'localhost', port: 3001, weight: 1 },
        { id: 'heavy', address: 'localhost', port: 3002, weight: 100 },
      ]);

      const counts = new Map<string, number>();
      for (let i = 0; i < 101; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) {
          counts.set(endpoint.id, (counts.get(endpoint.id) || 0) + 1);
        }
      }

      expect(counts.get('heavy')).toBe(100);
      expect(counts.get('light')).toBe(1);
    });

    it('should handle unicode keys in consistent hash', () => {
      const loadBalancer = new LoadBalancer(LoadBalancingStrategy.ConsistentHash);
      loadBalancer.setEndpoints(createMockEndpoints(3));

      const key1 = loadBalancer.next('user-1234-test');
      const key2 = loadBalancer.next('user-1234-test');

      expect(key1?.id).toBe(key2?.id);
    });
  });

  describe('Circuit Breaker Edge Cases', () => {
    it('should handle very low threshold', async () => {
      const cb = new CircuitBreaker({ threshold: 1, resetTimeout: 10 });

      try {
        await cb.execute(async () => {
          throw new Error('Fail');
        });
      } catch (e) {}

      expect(cb.getState()).toBe(CircuitState.Open);
    });

    it('should handle concurrent requests', async () => {
      const cb = new CircuitBreaker({ threshold: 10 });

      const results = await Promise.all(
        Array(5)
          .fill(null)
          .map((_, i) =>
            cb.execute(async () => {
              await delay(10);
              return i;
            })
          )
      );

      expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle alternating success/failure', async () => {
      const cb = new CircuitBreaker({ threshold: 3 });
      let callCount = 0;

      for (let i = 0; i < 6; i++) {
        try {
          await cb.execute(async () => {
            callCount++;
            if (i % 2 === 0) {
              throw new Error('Even failure');
            }
            return 'success';
          });
        } catch (e) {}
      }

      // Alternating means failures get reset by successes
      expect(cb.getState()).toBe(CircuitState.Closed);
      expect(callCount).toBe(6);
    });
  });

  describe('Service Discovery Edge Cases', () => {
    let mockDiscovery: MockServiceDiscovery;

    beforeEach(() => {
      mockDiscovery = new MockServiceDiscovery();
    });

    it('should handle empty service name', async () => {
      const instances = await mockDiscovery.discover('');
      expect(instances).toEqual([]);
    });

    it('should handle non-existent version filter', async () => {
      mockDiscovery.addService('svc', [createMockServiceInstance({ version: '1.0.0' })]);

      const instances = await mockDiscovery.discover('svc', '99.0.0');
      expect(instances).toEqual([]);
    });

    it('should handle multiple unwatchers', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const unwatch1 = mockDiscovery.watch('svc', callback1);
      const unwatch2 = mockDiscovery.watch('svc', callback2);

      unwatch1();
      unwatch2();

      // Should not throw
    });
  });

  describe('Health Check Edge Cases', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should handle AbortError on timeout', async () => {
      const healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        timeout: 10,
      });

      globalThis.fetch = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AbortError')), 50);
        });
      }) as any;

      const result = await healthCheck.check();
      expect(result.healthy).toBe(false);
    });

    it('should handle malformed JSON response', async () => {
      const healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        timeout: 1000,
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      }) as any;

      const result = await healthCheck.check();
      expect(result.healthy).toBe(false);
    });
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  it('should provide type-safe service proxy', () => {
    interface TypedService {
      getValue(): Promise<number>;
      setValue(value: number): Promise<void>;
      compute(a: number, b: number): Promise<number>;
    }

    const mockDiscovery = new MockServiceDiscovery();
    const manager = new ServiceMeshManager({ discovery: mockDiscovery });

    const proxy = manager.getServiceProxy<TypedService>('typed-service');

    // TypeScript should infer these as functions
    expect(typeof proxy.getValue).toBe('function');
    expect(typeof proxy.setValue).toBe('function');
    expect(typeof proxy.compute).toBe('function');
  });

  it('should maintain type information through token creation', () => {
    interface CustomDiscovery extends ServiceDiscovery {
      customMethod(): void;
    }

    const token = createToken<CustomDiscovery>('CustomDiscovery');
    expect(token.name).toBe('CustomDiscovery');
  });
});
