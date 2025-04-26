import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../dist/netron';
import { DiscoveryEvent } from '../dist/service-discovery/types';

describe('ServiceDiscovery Integration - Node Registration & Deregistration Events', () => {
  let redisPub: Redis;
  let netron: Netron;
  const receivedEvents: DiscoveryEvent[] = [];

  beforeAll(async () => {
    redisPub = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', { db: 2 });
    await redisPub.flushdb();

    const redisSub = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', { db: 2 });

    await redisSub.subscribe('netron:discovery:events');
    redisSub.on('message', (_, message) => {
      receivedEvents.push(JSON.parse(message) as DiscoveryEvent);
    });

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4002,
      discoveryEnabled: true,
      discoveryRedisUrl: process.env['REDIS_URL'] || 'redis://localhost:6379/2',
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
      discoveryPubSubEnabled: true, // Enable PubSub
    });

    await delay(1000); // Wait for initialization
  });

  afterAll(async () => {
    await netron.stop();
    await redisPub.quit();
  });

  it('should emit NODE_REGISTERED and NODE_DEREGISTERED events', async () => {
    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

    const registerEvent = receivedEvents.find(e => e.type === 'NODE_REGISTERED');
    expect(registerEvent).toBeDefined();
    expect(registerEvent!.nodeId).toBe(netron.id);
    expect(registerEvent!.address).toBe('localhost:4002');

    // Call graceful shutdown to check deregistration event
    await netron.stop();

    await delay(1000); // Give time for event publication

    const deregisterEvent = receivedEvents.find(e => e.type === 'NODE_DEREGISTERED');
    expect(deregisterEvent).toBeDefined();
    expect(deregisterEvent!.nodeId).toBe(netron.id);
  }, 10000);
});
