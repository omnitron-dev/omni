import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery Graceful Shutdown', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;

  const nodeId = 'shutdown-node';
  const address = '127.0.0.1:3000';
  const services = [{ name: 'shutdown-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    discovery = new ServiceDiscovery(redis, nodeId, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
      pubSubEnabled: true,
    });

    await discovery.subscribeToEvents(() => { });
    discovery.startHeartbeat();
    await delay(100); // ensure heartbeat and subscription started
  });

  afterEach(async () => {
    await discovery.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should gracefully shutdown heartbeat timer and unsubscribe from events', async () => {
    // Verify heartbeat is active
    expect(discovery['heartbeatTimer']).toBeDefined();
    expect(discovery['subscriber']).toBeDefined();

    // Initiate shutdown
    await discovery.shutdown();

    // Ensure heartbeat timer and subscriber are cleared
    expect(discovery['heartbeatTimer']).toBeUndefined();
    expect(discovery['subscriber']).toBeUndefined();

    // Verify node removal from Redis
    const nodeExists = await redis.exists(`netron:discovery:nodes:${nodeId}`);
    const heartbeatExists = await redis.exists(`netron:discovery:heartbeat:${nodeId}`);
    const nodeIndexed = await redis.sismember('netron:discovery:index:nodes', nodeId);

    expect(nodeExists).toBe(0);
    expect(heartbeatExists).toBe(0);
    expect(nodeIndexed).toBe(0);
  });

  it('should be idempotent on multiple shutdown calls', async () => {
    await discovery.shutdown();
    await expect(discovery.shutdown()).resolves.not.toThrow();
  });
});
