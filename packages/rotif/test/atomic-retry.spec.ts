import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { NotificationManager } from '../src';

describe('Lua Atomic Retry Script', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = new NotificationManager({
      redis: { db: 1 },
      blockInterval: 100,
      scheduledBatchSize: 1000,
      checkDelayInterval: 100,
    });
    redis = manager.redis;
    await redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should atomically retry messages with incremented attempt', async () => {
    const channel = 'atomic.retry.test';
    const payload = { message: 'retry message' };

    let attemptCount = 0;

    await manager.subscribe(channel, async (msg) => {
      attemptCount++;
      if (msg.attempt < 3) {
        throw new Error('Trigger retry'); // Теперь retry вызывается автоматически при ошибке
      } else {
        await msg.ack();
      }
    }, {
      groupName: 'retryGroup',
      retryDelay: 500
    });

    await manager.publish(channel, payload);

    await delay(2500); // дать время на retry и обработку

    expect(attemptCount).toBe(3);

    // Проверим, что delayed set пуст
    const delayedCount = await redis.zcount('rotif:scheduled', '-inf', '+inf');
    expect(delayedCount).toBe(0);
  }, 10000);
});
