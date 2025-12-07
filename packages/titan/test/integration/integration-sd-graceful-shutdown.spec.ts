import Redis from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { Netron } from '../../src/netron/index.js';
import { cleanupRedis, getTestRedisUrl, createTestRedisClient } from '../netron/helpers/test-utils.js';

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';

if (skipTests) {
  console.log('⏭️ Skipping integration-sd-graceful-shutdown.spec.ts - requires external services');
}

const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('ServiceDiscovery Integration - Graceful Shutdown', () => {
  let netron: Netron;
  let redis: Redis;

  beforeAll(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4001,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 2000,
    });

    await delay(1000); // wait for heartbeat to run several times
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('should deregister node on graceful shutdown', async () => {
    const activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.nodeId).toBe(netron.id);

    await netron.stop(); // call graceful shutdown

    await delay(1000); // give Redis time to process key deletion and clear TTL

    // Use another variable here:
    const remainingNodeIds = await redis.smembers('netron:discovery:index:nodes');
    expect(remainingNodeIds).toHaveLength(0);

    const heartbeatExists = await redis.exists(`netron:discovery:heartbeat:${netron.id}`);
    expect(heartbeatExists).toBe(0);

    const nodeMetaExists = await redis.exists(`netron:discovery:nodes:${netron.id}`);
    expect(nodeMetaExists).toBe(0);
  });
});
