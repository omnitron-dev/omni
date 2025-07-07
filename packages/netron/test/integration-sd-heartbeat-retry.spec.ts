import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../dist';
import { createTestRedisClient, getTestRedisUrl, cleanupRedis } from './helpers/test-utils';

describe('ServiceDiscovery Integration - Heartbeat Retry & Recovery', () => {
  let redis: Redis;
  let netron: Netron;

  beforeAll(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4007,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
    });

    await delay(1000);
  });

  afterAll(async () => {
    await netron.stop();
    await redis.quit();
  });

  it('should retry heartbeat on Redis error and recover after Redis reconnect', async () => {
    // Check node presence
    let activeNodes = await netron.discovery!.getActiveNodes();
    expect(activeNodes).toHaveLength(1);

    // Simulate Redis failure
    await redis.disconnect();

    // Wait for heartbeat to fail several times
    await delay(1500);

    // Restore Redis
    redis = createTestRedisClient(2);

    // Wait for heartbeat recovery
    await delay(2000);

    activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.nodeId).toBe(netron.id);
  });
});
