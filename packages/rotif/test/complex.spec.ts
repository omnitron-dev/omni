import { delay } from '@devgrid/common';

import { NotificationManager } from '../src/rotif';

const redisUrl = 'redis://localhost:6379/1';

describe('NotificationManager – Complex Case 1 Tests', () => {
  let manager: NotificationManager;

  beforeEach(async () => {
    manager = new NotificationManager({
      redis: redisUrl,
      maxRetries: 2,
      blockInterval: 100,
      checkDelayInterval: 200,
      deduplicationTTL: 60,
    });
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should test full Rotif functionality (fan-out, wildcard, DLQ, retry, delayed, exactly-once)', async () => {
    const results = {
      subscriber1: [] as any[],
      subscriber2: [] as any[],
      wildcard: [] as string[],
      dlq: [] as any[],
    };

    manager.use({
      beforePublish: (channel, payload) => console.log('beforePublish', channel, payload),
      afterProcess: (msg) => console.log('afterProcess', msg.channel, msg.id),
    });

    await manager.subscribe('orders.created', async (msg) => {
      if (msg.attempt === 1) throw new Error('Forced retry');
      results.subscriber2.push(msg.payload);
    }, { groupName: 'group2', maxRetries: 2 });


    await manager.subscribe('orders.created', async (msg) => {
      results.subscriber1.push(msg.payload);
    }, { groupName: 'group1', maxRetries: 2 });

    await manager.subscribe('orders.*', async (msg) => {
      console.error('wildcard', msg.channel);
      results.wildcard.push(msg.channel);
    }, { groupName: 'wildcardGroup' });

    manager.subscribeToDLQ(async (msg) => {
      results.dlq.push(msg.payload);
    });

    await delay(2000);

    // Публикуем сообщения
    await manager.publish('orders.created', { orderId: 1 }, { exactlyOnce: true });
    await manager.publish('orders.updated', { orderId: 1, status: 'shipped' });
    await manager.publish('orders.failed', { orderId: 1 }, { delayMs: 500 });

    // Повторное сообщение (дубликат, будет проигнорировано)
    await manager.publish('orders.created', { orderId: 1 }, { exactlyOnce: true });

    // Ожидаем обработку всех сообщений и retries
    await delay(2000);

    expect(results.subscriber1).toEqual([{ orderId: 1 }]); // subscriber1 успешно получил 1 сообщение
    expect(results.subscriber2).toEqual([{ orderId: 1 }]); // subscriber2 обработал после retry
    expect(results.wildcard).toEqual(expect.arrayContaining(['orders.created', 'orders.updated', 'orders.failed']));
    expect(results.dlq.length).toBe(0); // retries не превышены, DLQ пуст
  }, 20000);
});
