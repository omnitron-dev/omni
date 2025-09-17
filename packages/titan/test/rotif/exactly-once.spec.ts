
import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/index.js';
import { getTestRedisUrl } from './helpers/test-utils.js';

let manager: NotificationManager;

beforeEach(async () => {
  manager = new NotificationManager({
    redis: getTestRedisUrl(1),
    deduplicationTTL: 3600,
    blockInterval: 100,
  });
  await manager.redis.flushdb();
});

afterEach(async () => {
  await manager.stopAll();
});

describe('Exactly-once Deduplication', () => {

  it('should process unique messages only once', async () => {
    let received = 0;

    await manager.subscribe('exact.*', async (msg) => {
      received++;
      await msg.ack();
    });

    await delay(100);

    const payload = { data: 'unique message' };

    await manager.publish('exact.test', payload, { exactlyOnce: true });
    await manager.publish('exact.test', payload, { exactlyOnce: true });

    await delay(1000);

    expect(received).toBe(1);
  });

  it('should allow re-processing after TTL expiry', async () => {
    jest.setTimeout(15000);

    let received = 0;

    manager.config.deduplicationTTL = 2; // short TTL for test

    await manager.subscribe('exact.ttl', async (msg) => {
      received++;
      await msg.ack();
    });

    await delay(100);

    const payload = { data: 'ttl message' };

    await manager.publish('exact.ttl', payload, { exactlyOnce: true });

    await delay(1000);

    expect(received).toBe(1);

    // After TTL expires, the same payload should be processed again
    await delay(2000);

    await manager.publish('exact.ttl', payload, { exactlyOnce: true });

    await delay(1000);

    expect(received).toBe(2);
  });

  it('should deduplicate based on message payload hash', async () => {
    let received = 0;

    await manager.subscribe('exact.hash', async (msg) => {
      received++;
      await msg.ack();
    });

    await delay(100);

    const payload1 = { id: 1, content: 'duplicate' };
    const payload2 = { id: 1, content: 'duplicate' };

    await manager.publish('exact.hash', payload1, { exactlyOnce: true });
    await manager.publish('exact.hash', payload2, { exactlyOnce: true });

    await delay(1000);

    expect(received).toBe(1);
  });

  it('should handle exactly-once correctly with multiple subscribers', async () => {
    let sub1Received = 0;
    let sub2Received = 0;

    await manager.subscribe('exact.multi', async (msg) => {
      sub1Received++;
      await msg.ack();
    }, { groupName: 'group1' });

    await manager.subscribe('exact.multi', async (msg) => {
      sub2Received++;
      await msg.ack();
    }, { groupName: 'group2' });

    await delay(100);

    const payload = { data: 'multi subscriber' };

    await manager.publish('exact.multi', payload, { exactlyOnce: true });
    await manager.publish('exact.multi', payload, { exactlyOnce: true });

    await delay(1000);

    expect(sub1Received).toBe(1);
    expect(sub2Received).toBe(1);
  });
});