import { Redis } from 'ioredis';

import { NodeInfo } from '../../src/service-discovery/types';
import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery updateServices and updateAddress', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;

  const nodeId = 'update-node';
  const initialAddress = '127.0.0.1:5000';
  const initialServices = [{ name: 'initial-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    discovery = new ServiceDiscovery(redis, nodeId, initialAddress, initialServices, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discovery.startHeartbeat();
  });

  afterEach(async () => {
    await discovery.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should update services and reflect changes in Redis immediately', async () => {
    const updatedServices = [
      { name: 'updated-service', version: '2.0.0' },
      { name: 'extra-service', version: '3.0.1' },
    ];

    await discovery.updateServices(updatedServices);

    const nodeData = await redis.hgetall(`netron:discovery:nodes:${nodeId}`);
    expect(nodeData['services']).toBeDefined();
    expect(JSON.parse(nodeData['services']!)).toEqual(updatedServices);

    const activeNodes: NodeInfo[] = await discovery.getActiveNodes();
    const currentNode = activeNodes.find(node => node.nodeId === nodeId)!;
    expect(currentNode.services).toEqual(updatedServices);
  });

  it('should update address and reflect changes in Redis immediately', async () => {
    const updatedAddress = '192.168.1.100:6000';

    await discovery.updateAddress(updatedAddress);

    const nodeData = await redis.hgetall(`netron:discovery:nodes:${nodeId}`);
    expect(nodeData['address']).toBe(updatedAddress);

    const activeNodes: NodeInfo[] = await discovery.getActiveNodes();
    const currentNode = activeNodes.find(node => node.nodeId === nodeId)!;
    expect(currentNode.address).toBe(updatedAddress);
  });

  it('should handle simultaneous updates of services and address correctly', async () => {
    const newAddress = '10.10.10.10:7000';
    const newServices = [{ name: 'simultaneous-service', version: '4.2.0' }];

    await Promise.all([
      discovery.updateAddress(newAddress),
      discovery.updateServices(newServices),
    ]);

    const nodeData = await redis.hgetall(`netron:discovery:nodes:${nodeId}`);

    expect(nodeData['address']).toBe(newAddress);
    expect(JSON.parse(nodeData['services']!)).toEqual(newServices);

    const activeNodes: NodeInfo[] = await discovery.getActiveNodes();
    const currentNode = activeNodes.find(node => node.nodeId === nodeId)!;

    expect(currentNode.address).toBe(newAddress);
    expect(currentNode.services).toEqual(newServices);
  });
});
