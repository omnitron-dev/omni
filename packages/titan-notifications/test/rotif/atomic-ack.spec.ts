import Redis from 'ioredis';
import { delay, defer } from '@omnitron-dev/common';
import { isRedisInMockMode } from './helpers/test-utils.js';

import type { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestNotificationManager } from './helpers/test-utils.js';

const skipTests = isRedisInMockMode();
if (skipTests) {
  console.log('⏭️ Skipping atomic-ack.spec.ts - requires real Redis');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Lua Atomic Ack Script', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    manager = await createTestNotificationManager(1, { blockInterval: 100 });
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

    await manager.subscribe(
      channel,
      async (msg) => {
        expect(msg.payload.message).toEqual(payload.message);
        receivedMessageId = msg.id;
        messageProcessedDefer.resolve?.(true);
      },
      { groupName: 'atomicAckGroup', startFrom: '0' }
    );

    await delay(400);

    await manager.publish(channel, payload);

    await messageProcessedDefer.promise;

    expect(receivedMessageId).not.toBeNull();
    await delay(100);

    // Acknowledged: nothing is pending for THIS group any more. That is what
    // `XACK` does and what this suite's name is about.
    const pending = await redis.xpending(`rotif:stream:${channel}`, 'atomicAckGroup');
    expect(pending[0]).toBe(0);

    // ...and still present in the stream. This assertion used to require the
    // opposite, because `ack()` passed the script's delete flag and `XDEL`
    // removed the entry outright. `XACK` is per-group and `XDEL` is not, so
    // that made the first consumer group to acknowledge delete the message for
    // every other group reading the same channel — see
    // `ack-does-not-delete-for-other-groups.spec.ts`. Retention belongs to
    // `maxStreamLength` / `minStreamId`, not to an acknowledgement.
    const messages = await redis.xrange(`rotif:stream:${channel}`, '-', '+');
    expect(messages.map((m) => m[0])).toEqual([receivedMessageId]);
  }, 10000);
});
