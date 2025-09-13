import { Redis } from 'ioredis';

import { Netron, ServiceDiscovery } from '../../dist';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery Update Services', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'update-services-node';
  const address = '127.0.0.1:8000';
  const initialServices = [{ name: 'initial-service', version: '1.0.0' }];
  const updatedServices = [
    { name: 'updated-service', version: '2.0.0' },
    { name: 'additional-service', version: '1.0.0' },
  ];

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);
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

  it('should update node services correctly', async () => {
    await discovery!.updateServices(updatedServices);

    const nodeData = await redis!.hgetall(`netron:discovery:nodes:${nodeId}`);

    const servicesRaw = nodeData['services'];
    expect(servicesRaw).toBeDefined();
    expect(JSON.parse(servicesRaw!)).toEqual(updatedServices);
  });
});
