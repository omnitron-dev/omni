import { delay as delayMs } from '@devgrid/common';

import { NotificationManager } from '../src';

describe('Exactly-once - deduplication', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    manager = new NotificationManager({
      redis: { db: 1 },
      checkDelayInterval: 100,
      blockInterval: 100,
    });
    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should not process duplicate messages', async () => {
    const received: any[] = [];
    const channel = 'exactly-once.test';

    await manager.subscribe(
      channel,
      async (msg) => {
        received.push(msg.payload);
        // намеренно не делаем msg.ack()
      },
      {
        exactlyOnce: true,
        startFrom: '0',
      }
    );

    await delayMs(100);

    const payload = { key: 'value' };
    await manager.publish(channel, payload);

    // Дожидаемся первого получения
    await delayMs(500);

    // Останавливаем текущий менеджер, не сделав ACK, чтобы Redis переотправил
    await manager.stopAll();

    // Перезапускаем подписчика (новый consumer)
    manager = new NotificationManager({ redis: { db: 1 }, checkDelayInterval: 100, blockInterval: 100 });

    await manager.subscribe(
      channel,
      async (msg) => {
        received.push(msg.payload);
        await msg.ack();
      },
      {
        exactlyOnce: true,
        startFrom: '0',
      }
    );

    // Ждём повторную доставку того же сообщения
    await delayMs(1000);

    expect(received.length).toBe(1); // должно прийти только 1 сообщение
    expect(received[0]).toEqual(payload);
  }, 10000);
});
