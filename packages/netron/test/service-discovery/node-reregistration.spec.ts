import { Redis } from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { Netron, ServiceDiscovery } from '../../src';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery Node Re-registration', () => {
  let redis: Redis | undefined;
  let discoveryOriginal: ServiceDiscovery;
  let discoveryNew: ServiceDiscovery;

  const nodeId = 'node-re-registration';
  const originalAddress = '127.0.0.1:3000';
  const originalServices = [{ name: 'original-service', version: '1.0.0' }];

  const newAddress = '127.0.0.1:4000';
  const newServices = [{ name: 'new-service', version: '2.0.0' }];

  const netron = new Netron({
    id: nodeId,
  });

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    discoveryOriginal = new ServiceDiscovery(redis, netron, originalAddress, originalServices, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    discoveryOriginal.startHeartbeat();
    await delay(100); // Initial heartbeat
  });

  afterEach(async () => {
    await discoveryOriginal.shutdown();
    if (discoveryNew) await discoveryNew.shutdown();
    if (redis) {
      await cleanupRedis(redis);
    }
    if (redis) {
      redis.disconnect();
    }
  });

  it('should correctly handle node re-registration with updated details', async () => {
    // Verify original registration
    let activeNodes = await discoveryOriginal.getActiveNodes();
    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.address).toBe(originalAddress);
    expect(activeNodes[0]?.services).toEqual(originalServices);

    // Stop original heartbeat before new start
    await discoveryOriginal.shutdown();
    await delay(2000); // Make sure old heartbeat TTL has expired

    // Create new discovery instance
    discoveryNew = new ServiceDiscovery(redis!, netron, newAddress, newServices, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    discoveryNew.startHeartbeat();
    await delay(1000); // Wait for heartbeat update

    // Check updated data
    activeNodes = await discoveryNew.getActiveNodes();
    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.address).toBe(newAddress);
    expect(activeNodes[0]?.services).toEqual(newServices);
  });
});
