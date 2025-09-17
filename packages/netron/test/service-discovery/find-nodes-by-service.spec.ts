import { Redis } from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { Netron, ServiceDiscovery } from '../../src';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery findNodesByService', () => {
  let redis: Redis | undefined;
  let discoveryA: ServiceDiscovery | undefined;
  let discoveryB: ServiceDiscovery | undefined;

  const nodeIdA = 'node-A';
  const addressA = '127.0.0.1:3000';
  const servicesA = [{ name: 'auth-service', version: '1.0.0' }];

  const nodeIdB = 'node-B';
  const addressB = '127.0.0.1:3001';
  const servicesB = [
    { name: 'auth-service', version: '1.0.0' },
    { name: 'payment-service', version: '2.0.0' },
  ];

  const netronA = new Netron({
    id: nodeIdA,
  });

  const netronB = new Netron({
    id: nodeIdB,
  });

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    discoveryA = new ServiceDiscovery(redis, netronA, addressA, servicesA, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    discoveryB = new ServiceDiscovery(redis, netronB, addressB, servicesB, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discoveryA.startHeartbeat();
    await discoveryB.startHeartbeat();

    await delay(100); // Wait a bit to ensure heartbeat is published
  });

  afterEach(async () => {
    if (discoveryA) {
      await discoveryA.shutdown();
    }
    if (discoveryB) {
      await discoveryB.shutdown();
    }
    if (redis) {
      await cleanupRedis(redis);
      redis.disconnect();
    }
  });

  it('should find nodes by service name', async () => {
    expect(discoveryA).toBeDefined();
    const nodes = await discoveryA!.findNodesByService('auth-service');

    expect(nodes.length).toBe(2);

    const nodeIds = nodes.map((n) => n.nodeId);
    expect(nodeIds).toContain(nodeIdA);
    expect(nodeIds).toContain(nodeIdB);
  });

  it('should find nodes by service name and specific version', async () => {
    expect(discoveryA).toBeDefined();
    const nodes = await discoveryA!.findNodesByService('payment-service', '2.0.0');

    expect(nodes.length).toBe(1);
    expect(nodes[0]!.nodeId).toBe(nodeIdB);
  });

  it('should return empty array if service is not found', async () => {
    expect(discoveryA).toBeDefined();
    const nodes = await discoveryA!.findNodesByService('non-existent-service');

    expect(nodes.length).toBe(0);
  });

  it('should handle node expiration correctly', async () => {
    expect(discoveryA).toBeDefined();
    expect(discoveryB).toBeDefined();
    await discoveryB!.shutdown();

    await delay(2000);

    const nodesAfterExpiration = await discoveryA!.findNodesByService('payment-service');
    expect(nodesAfterExpiration.length).toBe(0);

    const authNodes = await discoveryA!.findNodesByService('auth-service');
    expect(authNodes.length).toBe(1);
    expect(authNodes[0]!.nodeId).toBe(nodeIdA);
  });
});
