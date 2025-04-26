import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { NodeInfo, ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery Concurrent Updates', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;

  const nodeId = 'concurrent-node';
  const initialAddress = '127.0.0.1:4000';
  const initialServices = [{ name: 'initial-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    discovery = new ServiceDiscovery(redis, nodeId, initialAddress, initialServices, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discovery.startHeartbeat();
    await delay(100);
  });

  afterEach(async () => {
    await discovery.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should handle concurrent address and service updates', async () => {
    const updatePromises: Promise<void>[] = [];

    for (let i = 0; i < 5; i++) {
      updatePromises.push(discovery.updateAddress(`127.0.0.1:400${i}`));
      updatePromises.push(discovery.updateServices([{ name: `service-${i}`, version: `2.${i}.0` }]));
    }

    await Promise.all(updatePromises);

    const activeNodes: NodeInfo[] = await discovery.getActiveNodes();
    expect(activeNodes.length).toBe(1);

    const currentNode = activeNodes.find(node => node.nodeId === nodeId);
    expect(currentNode).toBeDefined();
    expect(currentNode!.address).toMatch(/^127\.0\.0\.1:400\d$/);
    expect(currentNode!.services[0]?.name).toMatch(/^service-\d$/);
  });
});
