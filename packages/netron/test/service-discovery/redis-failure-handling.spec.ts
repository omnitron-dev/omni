import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../../src';
import { ServiceDiscovery } from '../../src/service-discovery';
import { createTestRedisClient, cleanupRedis } from '../helpers/test-utils';
describe('ServiceDiscovery Redis Failure Handling', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'node-redis-failure';
  const address = '127.0.0.1:3000';
  const services = [{ name: 'test-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    discovery!.startHeartbeat();
    await delay(100); // Ensure heartbeat is published
  });

  afterEach(async () => {
    if (discovery) { await discovery.shutdown(); }
    if (redis) { await cleanupRedis(redis); }
    if (redis) { redis.disconnect(); }
  });

  it('should handle Redis failures gracefully during getActiveNodes', async () => {
    // Simulate Redis failure by forcibly disconnecting
    await redis!.disconnect();

    await expect(discovery!.getActiveNodes()).rejects.toThrow();

    // Reconnect Redis
    redis = createTestRedisClient(2);
    discovery!['redis'] = redis;  // Restore connection to ServiceDiscovery

    // Retry after recovery
    const activeNodes = await discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.nodeId).toBe(nodeId);
  });
});
