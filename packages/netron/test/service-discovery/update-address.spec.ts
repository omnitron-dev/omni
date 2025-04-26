import { Redis } from 'ioredis';

import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery Update Address', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;

  const nodeId = 'update-address-node';
  const initialAddress = '127.0.0.1:8000';
  const updatedAddress = '192.168.1.100:9000';
  const services = [{ name: 'address-update-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    discovery = new ServiceDiscovery(redis, nodeId, initialAddress, services, {
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

  it('should update node address correctly', async () => {
    await discovery.updateAddress(updatedAddress);

    const nodeData = await redis.hgetall(`netron:discovery:nodes:${nodeId}`);

    expect(nodeData['address']).toBe(updatedAddress);
  });
});
