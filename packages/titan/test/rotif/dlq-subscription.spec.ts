import { delay } from '@omnitron-dev/common';

import { RotifMessage, NotificationManager } from '../../src/rotif/rotif.js';

describe('NotificationManager - DLQ Subscription', () => {
  let manager: NotificationManager;

  beforeAll(async () => {
    manager = new NotificationManager({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 1,
      },
      blockInterval: 100,
    });

    await manager.redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

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
