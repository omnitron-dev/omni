import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { NotificationManager } from '../src';

describe('Stress Test – Lua Atomic Publish', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = new NotificationManager({ redis: { db: 1 } });
    redis = manager.redis;
    await redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  async function waitUntil(condition: () => Promise<boolean>, timeoutMs: number, intervalMs: number = 100): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await condition()) return;
      await delay(intervalMs);
    }
    throw new Error('waitUntil timeout');
  }

  it('should handle concurrent atomic publishes without loss or error', async () => {
    const totalMessages = 10000;
    const concurrentPublishes = 1000;

    const publishTasks = Array.from({ length: totalMessages }, (_, i) => {
      const channel = `stress.channel.${i % 10}`;
      const payload = { index: i, message: `message-${i}` };
      return manager.publish(channel, payload, {
        delayMs: i % 20 === 0 ? 1000 : undefined,
      });
    });

    for (let i = 0; i < publishTasks.length; i += concurrentPublishes) {
      await Promise.all(publishTasks.slice(i, i + concurrentPublishes));
    }

    // ✅ Ждём пока delayed-сообщения переместятся
    await waitUntil(async () => {
      const delayedCount = await redis.zcount('rotif:scheduled', '-inf', '+inf');
      return delayedCount === 0;
    }, 10000);

    for (let i = 0; i < 10; i++) {
      const messages = await redis.xrange(`rotif:stream:stress.channel.${i}`, '-', '+');
      expect(messages.length).toBe(1000);
    }
  }, 30000);
});
