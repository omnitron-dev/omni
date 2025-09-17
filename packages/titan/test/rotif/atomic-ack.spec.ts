import { Redis } from 'ioredis';
import { delay, defer } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/index.js';
import { createTestConfig } from './helpers/test-utils.js';

describe('Lua Atomic Ack Script', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = new NotificationManager(createTestConfig(1, { blockInterval: 100 }));
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
    const messageProcessedDefer = defer();

    let receivedMessageId: string | null = null;

    await manager.subscribe(channel, async (msg) => {
      expect(msg.payload.message).toEqual(payload.message);
      receivedMessageId = msg.id;
      messageProcessedDefer.resolve?.(true);
    }, { groupName: 'atomicAckGroup', startFrom: '0' });

    await delay(400);

    await manager.publish(channel, payload);

    await messageProcessedDefer.promise;

    expect(receivedMessageId).not.toBeNull();
    await delay(100);

    // Проверим, что сообщение было подтверждено и удалено
    const pending = await redis.xpending(`rotif:stream:${channel}`, 'atomicAckGroup');
    expect(pending[0]).toBe(0);

    const messages = await redis.xrange(`rotif:stream:${channel}`, '-', '+');
    expect(messages.length).toBe(0);
  }, 10000);
});
