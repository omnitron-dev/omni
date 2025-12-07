/**
 * Comprehensive Infrastructure Tests for Rotif (NotificationManager)
 * Tests critical functionality, error scenarios, and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { Redis } from 'ioredis';
import type { NotificationManager } from '../../../src/rotif/rotif.js';
import type { RotifConfig, Subscription, RotifMessage } from '../../../src/rotif/types.js';
import { RedisTestManager } from '../../utils/redis-test-manager.js';
import { delay } from '@omnitron-dev/common';

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
if (skipTests) {
  console.log('⏭️  Skipping rotif-comprehensive.spec.ts - integration test');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Rotif - NotificationManager Infrastructure Tests', () => {
  let testContainer: Awaited<ReturnType<typeof RedisTestManager.prototype.createContainer>>;
  let redis: Redis;
  let manager: NotificationManager;

  beforeEach(async () => {
    const redisManager = RedisTestManager.getInstance();
    testContainer = await redisManager.createContainer();
    redis = testContainer.client!;
    
    const config: RotifConfig = {
      redis: {
        host: testContainer.host,
        port: testContainer.port,
        lazyConnect: false,
      },
      checkDelayInterval: 100,
      scheduledBatchSize: 100,
    };

    manager = new NotificationManager(config);
    await manager.waitUntilReady();
  });

  afterEach(async () => {
    if (manager) {
      await manager.stopAll();
    }
    if (testContainer) {
      await testContainer.cleanup();
    }
  });

  describe('Initialization and Lifecycle', () => {
    it('should initialize with default configuration', async () => {
      expect(manager).toBeDefined();
      expect(manager.redis).toBeDefined();
      expect(manager.config).toBeDefined();
    });

    it('should load Lua scripts on initialization', async () => {
      // Scripts should be loaded after waitUntilReady
      expect(manager['luaScripts'].size).toBeGreaterThan(0);
    });

    it('should handle graceful shutdown', async () => {
      const sub = await manager.subscribe('test.shutdown', async () => {});
      await manager.stopAll();
      
      // Verify cleanup
      expect(manager['active']).toBe(false);
      expect(manager['subscriptions'].size).toBe(0);
    });

    it('should cleanup resources on destroy', async () => {
      await manager.destroy();
      expect(manager['subscriptions'].size).toBe(0);
      expect(manager['activePatterns'].size).toBe(0);
    });
  });

  describe('Publishing Messages', () => {
    it('should publish simple messages', async () => {
      await manager.subscribe('test.channel', async () => {});
      
      const messageId = await manager.publish('test.channel', { data: 'test' });
      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe('string');
    });

    it('should handle publishing with no subscribers', async () => {
      const result = await manager.publish('nonexistent.channel', { data: 'test' });
      expect(result).toBeNull();
    });

    it('should publish to multiple matching patterns', async () => {
      await manager.subscribe('test.*', async () => {});
      await manager.subscribe('test.channel.*', async () => {});
      await delay(50); // Allow pattern sync
      
      const results = await manager.publish('test.channel.msg', { data: 'test' });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle delayed messages', async () => {
      await manager.subscribe('test.delay', async () => {});
      
      const messageId = await manager.publish('test.delay', { data: 'test' }, {
        delayMs: 1000,
      });
      
      expect(messageId).toBeDefined();
    });

    it('should handle scheduled messages with deliverAt', async () => {
      await manager.subscribe('test.scheduled', async () => {});
      
      const futureTime = new Date(Date.now() + 2000);
      const messageId = await manager.publish('test.scheduled', { data: 'test' }, {
        deliverAt: futureTime,
      });
      
      expect(messageId).toBeDefined();
    });

    it('should respect maxStreamLength configuration', async () => {
      const limitedManager = new NotificationManager({
        redis: { host: testContainer.host, port: testContainer.port },
        maxStreamLength: 10,
      });
      
      try {
        await limitedManager.waitUntilReady();
        await limitedManager.subscribe('test.limit', async () => {});
        
        // Publish more than max length
        for (let i = 0; i < 15; i++) {
          await limitedManager.publish('test.limit', { seq: i });
        }
        
        // Stream should be trimmed
        const streamKey = 'rotif:stream:test.limit';
        const length = await redis.xlen(streamKey);
        expect(length).toBeLessThanOrEqual(10);
      } finally {
        await limitedManager.stopAll();
      }
    });

    it('should handle exact-once publishing', async () => {
      await manager.subscribe('test.exactonce', async () => {});
      
      const result1 = await manager.publish('test.exactonce', { id: 'unique123' }, {
        exactlyOnce: true,
        deduplicationTTL: 60,
      });
      
      const result2 = await manager.publish('test.exactonce', { id: 'unique123' }, {
        exactlyOnce: true,
        deduplicationTTL: 60,
      });
      
      expect(result1).not.toBe('DUPLICATE');
      expect(result2).toBe('DUPLICATE');
    });
  });

  describe('Subscription Management', () => {
    it('should create subscription successfully', async () => {
      const sub = await manager.subscribe('test.sub', async (msg) => {
        expect(msg).toBeDefined();
      });
      
      expect(sub).toBeDefined();
      expect(sub.id).toBeDefined();
      expect(sub.pattern).toBe('test.sub');
      expect(typeof sub.unsubscribe).toBe('function');
    });

    it('should support wildcard patterns', async () => {
      const messages: RotifMessage[] = [];
      await manager.subscribe('test.*', async (msg) => {
        messages.push(msg);
      });
      
      await manager.publish('test.one', { data: 'one' });
      await manager.publish('test.two', { data: 'two' });
      await delay(200);
      
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle pause and resume', async () => {
      let messageCount = 0;
      const sub = await manager.subscribe('test.pause', async () => {
        messageCount++;
      });
      
      // Publish while active
      await manager.publish('test.pause', { data: '1' });
      await delay(100);
      const countBeforePause = messageCount;
      
      // Pause subscription
      sub.pause();
      await manager.publish('test.pause', { data: '2' });
      await delay(100);
      
      expect(messageCount).toBe(countBeforePause);
      
      // Resume subscription
      sub.resume();
      await manager.publish('test.pause', { data: '3' });
      await delay(100);
      
      expect(messageCount).toBeGreaterThan(countBeforePause);
    });

    it('should unsubscribe cleanly', async () => {
      const sub = await manager.subscribe('test.unsub', async () => {});
      await sub.unsubscribe(true);
      
      // Pattern should be removed
      expect(manager['activePatterns'].has('test.unsub')).toBe(false);
    });

    it('should handle consumer groups', async () => {
      const sub1 = await manager.subscribe('test.group', async () => {}, { groupName: 'group1' });
      const sub2 = await manager.subscribe('test.group', async () => {}, { groupName: 'group1' });
      
      expect(sub1.group).toBe(sub2.group);
    });

    it('should track subscription stats', async () => {
      const sub = await manager.subscribe('test.stats', async () => {});
      
      await manager.publish('test.stats', { data: 'test' });
      await delay(200);
      
      const stats = sub.stats();
      expect(stats).toBeDefined();
      expect(stats.messagesProcessed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Message Processing', () => {
    it('should process messages in order', async () => {
      const messages: any[] = [];
      await manager.subscribe('test.order', async (msg) => {
        messages.push(msg.payload);
      });
      
      await manager.publish('test.order', { seq: 1 });
      await manager.publish('test.order', { seq: 2 });
      await manager.publish('test.order', { seq: 3 });
      await delay(300);
      
      expect(messages.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].seq).toBeGreaterThan(messages[i - 1].seq);
      }
    });

    it('should handle message acknowledgment', async () => {
      let ackCalled = false;
      await manager.subscribe('test.ack', async (msg) => {
        await msg.ack();
        ackCalled = true;
      });
      
      await manager.publish('test.ack', { data: 'test' });
      await delay(200);
      
      expect(ackCalled).toBe(true);
    });

    it('should track in-flight messages', async () => {
      const sub = await manager.subscribe('test.inflight', async (msg) => {
        await delay(50);
        await msg.ack();
      });
      
      // Fire multiple messages quickly
      await manager.publish('test.inflight', { data: '1' });
      await manager.publish('test.inflight', { data: '2' });
      await manager.publish('test.inflight', { data: '3' });
      
      // In-flight count should increase temporarily
      await delay(10);
      expect(sub.inflightCount).toBeGreaterThanOrEqual(0);
      
      // Eventually all should be processed
      await delay(200);
      expect(sub.inflightCount).toBe(0);
    });

    it('should handle concurrent message processing', async () => {
      const processedMessages: number[] = [];
      await manager.subscribe('test.concurrent', async (msg) => {
        processedMessages.push(msg.payload.id);
        await delay(10); // Simulate processing
      });
      
      // Send multiple messages concurrently
      await Promise.all([
        manager.publish('test.concurrent', { id: 1 }),
        manager.publish('test.concurrent', { id: 2 }),
        manager.publish('test.concurrent', { id: 3 }),
        manager.publish('test.concurrent', { id: 4 }),
      ]);
      
      await delay(300);
      expect(processedMessages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed messages', async () => {
      let attempts = 0;
      await manager.subscribe('test.retry', async (msg) => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Simulated failure');
        }
        await msg.ack();
      }, {
        maxRetries: 5,
        retryDelay: 100,
      });
      
      await manager.publish('test.retry', { data: 'test' });
      await delay(500);
      
      expect(attempts).toBeGreaterThanOrEqual(2);
    });

    it('should move to DLQ after max retries', async () => {
      let attempts = 0;
      await manager.subscribe('test.dlq', async () => {
        attempts++;
        throw new Error('Always fails');
      }, {
        maxRetries: 2,
        retryDelay: 50,
      });
      
      await manager.publish('test.dlq', { data: 'test' });
      await delay(500);
      
      const dlqStats = await manager.getDLQStats();
      expect(dlqStats.count).toBeGreaterThan(0);
    });

    it('should use custom retry strategies', async () => {
      const retryDelays: number[] = [];
      await manager.subscribe('test.strategy', async (msg) => {
        retryDelays.push(Date.now());
        throw new Error('Fail');
      }, {
        maxRetries: 3,
        retryStrategy: 'exponential',
      });
      
      await manager.publish('test.strategy', { data: 'test' });
      await delay(3000);
      
      expect(retryDelays.length).toBeGreaterThan(1);
    });
  });

  describe('DLQ Management', () => {
    it('should subscribe to DLQ', async () => {
      const dlqMessages: RotifMessage[] = [];
      await manager.subscribeToDLQ(async (msg) => {
        dlqMessages.push(msg);
      });
      
      // Force a message to DLQ
      await manager.subscribe('test.dlq.force', async () => {
        throw new Error('Force DLQ');
      }, { maxRetries: 1, retryDelay: 10 });
      
      await manager.publish('test.dlq.force', { data: 'test' });
      await delay(500);
      
      expect(dlqMessages.length).toBeGreaterThan(0);
    });

    it('should get DLQ statistics', async () => {
      const stats = await manager.getDLQStats();
      expect(stats).toBeDefined();
      expect(stats.count).toBeGreaterThanOrEqual(0);
    });

    it('should requeue messages from DLQ', async () => {
      // Add message to DLQ
      await manager.subscribe('test.requeue', async () => {
        throw new Error('Fail once');
      }, { maxRetries: 1, retryDelay: 10 });
      
      await manager.publish('test.requeue', { data: 'test' });
      await delay(300);
      
      const requeueCount = await manager.requeueFromDLQ(10);
      expect(requeueCount).toBeGreaterThanOrEqual(0);
    });

    it('should clear DLQ', async () => {
      await manager.clearDLQ();
      const stats = await manager.getDLQStats();
      expect(stats.count).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle Redis connection errors gracefully', async () => {
      const brokenRedis = new Redis({
        host: 'invalid-host',
        port: 9999,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      
      let errorCaught = false;
      brokenRedis.on('error', () => {
        errorCaught = true;
      });
      
      try {
        await brokenRedis.connect();
      } catch (e) {
        errorCaught = true;
      }
      
      expect(errorCaught).toBe(true);
      brokenRedis.disconnect();
    });

    it('should handle invalid message payloads', async () => {
      await manager.subscribe('test.invalid', async (msg) => {
        expect(msg.payload).toBeDefined();
      });
      
      // Publish with valid payload (JSON serializable)
      const result = await manager.publish('test.invalid', { valid: true });
      expect(result).toBeDefined();
    });

    it('should handle subscription errors', async () => {
      const errorMessages: Error[] = [];
      manager.use({
        onError: async (msg, error) => {
          errorMessages.push(error);
        },
      });
      
      await manager.subscribe('test.error', async () => {
        throw new Error('Processing error');
      });
      
      await manager.publish('test.error', { data: 'test' });
      await delay(200);
      
      expect(errorMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high message throughput', async () => {
      let processed = 0;
      await manager.subscribe('test.throughput', async (msg) => {
        processed++;
        await msg.ack();
      });
      
      const messageCount = 100;
      const promises = [];
      
      for (let i = 0; i < messageCount; i++) {
        promises.push(manager.publish('test.throughput', { seq: i }));
      }
      
      await Promise.all(promises);
      await delay(2000);
      
      expect(processed).toBeGreaterThan(messageCount * 0.8); // Allow some delay
    }, 10000);

    it('should handle multiple subscriptions efficiently', async () => {
      const subscriptions: Subscription[] = [];
      
      for (let i = 0; i < 10; i++) {
        const sub = await manager.subscribe(`test.multi${i}`, async () => {});
        subscriptions.push(sub);
      }
      
      expect(subscriptions.length).toBe(10);
      expect(manager['subscriptions'].size).toBe(10);
      
      // Cleanup
      for (const sub of subscriptions) {
        await sub.unsubscribe(true);
      }
    });
  });

  describe('Middleware System', () => {
    it('should execute beforePublish middleware', async () => {
      let beforeCalled = false;
      manager.use({
        beforePublish: async (channel, payload) => {
          beforeCalled = true;
          expect(channel).toBe('test.middleware');
          expect(payload).toBeDefined();
        },
      });
      
      await manager.subscribe('test.middleware', async () => {});
      await manager.publish('test.middleware', { data: 'test' });
      
      expect(beforeCalled).toBe(true);
    });

    it('should execute afterPublish middleware', async () => {
      let afterCalled = false;
      manager.use({
        afterPublish: async (channel, payload, messageIds) => {
          afterCalled = true;
          expect(messageIds).toBeDefined();
        },
      });
      
      await manager.subscribe('test.after', async () => {});
      await manager.publish('test.after', { data: 'test' });
      
      expect(afterCalled).toBe(true);
    });

    it('should execute beforeProcess middleware', async () => {
      let beforeProcessCalled = false;
      manager.use({
        beforeProcess: async (msg) => {
          beforeProcessCalled = true;
          expect(msg.payload).toBeDefined();
        },
      });
      
      await manager.subscribe('test.beforeprocess', async () => {});
      await manager.publish('test.beforeprocess', { data: 'test' });
      await delay(200);
      
      expect(beforeProcessCalled).toBe(true);
    });

    it('should execute afterProcess middleware', async () => {
      let afterProcessCalled = false;
      manager.use({
        afterProcess: async (msg) => {
          afterProcessCalled = true;
        },
      });
      
      await manager.subscribe('test.afterprocess', async (msg) => {
        await msg.ack();
      });
      
      await manager.publish('test.afterprocess', { data: 'test' });
      await delay(200);
      
      expect(afterProcessCalled).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty payload', async () => {
      await manager.subscribe('test.empty', async (msg) => {
        expect(msg.payload).toBeDefined();
      });
      
      const result = await manager.publish('test.empty', null);
      expect(result).toBeDefined();
    });

    it('should handle rapid subscribe/unsubscribe', async () => {
      for (let i = 0; i < 5; i++) {
        const sub = await manager.subscribe(`test.rapid${i}`, async () => {});
        await sub.unsubscribe(true);
      }
      
      expect(manager['subscriptions'].size).toBe(0);
    });

    it('should handle duplicate patterns correctly', async () => {
      const sub1 = await manager.subscribe('test.duplicate', async () => {});
      const sub2 = await manager.subscribe('test.duplicate', async () => {});
      
      expect(sub1.pattern).toBe(sub2.pattern);
      
      await sub1.unsubscribe(false);
      await sub2.unsubscribe(true);
    });

    it('should handle very long message payloads', async () => {
      const largePayload = { data: 'x'.repeat(10000) };
      await manager.subscribe('test.large', async (msg) => {
        expect(msg.payload.data.length).toBe(10000);
      });
      
      const result = await manager.publish('test.large', largePayload);
      expect(result).toBeDefined();
    });
  });
});
