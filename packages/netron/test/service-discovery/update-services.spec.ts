import { Redis } from 'ioredis';

import { Netron } from '../../src';
import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery Update Services', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;

  const nodeId = 'update-services-node';
  const address = '127.0.0.1:8000';
  const initialServices = [{ name: 'initial-service', version: '1.0.0' }];
  const updatedServices = [
    { name: 'updated-service', version: '2.0.0' },
    { name: 'additional-service', version: '1.0.0' },
  ];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();
    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, address, initialServices, {
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

  it('should update node services correctly', async () => {
    await discovery.updateServices(updatedServices);

    const nodeData = await redis.hgetall(`netron:discovery:nodes:${nodeId}`);

    const servicesRaw = nodeData['services'];
    expect(servicesRaw).toBeDefined();
    expect(JSON.parse(servicesRaw!)).toEqual(updatedServices);
  });
});
