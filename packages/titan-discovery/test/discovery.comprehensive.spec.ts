/**
 * Comprehensive test suite for Discovery Module
 *
 * This file consolidates all discovery tests into a single, well-organized test suite
 * that provides complete coverage of the DiscoveryService functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { Redis } from 'ioredis';
import { Container } from '@omnitron-dev/titan/nexus';
import { REDIS_MANAGER } from '@omnitron-dev/titan-redis';
import { DiscoveryService } from '../src/discovery.service.js';
import { createDiscoveryModule } from '../src/discovery.module.js';
import {
  REDIS_TOKEN,
  LOGGER_TOKEN,
  DISCOVERY_OPTIONS_TOKEN,
  DISCOVERY_SERVICE_TOKEN,
  type ServiceInfo,
  type DiscoveryOptions,
} from '../src/types.js';
import {
  createTestRedisClient,
  cleanupRedis,
  createMockLogger,
  waitFor,
  isRedisInMockMode,
} from './test-utils.js';

/**
 * Is real Redis actually reachable?
 *
 * This used to answer by looking for `.redis-test-info.json` in `process.cwd()`
 * and returning false when it was absent. Only `packages/titan/globalSetup.ts`
 * writes that file, and it writes it into titan's OWN directory — so from this
 * package the file is never there, and all 31 tests below were skipped on every
 * run regardless of whether Redis was up. The other 90 tests in this package
 * ran fine the whole time, because `getTestRedisConfig()` falls back to the
 * compose stack; only this file asked the question a different way and got a
 * different answer.
 *
 * Ask Redis instead of asking the filesystem about Redis.
 */
