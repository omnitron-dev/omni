import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron } from '../../src';
import { ServiceDiscovery } from '../../src/service-discovery';

import type { DiscoveryEvent } from '../../src/service-discovery/types';

describe('ServiceDiscovery Pub/Sub Event Propagation', () => {
  let redis: Redis;
  let publisher: ServiceDiscovery;
  let subscriber: ServiceDiscovery;

  const pubNodeId = 'publisher-node';
  const subNodeId = 'subscriber-node';
  const addressPub = '127.0.0.1:4000';
  const addressSub = '127.0.0.1:5000';
  const servicesPub = [{ name: 'pub-service', version: '1.0.0' }];
  const servicesSub = [{ name: 'sub-service', version: '2.0.0' }];

  let receivedEvent: DiscoveryEvent | undefined;

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    const netron = new Netron({
      id: pubNodeId,
    });

    receivedEvent = undefined;

    subscriber = new ServiceDiscovery(redis, netron, addressSub, servicesSub, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
      pubSubEnabled: true,
    });

    publisher = new ServiceDiscovery(redis, netron, addressPub, servicesPub, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
      pubSubEnabled: true,
    });

    // Subscribe BEFORE starting heartbeat!
    await subscriber.subscribeToEvents((event: DiscoveryEvent) => {
      if (event.type === 'NODE_UPDATED' && event.nodeId === pubNodeId) {
        receivedEvent = event;
      }
    });

    await delay(100); // Ensure subscription is established

    subscriber.startHeartbeat();
    publisher.startHeartbeat();

    await delay(100); // Ensure heartbeat has started
  });

  afterEach(async () => {
    await publisher.shutdown();
    await subscriber.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should propagate NODE_UPDATED event via Redis Pub/Sub', async () => {
    const updatedServices = [{ name: 'pub-service', version: '1.1.0' }];

    await publisher.updateServices(updatedServices);

    await delay(500); // Ждём получения события

    expect(receivedEvent).toBeDefined();
    expect(receivedEvent!.nodeId).toBe(pubNodeId);
    expect(receivedEvent!.services).toEqual(updatedServices);
  });
});
