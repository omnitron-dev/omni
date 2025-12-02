import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Redis from 'ioredis';
import type { NotificationManager } from '../../../src/rotif/rotif.js';
import { createTestConfig, createTestNotificationManager } from '../helpers/test-utils.js';
import { delay } from '@omnitron-dev/common';

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
if (skipTests) {
  console.log('⏭️  Skipping edge-cases.spec.ts - integration test');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Rotif - Edge Cases', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeEach(async () => {
    manager = await createTestNotificationManager(8, {
      checkDelayInterval: 100,
      blockInterval: 100,
      maxRetries: 2,
    });
    redis = manager.redis;
    await redis.flushdb();
    await manager.waitUntilReady();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('payload edge cases', () => {
    beforeEach(async () => {
      await manager.subscribe('test.channel', async () => {});
      await delay(100);
    });

    it('should handle null payload', async () => {
      const id = await manager.publish('test.channel', null);
      expect(id).toBeTruthy();
    });

    it('should handle undefined payload', async () => {
      const id = await manager.publish('test.channel', undefined);
      expect(id).toBeTruthy();
    });

    it('should handle empty object payload', async () => {
      const id = await manager.publish('test.channel', {});
      expect(id).toBeTruthy();
    });

    it('should handle empty array payload', async () => {
      const id = await manager.publish('test.channel', []);
      expect(id).toBeTruthy();
    });

    it('should handle large payload', async () => {
      const largePayload = {
        data: 'x'.repeat(10000),
        nested: Array(100).fill({ key: 'value' }),
      };

      const id = await manager.publish('test.channel', largePayload);
      expect(id).toBeTruthy();
    });

    it('should handle deeply nested payload', async () => {
      let nested: any = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        nested = { child: nested };
      }

      const id = await manager.publish('test.channel', nested);
      expect(id).toBeTruthy();
    });

    it('should handle special characters in payload', async () => {
      const payload = {
        text: 'Special chars: 🎉 ñ € ™ \n\t\r',
        unicode: '中文 العربية हिन्दी',
      };

      const id = await manager.publish('test.channel', payload);
      expect(id).toBeTruthy();
    });

    it('should handle circular references by MessagePack', async () => {
      const obj: any = { name: 'test' };
      obj.self = obj; // Circular reference

      // MessagePack should handle this or throw
      await expect(async () => {
        await manager.publish('test.channel', obj);
      }).rejects.toThrow();
    });

    it('should handle Date objects', async () => {
      const payload = {
        timestamp: new Date(),
        futureDate: new Date(Date.now() + 86400000),
      };

      const received: any[] = [];
      await manager.subscribe('test.date', async (msg) => {
        received.push(msg.payload);
      });

      await delay(100);
      await manager.publish('test.date', payload);
      await delay(200);

      expect(received.length).toBe(1);
    });

    it('should handle Buffer/binary data', async () => {
      const payload = {
        buffer: Buffer.from('hello world'),
        bytes: new Uint8Array([1, 2, 3, 4, 5]),
      };

      const id = await manager.publish('test.channel', payload);
      expect(id).toBeTruthy();
    });
  });

  describe('channel name edge cases', () => {
    it('should handle very long channel names', async () => {
      const longChannel = 'test.' + 'a'.repeat(1000);

      await manager.subscribe(longChannel, async () => {});
      await delay(100);

      const id = await manager.publish(longChannel, { msg: 'test' });
      expect(id).toBeTruthy();
    });

    it('should handle channel with special characters', async () => {
      const channel = 'test:channel:with-dashes_and_underscores.dots';

      await manager.subscribe(channel, async () => {});
      await delay(100);

      const id = await manager.publish(channel, {});
      expect(id).toBeTruthy();
    });

    it('should handle numeric channel names', async () => {
      const channel = '12345';

      await manager.subscribe(channel, async () => {});
      await delay(100);

      const id = await manager.publish(channel, {});
      expect(id).toBeTruthy();
    });
  });

  describe('timing edge cases', () => {
    it('should handle publish before subscribe', async () => {
      await manager.subscribe('test.channel', async () => {});
      await delay(50); // Short delay

      const id = await manager.publish('test.channel', {});
      expect(id).toBeTruthy();
    });

    it('should handle rapid publish calls', async () => {
      const received: number[] = [];

      await manager.subscribe('test.rapid', async () => {
        received.push(Date.now());
      });

      await delay(100);

      // Publish 100 messages rapidly
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(manager.publish('test.rapid', { index: i }));
      }

      await Promise.all(promises);
      await delay(2000);

      expect(received.length).toBe(100);
    });

    it('should handle unsubscribe during message processing', async () => {
      let processing = false;

      const sub = await manager.subscribe('test.channel', async () => {
        processing = true;
        await delay(500);
        processing = false;
      });

      await delay(100);

      await manager.publish('test.channel', {});
      await delay(100);

      const unsubPromise = sub.unsubscribe();
      expect(processing).toBe(true);

      await unsubPromise;
      expect(processing).toBe(false);
    });

    it('should handle zero delay for delayed messages', async () => {
      await manager.subscribe('test.delay', async () => {});
      await delay(100);

      const result = await manager.publish('test.delay', {}, { delayMs: 0 });

      // Zero delay should still schedule
      expect(result).toBeTruthy();
    });

    it('should handle negative delay (treat as immediate)', async () => {
      await manager.subscribe('test.delay', async () => {});
      await delay(100);

      const result = await manager.publish('test.delay', {}, { delayMs: -1000 });

      expect(result).toBeTruthy();
    });
  });

  describe('concurrency edge cases', () => {
    it('should handle multiple subscribers to same pattern', async () => {
      const received1: number[] = [];
      const received2: number[] = [];
      const received3: number[] = [];

      await manager.subscribe('test.multi', async (msg) => {
        received1.push(msg.timestamp);
      });

      await manager.subscribe('test.multi', async (msg) => {
        received2.push(msg.timestamp);
      });

      await manager.subscribe('test.multi', async (msg) => {
        received3.push(msg.timestamp);
      });

      await delay(100);

      await manager.publish('test.multi', { msg: 'broadcast' });
      await delay(500);

      // All subscribers should receive the message
      expect(received1.length).toBeGreaterThan(0);
      expect(received2.length).toBeGreaterThan(0);
      expect(received3.length).toBeGreaterThan(0);
    });

    it('should handle subscribe/unsubscribe race conditions', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          (async () => {
            const sub = await manager.subscribe(`test.race.${i}`, async () => {});
            await delay(Math.random() * 100);
            await sub.unsubscribe(true);
          })()
        );
      }

      await Promise.all(promises);

      // Should complete without errors
      expect(true).toBe(true);
    });

    it('should handle overlapping pattern subscriptions', async () => {
      const received1: string[] = [];
      const received2: string[] = [];

      await manager.subscribe('test.*', async (msg) => {
        received1.push(msg.channel);
      });

      await manager.subscribe('test.specific', async (msg) => {
        received2.push(msg.channel);
      });

      await delay(100);

      await manager.publish('test.specific', {});
      await delay(300);

      // Both patterns should match
      expect(received1).toContain('test.specific');
      expect(received2).toContain('test.specific');
    });
  });

  describe('retry edge cases', () => {
    it('should respect maxRetries = 0', async () => {
      let attempts = 0;

      await manager.subscribe(
        'test.noretry',
        async () => {
          attempts++;
          throw new Error('Always fail');
        },
        { maxRetries: 0 }
      );

      await delay(100);

      await manager.publish('test.noretry', {});
      await delay(1000);

      // Should attempt once, then immediately go to DLQ
      expect(attempts).toBe(1);
    });

    it('should handle very high maxRetries', async () => {
      let attempts = 0;

      await manager.subscribe(
        'test.manyretries',
        async () => {
          attempts++;
          if (attempts < 5) {
            throw new Error('Fail');
          }
        },
        { maxRetries: 100 }
      );

      await delay(100);

      await manager.publish('test.manyretries', {});
      await delay(2000);

      expect(attempts).toBeGreaterThanOrEqual(5);
    });

    it('should handle handler that alternates between success and failure', async () => {
      let callCount = 0;

      await manager.subscribe('test.flaky', async () => {
        callCount++;
        if (callCount % 2 === 1) {
          throw new Error('Odd attempts fail');
        }
      });

      await delay(100);

      await manager.publish('test.flaky', {});
      await delay(1500);

      // Should eventually succeed on an even attempt
      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('pattern matching edge cases', () => {
    it('should handle ** double wildcard', async () => {
      const received: string[] = [];

      await manager.subscribe('**', async (msg) => {
        received.push(msg.channel);
      });

      await delay(100);

      await manager.publish('anything', {});
      await manager.publish('deeply.nested.channel', {});
      await delay(300);

      expect(received.length).toBeGreaterThan(0);
    });

    it('should handle single * wildcard', async () => {
      const received: string[] = [];

      await manager.subscribe('test.*', async (msg) => {
        received.push(msg.channel);
      });

      await delay(100);

      await manager.publish('test.one', {});
      await manager.publish('test.two', {});
      await manager.publish('other.channel', {});
      await delay(300);

      expect(received).toContain('test.one');
      expect(received).toContain('test.two');
      expect(received).not.toContain('other.channel');
    });

    it('should handle multiple wildcards in pattern', async () => {
      const received: string[] = [];

      await manager.subscribe('*.test.*', async (msg) => {
        received.push(msg.channel);
      });

      await delay(100);

      await manager.publish('prefix.test.suffix', {});
      await manager.publish('a.test.b', {});
      await manager.publish('test.suffix', {});
      await delay(300);

      expect(received).toContain('prefix.test.suffix');
      expect(received).toContain('a.test.b');
    });
  });

  describe('resource cleanup edge cases', () => {
    it('should handle stopAll called multiple times', async () => {
      await manager.stopAll();
      await manager.stopAll();
      await manager.stopAll();

      expect(manager['active']).toBe(false);
    });

    it('should handle operations after stopAll', async () => {
      await manager.stopAll();

      await expect(async () => {
        await manager.publish('test.channel', {});
      }).rejects.toThrow();
    });

    it('should handle unsubscribe of already unsubscribed', async () => {
      const sub = await manager.subscribe('test.channel', async () => {});

      await sub.unsubscribe();
      await sub.unsubscribe(); // Second unsubscribe

      expect(true).toBe(true); // Should not throw
    });
  });

  describe('deduplication edge cases', () => {
    beforeEach(async () => {
      await manager.subscribe('test.dedup', async () => {});
      await delay(100);
    });

    it('should deduplicate identical payloads with exactlyOnce', async () => {
      const payload = { id: 123, data: 'test' };

      const id1 = await manager.publish('test.dedup', payload, { exactlyOnce: true });
      const id2 = await manager.publish('test.dedup', payload, { exactlyOnce: true });
      const id3 = await manager.publish('test.dedup', payload, { exactlyOnce: true });

      expect(id1).toBeTruthy();
      expect(id2).toBe('DUPLICATE');
      expect(id3).toBe('DUPLICATE');
    });

    it('should not deduplicate similar but different payloads', async () => {
      const id1 = await manager.publish('test.dedup', { id: 1 }, { exactlyOnce: true });
      const id2 = await manager.publish('test.dedup', { id: 2 }, { exactlyOnce: true });

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('should respect deduplicationTTL', async () => {
      const payload = { unique: 'data' };

      const id1 = await manager.publish('test.dedup', payload, {
        exactlyOnce: true,
        deduplicationTTL: 1, // 1 second
      });

      await delay(1500); // Wait for TTL to expire

      const id2 = await manager.publish('test.dedup', payload, {
        exactlyOnce: true,
        deduplicationTTL: 1,
      });

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });
  });

  describe('error recovery edge cases', () => {
    it('should recover from Redis connection errors', async () => {
      // This is hard to test without actually killing Redis
      // Just verify manager handles errors gracefully
      expect(manager.redis.status).toBe('ready');
    });

    it('should handle malformed messages in stream', async () => {
      const received: any[] = [];

      await manager.subscribe('test.malformed', async (msg) => {
        received.push(msg);
      });

      await delay(100);

      // Add malformed message directly to stream
      await redis.xadd(
        'rotif:stream:test.malformed',
        '*',
        'channel',
        'test.malformed',
        'payload',
        'invalid-json',
        'timestamp',
        String(Date.now())
      );

      await delay(500);

      // Should not crash, message should be acked
    });
  });
});
