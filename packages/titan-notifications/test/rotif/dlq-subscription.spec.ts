import { delay } from '@omnitron-dev/common';
import { getTestRedisConfig, isRedisInMockMode } from './helpers/test-utils.js';

import { RotifMessage } from '../../src/rotif/rotif.js';
import { NotificationManager } from '../../src/rotif/rotif.js';

const skipTests = isRedisInMockMode();
if (skipTests) {
  console.log('⏭️ Skipping dlq-subscription.spec.ts - requires real Redis');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('NotificationManager - DLQ Subscription', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    const redisConfig = getTestRedisConfig(1);
    manager = new NotificationManager({
      redis: {
        host: redisConfig.host,
        port: redisConfig.port,
        db: redisConfig.db,
      },
      blockInterval: 100,
    });

    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('subscribeToDLQ resolves instead of adopting its own consumer loop', async () => {
    // `subscribeToDLQ` is async and used to `return this.dlqSubscriptionPromise`
    // — the infinite `while (this.active)` loop — so the returned promise was
    // adopted and never settled until stopAll(). Every caller awaits it
    // (NotificationsService, RotifTransport, these tests), so subscribing to
    // the dead letter queue hung the caller forever.
    const config = getTestRedisConfig(1);
    const probe = new NotificationManager({
      redis: { host: config.host, port: config.port, db: config.db },
      blockInterval: 100,
    });
    await probe.waitUntilReady();

    try {
      let settled = false;
      await Promise.race([
        probe.subscribeToDLQ(async () => {}).then(() => {
          settled = true;
        }),
        delay(5_000),
      ]);

      expect(settled).toBe(true);
    } finally {
      await probe.stopAll();
    }
  }, 30_000);

  it('should deliver messages from DLQ subscription', async () => {
    const received: RotifMessage[] = [];

    // Don't await - this starts the background subscription
    manager.subscribeToDLQ(async (msg) => {
      received.push(msg);
      await msg.ack();
    });

    await delay(100);

    // Имитируем сообщение в DLQ
    await manager.redis.xadd(
      'rotif:dlq',
      '*',
      'channel',
      'test.channel',
      'payload',
      JSON.stringify({ failedData: 42 }),
      'attempt',
      '3'
    );

    await delay(500);

    expect(received.length).toBe(1);
    expect(received[0]?.channel).toBe('test.channel');
    expect(received[0]?.payload).toEqual({ failedData: 42 });
    expect(received[0]?.attempt).toBe(3);
  }, 10000);
});
