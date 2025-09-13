import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { Netron, Service } from '../dist';
import { cleanupRedis, getTestRedisUrl, createTestRedisClient } from './helpers/test-utils';

@Service('service.alpha@1.0.0')
class ServiceAlpha {}

@Service('service.beta@1.0.0')
class ServiceBeta {}

describe('ServiceDiscovery Integration - Concurrent Service Updates', () => {
  let redis: Redis;
  let netron: Netron;

  beforeAll(async () => {
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    netron = await Netron.create({
      listenHost: 'localhost',
      listenPort: 4008,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
    });

    await delay(1000);
  });

  afterAll(async () => {
    await netron.stop();
    await redis.quit();
  });

  it('should handle concurrent service updates correctly', async () => {
    // Expose service Alpha
    const exposeAlpha = netron.peer.exposeService(new ServiceAlpha());

    // Simultaneously expose service Beta
    const exposeBeta = netron.peer.exposeService(new ServiceBeta());

    await Promise.all([exposeAlpha, exposeBeta]);

    await delay(1000); // wait for heartbeat

    let activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.services).toEqual(
      expect.arrayContaining([
        { name: 'service.alpha', version: '1.0.0' },
        { name: 'service.beta', version: '1.0.0' },
      ])
    );

    // Now simultaneously unexpose both services
    const unexposeAlpha = netron.peer.unexposeService('service.alpha@1.0.0');
    const unexposeBeta = netron.peer.unexposeService('service.beta@1.0.0');

    await Promise.all([unexposeAlpha, unexposeBeta]);

    await delay(1000); // wait for heartbeat

    activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.services).toEqual([]);
  });
});
