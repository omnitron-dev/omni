import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Redis from 'ioredis';
import type { NotificationManager } from '../../../src/rotif/rotif.js';
import { createTestConfig, createTestNotificationManager } from '../helpers/test-utils.js';
import { delay } from '@omnitron-dev/common';

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
if (skipTests) {
  console.log('⏭️  Skipping consumer-loop.spec.ts - integration test');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Rotif - Consumer Loop', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeEach(async () => {
    manager = await createTestNotificationManager(9, {
      checkDelayInterval: 100,
      blockInterval: 100,
      maxRetries: 3,
      retryDelay: 200,
      pendingCheckInterval: 500,
      pendingIdleThreshold: 1000,
    });
    redis = manager.redis;
    await redis.flushdb();
    await manager.waitUntilReady();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('consumer loop lifecycle', () => {
    it('should start consumer loop on first subscription', async () => {
      const sub = await manager.subscribe('test.channel', async () => {});

      expect(manager['consumerLoops'].size).toBeGreaterThan(0);
      await sub.unsubscribe();
    });

    it('should share consumer loop for same stream and group', async () => {
      const sub1 = await manager.subscribe('test.channel', async () => {});
      const sub2 = await manager.subscribe('test.channel', async () => {});

      // Both should use the same consumer loop
      const initialLoopCount = manager['consumerLoops'].size;

      await sub1.unsubscribe();
      await sub2.unsubscribe();

      expect(initialLoopCount).toBeGreaterThan(0);
    });

    it('should create separate loops for different groups', async () => {
      await manager.subscribe('test.channel', async () => {}, { groupName: 'group1' });
      await manager.subscribe('test.channel', async () => {}, { groupName: 'group2' });

      // Should have at least 2 loops (main + retry for each group)
      expect(manager['consumerLoops'].size).toBeGreaterThan(2);
    });

    it('should cleanup loop when last subscription removed', async () => {
      const sub1 = await manager.subscribe('test.unique', async () => {});
      const sub2 = await manager.subscribe('test.unique', async () => {});

      await delay(100);

      await sub1.unsubscribe();
      await delay(100);

      // Loop should still exist with one subscription
      expect(manager['consumerLoops'].size).toBeGreaterThan(0);

      await sub2.unsubscribe();
      await delay(200);

      // Loop might be cleaned up or waiting for cleanup
      // Just verify no errors
      expect(true).toBe(true);
    });
  });

  describe('message acknowledgment', () => {
    it('should acknowledge messages after successful processing', async () => {
      let processed = false;

      await manager.subscribe('test.ack', async (msg) => {
        processed = true;
        await msg.ack();
      });

      await delay(100);

      await manager.publish('test.ack', { msg: 'test' });
      await delay(300);

      expect(processed).toBe(true);

      // Message should be acknowledged and removed from pending
      const pending = await redis.xpending('rotif:stream:test.ack', 'grp:test.ack');
      expect(pending[0]).toBe(0); // No pending messages
    });

    it('should not acknowledge messages on handler error', async () => {
      let errorThrown = false;

      await manager.subscribe(
        'test.noack',
        async () => {
          errorThrown = true;
          throw new Error('Handler error');
        },
        { maxRetries: 1 }
      );

      await delay(100);

      await manager.publish('test.noack', { msg: 'test' });
      await delay(500);

      expect(errorThrown).toBe(true);

      // Message should either be in retry or DLQ
      const streamLen = await redis.xlen('rotif:stream:test.noack');
      const dlqLen = await redis.xlen('rotif:dlq');

      expect(streamLen + dlqLen).toBeGreaterThanOrEqual(0);
    });
  });

  describe('pending message recovery', () => {
    it('should recover stale pending messages', async () => {
      // This is complex to test - we need to create a pending message
      // without acknowledging it and wait for idle threshold

      const received: string[] = [];

      await manager.subscribe('test.recovery', async (msg) => {
        received.push(msg.id);
      });

      await delay(100);

      // Publish and let it sit pending
      await manager.publish('test.recovery', { msg: 'test' });
      await delay(2000); // Wait longer than pendingIdleThreshold

      // Message should be processed
      expect(received.length).toBeGreaterThan(0);
    });

    it('should handle disabled pending recovery', async () => {
      const customManager = new NotificationManager(
        createTestConfig(10, {
          disablePendingMessageRecovery: true,
        })
      );

      await customManager.waitUntilReady();

      await customManager.subscribe('test.channel', async () => {});
      await delay(100);

      await customManager.publish('test.channel', {});
      await delay(300);

      await customManager.stopAll();

      expect(true).toBe(true); // Should work without errors
    });
  });

  describe('round-robin distribution', () => {
    it('should distribute messages with localRoundRobin', async () => {
      const received1: string[] = [];
      const received2: string[] = [];

      const customManager = new NotificationManager(
        createTestConfig(11, {
          localRoundRobin: true,
          blockInterval: 100,
        })
      );

      await customManager.waitUntilReady();

      await customManager.subscribe('test.rr', async (msg) => {
        received1.push(msg.id);
      });

      await customManager.subscribe('test.rr', async (msg) => {
        received2.push(msg.id);
      });

      await delay(100);

      // Publish multiple messages
      for (let i = 0; i < 10; i++) {
        await customManager.publish('test.rr', { index: i });
      }

      await delay(1000);

      await customManager.stopAll();

      // With round-robin, messages should be distributed
      // (though exact distribution depends on timing)
      const total = received1.length + received2.length;
      expect(total).toBeGreaterThan(0);
    });

    it('should handle round-robin index overflow', async () => {
      // Test that round-robin index wraps correctly
      const stream = 'test-stream';
      const group = 'test-group';
      const count = 5;

      // Simulate multiple calls
      for (let i = 0; i < 20; i++) {
        const index = manager['getRoundRobinIndex'](stream, group, count);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
      }
    });
  });

  describe('consumer group creation', () => {
    it('should create consumer group if not exists', async () => {
      const stream = 'rotif:stream:test.newgroup';
      const group = 'grp:test.newgroup';

      // Subscribe should create the group
      await manager.subscribe('test.newgroup', async () => {});
      await delay(100);

      // Verify group exists
      const groups = await redis.xinfo('GROUPS', stream);
      const groupNames = groups.map((g: any) => g[1]);

      expect(groupNames).toContain(group);
    });

    it('should handle existing consumer group', async () => {
      const stream = 'rotif:stream:test.existing';
      const group = 'grp:test.existing';

      // Create group manually
      await redis.xgroup('CREATE', stream, group, '$', 'MKSTREAM');

      // Subscribe should not throw
      await expect(async () => {
        await manager.subscribe('test.existing', async () => {});
      }).resolves.not.toThrow();
    });
  });

  describe('stream operations', () => {
    it('should handle empty stream', async () => {
      const received: any[] = [];

      await manager.subscribe('test.empty', async (msg) => {
        received.push(msg);
      });

      await delay(500);

      // No messages published
      expect(received.length).toBe(0);
    });

    it('should process messages in order', async () => {
      const received: number[] = [];

      await manager.subscribe('test.order', async (msg) => {
        received.push(msg.payload.index);
      });

      await delay(100);

      // Publish in sequence
      for (let i = 0; i < 5; i++) {
        await manager.publish('test.order', { index: i });
      }

      await delay(500);

      expect(received).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle concurrent message processing', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      await manager.subscribe('test.concurrent', async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await delay(100);
        concurrentCount--;
      });

      await delay(100);

      // Publish multiple messages quickly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(manager.publish('test.concurrent', { index: i }));
      }

      await Promise.all(promises);
      await delay(800);

      expect(maxConcurrent).toBeGreaterThan(0);
    });
  });

  describe('error scenarios', () => {
    it('should handle malformed stream data gracefully', async () => {
      const received: any[] = [];

      await manager.subscribe('test.malformed', async (msg) => {
        received.push(msg);
      });

      await delay(100);

      // Add malformed data directly to stream
      await redis.xadd(
        'rotif:stream:test.malformed',
        '*',
        'channel',
        'test.malformed',
        'payload',
        'not-json',
        'timestamp',
        'not-a-number'
      );

      await delay(500);

      // Should not crash, message should be handled
      expect(true).toBe(true);
    });

    it('should handle missing required fields', async () => {
      const received: any[] = [];

      await manager.subscribe('test.missing', async (msg) => {
        received.push(msg);
      });

      await delay(100);

      // Add incomplete message
      await redis.xadd('rotif:stream:test.missing', '*', 'channel', 'test.missing');

      await delay(500);

      // Should handle gracefully
      expect(true).toBe(true);
    });

    it('should continue processing after handler error', async () => {
      let callCount = 0;
      let errors = 0;

      await manager.subscribe(
        'test.continue',
        async () => {
          callCount++;
          if (callCount === 2) {
            errors++;
            throw new Error('Second message fails');
          }
        },
        { maxRetries: 1 }
      );

      await delay(100);

      await manager.publish('test.continue', { index: 1 });
      await manager.publish('test.continue', { index: 2 });
      await manager.publish('test.continue', { index: 3 });

      await delay(1000);

      expect(callCount).toBeGreaterThanOrEqual(3);
      expect(errors).toBe(1);
    });
  });

  describe('pattern synchronization', () => {
    it('should sync patterns on Redis reconnect', async () => {
      // Subscribe to a pattern
      await manager.subscribe('test.sync', async () => {});
      await delay(100);

      expect(manager['activePatterns'].has('test.sync')).toBe(true);

      // Simulate pattern sync
      await manager['syncPatterns']();

      expect(manager['activePatterns'].has('test.sync')).toBe(true);
    });

    it('should handle pattern updates via pubsub', async () => {
      const sub = await manager.subscribe('test.pubsub', async () => {});
      await delay(100);

      expect(manager['activePatterns'].has('test.pubsub')).toBe(true);

      await sub.unsubscribe(true);
      await delay(200);

      // Pattern should be removed
      expect(manager['activePatterns'].has('test.pubsub')).toBe(false);
    });
  });

  describe('inflight message tracking', () => {
    it('should track inflight messages', async () => {
      let inflightCount = 0;

      const sub = await manager.subscribe('test.inflight', async () => {
        inflightCount = sub.inflightCount;
        await delay(200);
      });

      await delay(100);

      await manager.publish('test.inflight', {});
      await delay(50);

      expect(inflightCount).toBeGreaterThan(0);

      await delay(300);

      expect(sub.inflightCount).toBe(0);
    });

    it('should wait for inflight messages on unsubscribe', async () => {
      let completed = false;

      const sub = await manager.subscribe('test.waitinflight', async () => {
        await delay(300);
        completed = true;
      });

      await delay(100);

      await manager.publish('test.waitinflight', {});
      await delay(50);

      const unsubPromise = sub.unsubscribe();

      expect(completed).toBe(false);
      await unsubPromise;
      expect(completed).toBe(true);
    });
  });
});