async function isRealRedisAvailable(): Promise<boolean> {
  if (isRedisInMockMode()) return false;
  const client = createTestRedisClient(15);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

// Decided once, before the suite is registered.
const redisAvailable = await isRealRedisAvailable();
if (!redisAvailable) {
  console.warn('[SKIP] Discovery comprehensive tests require real Redis');
}
const describeWithRedis = redisAvailable ? describe : describe.skip;

describeWithRedis('Discovery Module - Comprehensive Tests', () => {
  let redis: Redis;
  let service: DiscoveryService;
  let container: Container;
  let logger: ReturnType<typeof createMockLogger>;

  beforeAll(async () => {
    if (!isRealRedisAvailable()) {
      console.log('[SKIP] Discovery tests require real Redis - skipping');
      return;
    }
    // Verify Redis connectivity
    const testRedis = createTestRedisClient(15);
    try {
      await testRedis.connect();
      await testRedis.ping();
      await testRedis.disconnect();
    } catch (error) {
      console.error('Redis is not running. Please start Redis server.');
      throw error;
    }
  });

  beforeEach(async () => {
    if (!isRealRedisAvailable()) return;
    redis = createTestRedisClient(15);
    await redis.connect();
    await cleanupRedis(redis);
    logger = createMockLogger();
    container = new Container();
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.onStop();
      } catch {
        // Ignore stop errors
      }
      service = null as any;
    }
    if (redis) {
      try {
        await cleanupRedis(redis);
        await redis.disconnect();
      } catch {
        // Ignore cleanup errors if redis was not properly initialized
      }
    }
    vi.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should initialize with default options', async () => {
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DiscoveryService, { useClass: DiscoveryService });

      service = container.resolve(DiscoveryService);

      expect(service).toBeDefined();
      expect(service.getNodeId()).toMatch(/^titan-\d+-\d+-\w+$/);
      expect(service.getAddress()).toBeDefined();
      expect(service.getServices()).toEqual([]);
      expect(service.isRegistered()).toBe(false);
    });

    it('should initialize with custom options', async () => {
      const options: DiscoveryOptions = {
        heartbeatInterval: 10000,
        heartbeatTTL: 30000,
        clientMode: false,
        pubSubEnabled: true,
        pubSubChannel: 'custom:channel',
        redisPrefix: 'custom:prefix',
        maxRetries: 5,
        retryDelay: 2000,
      };

      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, { useValue: options });
      container.register(DiscoveryService, { useClass: DiscoveryService });

      service = container.resolve(DiscoveryService);

      expect(service).toBeDefined();
      // Options are stored privately, but we can test their effects
      expect(service.isRegistered()).toBe(false);
    });

    it('should initialize in client mode', async () => {
      const options: DiscoveryOptions = { clientMode: true };

      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, { useValue: options });
      container.register(DiscoveryService, { useClass: DiscoveryService });

      service = container.resolve(DiscoveryService);
      await service.onStart();

      expect(service.isRegistered()).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('client mode'));
    });

    it('should throw if Redis is not provided', () => {
      const emptyContainer = new Container();
      emptyContainer.register(LOGGER_TOKEN, { useValue: logger });
      emptyContainer.register(DiscoveryService, { useClass: DiscoveryService });

      // Need to provide an empty REDIS_TOKEN to trigger the check
      emptyContainer.register(REDIS_TOKEN, { useValue: null });

      expect(() => emptyContainer.resolve(DiscoveryService)).toThrow(
        'Redis instance must be provided for DiscoveryService'
      );
    });
  });

  describe('Node Registration and Heartbeat', () => {
    beforeEach(() => {
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000, heartbeatTTL: 3000 },
      });
      container.register(DiscoveryService, { useClass: DiscoveryService });
      service = container.resolve(DiscoveryService);
    });

    it('should register node on start', async () => {
      await service.onStart();

      // Wait for registration
      await waitFor(() => service.isRegistered(), 2000);

      expect(service.isRegistered()).toBe(true);

      // Verify node exists in Redis
      const nodeId = service.getNodeId();
      const nodeKey = `titan:discovery:nodes:${nodeId}`;
      const nodeData = await redis.hgetall(nodeKey);

      expect(nodeData).toBeTruthy();
      expect(nodeData.address).toBe(service.getAddress());
      expect(JSON.parse(nodeData.services)).toEqual([]);
    });

    it('should not register in client mode', async () => {
      const clientService = createClientModeService();
      await clientService.onStart();

      expect(clientService.isRegistered()).toBe(false);

      const nodeId = clientService.getNodeId();
      const nodeKey = `titan:discovery:nodes:${nodeId}`;
      const exists = await redis.exists(nodeKey);

      expect(exists).toBe(0);

      await clientService.onStop();
    });

    it('should send periodic heartbeats', async () => {
      vi.useFakeTimers();

      await service.onStart();
      await waitFor(() => service.isRegistered(), 2000);

      const nodeId = service.getNodeId();
      const heartbeatKey = `titan:discovery:heartbeat:${nodeId}`;

      // Check initial heartbeat
      let ttl1 = await redis.pttl(heartbeatKey);
      expect(ttl1).toBeGreaterThan(0);
      expect(ttl1).toBeLessThanOrEqual(3000);

      // Advance time and check heartbeat renewal
      vi.advanceTimersByTime(1000);
      await Promise.resolve(); // Let promises settle

      const ttl2 = await redis.pttl(heartbeatKey);
      expect(ttl2).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it('should handle heartbeat retry on failure', async () => {
      // Simulate Redis failure
      const originalEval = redis.eval.bind(redis);
      let callCount = 0;
      redis.eval = vi.fn().mockImplementation(async (...args) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Redis error');
        }
        return originalEval(...args);
      });

      await service.onStart();

      // Should retry and succeed
      await waitFor(() => service.isRegistered(), 3000);
      expect(service.isRegistered()).toBe(true);
      expect(redis.eval).toHaveBeenCalledTimes(2);
    });

    it('should stop heartbeats when service stops', async () => {
      await service.onStart();
      await waitFor(() => service.isRegistered(), 2000);

      await service.onStop();

      // Heartbeat timer should be cleared
      const nodeId = service.getNodeId();
      const heartbeatKey = `titan:discovery:heartbeat:${nodeId}`;

      // Wait a bit and check that heartbeat is not renewed
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const ttl = await redis.pttl(heartbeatKey);

      // Should be expired or very low
      expect(ttl).toBeLessThanOrEqual(1000);
    });
  });

  describe('Service Management', () => {
    beforeEach(async () => {
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000 },
      });
      container.register(DiscoveryService, { useClass: DiscoveryService });
      service = container.resolve(DiscoveryService);
      await service.onStart();
      await waitFor(() => service.isRegistered(), 2000);
    });

    it('should register a service', async () => {
      const serviceInfo: ServiceInfo = { name: 'TestService', version: '1.0.0' };

      await service.registerService(serviceInfo);

      const services = service.getServices();
      expect(services).toContainEqual(serviceInfo);

      // Verify in Redis
      const nodeId = service.getNodeId();
      const nodeData = await redis.hgetall(`titan:discovery:nodes:${nodeId}`);
      const storedServices = JSON.parse(nodeData.services);

      expect(storedServices).toContainEqual(serviceInfo);
    });

    it('should register multiple services', async () => {
      const services: ServiceInfo[] = [
        { name: 'Service1', version: '1.0.0' },
        { name: 'Service2', version: '2.0.0' },
      ];

      for (const svc of services) {
        await service.registerService(svc);
      }

      const registeredServices = service.getServices();
      expect(registeredServices).toEqual(services);
    });

    it('should unregister a service', async () => {
      const service1: ServiceInfo = { name: 'Service1', version: '1.0.0' };
      const service2: ServiceInfo = { name: 'Service2', version: '2.0.0' };

      await service.registerService(service1);
      await service.registerService(service2);

      await service.unregisterService('Service1');

      const services = service.getServices();
      expect(services).toEqual([service2]);
    });

    it('should update services', async () => {
      const initialService: ServiceInfo = { name: 'Service1', version: '1.0.0' };
      await service.registerService(initialService);

      const newServices: ServiceInfo[] = [
        { name: 'Service2', version: '2.0.0' },
        { name: 'Service3', version: '3.0.0' },
      ];

      await service.updateServices(newServices);

      const services = service.getServices();
      expect(services).toEqual(newServices);
    });

    it('should handle duplicate service registration', async () => {
      const serviceInfo: ServiceInfo = { name: 'TestService', version: '1.0.0' };

      await service.registerService(serviceInfo);
      await service.registerService(serviceInfo);

      const services = service.getServices();
      expect(services).toEqual([serviceInfo]);
    });
  });

  describe('Service Discovery', () => {
    let service1: DiscoveryService;
    let service2: DiscoveryService;

    beforeEach(async () => {
      // Create first service
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000 },
      });
      container.register(DiscoveryService, { useClass: DiscoveryService });
      service1 = container.resolve(DiscoveryService);

      // Create second service with new container
      const container2 = new Container();
      container2.register(REDIS_TOKEN, { useValue: redis });
      container2.register(LOGGER_TOKEN, { useValue: createMockLogger() });
      container2.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000 },
      });
      container2.register(DiscoveryService, { useClass: DiscoveryService });
      service2 = container2.resolve(DiscoveryService);

      // Start and register services
      await service1.onStart();
      await service1.registerService({ name: 'Service1', version: '1.0.0' });
      await waitFor(() => service1.isRegistered(), 2000);

      await service2.onStart();
      await service2.registerService({ name: 'Service2', version: '2.0.0' });
      await service2.registerService({ name: 'SharedService', version: '1.0.0' });
      await waitFor(() => service2.isRegistered(), 2000);
    });

    afterEach(async () => {
      // `onStop()`, not `stop()` — DiscoveryService has never had a `stop`.
      // Every other block in this file already called it correctly; this one
      // threw in afterEach and failed all seven of its tests. It went
      // unnoticed because the whole file was gated on a `.redis-test-info.json`
      // that this package never writes, so none of it had run.
      await service1?.onStop();
      await service2?.onStop();
    });

    it('should find all active nodes', async () => {
      const nodes = await service1.findNodes();

      expect(nodes).toHaveLength(2);

      const nodeIds = nodes.map((n) => n.nodeId);
      expect(nodeIds).toContain(service1.getNodeId());
      expect(nodeIds).toContain(service2.getNodeId());
    });

    it('should find nodes by service', async () => {
      const nodes = await service1.findNodesByService('Service2');

      expect(nodes).toHaveLength(1);
      expect(nodes[0].nodeId).toBe(service2.getNodeId());
    });

    it('should find nodes by service and version', async () => {
      const nodes = await service1.findNodesByService('SharedService', '1.0.0');

      expect(nodes).toHaveLength(1);
      expect(nodes[0].nodeId).toBe(service2.getNodeId());
    });

    it('should return empty array for non-existent service', async () => {
      const nodes = await service1.findNodesByService('NonExistentService');

      expect(nodes).toEqual([]);
    });

    it('should check if node exists', async () => {
      const exists1 = await service1.nodeExists(service2.getNodeId());
      const exists2 = await service1.nodeExists('non-existent-node');

      expect(exists1).toBe(true);
      expect(exists2).toBe(false);
    });

    it('should get node info', async () => {
      const nodeInfo = await service1.getNodeInfo(service2.getNodeId());

      expect(nodeInfo).toBeTruthy();
      expect(nodeInfo?.nodeId).toBe(service2.getNodeId());
      expect(nodeInfo?.services).toHaveLength(2);
    });

    it('should filter inactive nodes', async () => {
      // Stop service2 to make it inactive
      await service2.onStop();

      // Wait for heartbeat to expire
      await new Promise((resolve) => setTimeout(resolve, 3500));

      const activeNodes = await service1.findNodes();

      expect(activeNodes).toHaveLength(1);
      expect(activeNodes[0].nodeId).toBe(service1.getNodeId());
    });
  });

  describe('Address Management', () => {
    beforeEach(async () => {
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000 },
      });
      container.register(DiscoveryService, { useClass: DiscoveryService });
      service = container.resolve(DiscoveryService);
      await service.onStart();
      await waitFor(() => service.isRegistered(), 2000);
    });

    it('should update node address', async () => {
      const newAddress = '192.168.1.100:8080';

      await service.updateAddress(newAddress);

      expect(service.getAddress()).toBe(newAddress);

      // Verify in Redis
      const nodeId = service.getNodeId();
      const nodeData = await redis.hgetall(`titan:discovery:nodes:${nodeId}`);

      expect(nodeData.address).toBe(newAddress);
    });

    it('should update services and address simultaneously', async () => {
      const newAddress = '192.168.1.100:8080';
      const newServices: ServiceInfo[] = [{ name: 'UpdatedService', version: '3.0.0' }];

      await service.updateAddress(newAddress);
      await service.updateServices(newServices);

      expect(service.getAddress()).toBe(newAddress);
      expect(service.getServices()).toEqual(newServices);
    });
  });

  describe('Graceful Shutdown', () => {
    beforeEach(async () => {
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000 },
      });
      container.register(DiscoveryService, { useClass: DiscoveryService });
      service = container.resolve(DiscoveryService);
      await service.onStart();
      await waitFor(() => service.isRegistered(), 2000);
    });

    it('should deregister node on stop', async () => {
      const nodeId = service.getNodeId();

      await service.onStop();

      // Node should be removed from Redis
      const exists = await redis.exists(`titan:discovery:nodes:${nodeId}`);
      expect(exists).toBe(0);

      // Node should be removed from index
      const members = await redis.smembers('titan:discovery:index:nodes');
      expect(members).not.toContain(nodeId);
    });

    it('should handle multiple stop calls gracefully', async () => {
      const promise1 = service.onStop();
      const promise2 = service.onStop();
      const promise3 = service.onStop();

      await Promise.all([promise1, promise2, promise3]);

      // Should not throw and should complete successfully
      expect(true).toBe(true);
    });

    it('should clean up PubSub subscriptions', async () => {
      const pubSubService = createPubSubEnabledService();
      await pubSubService.onStart();
      await waitFor(() => pubSubService.isRegistered(), 2000);

      await pubSubService.onStop();

      // Verify logger was called for cleanup
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Unsubscribed from PubSub'));
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      container.register(REDIS_TOKEN, { useValue: redis });
      container.register(LOGGER_TOKEN, { useValue: logger });
      container.register(DISCOVERY_OPTIONS_TOKEN, {
        useValue: { heartbeatInterval: 1000, maxRetries: 3 },
      });
      container.register(DiscoveryService, { useClass: DiscoveryService });
      service = container.resolve(DiscoveryService);
    });

    it('should handle Redis connection errors gracefully', async () => {
      // Mock Redis error
      redis.eval = vi.fn().mockRejectedValue(new Error('Connection error'));

      await service.onStart();

      // Should log error but not throw
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('failed')
      );

      expect(service.isRegistered()).toBe(false);
    });

    it('should handle service discovery errors', async () => {
      await service.onStart();

      // Mock Redis error for discovery
      redis.smembers = vi.fn().mockRejectedValue(new Error('Discovery error'));

      const nodes = await service.findNodes();

      // Should return empty array on error
      expect(nodes).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should prevent starting a stopped service', async () => {
      await service.onStart();
      await service.onStop();

      await expect(service.onStart()).rejects.toThrow('Cannot start a stopped DiscoveryService');
    });
  });

  describe('Module Integration', () => {
    /**
     * `createDiscoveryModule()` returns a DynamicModule — a declaration of
     * providers — and the framework is what registers them. These two tests
     * used to call `module.onRegister(mockApp)`, a hook that no longer exists:
     * providers moved to `forRoot()` so they are available during
     * `eagerlyInitialize()`, and the module instance kept only the runtime
     * hooks. Both were skipped as "needs proper Application context", which
     * left the module's own wiring untested.
     *
     * Registering the declared providers is what an Application does with a
     * DynamicModule, so do exactly that.
     */
    const applyModule = (target: Container, module: ReturnType<typeof createDiscoveryModule>): void => {
      for (const [token, provider] of module.providers ?? []) {
        target.register(token as never, provider as never);
      }
    };

    /**
     * The module declares REDIS_TOKEN itself, bridging from `REDIS_MANAGER`.
     * So a consumer supplies the MANAGER, exactly as RedisModule does — a test
     * that registers REDIS_TOKEN directly collides with the module's own
     * provider and never exercises the bridge.
     */
    const registerRedisManager = (target: Container, log = logger): void => {
      target.register(LOGGER_TOKEN, { useValue: log });
      target.register(REDIS_MANAGER as never, {
        useValue: { getInternalClient: () => redis },
      } as never);
    };

    it('declares the providers a consumer resolves the service through', async () => {
      container = new Container();
      registerRedisManager(container);

      const module = createDiscoveryModule({
        heartbeatInterval: 1000,
        clientMode: false,
        // No redisUrl/redisOptions, so the module bridges REDIS_TOKEN from
        // REDIS_MANAGER — the path a real app takes, and the one worth
        // covering.
        enableNetronIntegration: false,
      });

      applyModule(container, module);

      expect(container.has(DISCOVERY_SERVICE_TOKEN)).toBe(true);
      expect(module.exports).toContain(DISCOVERY_SERVICE_TOKEN);

      const moduleService = container.resolve(DISCOVERY_SERVICE_TOKEN) as DiscoveryService;
      expect(moduleService).toBeInstanceOf(DiscoveryService);

      // The options declared by forRoot must be the ones the service sees —
      // that join is the whole purpose of the module.
      expect(container.resolve(DISCOVERY_OPTIONS_TOKEN)).toMatchObject({
        heartbeatInterval: 1000,
        clientMode: false,
      });

      await moduleService.onStart();
      await waitFor(() => moduleService.isRegistered(), 3000);
      expect(moduleService.isRegistered()).toBe(true);

      await moduleService.onStop();
    });

    it('should share discovery between multiple modules', async () => {
      const container1 = new Container();
      registerRedisManager(container1);
      applyModule(container1, createDiscoveryModule({ heartbeatInterval: 1000, enableNetronIntegration: false }));

      const container2 = new Container();
      registerRedisManager(container2, createMockLogger());
      applyModule(container2, createDiscoveryModule({ heartbeatInterval: 1000, enableNetronIntegration: false }));

      const service1 = container1.resolve(DISCOVERY_SERVICE_TOKEN) as DiscoveryService;
      const service2 = container2.resolve(DISCOVERY_SERVICE_TOKEN) as DiscoveryService;

      await service1.onStart();
      await service1.registerService({ name: 'ModuleService1', version: '1.0.0' });

      await service2.onStart();
      await service2.registerService({ name: 'ModuleService2', version: '2.0.0' });

      await waitFor(() => service1.isRegistered() && service2.isRegistered(), 3000);

      // Two independently-wired modules on one Redis see each other.
      const nodes1 = await service1.findNodes();
      const nodes2 = await service2.findNodes();

      expect(nodes1).toHaveLength(2);
      expect(nodes2).toHaveLength(2);

      await service1.onStop();
      await service2.onStop();
    });
  });

  // Helper functions for creating services with specific configurations
  function createClientModeService(): DiscoveryService {
    const clientContainer = new Container();
    clientContainer.register(REDIS_TOKEN, { useValue: redis });
    clientContainer.register(LOGGER_TOKEN, { useValue: logger });
    clientContainer.register(DISCOVERY_OPTIONS_TOKEN, {
      useValue: { clientMode: true },
    });
    clientContainer.register(DiscoveryService, { useClass: DiscoveryService });
    return clientContainer.resolve(DiscoveryService);
  }

  function createPubSubEnabledService(): DiscoveryService {
    const pubSubContainer = new Container();
    pubSubContainer.register(REDIS_TOKEN, { useValue: redis });
    pubSubContainer.register(LOGGER_TOKEN, { useValue: logger });
    pubSubContainer.register(DISCOVERY_OPTIONS_TOKEN, {
      useValue: {
        heartbeatInterval: 1000,
        pubSubEnabled: true,
        pubSubChannel: 'test:channel',
      },
    });
    pubSubContainer.register(DiscoveryService, { useClass: DiscoveryService });
    return pubSubContainer.resolve(DiscoveryService);
  }
});
