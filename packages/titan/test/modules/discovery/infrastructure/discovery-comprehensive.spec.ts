/**
 * Comprehensive Infrastructure Tests for Discovery Service
 * Tests heartbeat, registration, cleanup, and distributed scenarios
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Redis } from 'ioredis';
import { DiscoveryService } from '../../../../src/modules/discovery/discovery.service.js';
import type { ILogger } from '../../../../src/modules/logger/logger.types.js';
import type { ServiceInfo, DiscoveryOptions, DiscoveryEvent } from '../../../../src/modules/discovery/types.js';
import { RedisTestManager } from '../../../utils/redis-test-manager.js';
import { delay } from '@omnitron-dev/common';

const createMockLogger = (): ILogger => ({
  log: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  info: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => createMockLogger(),
});

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
if (skipTests) {
  console.log('⏭️ Skipping discovery-comprehensive.spec.ts - requires external Redis services');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Discovery Service - Infrastructure Tests', () => {
  let testContainer: Awaited<ReturnType<typeof RedisTestManager.prototype.createContainer>>;
  let redis: Redis;
  let logger: ILogger;
  let service: DiscoveryService;

  beforeEach(async () => {
    const redisManager = RedisTestManager.getInstance();
    testContainer = await redisManager.createContainer();
    redis = testContainer.client!;
    logger = createMockLogger();
  });

  afterEach(async () => {
    if (service) {
      await service.stop();
    }
    if (redis) {
      await redis.flushdb();
    }
    if (testContainer) {
      await testContainer.cleanup();
    }
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with default configuration', () => {
      service = new DiscoveryService(redis, logger);
      
      expect(service.getNodeId()).toBeDefined();
      expect(service.getAddress()).toBeDefined();
      expect(service.getServices()).toEqual([]);
      expect(service.isRegistered()).toBe(false);
    });

    it('should generate unique node IDs', () => {
      const service1 = new DiscoveryService(redis, logger);
      const service2 = new DiscoveryService(redis, logger);
      
      expect(service1.getNodeId()).not.toBe(service2.getNodeId());
    });

    it('should support custom heartbeat interval', () => {
      const options: DiscoveryOptions = {
        heartbeatInterval: 1000,
        heartbeatTTL: 3000,
      };
      
      service = new DiscoveryService(redis, logger, options);
      expect(service).toBeDefined();
    });

    it('should support client mode (no heartbeat)', () => {
      const options: DiscoveryOptions = {
        clientMode: true,
      };
      
      service = new DiscoveryService(redis, logger, options);
      expect(service).toBeDefined();
    });
  });

  describe('Node Registration and Heartbeat', () => {
    it('should register node on start', async () => {
      service = new DiscoveryService(redis, logger);
      await service.start();
      await delay(100);
      
      expect(service.isRegistered()).toBe(true);
      
      const nodes = await service.getActiveNodes();
      expect(nodes.length).toBe(1);
    });

    it('should maintain heartbeat at regular intervals', async () => {
      const options: DiscoveryOptions = {
        heartbeatInterval: 200,
        heartbeatTTL: 1000,
      };
      
      service = new DiscoveryService(redis, logger, options);
      await service.start();
      await delay(100);
      
      const isActive1 = await service.isNodeActive(service.getNodeId());
      expect(isActive1).toBe(true);
      
      await delay(300);
      
      const isActive2 = await service.isNodeActive(service.getNodeId());
      expect(isActive2).toBe(true);
    });

    it('should deregister node on stop', async () => {
      service = new DiscoveryService(redis, logger);
      await service.start();
      await delay(100);
      
      const isActive1 = await service.isNodeActive(service.getNodeId());
      expect(isActive1).toBe(true);
      
      await service.stop();
      await delay(100);
      
      const isActive2 = await service.isNodeActive(service.getNodeId());
      expect(isActive2).toBe(false);
    });
  });

  describe('Service Discovery', () => {
    beforeEach(async () => {
      service = new DiscoveryService(redis, logger);
    });

    it('should find active nodes', async () => {
      await service.start();
      await delay(100);
      
      const nodes = await service.findNodes();
      expect(nodes.length).toBe(1);
    });

    it('should find nodes by service name', async () => {
      const svc: ServiceInfo = { name: 'TestService', version: '1.0.0' };
      await service.registerService(svc);
      await service.start();
      await delay(100);
      
      const nodes = await service.findNodesByService('TestService');
      expect(nodes.length).toBe(1);
    });
  });
});
