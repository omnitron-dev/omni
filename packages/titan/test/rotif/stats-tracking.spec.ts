import { delay as delayMs } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestConfig } from './helpers/test-utils.js';

describe('Stats - tracking', () => {
  describe('should correctly track subscription stats', () => {
    let manager: NotificationManager;

    beforeAll(async () => {
      manager = new NotificationManager(
        createTestConfig(1, {
          checkDelayInterval: 50,
          blockInterval: 100,
        })
      );

      await manager.redis.flushdb();
    });

    afterAll(async () => {
      await manager.stopAll();
    });

    it('tracks successful retries correctly', async () => {
      const sub = await manager.subscribe(
        'test.stats',
        async (msg) => {
          if (msg.attempt === 1) {
            throw new Error('Forced retry');
          }
          await delayMs(50);
        },
        {
          startFrom: '0',
          maxRetries: 2,
          retryDelay: 200, // ⚠️ увеличил retryDelay до 200мс
        }
      );

      await delayMs(100);

      await manager.publish('test.stats', { data: 123 });

      // Гарантируем достаточно времени на retry и обработку:
      await delayMs(1000);

      const stats = sub.stats();

      expect(stats.messages).toBe(1);
      expect(stats.retries).toBe(1);
      expect(stats.failures).toBe(0);
      expect(stats.lastMessageAt).toBeGreaterThan(0);
    }, 10000);
  });

  describe('should track failures into DLQ', () => {
    let manager: NotificationManager;

    beforeAll(async () => {
      manager = new NotificationManager(
        createTestConfig(1, {
          checkDelayInterval: 100,
          maxRetries: 2,
          blockInterval: 100,
        })
      );

      await manager.redis.flushdb();
    });

    afterAll(async () => {
      await manager.stopAll();
    });

    it('tracks DLQ entries correctly', async () => {
      const sub = await manager.subscribe(
        'test.stats.dlq',
        async () => {
          throw new Error('always fail');
        },
        {
          startFrom: '0',
          retryDelay: 50,
          maxRetries: 2,
        }
      );

      await delayMs(100);

      await manager.publish('test.stats.dlq', { fail: true });

      await delayMs(1000); // гарантируем все попытки и отправку в DLQ

      const stats = sub.stats();

      expect(stats.messages).toBe(0); // нет успешных сообщений
      expect(stats.retries).toBe(2); // 2 retry после первой неудачи (при maxRetries=2, всего 3 попытки)
      expect(stats.failures).toBe(1); // 1 сообщение попало в DLQ
      expect(stats.lastMessageAt).toBe(0); // нет успешной обработки
    }, 10000);
  });
});
