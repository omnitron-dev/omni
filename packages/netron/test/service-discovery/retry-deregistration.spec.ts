import { Redis } from 'ioredis';
import { jest } from '@jest/globals';
import { delay } from '@omnitron-dev/common';

import { Netron, ServiceDiscovery } from '../../src';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery Retry Deregistration', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;

  const nodeId = 'retry-deregistration-node';
  const address = '127.0.0.1:3000';
  const services = [{ name: 'retry-dereg-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
      pubSubEnabled: true,
    });

    discovery!.startHeartbeat();
    await delay(100); // ensure initial heartbeat
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

  it('should retry deregistration if Redis fails temporarily', async () => {
    // Mock Redis multi to fail on the first attempt
    const originalMulti = redis!.multi.bind(redis);
    let failOnce = true;

    jest.spyOn(redis!, 'multi').mockImplementation(() => {
      const transaction = originalMulti();
      if (failOnce) {
        failOnce = false;
        jest.spyOn(transaction, 'exec').mockRejectedValueOnce(new Error('Temporary Redis Error'));
      }
      return transaction;
    });

    await expect(discovery!.shutdown()).resolves.not.toThrow();

    const nodeExists = await redis!.exists(`netron:discovery:nodes:${nodeId}`);
    const heartbeatExists = await redis!.exists(`netron:discovery:heartbeat:${nodeId}`);
    const nodeIndexed = await redis!.sismember('netron:discovery:index:nodes', nodeId);

    expect(nodeExists).toBe(0);
    expect(heartbeatExists).toBe(0);
    expect(nodeIndexed).toBe(0);

    jest.restoreAllMocks();
  });
});
