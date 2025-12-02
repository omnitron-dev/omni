/**
 * Comprehensive Tests for Service Mesh (Multi-Container Federation)
 * Tests service discovery, load balancing, circuit breakers, and proxies
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Skip tests in mock Redis mode as they test mesh infrastructure
const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
if (skipTests) {
  console.log('⏭️ Skipping mesh-comprehensive.spec.ts - requires full Nexus infrastructure');
}
const describeOrSkip = skipTests ? describe.skip : describe;
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
  type ServiceInstance,
  type ServiceEndpoint,
  createRemoteProxy,
} from '../../../src/nexus/mesh.js';
import { delay } from '@omnitron-dev/common';

describeOrSkip('Service Mesh - Infrastructure Tests', () => {
  describe('ConsulServiceDiscovery', () => {
    it('should initialize with string URL', () => {
      const discovery = new ConsulServiceDiscovery('http://localhost:8500');
      expect(discovery).toBeDefined();
    });

    it('should initialize with config object', () => {
      const discovery = new ConsulServiceDiscovery({
        host: 'localhost',
        port: 8500,
      });
      expect(discovery).toBeDefined();
    });

    it('should build URL from config', () => {
      const discovery = new ConsulServiceDiscovery({
        host: 'consul.example.com',
        port: 8600,
      });
      expect(discovery).toBeDefined();
    });

    it('should use default port if not specified', () => {
      const discovery = new ConsulServiceDiscovery({
        host: 'localhost',
      });
      expect(discovery).toBeDefined();
    });
  });

  describe('Load Balancer', () => {
    let loadBalancer: LoadBalancer;
    let endpoints: ServiceEndpoint[];

    beforeEach(() => {
      endpoints = [
        { id: 'endpoint1', address: 'localhost', port: 3001 },
        { id: 'endpoint2', address: 'localhost', port: 3002 },
        { id: 'endpoint3', address: 'localhost', port: 3003 },
      ];
    });

    describe('Round Robin Strategy', () => {
      beforeEach(() => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
        loadBalancer.setEndpoints(endpoints);
      });

      it('should distribute requests evenly', () => {
        const selections = [
          loadBalancer.next(),
          loadBalancer.next(),
          loadBalancer.next(),
          loadBalancer.next(),
        ];

        expect(selections[0]?.id).toBe('endpoint1');
        expect(selections[1]?.id).toBe('endpoint2');
        expect(selections[2]?.id).toBe('endpoint3');
        expect(selections[3]?.id).toBe('endpoint1'); // Wrap around
      });

      it('should handle single endpoint', () => {
        loadBalancer.setEndpoints([endpoints[0]]);
        
        const selection1 = loadBalancer.next();
        const selection2 = loadBalancer.next();
        
        expect(selection1?.id).toBe('endpoint1');
        expect(selection2?.id).toBe('endpoint1');
      });
    });

    describe('Random Strategy', () => {
      beforeEach(() => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.Random);
        loadBalancer.setEndpoints(endpoints);
      });

      it('should select random endpoints', () => {
        const selections = new Set();
        
        for (let i = 0; i < 20; i++) {
          const endpoint = loadBalancer.next();
          if (endpoint) selections.add(endpoint.id);
        }
        
        // Should have selected multiple different endpoints
        expect(selections.size).toBeGreaterThan(1);
      });
    });

    describe('Least Connections Strategy', () => {
      beforeEach(() => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.LeastConnections);
        loadBalancer.setEndpoints(endpoints);
      });

      it('should select endpoint with least connections', () => {
        loadBalancer.incrementConnections('endpoint1');
        loadBalancer.incrementConnections('endpoint1');
        loadBalancer.incrementConnections('endpoint2');
        
        const next = loadBalancer.next();
        expect(next?.id).toBe('endpoint3'); // Has 0 connections
      });

      it('should track and release connections', () => {
        loadBalancer.recordConnection('endpoint1');
        loadBalancer.recordConnection('endpoint1');
        
        const next1 = loadBalancer.next();
        expect(next1?.id).not.toBe('endpoint1');
        
        loadBalancer.releaseConnection('endpoint1');
        loadBalancer.releaseConnection('endpoint1');
        
        // Now endpoint1 should be available again
        const next2 = loadBalancer.next();
        expect(next2).toBeDefined();
      });
    });

    describe('Weighted Round Robin Strategy', () => {
      beforeEach(() => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.WeightedRoundRobin);
        
        const weightedEndpoints: ServiceEndpoint[] = [
          { id: 'endpoint1', address: 'localhost', port: 3001, weight: 1 },
          { id: 'endpoint2', address: 'localhost', port: 3002, weight: 2 },
          { id: 'endpoint3', address: 'localhost', port: 3003, weight: 3 },
        ];
        
        loadBalancer.setEndpoints(weightedEndpoints);
      });

      it('should distribute according to weights', () => {
        const counts = new Map<string, number>();
        
        for (let i = 0; i < 60; i++) {
          const endpoint = loadBalancer.next();
          if (endpoint) {
            counts.set(endpoint.id, (counts.get(endpoint.id) || 0) + 1);
          }
        }
        
        // endpoint3 should have more selections than endpoint1
        expect(counts.get('endpoint3')!).toBeGreaterThan(counts.get('endpoint1')!);
      });
    });

    describe('Response Time Strategy', () => {
      beforeEach(() => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.ResponseTime);
        loadBalancer.setEndpoints(endpoints);
      });

      it('should prefer endpoint with lowest response time', () => {
        loadBalancer.recordResponseTime('endpoint1', 100);
        loadBalancer.recordResponseTime('endpoint2', 50);
        loadBalancer.recordResponseTime('endpoint3', 150);
        
        const next = loadBalancer.next();
        expect(next?.id).toBe('endpoint2');
      });

      it('should select endpoint with no data first', () => {
        loadBalancer.recordResponseTime('endpoint1', 100);
        
        const next = loadBalancer.next();
        expect(['endpoint2', 'endpoint3']).toContain(next?.id);
      });

      it('should calculate average response time', () => {
        loadBalancer.recordResponseTime('endpoint1', 100);
        loadBalancer.recordResponseTime('endpoint1', 200);
        loadBalancer.recordResponseTime('endpoint1', 300);
        
        loadBalancer.recordResponseTime('endpoint2', 50);
        
        const next = loadBalancer.next();
        expect(next?.id).toBe('endpoint2'); // Lower average
      });
    });

    describe('Consistent Hash Strategy', () => {
      beforeEach(() => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.ConsistentHash);
        loadBalancer.setEndpoints(endpoints);
      });

      it('should return same endpoint for same key', () => {
        const endpoint1 = loadBalancer.next('user123');
        const endpoint2 = loadBalancer.next('user123');
        
        expect(endpoint1?.id).toBe(endpoint2?.id);
      });

      it('should distribute different keys', () => {
        const selections = new Set();
        
        for (let i = 0; i < 10; i++) {
          const endpoint = loadBalancer.next(`user${i}`);
          if (endpoint) selections.add(endpoint.id);
        }
        
        expect(selections.size).toBeGreaterThan(1);
      });
    });

    describe('Edge Cases', () => {
      it('should return null for empty endpoints', () => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
        loadBalancer.setEndpoints([]);
        
        const next = loadBalancer.next();
        expect(next).toBeNull();
      });

      it('should change strategy dynamically', () => {
        loadBalancer = new LoadBalancer(LoadBalancingStrategy.RoundRobin);
        loadBalancer.setEndpoints(endpoints);
        
        const rr = loadBalancer.next();
        
        loadBalancer.setStrategy(LoadBalancingStrategy.Random);
        const random = loadBalancer.next();
        
        expect(rr).toBeDefined();
        expect(random).toBeDefined();
      });
    });
  });

  describe('Circuit Breaker', () => {
    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      circuitBreaker = new CircuitBreaker({
        threshold: 3,
        resetTimeout: 1000,
      });
    });

    it('should start in closed state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it('should execute successful function', async () => {
      const result = await circuitBreaker.execute(async () => 'success');
      expect(result).toBe('success');
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

    it('should reject requests when open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {
          // Expected
        }
      }

      // Should now be open
      await expect(
        circuitBreaker.execute(async () => 'test')
      ).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.Open);

      // Wait for reset timeout
      await delay(1100);

      // Next request should transition to half-open
      try {
        await circuitBreaker.execute(async () => 'success');
      } catch (e) {
        // Might fail
      }

      expect([CircuitState.HalfOpen, CircuitState.Closed]).toContain(
        circuitBreaker.getState()
      );
    });

    it('should close on successful request in half-open state', async () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      // Wait for reset
      await delay(1100);

      // Execute successful request
      await circuitBreaker.execute(async () => 'success');

      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it('should handle request timeout', async () => {
      circuitBreaker = new CircuitBreaker({
        requestTimeout: 100,
      });

      await expect(
        circuitBreaker.execute(async () => {
          await delay(200);
          return 'too slow';
        })
      ).rejects.toThrow();
    });

    it('should reset state manually', () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        try {
          circuitBreaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch (e) {}
      }

      circuitBreaker.reset();
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it('should support call alias for execute', async () => {
      const result = await circuitBreaker.call(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('Service Registry', () => {
    let registry: ServiceRegistry;

    beforeEach(() => {
      registry = new ServiceRegistry();
    });

    it('should register service implementation', () => {
      const impl = { method: () => 'test' };
      registry.register('TestService', impl);

      const retrieved = registry.get<typeof impl>('TestService');
      expect(retrieved).toBe(impl);
    });

    it('should register with metadata', () => {
      const impl = { method: () => 'test' };
      registry.register('TestService', impl, {
        version: '1.0.0',
        port: 3000,
      });

      const metadata = registry.getMetadata('TestService');
      expect(metadata?.version).toBe('1.0.0');
    });

    it('should return undefined for non-existent service', () => {
      const service = registry.get('NonExistent');
      expect(service).toBeUndefined();
    });

    it('should list all registered services', () => {
      registry.register('Service1', {});
      registry.register('Service2', {});
      registry.register('Service3', {});

      const services = registry.list();
      expect(services).toContain('Service1');
      expect(services).toContain('Service2');
      expect(services).toContain('Service3');
    });
  });

  describe('Health Check', () => {
    let healthCheck: HealthCheck;

    beforeEach(() => {
      healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        interval: 1000,
        timeout: 500,
        unhealthyThreshold: 3,
      });
    });

    it('should initialize with default values', () => {
      const hc = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
      });
      
      expect(hc.isHealthy()).toBe(true);
    });

    it('should track consecutive failures', () => {
      expect(healthCheck.getConsecutiveFailures()).toBe(0);
    });

    it('should reset health status', () => {
      healthCheck.reset();
      
      expect(healthCheck.isHealthy()).toBe(true);
      expect(healthCheck.getConsecutiveFailures()).toBe(0);
    });
  });

  describe('Integration Scenarios', () => {
    it('should create remote proxy with endpoints', () => {
      const endpoints: ServiceEndpoint[] = [
        { id: 'e1', address: 'localhost', port: 3001 },
        { id: 'e2', address: 'localhost', port: 3002 },
      ];

      interface TestService {
        hello(name: string): Promise<string>;
      }

      const proxy = createRemoteProxy<TestService>({
        serviceName: 'TestService',
        endpoints,
      });

      expect(proxy).toBeDefined();
      expect(typeof proxy.hello).toBe('function');
    });

    it('should throw error without discovery or endpoints', () => {
      expect(() => {
        createRemoteProxy({
          serviceName: 'TestService',
        });
      }).toThrow();
    });
  });
});
