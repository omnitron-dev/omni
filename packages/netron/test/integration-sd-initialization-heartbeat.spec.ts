import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../dist/netron';

describe('ServiceDiscovery Integration - Initialization & Heartbeat', () => {
  let netron: Netron;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', { db: 2 });
    await redis.flushdb();

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4000,
      discoveryEnabled: true,
      discoveryRedisUrl: process.env['REDIS_URL'] || 'redis://localhost:6379/2',
      discoveryHeartbeatInterval: 500, // speed up heartbeat for testing
      discoveryHeartbeatTTL: 3000,
    });
  });

  afterAll(async () => {
    await netron.stop();
    await redis.quit();
  });

  it('should initialize service discovery and maintain heartbeat', async () => {
    // Give time for several heartbeat cycles
    await delay(1500);

    const activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.nodeId).toBe(netron.id);
    expect(activeNodes[0]?.address).toBe('localhost:4000');
    expect(activeNodes[0]?.services).toEqual([]);

    // Wait and check again that heartbeat keeps the node active
    await delay(1000);

    const activeNodesAfterWait = await netron.discovery!.getActiveNodes();

    expect(activeNodesAfterWait).toHaveLength(1);
    expect(activeNodesAfterWait[0]?.nodeId).toBe(netron.id);
  });
});
