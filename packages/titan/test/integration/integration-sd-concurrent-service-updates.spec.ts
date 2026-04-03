import Redis from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { Netron, Service } from '../../src/netron/index.js';
import { cleanupRedis, getTestRedisUrl, createTestRedisClient } from '../netron/helpers/test-utils.js';
import { setupRedisForTests, teardownRedisForTests } from '../netron/helpers/redis-test-helper.js';
import { isRedisInMockMode } from '../utils/redis-test-utils.js';

function createTestLogger(): any {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
    fatal: () => {},
  };
  logger.child = () => logger;
  return logger;
}

const skipTests = isRedisInMockMode();

if (skipTests) {
  console.log('⏭️ Skipping integration-sd-concurrent-service-updates.spec.ts - requires real Redis');
}

@Service('service.alpha@1.0.0')
class ServiceAlpha {}

@Service('service.beta@1.0.0')
class ServiceBeta {}

const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('ServiceDiscovery Integration - Concurrent Service Updates', () => {
  let redis: Redis;
  let netron: Netron;

  beforeAll(async () => {
    await setupRedisForTests();
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    netron = await Netron.create(createTestLogger(), {
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
    if (netron) await netron.stop();
    if (redis) await redis.quit();
    await teardownRedisForTests();
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
