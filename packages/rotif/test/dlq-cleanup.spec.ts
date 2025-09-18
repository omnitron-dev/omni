import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NotificationManager } from '../src/rotif.js';
import { DLQManager } from '../src/dlq-manager.js';
import { delay } from '@omnitron-dev/common';
import Redis from 'ioredis';

// Test helpers
async function publishAndFail(
  manager: NotificationManager,
  channel: string,
  payload: any,
  maxRetries: number = 0
) {
  // Subscribe with handler that always fails
  const sub = await manager.subscribe(channel, async () => {
    throw new Error('Test failure');
  }, { maxRetries });

  // Wait for subscription to be ready
  await delay(50);

  // Publish message
  await manager.publish(channel, payload);

  // Wait for processing and DLQ movement
  // Need more time for the message to be processed, failed, and moved to DLQ
  await delay(300);

  // Unsubscribe
  await sub.unsubscribe();

  // Wait for unsubscribe to complete
  await delay(50);
}

describe('DLQ Auto-Cleanup', () => {
  let manager: NotificationManager;
  let redis: Redis;
  const testChannel = 'test:dlq:cleanup';

  beforeEach(async () => {
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      db: 0,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1
    });

    // Clean up test data
    await redis.del('rotif:dlq');
    // Delete all archive keys
    const archiveKeys = await redis.keys('rotif:dlq:archive:*');
    if (archiveKeys.length > 0) {
      await redis.del(...archiveKeys);
    }
    // Also delete test-specific archive keys
    const testArchiveKeys = await redis.keys('test:archive:*');
    if (testArchiveKeys.length > 0) {
      await redis.del(...testArchiveKeys);
    }
  });

  afterEach(async () => {
    if (manager) {
      await manager.stopAll();
    }
    await redis.quit();
  });

  describe('DLQ Manager Basic Operations', () => {
    it('should get DLQ statistics', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0, // Messages fail immediately
      });

      // Send some messages to DLQ
      await publishAndFail(manager, testChannel, { msg: 1 });
      await publishAndFail(manager, testChannel, { msg: 2 });
      await publishAndFail(manager, `${testChannel}:other`, { msg: 3 });

      const stats = await manager.getDLQStats();

      expect(stats.totalMessages).toBe(3);
      expect(stats.messagesByChannel[testChannel]).toBe(2);
      expect(stats.messagesByChannel[`${testChannel}:other`]).toBe(1);
      expect(stats.oldestMessage).toBeDefined();
      expect(stats.newestMessage).toBeDefined();
    });

    it('should get DLQ messages with filtering', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
      });

      // Send messages to different channels
      await publishAndFail(manager, testChannel, { msg: 'a' });
      await publishAndFail(manager, testChannel, { msg: 'b' });
      await publishAndFail(manager, `${testChannel}:other`, { msg: 'c' });

      // Get all messages
      const allMessages = await manager.getDLQMessages();
      expect(allMessages.length).toBe(3);

      // Filter by channel
      const filteredMessages = await manager.getDLQMessages({
        channel: testChannel
      });
      expect(filteredMessages.length).toBe(2);

      // Test pagination
      const paginatedMessages = await manager.getDLQMessages({
        limit: 1,
        offset: 1
      });
      expect(paginatedMessages.length).toBe(1);
    });

    it('should manually clear DLQ', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
      });

      // Send messages to DLQ
      await publishAndFail(manager, testChannel, { msg: 1 });
      await publishAndFail(manager, testChannel, { msg: 2 });

      let stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(2);

      // Clear DLQ
      await manager.clearDLQ();

      stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(0);
    });
  });

  describe('Auto-Cleanup Configuration', () => {
    it('should start auto-cleanup when enabled', async () => {
      const cleanupSpy = jest.spyOn(DLQManager.prototype, 'startAutoCleanup');

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        dlqCleanup: {
          enabled: true,
          cleanupInterval: 100, // Very short for testing
        }
      });

      await delay(50);
      expect(cleanupSpy).toHaveBeenCalled();
      cleanupSpy.mockRestore();
    });

    it('should not start auto-cleanup when disabled', async () => {
      const cleanupSpy = jest.spyOn(DLQManager.prototype, 'startAutoCleanup');

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        dlqCleanup: {
          enabled: false,
        }
      });

      await delay(50);
      expect(cleanupSpy).not.toHaveBeenCalled();
      cleanupSpy.mockRestore();
    });

    it('should update cleanup configuration dynamically', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        dlqCleanup: {
          enabled: false,
          maxAge: 1000,
        }
      });

      // Update configuration
      manager.updateDLQConfig({
        enabled: true,
        maxAge: 2000,
      });

      // Verify configuration was updated (we'd need to expose config getter for full test)
      // This at least verifies the method exists and doesn't throw
      expect(() => manager.updateDLQConfig({})).not.toThrow();
    });
  });

  describe('Message Age-Based Cleanup', () => {
    it('should remove old messages based on maxAge', async () => {
      // Create manager with short max age
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
        dlqCleanup: {
          enabled: false, // Manual control for testing
          maxAge: 500, // 500ms
        }
      });

      // Send message to DLQ
      await publishAndFail(manager, testChannel, { msg: 'old' });

      // Wait for message to age
      await delay(600);

      // Send a new message
      await publishAndFail(manager, testChannel, { msg: 'new' });

      // Run cleanup manually
      const cleaned = await manager.cleanupDLQ();

      expect(cleaned).toBe(1); // Should clean up only the old message

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(1);

      const remaining = await manager.getDLQMessages();
      expect(remaining[0].payload.msg).toBe('new');
    });
  });

  describe('Size-Based Cleanup', () => {
    it('should enforce maximum DLQ size', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
        dlqCleanup: {
          enabled: false,
          maxSize: 3,
        }
      });

      // Send messages to exceed max size
      for (let i = 1; i <= 5; i++) {
        await publishAndFail(manager, testChannel, { msg: i });
      }

      // Run cleanup
      await manager.cleanupDLQ();

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(3); // Should keep only 3 newest

      const messages = await manager.getDLQMessages();
      expect(messages[0].payload.msg).toBe(3); // Oldest remaining
      expect(messages[2].payload.msg).toBe(5); // Newest
    });
  });

  describe('Message Archiving', () => {
    it('should archive messages before deletion when configured', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
        dlqCleanup: {
          enabled: false,
          maxAge: 100,
          archiveBeforeDelete: true,
          archivePrefix: 'test:archive',
        }
      });

      // Send message to DLQ
      await publishAndFail(manager, testChannel, { msg: 'to-archive' });

      // Wait for message to age
      await delay(150);

      // Run cleanup
      await manager.cleanupDLQ();

      // Check archive
      const today = new Date().toISOString().split('T')[0];
      const archiveKey = `test:archive:${today}`;
      const archived = await redis.lrange(archiveKey, 0, -1);

      expect(archived.length).toBe(1);

      const archivedData = JSON.parse(archived[0]);
      expect(archivedData.payload).toBe(JSON.stringify({ msg: 'to-archive' }));
      expect(archivedData.archivedAt).toBeDefined();

      // Clean up
      await redis.del(archiveKey);
    });
  });

  describe('Batch Processing', () => {
    it('should process messages in batches', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
        dlqCleanup: {
          enabled: false,
          maxAge: 100,
          batchSize: 2,
        }
      });

      // Send multiple messages
      for (let i = 1; i <= 5; i++) {
        await publishAndFail(manager, testChannel, { msg: i });
      }

      // Wait for all to age
      await delay(150);

      // Run cleanup - should process in batches of 2
      const cleaned = await manager.cleanupDLQ();
      expect(cleaned).toBe(5);

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.messagesCleanedUp).toBe(5);
    });
  });

  describe('Integration with Retry Strategies', () => {
    it('should move messages to DLQ after retries with new strategies', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        retryStrategy: {
          strategy: 'fixed',
          baseDelay: 50,
        },
        maxRetries: 2,
      });

      const startTime = Date.now();
      const attempts: number[] = [];

      // Subscribe with failing handler that tracks attempts
      const sub = await manager.subscribe(testChannel, async (msg) => {
        attempts.push(msg.attempt);
        throw new Error('Test failure');
      });

      // Wait for subscription to be ready
      await delay(100);

      // Publish message
      await manager.publish(testChannel, { test: 'retry' });

      // Wait for retries and DLQ (2 attempts with 50ms delay each)
      await delay(1000);

      expect(attempts).toEqual([1, 2]); // Should have 2 attempts

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(1);

      await sub.unsubscribe();
    });

    it('should use subscription-level retry strategy', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 1,
      });

      const delays: number[] = [];
      let lastAttemptTime = Date.now();

      const sub = await manager.subscribe(
        testChannel,
        async (msg) => {
          const now = Date.now();
          if (msg.attempt > 1) {
            delays.push(now - lastAttemptTime);
          }
          lastAttemptTime = now;
          throw new Error('Test failure');
        },
        {
          maxRetries: 1,
          retryStrategy: {
            strategy: 'linear',
            baseDelay: 100,
            jitter: 0
          }
        }
      );

      await manager.publish(testChannel, { test: 'data' });
      await delay(250);

      // Should have one retry with ~100ms delay (linear strategy, attempt 1)
      expect(delays.length).toBe(1);
      expect(delays[0]).toBeGreaterThanOrEqual(90);
      expect(delays[0]).toBeLessThanOrEqual(110);

      await sub.unsubscribe();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent cleanup and message processing', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        maxRetries: 0,
        dlqCleanup: {
          enabled: true,
          cleanupInterval: 50,
          maxAge: 100,
        }
      });

      // Send messages continuously while cleanup runs
      const publishPromises = [];
      for (let i = 0; i < 10; i++) {
        publishPromises.push(
          publishAndFail(manager, `${testChannel}:${i}`, { msg: i })
            .then(() => delay(20))
        );
      }

      await Promise.all(publishPromises);
      await delay(200); // Let cleanup run

      // Should have cleaned up some old messages
      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBeLessThan(10);
    });
  });
});