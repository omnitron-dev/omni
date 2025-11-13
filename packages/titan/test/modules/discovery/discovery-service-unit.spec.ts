/**
 * Discovery Service Core Unit Tests
 * Tests core functionality with mocked Redis
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Redis } from 'ioredis';
import { DiscoveryService } from '../../../src/modules/discovery/discovery.service.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';
import type { ServiceInfo, DiscoveryOptions } from '../../../src/modules/discovery/types.js';
import { createTestRedisClient, cleanupRedis, createMockLogger } from './test-utils.js';

describe('DiscoveryService - Core Unit Tests', () => {
  let redis: Redis;
  let logger: ILogger;
  let service: DiscoveryService;

  beforeAll(async () => {
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
    redis = createTestRedisClient(15);
    await redis.connect();
    await cleanupRedis(redis);
    logger = createMockLogger();
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.stop();
      } catch (e) {
        // ignore
      }
      service = null as any;
    }
    await cleanupRedis(redis);
    await redis.disconnect();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should throw if Redis is not provided', () => {
      expect(() => new DiscoveryService(null as any, logger)).toThrow(
        'Redis instance must be provided for DiscoveryService'
      );
    });

    it('should initialize with default options', () => {
      service = new DiscoveryService(redis, logger);
      
      expect(service.getNodeId()).toBeTruthy();
      expect(service.getAddress()).toBeTruthy();
      expect(service.getServices()).toEqual([]);
      expect(service.isRegistered()).toBe(false);
    });

    it('should generate unique node IDs', () => {
      const service1 = new DiscoveryService(redis, logger);
      const service2 = new DiscoveryService(redis, logger);
      
      expect(service1.getNodeId()).not.toBe(service2.getNodeId());
    });

    it('should accept custom options', () => {
      const options: DiscoveryOptions = {
        clientMode: true,
        heartbeatInterval: 2000,
        heartbeatTTL: 6000,
      };
      
      service = new DiscoveryService(redis, logger, options);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('client mode'));
    });
  });

  describe('Service Management', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should register a service', async () => {
      const svcInfo: ServiceInfo = { name: 'TestService', version: '1.0.0' };
      
      await service.registerService(svcInfo);
      
      const services = service.getServices();
      expect(services).toHaveLength(1);
      expect(services[0]).toEqual(svcInfo);
    });

    it('should not duplicate identical services', async () => {
      const svcInfo: ServiceInfo = { name: 'TestService', version: '1.0.0' };
      
      await service.registerService(svcInfo);
      await service.registerService(svcInfo);
      
      expect(service.getServices()).toHaveLength(1);
    });

    it('should allow different versions of same service', async () => {
      await service.registerService({ name: 'TestService', version: '1.0.0' });
      await service.registerService({ name: 'TestService', version: '2.0.0' });
      
      expect(service.getServices()).toHaveLength(2);
    });

    it('should unregister services by name', async () => {
      await service.registerService({ name: 'Service1', version: '1.0.0' });
      await service.registerService({ name: 'Service2', version: '1.0.0' });
      
      await service.unregisterService('Service1');
      
      const services = service.getServices();
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe('Service2');
    });

    it('should update all services', async () => {
      await service.registerService({ name: 'Service1', version: '1.0.0' });
      
      const newServices: ServiceInfo[] = [
        { name: 'Service2', version: '2.0.0' },
        { name: 'Service3', version: '3.0.0' },
      ];
      
      await service.updateServices(newServices);
      
      expect(service.getServices()).toEqual(newServices);
    });
  });

  describe('Address Management', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should update node address', async () => {
      const newAddress = '192.168.1.100:8080';
      
      await service.updateAddress(newAddress);
      
      expect(service.getAddress()).toBe(newAddress);
    });

    it('should detect network address', () => {
      const address = service.getAddress();
      
      expect(address).toMatch(/:\d+$/);
    });
  });

  describe('Node Operations', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should register node', async () => {
      const nodeId = 'test-node-1';
      const address = '127.0.0.1:8080';
      const services: ServiceInfo[] = [{ name: 'TestService', version: '1.0.0' }];
      
      await service.registerNode(nodeId, address, services);
      
      expect(service.getNodeId()).toBe(nodeId);
      expect(service.getAddress()).toBe(address);
      expect(service.getServices()).toEqual(services);
    });

    it('should deregister node', async () => {
      await service.start();
      const nodeId = service.getNodeId();
      
      await service.deregisterNode(nodeId);
      
      // Verify cleanup
      const exists = await redis.exists(`titan:discovery:nodes:${nodeId}`);
      expect(exists).toBe(0);
    });

    it('should check if node exists', async () => {
      await service.start();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const exists = await service.nodeExists(service.getNodeId());
      expect(typeof exists).toBe('boolean');
    });

    it('should check if node is active', async () => {
      const isActive = await service.isNodeActive('non-existent');
      expect(isActive).toBe(false);
    });

    it('should get node info', async () => {
      const info = await service.getNodeInfo('non-existent');
      expect(info).toBeNull();
    });
  });

  describe('Discovery Operations', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should find all nodes', async () => {
      const nodes = await service.findNodes();
      expect(Array.isArray(nodes)).toBe(true);
    });

    it('should find nodes by service', async () => {
      const nodes = await service.findNodesByService('NonExistent');
      expect(nodes).toEqual([]);
    });

    it('should get all nodes', async () => {
      const nodes = await service.getAllNodes();
      expect(Array.isArray(nodes)).toBe(true);
    });

    it('should get active nodes', async () => {
      const nodes = await service.getActiveNodes();
      expect(Array.isArray(nodes)).toBe(true);
    });

    it('should find nodes by service and version', async () => {
      const nodes = await service.findNodesByService('TestService', '1.0.0');
      expect(Array.isArray(nodes)).toBe(true);
    });
  });

  describe('Event Handling', () => {
    beforeEach(() => {
      const options: DiscoveryOptions = { pubSubEnabled: true };
      service = new DiscoveryService(redis, logger, options);
    });

    it('should register event handlers', () => {
      const handler = jest.fn();
      
      service.onEvent(handler);
      
      // Manually trigger event
      (service as any).eventEmitter.emit('discovery:event', {
        type: 'NODE_REGISTERED',
        nodeId: 'test',
        address: '127.0.0.1:8080',
        services: [],
        timestamp: Date.now(),
      });
      
      expect(handler).toHaveBeenCalled();
    });

    it('should unregister event handlers', () => {
      const handler = jest.fn();
      
      service.onEvent(handler);
      service.offEvent(handler);
      
      (service as any).eventEmitter.emit('discovery:event', {
        type: 'NODE_REGISTERED',
      });
      
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Client Mode', () => {
    it('should not register in client mode', async () => {
      const options: DiscoveryOptions = { clientMode: true };
      service = new DiscoveryService(redis, logger, options);
      
      await service.start();
      
      expect(service.isRegistered()).toBe(false);
    });

    it('should still discover nodes in client mode', async () => {
      const options: DiscoveryOptions = { clientMode: true };
      service = new DiscoveryService(redis, logger, options);
      
      await service.start();
      
      const nodes = await service.findNodes();
      expect(Array.isArray(nodes)).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should start service', async () => {
      await expect(service.start()).resolves.not.toThrow();
    });

    it('should stop service', async () => {
      await service.start();
      await expect(service.stop()).resolves.not.toThrow();
    });

    it('should handle multiple stop calls', async () => {
      await service.start();
      
      await service.stop();
      await service.stop();
      await service.stop();
      
      expect(true).toBe(true);
    });

    it('should not restart after stop', async () => {
      await service.start();
      await service.stop();
      
      await expect(service.start()).rejects.toThrow(
        'Cannot start a stopped DiscoveryService'
      );
    });
  });

  describe('Getters', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should return node ID', () => {
      const nodeId = service.getNodeId();
      expect(typeof nodeId).toBe('string');
      expect(nodeId).toMatch(/^titan-/);
    });

    it('should return address', () => {
      const address = service.getAddress();
      expect(typeof address).toBe('string');
      expect(address).toBeTruthy();
    });

    it('should return services copy', () => {
      const services1 = service.getServices();
      const services2 = service.getServices();
      
      expect(services1).toEqual(services2);
      expect(services1).not.toBe(services2);
    });

    it('should return registration status', () => {
      expect(typeof service.isRegistered()).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      service = new DiscoveryService(redis, logger);
    });

    it('should handle Redis errors in findNodes', async () => {
      redis.smembers = jest.fn().mockRejectedValue(new Error('Redis error'));
      
      const nodes = await service.findNodes();
      
      expect(nodes).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle errors in nodeExists', async () => {
      redis.exists = jest.fn().mockRejectedValue(new Error('Redis error'));
      
      const exists = await service.nodeExists('test');
      
      expect(exists).toBe(false);
    });

    it('should handle errors in getNodeInfo', async () => {
      redis.hgetall = jest.fn().mockRejectedValue(new Error('Redis error'));
      
      const info = await service.getNodeInfo('test');
      
      expect(info).toBeNull();
    });
  });
});
