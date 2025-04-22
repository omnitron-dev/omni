import Redis from 'ioredis';
import { delay } from '@devgrid/common';

import { NotificationManager } from '../src';

describe('Lua Atomic Ack Script', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = new NotificationManager({ redis: { db: 1 }, blockInterval: 500 });
    redis = manager.redis;
    await redis.flushdb();
    await delay(1000); // Дождёмся загрузки скриптов
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should atomically acknowledge messages', async () => {
    const channel = 'atomic.ack.test';
    const payload = { message: 'test message' };

    await manager.publish(channel, payload);

    let receivedMessageId: string | null = null;

    await manager.subscribe(channel, async (msg) => {
      expect(msg.payload.message).toEqual(payload.message);
      receivedMessageId = msg.id;
      await msg.ack();
    }, { groupName: 'atomicAckGroup', startFrom: '0' });

    await delay(1500); // Дать время на обработку сообщения

    expect(receivedMessageId).not.toBeNull();

    // Проверим, что сообщение было подтверждено и удалено
    const pending = await redis.xpending(`rotif:stream:${channel}`, 'atomicAckGroup');
    expect(pending[0]).toBe(0);

    const messages = await redis.xrange(`rotif:stream:${channel}`, '-', '+');
    expect(messages.length).toBe(0);
  }, 10000);
});
