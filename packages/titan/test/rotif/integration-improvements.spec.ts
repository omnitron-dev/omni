import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NotificationManager, RetryStrategies } from '../src/index.js';
import { delay } from '@omnitron-dev/common';
import Redis from 'ioredis';

describe('Rotif Improvements Integration', () => {
  let manager: NotificationManager;
  let redis: Redis;

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
    const keys = await redis.keys('rotif:stream:test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterEach(async () => {
    if (manager) {
      await manager.stopAll();
    }

    // Clean up test data
    await redis.del('rotif:dlq');
    const keys = await redis.keys('rotif:stream:test:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    const scheduledKeys = await redis.keys('rotif:delayed:*');
    if (scheduledKeys.length > 0) {
      await redis.del(...scheduledKeys);
    }
    await redis.del('rotif:scheduled');

    await redis.quit();
  });

  describe('Retry Strategies Integration', () => {
    it('should use exponential retry strategy', async () => {
      const attempts: { attempt: number; timestamp: number }[] = [];
      let completed = false;

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        scheduledBatchSize: 100, // Process all messages at once
        retryStrategy: {
          strategy: 'exponential',
          baseDelay: 50,
          multiplier: 2,
          jitter: 0
        },
        maxRetries: 3
      });

      const sub = await manager.subscribe('test:retry:exponential', async (msg) => {
        attempts.push({ attempt: msg.attempt, timestamp: Date.now() });
        if (msg.attempt < 3) {
          throw new Error('Test failure');
        }
        completed = true;
      });

      const startTime = Date.now();
      await manager.publish('test:retry:exponential', { test: 'data' });

      // Wait for completion with timeout
      const maxWait = 1000;
      const waitStart = Date.now();
      while (!completed && Date.now() - waitStart < maxWait) {
        await delay(10);
      }

      expect(attempts.length).toBe(3);

      // Check delays between attempts (with tolerance for scheduler and processing)
      if (attempts.length >= 2) {
        const delay1 = attempts[1].timestamp - attempts[0].timestamp;
        expect(delay1).toBeGreaterThanOrEqual(40); // 50ms base - some tolerance
        expect(delay1).toBeLessThanOrEqual(500); // Allow for scheduler overhead and CI/CD delays
      }

      if (attempts.length >= 3) {
        const delay2 = attempts[2].timestamp - attempts[1].timestamp;
        expect(delay2).toBeGreaterThanOrEqual(80); // 100ms base - some tolerance
        expect(delay2).toBeLessThanOrEqual(600); // Allow for scheduler overhead and CI/CD delays
      }

      await sub.unsubscribe();
    });

    it('should use linear retry strategy', async () => {
      const attempts: { attempt: number; timestamp: number }[] = [];
      let completed = false;

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        scheduledBatchSize: 100, // Process all messages at once
        retryStrategy: {
          strategy: 'linear',
          baseDelay: 30,
          jitter: 0
        },
        maxRetries: 3
      });

      const sub = await manager.subscribe('test:retry:linear', async (msg) => {
        attempts.push({ attempt: msg.attempt, timestamp: Date.now() });
        if (msg.attempt < 3) {
          throw new Error('Test failure');
        }
        completed = true;
      });

      await manager.publish('test:retry:linear', { test: 'data' });

      // Wait for completion with timeout
      const maxWait = 1000;
      const waitStart = Date.now();
      while (!completed && Date.now() - waitStart < maxWait) {
        await delay(10);
      }

      expect(attempts.length).toBe(3);

      // Check delays between attempts (with tolerance for scheduler and processing)
      if (attempts.length >= 2) {
        const delay1 = attempts[1].timestamp - attempts[0].timestamp;
        expect(delay1).toBeGreaterThanOrEqual(20); // 30ms base - some tolerance
        expect(delay1).toBeLessThanOrEqual(500); // Allow for scheduler overhead and CI/CD delays
      }

      if (attempts.length >= 3) {
        const delay2 = attempts[2].timestamp - attempts[1].timestamp;
        expect(delay2).toBeGreaterThanOrEqual(50); // 60ms base - some tolerance
        expect(delay2).toBeLessThanOrEqual(600); // Allow for scheduler overhead and CI/CD delays
      }

      await sub.unsubscribe();
    });

    it('should use preset retry strategies', async () => {
      const attempts: number[] = [];
      let completed = false;

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        scheduledBatchSize: 100, // Process all messages at once
        retryStrategy: NotificationManager.RetryStrategies.aggressive(),
        maxRetries: 2
      });

      const sub = await manager.subscribe('test:retry:preset', async (msg) => {
        attempts.push(msg.attempt);
        if (msg.attempt < 2) {
          throw new Error('Test failure');
        }
        completed = true;
      });

      await manager.publish('test:retry:preset', { test: 'data' });

      // Wait for completion
      const maxWait = 1000;
      const waitStart = Date.now();
      while (!completed && Date.now() - waitStart < maxWait) {
        await delay(10);
      }

      expect(attempts).toEqual([1, 2]);
      await sub.unsubscribe();
    });

    it('should override global strategy with subscription-level strategy', async () => {
      const attempts: { attempt: number; timestamp: number }[] = [];
      let completed = false;

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        scheduledBatchSize: 100, // Process all messages at once
        retryStrategy: {
          strategy: 'exponential',
          baseDelay: 100,
          jitter: 0
        },
        maxRetries: 2
      });

      // Use fixed strategy at subscription level
      const sub = await manager.subscribe(
        'test:retry:override',
        async (msg) => {
          attempts.push({ attempt: msg.attempt, timestamp: Date.now() });
          if (msg.attempt < 2) {
            throw new Error('Test failure');
          }
          completed = true;
        },
        {
          retryStrategy: {
            strategy: 'fixed',
            baseDelay: 25,
            jitter: 0
          },
          maxRetries: 2
        }
      );

      await manager.publish('test:retry:override', { test: 'data' });

      // Wait for completion
      const maxWait = 1000;  // Increased wait time
      const waitStart = Date.now();
      while (!completed && Date.now() - waitStart < maxWait) {
        await delay(10);
      }

      expect(attempts.length).toBe(2);

      // Should use fixed 25ms delay (with tolerance for scheduler)
      if (attempts.length >= 2) {
        const delay1 = attempts[1].timestamp - attempts[0].timestamp;
        expect(delay1).toBeGreaterThanOrEqual(20);
        expect(delay1).toBeLessThanOrEqual(500); // Allow for scheduler overhead and CI/CD delays
      }

      await sub.unsubscribe();
    });
  });

  describe('DLQ Management Integration', () => {
    it('should move messages to DLQ after max retries', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        scheduledBatchSize: 100, // Process all messages at once
        maxRetries: 1,
        retryStrategy: {
          strategy: 'fixed',
          baseDelay: 20,
          jitter: 0
        }
      });

      const sub = await manager.subscribe('test:dlq:basic', async () => {
        throw new Error('Always fails');
      });

      await manager.publish('test:dlq:basic', { data: 'test' });
      await delay(500); // Wait for retry and DLQ move to complete

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(1);

      await sub.unsubscribe();
    });

    it('should get DLQ messages with metadata', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        maxRetries: 0
      });

      const sub = await manager.subscribe('test:dlq:metadata', async () => {
        throw new Error('Test error message');
      });

      await manager.publish('test:dlq:metadata', { id: 123, name: 'test' });
      await delay(200);

      const messages = await manager.getDLQMessages({ channel: 'test:dlq:metadata' });

      expect(messages.length).toBe(1);
      expect(messages[0].channel).toBe('test:dlq:metadata');
      expect(messages[0].payload).toEqual({ id: 123, name: 'test' });
      expect(messages[0].error).toContain('Test error message');
      expect(messages[0].attempt).toBe(1);

      await sub.unsubscribe();
    });

    it('should manually cleanup DLQ', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        maxRetries: 0,
        dlqCleanup: {
          enabled: false,
          maxAge: 300  // 300ms for testing
        }
      });

      const sub = await manager.subscribe('test:dlq:cleanup', async () => {
        throw new Error('Fail');
      });

      // Send old message
      await manager.publish('test:dlq:cleanup', { msg: 'old' });
      await delay(400); // Let it process and age beyond maxAge

      // Send new message
      await manager.publish('test:dlq:cleanup', { msg: 'new' });
      await delay(100); // Just let it process but not age beyond maxAge

      // Run manual cleanup
      const cleaned = await manager.cleanupDLQ();
      expect(cleaned).toBe(1); // Should clean only old message

      const messages = await manager.getDLQMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].payload.msg).toBe('new');

      await sub.unsubscribe();
    });

    it('should clear all DLQ messages', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        maxRetries: 0
      });

      const sub = await manager.subscribe('test:dlq:clear', async () => {
        throw new Error('Fail');
      });

      await manager.publish('test:dlq:clear', { msg: 1 });
      await delay(100); // Space out the messages
      await manager.publish('test:dlq:clear', { msg: 2 });
      await delay(300); // Wait for both to process

      let stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(2);

      await manager.clearDLQ();

      stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(0);

      await sub.unsubscribe();
    });

    it('should track DLQ stats by channel', async () => {
      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        maxRetries: 0
      });

      const sub1 = await manager.subscribe('test:channel1', async () => {
        throw new Error('Fail');
      });

      const sub2 = await manager.subscribe('test:channel2', async () => {
        throw new Error('Fail');
      });

      await manager.publish('test:channel1', { data: 1 });
      await manager.publish('test:channel1', { data: 2 });
      await manager.publish('test:channel2', { data: 3 });
      await delay(300);

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(3);
      expect(stats.messagesByChannel['test:channel1']).toBe(2);
      expect(stats.messagesByChannel['test:channel2']).toBe(1);

      await sub1.unsubscribe();
      await sub2.unsubscribe();
    });
  });

  describe('Combined Features', () => {
    it('should use retry strategies and then move to DLQ', async () => {
      const attempts: number[] = [];

      manager = new NotificationManager({
        redis: { host: 'localhost', port: 6379, db: 0 },
        checkDelayInterval: 20, // Fast scheduler for tests
        blockInterval: 100, // Short block time for tests
        scheduledBatchSize: 100, // Process all messages at once
        retryStrategy: NotificationManager.RetryStrategies.fibonacci(20),
        maxRetries: 2  // Reduced to 2 so message goes to DLQ after 3rd attempt
      });

      const sub = await manager.subscribe('test:combined', async (msg) => {
        attempts.push(msg.attempt);
        throw new Error('Always fails');
      });

      await manager.publish('test:combined', { test: 'combined' });

      // Wait for retries and DLQ - Fibonacci sequence delays
      await delay(800); // 20 + 40 + scheduler cycles + DLQ processing

      expect(attempts).toEqual([1, 2, 3]);

      const stats = await manager.getDLQStats();
      expect(stats.totalMessages).toBe(1);

      const dlqMessages = await manager.getDLQMessages();
      expect(dlqMessages[0].payload).toEqual({ test: 'combined' });
      expect(dlqMessages[0].attempt).toBe(3);

      await sub.unsubscribe();
    });
  });
});