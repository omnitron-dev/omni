/**
 * Test utilities for Discovery module testing
 */

import { jest } from '@jest/globals';
import { Redis } from 'ioredis';
import { Container } from '@nexus';
import { DiscoveryService } from '../../../src/modules/discovery/discovery.service.js';
import { REDIS_TOKEN, LOGGER_TOKEN, DISCOVERY_OPTIONS_TOKEN } from '../../../src/modules/discovery/types.js';
import { DiscoveryModule } from '../../../src/modules/discovery/discovery.module.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';
import type { NodeInfo, ServiceInfo, DiscoveryOptions } from '../../../src/modules/discovery/types.js';
import { getTestRedisConfig } from '../../utils/redis-test-utils.js';

/**
 * Create a mock logger for testing
 */
export function createMockLogger(): ILogger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => createMockLogger()),
    level: 'info',
    setLevel: jest.fn(),
    isLevelEnabled: jest.fn(() => true),
  } as any;
}

/**
 * Create a test Redis client
 */
export function createTestRedisClient(db: number = 0): Redis {
  const redisConfig = getTestRedisConfig(db);
  return new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
    db: redisConfig.db,
    lazyConnect: true,
    retryStrategy: () => null, // Disable retries in tests
  });
}

/**
 * Clean up Redis data for tests
 */
