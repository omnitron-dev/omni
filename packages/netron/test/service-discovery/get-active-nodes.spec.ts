import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron , NodeInfo , ServiceDiscovery } from '../../dist';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery getActiveNodes', () => {
  let redis: Redis | undefined;
  let discoveryA: ServiceDiscovery | undefined;
  let discoveryB: ServiceDiscovery | undefined;

  const nodeIdA = 'node-a';
  const addressA = '127.0.0.1:3000';
  const servicesA = [{ name: 'auth-service', version: '1.0.0' }];

  const nodeIdB = 'node-b';
  const addressB = '127.0.0.1:4000';
  const servicesB = [{ name: 'payment-service', version: '2.0.0' }];

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
  });

  afterEach(async () => {
    if (discoveryA) { await discoveryA.shutdown(); }
    if (discoveryB) { await discoveryB.shutdown(); }
    if (redis) { await cleanupRedis(redis); }
    if (redis) { redis.disconnect(); }
  });

  it('should return all active nodes correctly', async () => {
    const activeNodes: NodeInfo[] = await discoveryA!.getActiveNodes();

    expect(activeNodes.length).toBe(2);

    const nodeIds = activeNodes.map((node) => node.nodeId);
    expect(nodeIds).toContain(nodeIdA);
    expect(nodeIds).toContain(nodeIdB);

    const nodeA = activeNodes.find(node => node.nodeId === nodeIdA)!;
    expect(nodeA.address).toBe(addressA);
    expect(nodeA.services).toEqual(servicesA);

    const nodeB = activeNodes.find(node => node.nodeId === nodeIdB)!;
    expect(nodeB.address).toBe(addressB);
    expect(nodeB.services).toEqual(servicesB);
  });

  it('should automatically deregister inactive nodes', async () => {
    await discoveryB!.shutdown();
    await delay(2000); // Wait longer than heartbeatTTL

    const activeNodes: NodeInfo[] = await discoveryA!.getActiveNodes();
    expect(activeNodes.length).toBe(1);
    expect(activeNodes[0]!.nodeId).toBe(nodeIdA);

    const nodeBExists = await redis!.exists(`netron:discovery:nodes:${nodeIdB}`);
    expect(nodeBExists).toBe(0);
  });
});
