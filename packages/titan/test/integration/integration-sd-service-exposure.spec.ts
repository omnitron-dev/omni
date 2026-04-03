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
  console.log('⏭️ Skipping integration-sd-service-exposure.spec.ts - requires real Redis');
}

@Service('test.service@1.0.0')
class TestService {
  hello() {
    return 'Hello Netron!';
  }
}

const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('ServiceDiscovery Integration - Service Exposure & Unexposure', () => {
  let redis: Redis;
  let netron: Netron;

  beforeAll(async () => {
    await setupRedisForTests();
    redis = createTestRedisClient(2);
    await cleanupRedis(redis);

    netron = await Netron.create(createTestLogger(), {
      listenHost: 'localhost',
      listenPort: 4004,
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

  it('should correctly update service info in Redis on exposure and unexposure', async () => {
    await netron.peer.exposeService(new TestService());

    await delay(1000); // wait for heartbeat update

    const activeNodes = await netron.discovery!.getActiveNodes();

    expect(activeNodes).toHaveLength(1);
    expect(activeNodes[0]?.services).toEqual([{ name: 'test.service', version: '1.0.0' }]);

    // Now unexpose the service
    await netron.peer.unexposeService('test.service@1.0.0');

    await delay(1000); // wait for heartbeat update

    const activeNodesAfterUnexpose = await netron.discovery!.getActiveNodes();
    expect(activeNodesAfterUnexpose).toHaveLength(1);
    expect(activeNodesAfterUnexpose[0]?.services).toEqual([]);
  });
});
