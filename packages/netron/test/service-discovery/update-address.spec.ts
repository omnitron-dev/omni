import { Redis } from 'ioredis';

import { Netron } from '../../src';
import { ServiceDiscovery } from '../../src/service-discovery';
import { createTestRedisClient, cleanupRedis } from '../helpers/test-utils';
describe('ServiceDiscovery Update Address', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'update-address-node';
  const initialAddress = '127.0.0.1:8000';
  const updatedAddress = '192.168.1.100:9000';
  const services = [{ name: 'address-update-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, initialAddress, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });

    await discovery.startHeartbeat();
  });

  afterEach(async () => {
    if (discovery) { await discovery.shutdown(); }
    if (redis) { await cleanupRedis(redis); }
    if (redis) { redis.disconnect(); }
  });

  it('should update node address correctly', async () => {
    await discovery!.updateAddress(updatedAddress);

    const nodeData = await redis!.hgetall(`netron:discovery:nodes:${nodeId}`);

    expect(nodeData['address']).toBe(updatedAddress);
  });
});
