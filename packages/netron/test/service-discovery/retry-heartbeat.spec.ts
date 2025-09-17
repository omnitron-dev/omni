import { Redis } from 'ioredis';

import { Netron, ServiceDiscovery } from '../../src';
import { cleanupRedis, createTestRedisClient } from '../helpers/test-utils';

describe('ServiceDiscovery Retry Heartbeat', () => {
  let redis: Redis | undefined;
  let discovery: ServiceDiscovery | undefined;
  const nodeId = 'retry-node';
  const address = '127.0.0.1:3000';
  const services = [{ name: 'retry-service', version: '1.0.0' }];

  beforeEach(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    const netron = new Netron({
      id: nodeId,
    });

    discovery = new ServiceDiscovery(redis, netron, address, services, {
      heartbeatInterval: 500,
      heartbeatTTL: 1500,
    });
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

  it('should retry heartbeat if Redis fails temporarily', async () => {
    const originalEval = redis!.eval.bind(redis);

    const mockEval = jest
      .spyOn(redis!, 'eval')
      .mockRejectedValueOnce(new Error('Temporary Redis Error')) // первая попытка всегда падает
      .mockImplementationOnce(originalEval); // вторая попытка вызывает оригинал

    await expect(discovery!.publishHeartbeat()).resolves.not.toThrow();

    expect(mockEval).toHaveBeenCalledTimes(2);

    const nodeData = await redis!.hgetall(`netron:discovery:nodes:${nodeId}`);
    expect(nodeData['address']).toBe(address);

    const heartbeatExists = await redis!.exists(`netron:discovery:heartbeat:${nodeId}`);
    expect(heartbeatExists).toBe(1);

    mockEval.mockRestore();
  });
});
