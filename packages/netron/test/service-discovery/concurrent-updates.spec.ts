import { Redis } from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron , NodeInfo, ServiceDiscovery } from '../../dist';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery Concurrent Updates', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'concurrent-node';
  const initialAddress = '127.0.0.1:4000';
  const initialServices = [{ name: 'initial-service', version: '1.0.0' }];

  const netron = new Netron({
    id: nodeId,
  });

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    discovery = new ServiceDiscovery(redis, netron, initialAddress, initialServices, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discovery.startHeartbeat();
    await delay(100);
  });

  afterEach(async () => {
    if (discovery) { await discovery.shutdown(); }
    if (redis) { await cleanupRedis(redis); }
    if (redis) { redis.disconnect(); }
  });

  it('should handle concurrent address and service updates', async () => {
    const updatePromises: Promise<void>[] = [];

    for (let i = 0; i < 5; i++) {
      updatePromises.push(discovery!.updateAddress(`127.0.0.1:400${i}`));
      updatePromises.push(discovery!.updateServices([{ name: `service-${i}`, version: `2.${i}.0` }]));
    }

    await Promise.all(updatePromises);

    const activeNodes: NodeInfo[] = await discovery!.getActiveNodes();
    expect(activeNodes.length).toBe(1);

    const currentNode = activeNodes.find(node => node.nodeId === nodeId);
    expect(currentNode).toBeDefined();
    expect(currentNode!.address).toMatch(/^127\.0\.0\.1:400\d$/);
    expect(currentNode!.services[0]?.name).toMatch(/^service-\d$/);
  });
});
