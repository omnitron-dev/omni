import { Redis } from 'ioredis';
import { jest } from '@jest/globals';
import { delay } from '@devgrid/common';

import { ServiceDiscovery } from '../../src/service-discovery';

describe('ServiceDiscovery Retry Deregistration', () => {
  let redis: Redis;
  let discovery: ServiceDiscovery;

  const nodeId = 'retry-deregistration-node';
  const address = '127.0.0.1:3000';
  const services = [{ name: 'retry-dereg-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = new Redis('redis://localhost:6379/2');
    await redis.flushdb();

    discovery = new ServiceDiscovery(redis, nodeId, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
      pubSubEnabled: true,
    });

    discovery.startHeartbeat();
    await delay(100); // ensure initial heartbeat
  });

  afterEach(async () => {
    await discovery.shutdown();
    await redis.flushdb();
    redis.disconnect();
  });

  it('should retry deregistration if Redis fails temporarily', async () => {
    // Mock Redis multi to fail on the first attempt
    const originalMulti = redis.multi.bind(redis);
    let failOnce = true;

    jest.spyOn(redis, 'multi').mockImplementation(() => {
      const transaction = originalMulti();
      if (failOnce) {
        failOnce = false;
        jest.spyOn(transaction, 'exec').mockRejectedValueOnce(new Error('Temporary Redis Error'));
      }
      return transaction;
    });

    await expect(discovery.shutdown()).resolves.not.toThrow();

    const nodeExists = await redis.exists(`netron:discovery:nodes:${nodeId}`);
    const heartbeatExists = await redis.exists(`netron:discovery:heartbeat:${nodeId}`);
    const nodeIndexed = await redis.sismember('netron:discovery:index:nodes', nodeId);

    expect(nodeExists).toBe(0);
    expect(heartbeatExists).toBe(0);
    expect(nodeIndexed).toBe(0);

    jest.restoreAllMocks();
  });
});
