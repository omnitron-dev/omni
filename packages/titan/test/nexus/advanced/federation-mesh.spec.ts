/**
 * Module Federation and Service Mesh Tests
 * Tests for distributed module loading and service discovery
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import {
  Container,
  createToken
} from '../../../src/nexus/index.js';
import {
  ModuleFederationContainer,
  createFederatedModule,
  createLazyModule,
  RemoteModule,
  SharedDependencies
} from '../../../src/nexus/federation.js';
import {
  ConsulServiceDiscovery,
  LoadBalancer,
  LoadBalancingStrategy,
  CircuitBreaker,
  ServiceProxy,
  createRemoteProxy,
  HealthCheck,
  ServiceEndpoint
} from '../../../src/nexus/mesh.js';

describe('Module Federation', () => {
  let federation: ModuleFederationContainer;

  beforeEach(() => {
    federation = new ModuleFederationContainer();
  });

  afterEach(async () => {
    await federation.dispose();
  });

  describe('Remote Module Loading', () => {
    it('should load remote module', async () => {
      const remoteUrl = 'http://remote-service/module';

      // Mock fetch for remote module
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          name: 'RemoteModule',
          version: '1.0.0',
          exports: ['ServiceA', 'ServiceB']
        })
      });

      const remoteModule = await createFederatedModule({
        name: 'remote',
        remoteUrl,
        exports: ['ServiceA', 'ServiceB']
      });

      await federation.loadRemoteModule(remoteModule);

      expect(federation.hasModule('remote')).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(remoteUrl, expect.objectContaining({
        headers: expect.objectContaining({
          'Accept': 'application/javascript'
        })
      }));
    });

    it('should handle remote module failure with fallback', async () => {
      const fallbackModule = {
        name: 'FallbackModule',
        providers: [
          {
            provide: createToken('Service'),
            useValue: 'fallback-service'
          }
        ]
      };

      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const remoteModule = await createFederatedModule({
        name: 'remote',
        remoteUrl: 'http://failing-remote/module',
        fallback: fallbackModule
      });

      const loaded = await federation.loadRemoteModule(remoteModule);

      expect(loaded.name).toBe('FallbackModule');
    });

    it('should retry failed remote module loading', async () => {
      let attempts = 0;

      global.fetch = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ name: 'RemoteModule' })
        });
      });

      const remoteModule = await createFederatedModule({
        name: 'remote',
        remoteUrl: 'http://remote/module',
        retry: {
          maxAttempts: 3,
          delay: 10
        }
      });

      await federation.loadRemoteModule(remoteModule);

      expect(attempts).toBe(3);
      expect(federation.hasModule('remote')).toBe(true);
    });

    it('should cache remote modules', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'CachedModule' })
      });

      global.fetch = fetchMock;

      const remoteModule = await createFederatedModule({
        name: 'cached',
        remoteUrl: 'http://remote/cached',
        cache: {
          ttl: 60000
        }
      });

      // Load twice
      await federation.loadRemoteModule(remoteModule);
      await federation.loadRemoteModule(remoteModule);

      // Should only fetch once due to caching
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Lazy Module Loading', () => {
    it('should load module lazily on first access', async () => {
      let loaded = false;

      const lazyModule = createLazyModule(() => {
        loaded = true;
        return Promise.resolve({
          name: 'LazyModule',
          providers: [
            {
              provide: createToken('LazyService'),
              useValue: 'lazy-value'
            }
          ]
        });
      });

      expect(loaded).toBe(false);

      await federation.loadLazyModule(lazyModule);

      expect(loaded).toBe(false); // Still not loaded

      // Access module triggers loading
      const module = await lazyModule.load();

      expect(loaded).toBe(true);
      expect(module.name).toBe('LazyModule');
    });

    it('should support conditional lazy loading', async () => {
      const condition = { shouldLoad: false };

      const lazyModule = createLazyModule(
        () => import('./test-module'),
        {
          condition: () => condition.shouldLoad
        }
      );

      const result1 = await lazyModule.shouldLoad();
      expect(result1).toBe(false);

      condition.shouldLoad = true;

      const result2 = await lazyModule.shouldLoad();
      expect(result2).toBe(true);
    });
  });

  describe('Shared Dependencies', () => {
    it('should share dependencies between modules', async () => {
      const sharedToken = createToken<string>('Shared');

      const moduleA = {
        name: 'ModuleA',
        providers: [
          {
            provide: createToken('ServiceA'),
            useFactory: (shared: string) => `A-${shared}`,
            inject: [sharedToken]
          }
        ]
      };

      const moduleB = {
        name: 'ModuleB',
        providers: [
          {
            provide: createToken('ServiceB'),
            useFactory: (shared: string) => `B-${shared}`,
            inject: [sharedToken]
          }
        ]
      };

      const shared: SharedDependencies = {
        [sharedToken.toString()]: {
          version: '1.0.0',
          singleton: true,
          provider: { useValue: 'shared-value' }
        }
      };

      await federation.loadModuleWithShared(moduleA, shared);
      await federation.loadModuleWithShared(moduleB, shared);

      const container = federation.createContainer();

      const serviceA = container.resolve(createToken('ServiceA'));
      const serviceB = container.resolve(createToken('ServiceB'));

      expect(serviceA).toBe('A-shared-value');
      expect(serviceB).toBe('B-shared-value');
    });

    it('should handle version conflicts in shared dependencies', async () => {
      const sharedToken = createToken('Shared');

      const moduleA = {
        name: 'ModuleA',
        requiredShared: {
          [sharedToken.toString()]: '^1.0.0'
        }
      };

      const moduleB = {
        name: 'ModuleB',
        requiredShared: {
          [sharedToken.toString()]: '^2.0.0'
        }
      };

      const shared: SharedDependencies = {
        [sharedToken.toString()]: {
          version: '1.5.0',
          singleton: true,
          provider: { useValue: 'v1.5' }
        }
      };

      await federation.loadModuleWithShared(moduleA, shared);

      // Should warn about version conflict
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      await federation.loadModuleWithShared(moduleB, shared);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Version conflict')
      );

      warnSpy.mockRestore();
    });
  });
});

describe('Service Mesh', () => {
  let container: Container;
  let discovery: ConsulServiceDiscovery;
  let loadBalancer: LoadBalancer;

  beforeEach(() => {
    container = new Container();
    discovery = new ConsulServiceDiscovery({
      host: 'localhost',
      port: 8500
    });
    loadBalancer = new LoadBalancer();
  });

  afterEach(async () => {
    await container.dispose();
    discovery.stop();
    await discovery.close();
  });

  describe('Service Discovery', () => {
    it('should register service with Consul', async () => {
      const mockConsul = {
        agent: {
          service: {
            register: jest.fn().mockResolvedValue(true)
          }
        }
      };

      discovery['consul'] = mockConsul as any;

      await discovery.register({
        id: 'service-1',
        name: 'test-service',
        address: '127.0.0.1',
        port: 3000,
        tags: ['api', 'v1'],
        check: {
          http: 'http://127.0.0.1:3000/health',
          interval: '10s'
        }
      });

      expect(mockConsul.agent.service.register).toHaveBeenCalledWith({
        id: 'service-1',
        name: 'test-service',
        address: '127.0.0.1',
        port: 3000,
        tags: ['api', 'v1'],
        check: {
          http: 'http://127.0.0.1:3000/health',
          interval: '10s'
        }
      });
    });

    it('should discover services', async () => {
      const mockConsul = {
        health: {
          service: jest.fn().mockResolvedValue([
            {
              Service: {
                ID: 'service-1',
                Service: 'test-service',
                Address: '127.0.0.1',
                Port: 3000
              }
            },
            {
              Service: {
                ID: 'service-2',
                Service: 'test-service',
                Address: '127.0.0.2',
                Port: 3001
              }
            }
          ])
        }
      };

      discovery['consul'] = mockConsul as any;

      const services = await discovery.discover('test-service');

      expect(services).toHaveLength(2);
      expect(services[0]).toMatchObject({
        id: 'service-1',
        name: 'test-service',
        address: '127.0.0.1',
        port: 3000
      });
      expect(services[1]).toMatchObject({
        id: 'service-2',
        name: 'test-service',
        address: '127.0.0.2',
        port: 3001
      });
    });

    it('should watch service changes', async () => {
      const changes: any[] = [];

      // Mock the agent service register for this test
      const mockConsul = {
        agent: {
          service: {
            register: jest.fn().mockResolvedValue(undefined)
          }
        }
      };

      discovery['consul'] = mockConsul as any;

      // Set up a watcher
      discovery.watch('test-service', (services) => {
        changes.push(services);
      });

      // Register a new service to trigger the watcher
      await discovery.register({
        id: 'new-service',
        name: 'test-service',
        address: '127.0.0.3',
        port: 3002
      });

      // The watcher should have been called
      expect(changes).toHaveLength(1);
      expect(changes[0][0].id).toBe('new-service');
    });
  });

  describe('Load Balancing', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: '1', address: '127.0.0.1', port: 3000, weight: 1 },
      { id: '2', address: '127.0.0.2', port: 3001, weight: 2 },
      { id: '3', address: '127.0.0.3', port: 3002, weight: 1 }
    ];

    it('should use round-robin strategy', () => {
      loadBalancer.setStrategy(LoadBalancingStrategy.RoundRobin);
      loadBalancer.setEndpoints(endpoints);

      const selected = [];
      for (let i = 0; i < 6; i++) {
        selected.push(loadBalancer.next()?.id);
      }

      expect(selected).toEqual(['1', '2', '3', '1', '2', '3']);
    });

    it('should use random strategy', () => {
      loadBalancer.setStrategy(LoadBalancingStrategy.Random);
      loadBalancer.setEndpoints(endpoints);

      const selected = new Set();
      for (let i = 0; i < 10; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) selected.add(endpoint.id);
      }

      // Should select different endpoints randomly
      expect(selected.size).toBeGreaterThan(1);
    });

    it('should use weighted round-robin', () => {
      loadBalancer.setStrategy(LoadBalancingStrategy.WeightedRoundRobin);
      loadBalancer.setEndpoints(endpoints);

      const counts: Record<string, number> = {};
      for (let i = 0; i < 12; i++) {
        const endpoint = loadBalancer.next();
        if (endpoint) {
          counts[endpoint.id] = (counts[endpoint.id] || 0) + 1;
        }
      }

      // Endpoint 2 has weight 2, should be selected twice as often
      expect(counts['2']).toBeGreaterThan(counts['1']);
      expect(counts['2']).toBeGreaterThan(counts['3']);
    });

    it('should use least connections strategy', () => {
      loadBalancer.setStrategy(LoadBalancingStrategy.LeastConnections);
      loadBalancer.setEndpoints(endpoints);

      // Simulate active connections
      loadBalancer.incrementConnections('1');
      loadBalancer.incrementConnections('1');
      loadBalancer.incrementConnections('2');

      const next = loadBalancer.next();
      expect(next?.id).toBe('3'); // Should select endpoint with least connections
    });

    it('should use consistent hash strategy', () => {
      loadBalancer.setStrategy(LoadBalancingStrategy.ConsistentHash);
      loadBalancer.setEndpoints(endpoints);

      const key1 = 'user-123';
      const key2 = 'user-456';

      const endpoint1a = loadBalancer.next(key1);
      const endpoint1b = loadBalancer.next(key1);
      const endpoint2 = loadBalancer.next(key2);

      // Same key should always select same endpoint
      expect(endpoint1a?.id).toBe(endpoint1b?.id);
      // Different keys might select different endpoints
      expect([endpoints[0].id, endpoints[1].id, endpoints[2].id]).toContain(endpoint2?.id);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const breaker = new CircuitBreaker({
        threshold: 2,
        resetTimeout: 100,
        requestTimeout: 50
      });

      const failingCall = async () => {
        throw new Error('Service unavailable');
      };

      // First two calls fail
      await expect(breaker.call(failingCall)).rejects.toThrow('Service unavailable');
      await expect(breaker.call(failingCall)).rejects.toThrow('Service unavailable');

      // Circuit should be open
      expect(breaker.getState()).toBe('open');

      // Next call should fail immediately
      await expect(breaker.call(failingCall)).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker({
        threshold: 1,
        resetTimeout: 50
      });

      let shouldFail = true;
      const call = async () => {
        if (shouldFail) throw new Error('Failed');
        return 'success';
      };

      // Open the circuit
      await expect(breaker.call(call)).rejects.toThrow('Failed');
      expect(breaker.getState()).toBe('open');

      // Fix the service
      shouldFail = false;

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should be half-open and try the call
      const result = await breaker.call(call);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('closed');
    });

    it('should handle request timeout', async () => {
      const breaker = new CircuitBreaker({
        requestTimeout: 50
      });

      const slowCall = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'too-late';
      };

      await expect(breaker.call(slowCall)).rejects.toThrow('Request timeout');
    });
  });

  describe('Service Proxy', () => {
    it('should create remote service proxy', () => {
      interface RemoteService {
        getData(): Promise<string>;
        processData(data: string): Promise<void>;
      }

      const proxy = createRemoteProxy<RemoteService>({
        serviceName: 'remote-service',
        discovery,
        loadBalancer
      });

      expect(proxy).toBeDefined();
      expect(typeof proxy.getData).toBe('function');
      expect(typeof proxy.processData).toBe('function');
    });

    it('should route calls through load balancer', async () => {
      interface ApiService {
        getUser(id: string): Promise<{ id: string; name: string }>;
      }

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: '1', name: 'John' })
      });

      global.fetch = mockFetch;

      const proxy = createRemoteProxy<ApiService>({
        serviceName: 'api-service',
        endpoints: [
          { id: '1', address: 'api1.example.com', port: 80 },
          { id: '2', address: 'api2.example.com', port: 80 }
        ],
        loadBalancer
      });

      const user = await proxy.getUser('1');

      expect(user).toEqual({ id: '1', name: 'John' });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should retry failed requests', async () => {
      interface Service {
        call(): Promise<string>;
      }

      let attempts = 0;
      const mockFetch = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => 'success'
        });
      });

      global.fetch = mockFetch;

      const proxy = createRemoteProxy<Service>({
        serviceName: 'retry-service',
        endpoints: [{ id: '1', address: 'localhost', port: 3000 }],
        retry: {
          maxAttempts: 3,
          delay: 10
        }
      });

      const result = await proxy.call();

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  describe('Health Checks', () => {
    it('should perform health check', async () => {
      const healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        interval: 1000,
        timeout: 500
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'healthy' })
      });

      const result = await healthCheck.check();

      expect(result.healthy).toBe(true);
      expect(result.status).toBe('healthy');
    });

    it('should mark unhealthy on failure', async () => {
      const healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health'
      });

      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await healthCheck.check();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should track consecutive failures', async () => {
      const healthCheck = new HealthCheck({
        endpoint: 'http://localhost:3000/health',
        unhealthyThreshold: 3
      });

      global.fetch = jest.fn().mockRejectedValue(new Error('Failed'));

      for (let i = 0; i < 3; i++) {
        await healthCheck.check();
      }

      expect(healthCheck.isHealthy()).toBe(false);
      expect(healthCheck.getConsecutiveFailures()).toBe(3);
    });
  });
});