export async function cleanupRedis(redis: Redis, prefix: string = 'titan:discovery'): Promise<void> {
  try {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

/**
 * Create a test discovery service with dependencies
 */
export function createTestDiscoveryService(
  redis: Redis,
  options?: DiscoveryOptions,
  logger?: ILogger
): DiscoveryService {
  const container = new Container();

  container.register(REDIS_TOKEN, { useValue: redis });
  container.register(LOGGER_TOKEN, { useValue: logger || createMockLogger() });

  if (options) {
    container.register(DISCOVERY_OPTIONS_TOKEN, { useValue: options });
  }

  // Register DiscoveryService provider
  container.register(DiscoveryService, { useClass: DiscoveryService });

  return container.resolve(DiscoveryService);
}

/**
 * Create a test discovery module with all dependencies
 */
export function createTestDiscoveryModule(
  redis: Redis,
  options?: DiscoveryOptions
): { module: DiscoveryModule; container: Container } {
  const container = new Container();

  container.register(REDIS_TOKEN, { useValue: redis });
  container.register(LOGGER_TOKEN, { useValue: createMockLogger() });

  const module = new DiscoveryModule();

  // Register module in container
  container.register(DiscoveryModule, { useValue: module });

  return { module, container };
}

/**
 * Create test node info
 */
export function createTestNodeInfo(overrides?: Partial<NodeInfo>): NodeInfo {
  return {
    nodeId: 'test-node-1',
    address: '127.0.0.1:8080',
    services: [{ name: 'TestService', version: '1.0.0' }],
    registeredAt: Date.now(),
    lastHeartbeat: Date.now(),
    active: true,
    metadata: {},
    ...overrides,
  };
}

/**
 * Create test service info
 */
export function createTestServiceInfo(overrides?: Partial<ServiceInfo>): ServiceInfo {
  return {
    name: 'TestService',
    version: '1.0.0',
    ...overrides,
  };
}

/**
 * Assert that a node exists in Redis
 */
export async function assertNodeExists(
  redis: Redis,
  nodeId: string,
  prefix: string = 'titan:discovery'
): Promise<void> {
  const data = await redis.hgetall(`${prefix}:nodes:${nodeId}`);
  expect(data).toBeTruthy();
  expect(data.address).toBeTruthy();
}

/**
 * Assert that a node does not exist in Redis
 */
export async function assertNodeNotExists(
  redis: Redis,
  nodeId: string,
  prefix: string = 'titan:discovery'
): Promise<void> {
  const exists = await redis.exists(`${prefix}:nodes:${nodeId}`);
  expect(exists).toBe(0);
}

/**
 * Get node data from Redis
 */
export async function getNodeData(
  redis: Redis,
  nodeId: string,
  prefix: string = 'titan:discovery'
): Promise<NodeInfo | null> {
  const data = await redis.hgetall(`${prefix}:nodes:${nodeId}`);

  if (!data || !data.address) {
    return null;
  }

  const heartbeatExists = await redis.exists(`${prefix}:heartbeat:${nodeId}`);

  return {
    nodeId,
    address: data.address,
    services: JSON.parse(data.services || '[]'),
    registeredAt: parseInt(data.timestamp || '0'),
    lastHeartbeat: parseInt(data.timestamp || '0'),
    active: heartbeatExists === 1,
    metadata: {},
  };
}

/**
 * Set node data in Redis
 */
export async function setNodeData(
  redis: Redis,
  nodeId: string,
  nodeInfo: NodeInfo,
  ttl: number = 15000,
  prefix: string = 'titan:discovery'
): Promise<void> {
  const nodeKey = `${prefix}:nodes:${nodeId}`;
  const heartbeatKey = `${prefix}:heartbeat:${nodeId}`;
  const nodesIndexKey = `${prefix}:index:nodes`;

  await redis.hmset(nodeKey, {
    address: nodeInfo.address,
    services: JSON.stringify(nodeInfo.services),
    timestamp: nodeInfo.lastHeartbeat.toString(),
  });

  await redis.expire(nodeKey, Math.round(ttl / 1000));
  await redis.psetex(heartbeatKey, ttl, '1');
  await redis.sadd(nodesIndexKey, nodeId);
}

/**
 * Simulate node heartbeat
 */
export async function simulateHeartbeat(
  redis: Redis,
  nodeId: string,
  prefix: string = 'titan:discovery'
): Promise<void> {
  const nodeData = await getNodeData(redis, nodeId, prefix);
  if (nodeData) {
    nodeData.lastHeartbeat = Date.now();
    await setNodeData(redis, nodeId, nodeData, 15000, prefix);
  }
}

/**
 * Wait for a node to become inactive
 */
export async function waitForNodeInactive(
  redis: Redis,
  nodeId: string,
  timeout: number = 20000,
  prefix: string = 'titan:discovery'
): Promise<void> {
  await waitFor(async () => {
    const data = await getNodeData(redis, nodeId, prefix);
    return !data || !data.active;
  }, timeout);
}

/**
 * Create multiple test nodes
 */
export async function createTestNodes(
  redis: Redis,
  count: number = 3,
  servicePrefix: string = 'TestService',
  prefix: string = 'titan:discovery'
): Promise<NodeInfo[]> {
  const nodes: NodeInfo[] = [];

  for (let i = 1; i <= count; i++) {
    const nodeInfo = createTestNodeInfo({
      nodeId: `test-node-${i}`,
      address: `127.0.0.1:${8080 + i}`,
      services: [{ name: `${servicePrefix}${i}`, version: '1.0.0' }],
    });

    await setNodeData(redis, nodeInfo.nodeId, nodeInfo, 15000, prefix);
    nodes.push(nodeInfo);
  }

  return nodes;
}

/**
 * Subscribe to discovery events
 */
export function subscribeToEvents(
  service: DiscoveryService,
  events: string[] = ['nodeRegistered', 'nodeUpdated', 'nodeRemoved', 'heartbeatReceived']
): { [key: string]: jest.Mock } {
  const handlers: { [key: string]: jest.Mock } = {};

  events.forEach((event) => {
    handlers[event] = jest.fn();
    service.on(event as any, handlers[event]);
  });

  return handlers;
}

/**
 * Create a spy for Redis commands
 */
export function spyOnRedisCommand(redis: Redis, command: string): jest.SpyInstance {
  return jest.spyOn(redis, command as any);
}

/**
 * Mock Redis pub/sub
 */
export function mockRedisPubSub(redis: Redis): {
  publish: jest.Mock;
  subscribe: jest.Mock;
  on: jest.Mock;
} {
  const mocks = {
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  };

  Object.assign(redis, mocks);

  return mocks;
}

/**
 * Wait for discovery service to be ready
 */
export async function waitForDiscoveryReady(service: DiscoveryService, timeout: number = 5000): Promise<void> {
  await waitFor(() => (service as any).registered === true, timeout);
}

/**
 * Assert service list contains expected services
 */
export function assertServicesContain(services: ServiceInfo[], expectedName: string, expectedVersion?: string): void {
  const found = services.find((s) => s.name === expectedName && (!expectedVersion || s.version === expectedVersion));
  expect(found).toBeTruthy();
}

/**
 * Create a test container with all discovery dependencies
 */
export function createTestContainer(redis: Redis, options?: DiscoveryOptions): Container {
  const container = new Container();

  container.register(REDIS_TOKEN, { useValue: redis });
  container.register(LOGGER_TOKEN, { useValue: createMockLogger() });

  if (options) {
    container.register(DISCOVERY_OPTIONS_TOKEN, { useValue: options });
  }

  return container;
}
