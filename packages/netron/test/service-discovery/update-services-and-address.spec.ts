import { Redis } from 'ioredis';

import { Netron, NodeInfo, ServiceDiscovery } from '../../src';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery updateServices and updateAddress', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'update-node';
  const initialAddress = '127.0.0.1:5000';
  const initialServices = [{ name: 'initial-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, initialAddress, initialServices, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discovery.startHeartbeat();
  });

  afterEach(async () => {
    if (discovery) {
      await discovery.shutdown();
    }
    if (redis) {
      await cleanupRedis(redis);
    }
    if (redis) {
      redis.disconnect();
    }
  });

  it('should update services and reflect changes in Redis immediately', async () => {
    const updatedServices = [
      { name: 'updated-service', version: '2.0.0' },
      { name: 'extra-service', version: '3.0.1' },
    ];

    await discovery!.updateServices(updatedServices);

    const nodeData = await redis!.hgetall(`netron:discovery:nodes:${nodeId}`);
    expect(nodeData['services']).toBeDefined();
    expect(JSON.parse(nodeData['services']!)).toEqual(updatedServices);

    const activeNodes: NodeInfo[] = await discovery!.getActiveNodes();
    const currentNode = activeNodes.find((node) => node.nodeId === nodeId)!;
    expect(currentNode.services).toEqual(updatedServices);
  });

  it('should update address and reflect changes in Redis immediately', async () => {
    const updatedAddress = '192.168.1.100:6000';

    await discovery!.updateAddress(updatedAddress);

    const nodeData = await redis!.hgetall(`netron:discovery:nodes:${nodeId}`);
    expect(nodeData['address']).toBe(updatedAddress);

    const activeNodes: NodeInfo[] = await discovery!.getActiveNodes();
    const currentNode = activeNodes.find((node) => node.nodeId === nodeId)!;
    expect(currentNode.address).toBe(updatedAddress);
  });

  it('should handle simultaneous updates of services and address correctly', async () => {
    const newAddress = '10.10.10.10:7000';
    const newServices = [{ name: 'simultaneous-service', version: '4.2.0' }];

    await Promise.all([discovery!.updateAddress(newAddress), discovery!.updateServices(newServices)]);

    const nodeData = await redis!.hgetall(`netron:discovery:nodes:${nodeId}`);

    expect(nodeData['address']).toBe(newAddress);
    expect(JSON.parse(nodeData['services']!)).toEqual(newServices);

    const activeNodes: NodeInfo[] = await discovery!.getActiveNodes();
    const currentNode = activeNodes.find((node) => node.nodeId === nodeId)!;

    expect(currentNode.address).toBe(newAddress);
    expect(currentNode.services).toEqual(newServices);
  });
});
