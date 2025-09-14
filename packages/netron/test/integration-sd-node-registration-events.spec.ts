import Redis from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { Netron } from '../dist';
import { cleanupRedis, getTestRedisUrl, createTestRedisClient } from './helpers/test-utils';

describe('ServiceDiscovery Integration - Node Registration & Deregistration Events', () => {
  let redis: Redis;
  let nodeA: Netron;
  let nodeB: Netron;

  const eventsReceivedByB: any[] = [];

  beforeAll(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    // First start nodeB and subscribe to events
    nodeB = await Netron.create({
      id: 'nodeB',
      listenHost: 'localhost',
      listenPort: 4006,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
      discoveryPubSubEnabled: true,
    });

    await nodeB.discovery!.subscribeToEvents((event) => {
      eventsReceivedByB.push(event);
    });

    await delay(500); // give time for subscription

    // Now start nodeA
    nodeA = await Netron.create({
      id: 'nodeA',
      listenHost: 'localhost',
      listenPort: 4005,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
      discoveryPubSubEnabled: true,
    });

    await delay(1500); // wait for heartbeat and registration events
  });

  afterAll(async () => {
    await nodeA.stop();
    await nodeB.stop();
    await redis.quit();
  });

  it('should receive NODE_REGISTERED event on new node registration', async () => {
    expect(eventsReceivedByB.some((e) => e.type === 'NODE_REGISTERED' && e.nodeId === 'nodeA')).toBeTruthy();
  });

  it('should receive NODE_DEREGISTERED event on node deregistration', async () => {
    await nodeA.stop();

    await delay(1000); // wait for event processing

    expect(eventsReceivedByB.some((e) => e.type === 'NODE_DEREGISTERED' && e.nodeId === 'nodeA')).toBeTruthy();
  });
});
