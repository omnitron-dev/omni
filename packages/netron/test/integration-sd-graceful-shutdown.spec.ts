import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../dist/netron';

describe('ServiceDiscovery Integration - Graceful Shutdown', () => {
  let netron: Netron;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', { db: 2 });
    await redis.flushdb();

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4001,
      discoveryEnabled: true,
      discoveryRedisUrl: process.env['REDIS_URL'] || 'redis://localhost:6379/2',
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
