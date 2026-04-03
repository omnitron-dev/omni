import { Redis } from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { Netron } from '../../src/netron/index.js';
import { DiscoveryEvent } from '../../src/modules/discovery/types.js';
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
  console.log('⏭️ Skipping integration-sd-node-events.spec.ts - requires real Redis');
}

const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('ServiceDiscovery Integration - Node Registration & Deregistration Events', () => {
  let redisPub: Redis;
  let redisSub: Redis;
  let netron: Netron;
  const receivedEvents: DiscoveryEvent[] = [];

  beforeAll(async () => {
    await setupRedisForTests();
    redisPub = createTestRedisClient(2);
    await cleanupRedis(redisPub);

    redisSub = createTestRedisClient(2);

    await redisSub.subscribe('netron:discovery:events');
    redisSub.on('message', (_, message) => {
      receivedEvents.push(JSON.parse(message) as DiscoveryEvent);
    });

    netron = await Netron.create(createTestLogger(), {
      listenHost: 'localhost',
      listenPort: 4002,
      discoveryEnabled: true,
      discoveryRedisUrl: getTestRedisUrl(2),
      discoveryHeartbeatInterval: 500,
      discoveryHeartbeatTTL: 3000,
      discoveryPubSubEnabled: true, // Enable PubSub
    });

    await delay(1000); // Wait for initialization
  });

  afterAll(async () => {
    if (netron) await netron.stop();
    if (redisPub) await redisPub.quit();
    if (redisSub) await redisSub.quit();
    await teardownRedisForTests();
  });

  it('should emit NODE_REGISTERED and NODE_DEREGISTERED events', async () => {
    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

    const registerEvent = receivedEvents.find((e) => e.type === 'NODE_REGISTERED');
    expect(registerEvent).toBeDefined();
    expect(registerEvent!.nodeId).toBe(netron.id);
    expect(registerEvent!.address).toBe('localhost:4002');

    // Call graceful shutdown to check deregistration event
    await netron.stop();

    await delay(1000); // Give time for event publication

    const deregisterEvent = receivedEvents.find((e) => e.type === 'NODE_DEREGISTERED');
    expect(deregisterEvent).toBeDefined();
    expect(deregisterEvent!.nodeId).toBe(netron.id);
  }, 10000);
});
