import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { NodeInfo } from '../../src/service-discovery/types';
import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery getActiveNodes', () => {
  let redis: Redis;
  let discoveryA: ServiceDiscovery;
  let discoveryB: ServiceDiscovery;

  const nodeIdA = 'node-a';
  const addressA = '127.0.0.1:3000';
  const servicesA = [{ name: 'auth-service', version: '1.0.0' }];

  const nodeIdB = 'node-b';
  const addressB = '127.0.0.1:4000';
  const servicesB = [{ name: 'payment-service', version: '2.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    discoveryA = new ServiceDiscovery(redis, nodeIdA, addressA, servicesA, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    discoveryB = new ServiceDiscovery(redis, nodeIdB, addressB, servicesB, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discoveryA.startHeartbeat();
    await discoveryB.startHeartbeat();
  });

  afterEach(async () => {
    await discoveryA.shutdown();
    await discoveryB.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should return all active nodes correctly', async () => {
    const activeNodes: NodeInfo[] = await discoveryA.getActiveNodes();

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
    await discoveryB.shutdown();
    await delay(2000); // Wait longer than heartbeatTTL

    const activeNodes: NodeInfo[] = await discoveryA.getActiveNodes();
    expect(activeNodes.length).toBe(1);
    expect(activeNodes[0]!.nodeId).toBe(nodeIdA);

    const nodeBExists = await redis.exists(`netron:discovery:nodes:${nodeIdB}`);
    expect(nodeBExists).toBe(0);
  });
});
