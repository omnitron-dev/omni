import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron , ServiceDiscovery } from '../../dist';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery Node Active Status', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'status-node';
  const address = '127.0.0.1:7000';
  const services = [{ name: 'status-service', version: '1.0.0' }];

  const netron = new Netron({
    id: nodeId,
  });

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    discovery = new ServiceDiscovery(redis, netron, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1000,
    });

    await discovery.startHeartbeat();
  });

  afterEach(async () => {
    if (discovery) { await discovery.shutdown(); }
    if (redis) { await cleanupRedis(redis); }
    if (redis) { redis.disconnect(); }
  });

  it('should return true when node is active', async () => {
    const isActive = await discovery!.isNodeActive(nodeId);
    expect(isActive).toBe(true);
  });

  it('should return false and deregister node after TTL expiration', async () => {
    await discovery!.shutdown();

    await delay(1500); // подождем больше heartbeatTTL

    const isActive = await discovery!.isNodeActive(nodeId);
    expect(isActive).toBe(false);

    const nodeExists = await redis!.exists(`netron:discovery:nodes:${nodeId}`);
    const heartbeatExists = await redis!.exists(`netron:discovery:heartbeat:${nodeId}`);
    const nodeIndex = await redis!.sismember('netron:discovery:index:nodes', nodeId);

    expect(nodeExists).toBe(0);
    expect(heartbeatExists).toBe(0);
    expect(nodeIndex).toBe(0);
  });
});
