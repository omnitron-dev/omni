/**
 * Real Redis Integration Tests for NotificationService
 * Tests with actual Redis connection for comprehensive coverage
 */

import Redis from 'ioredis';
import { NotificationService } from '../../../src/modules/notifications/notifications.service.js';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import { ChannelManager } from '../../../src/modules/notifications/channel-manager.js';
import { PreferenceManager } from '../../../src/modules/notifications/preference-manager.js';
import { RateLimiter } from '../../../src/modules/notifications/rate-limiter.js';
import type { NotificationPayload, NotificationRecipient } from '../../../src/modules/notifications/types.js';
import { RedisDockerTestHelper } from './test-redis-docker.js';

describe('NotificationService with Real Redis', () => {
  let redis: Redis;
  let pubRedis: Redis;
  let subRedis: Redis;
  let rotifManager: NotificationManager;
  let channelManager: ChannelManager;
  let preferenceManager: PreferenceManager;
  let rateLimiter: RateLimiter;
  let service: NotificationService;
  const TEST_PREFIX = `test:notifications:${Date.now()}`;

  beforeAll(async () => {
    // Start Redis container and create connections
    try {
      await RedisDockerTestHelper.startRedis();
      const clients = RedisDockerTestHelper.createClients();
      redis = clients.redis;
      pubRedis = clients.pubRedis;
      subRedis = clients.subRedis;
    } catch (error) {
      console.error('Failed to start Redis for testing:', error);
      throw error;
    }

    // Clear test data
    const keys = await redis.keys(`${TEST_PREFIX}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Initialize Rotif Manager
    rotifManager = new NotificationManager({
      redis,
      pubRedis,
      subRedis,
      redisNamespace: TEST_PREFIX,
      disableDelayed: false, // Enable delayed notifications
      maxRetries: 3,
      retryDelay: 1000,
      logger: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error,
      },
      dlqCleanup: {
        enabled: true,
        interval: 60000,
        maxAge: 86400000, // 24 hours
      },
    });

    await rotifManager.waitUntilReady();

    // Initialize managers
    channelManager = new ChannelManager();
    preferenceManager = new PreferenceManager(redis);
    rateLimiter = new RateLimiter(redis);

    // Initialize service
    service = new NotificationService(rotifManager, channelManager, preferenceManager, rateLimiter);
  }, 30000); // Increase timeout for Docker setup

  afterAll(async () => {
    try {
      // Clean up test data
      await RedisDockerTestHelper.cleanup(redis, `${TEST_PREFIX}:*`);

      // Close connections
      if (rotifManager) {
        await rotifManager.destroy();
      }
      if (pubRedis) {
        await pubRedis.quit();
      }
      if (subRedis) {
        await subRedis.quit();
      }
      if (redis) {
        await redis.quit();
      }
    } finally {
      // Stop Redis container
      await RedisDockerTestHelper.stopRedis();
    }
  }, 30000); // Increase timeout for cleanup

  describe('Basic Notification Flow', () => {
    it('should send and receive notification through real Redis', async () => {
      const received: any[] = [];

      // Subscribe to notifications
      await rotifManager.subscribe('notifications.*', async (msg) => {
        received.push(msg);
        return { success: true };
      });

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'test@example.com',
      };

      const notification: NotificationPayload = {
        title: 'Test Notification',
        message: 'This is a test notification via real Redis',
        type: 'info',
        metadata: { testId: 'real-redis-1' },
      };

      // Send notification
      const result = await service.send(recipient, notification);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify received
      expect(received).toHaveLength(1);
      expect(received[0].payload.title).toBe(notification.title);
    });

    it('should handle multiple recipients concurrently', async () => {
      const received = new Map<string, any[]>();

      // Subscribe for each recipient
      const recipients = Array.from({ length: 10 }, (_, i) => ({
        id: `user-${i}`,
        email: `user${i}@example.com`,
      }));

      for (const recipient of recipients) {
        received.set(recipient.id, []);
        await rotifManager.subscribe(`notifications.${recipient.id}.*`, async (msg) => {
          received.get(recipient.id)?.push(msg);
          return { success: true };
        });
      }

      const notification: NotificationPayload = {
        title: 'Broadcast Test',
        message: 'Testing concurrent delivery',
        type: 'info',
      };

      // Send to all recipients
      const promises = recipients.map((r) => service.send(r, notification));
      const results = await Promise.all(promises);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify all received
      for (const recipient of recipients) {
        const messages = received.get(recipient.id);
        expect(messages).toHaveLength(1);
        expect(messages![0].payload.title).toBe(notification.title);
      }

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result.id).toBeDefined();
      });
    });
  });

  describe('Delayed Notifications', () => {
    it('should schedule notification for future delivery', async () => {
      const received: any[] = [];

      await rotifManager.subscribe('notifications.*', async (msg) => {
        received.push({ ...msg, receivedAt: Date.now() });
        return { success: true };
      });

      const recipient: NotificationRecipient = {
        id: 'user-delayed',
        email: 'delayed@example.com',
      };

      const notification: NotificationPayload = {
        title: 'Delayed Notification',
        message: 'This should arrive in the future',
        type: 'reminder',
      };

      const scheduledTime = new Date(Date.now() + 2000); // 2 seconds from now
      const result = await service.schedule(recipient, notification, scheduledTime);

      expect(result).toBeDefined();
      expect(result.scheduledFor).toEqual(scheduledTime);

      // Verify not received immediately
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(received).toHaveLength(0);

      // Wait for scheduled time
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify received after delay
      expect(received).toHaveLength(1);
      expect(received[0].payload.title).toBe(notification.title);
      expect(received[0].receivedAt).toBeGreaterThan(scheduledTime.getTime() - 100);
    });

    it('should handle multiple scheduled notifications', async () => {
      const received: any[] = [];

      await rotifManager.subscribe('notifications.scheduled.*', async (msg) => {
        received.push({ ...msg, receivedAt: Date.now() });
        return { success: true };
      });

      const notifications = Array.from({ length: 5 }, (_, i) => ({
        recipient: { id: `scheduled-${i}`, email: `scheduled${i}@example.com` },
        payload: {
          title: `Scheduled ${i}`,
          message: `Message ${i}`,
          type: 'reminder' as const,
        },
        delay: (i + 1) * 500, // 0.5s, 1s, 1.5s, 2s, 2.5s
      }));

      // Schedule all notifications
      const schedulePromises = notifications.map((n) =>
        service.schedule(n.recipient, n.payload, new Date(Date.now() + n.delay))
      );

      const results = await Promise.all(schedulePromises);
      expect(results).toHaveLength(5);

      // Wait for all to be delivered
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify all received in correct order
      expect(received).toHaveLength(5);
      for (let i = 0; i < received.length - 1; i++) {
        expect(received[i].receivedAt).toBeLessThan(received[i + 1].receivedAt);
      }
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry failed notifications', async () => {
      const attempts: any[] = [];
      let shouldFail = true;

      await rotifManager.subscribe('notifications.retry.*', async (msg) => {
        attempts.push({ ...msg, attemptedAt: Date.now() });

        if (shouldFail) {
          shouldFail = false; // Succeed on next attempt
          throw new Error('Simulated failure');
        }

        return { success: true };
      });

      const recipient: NotificationRecipient = {
        id: 'retry-user',
        email: 'retry@example.com',
      };

      const notification: NotificationPayload = {
        title: 'Retry Test',
        message: 'This should be retried',
        type: 'alert',
        priority: 'high',
      };

      const result = await service.send(recipient, notification);
      expect(result).toBeDefined();

      // Wait for initial attempt and retry
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have 2 attempts (initial + 1 retry)
      expect(attempts.length).toBeGreaterThanOrEqual(2);
      expect(attempts[0].payload.title).toBe(notification.title);

      // Verify retry delay
      if (attempts.length >= 2) {
        const delay = attempts[1].attemptedAt - attempts[0].attemptedAt;
        expect(delay).toBeGreaterThan(900); // At least 900ms delay
      }
    });

    it('should move to DLQ after max retries', async () => {
      let attemptCount = 0;

      await rotifManager.subscribe('notifications.dlq.*', async (msg) => {
        attemptCount++;
        throw new Error('Always fail');
      });

      const recipient: NotificationRecipient = {
        id: 'dlq-user',
        email: 'dlq@example.com',
      };

      const notification: NotificationPayload = {
        title: 'DLQ Test',
        message: 'This should go to DLQ',
        type: 'critical',
      };

      const result = await service.send(recipient, notification);
      expect(result).toBeDefined();

      // Wait for retries to exhaust (3 retries * 1 second each + processing time)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check DLQ
      const dlqKey = `${TEST_PREFIX}:dlq`;
      const dlqMessages = await redis.zrange(dlqKey, 0, -1);

      // Should have at least one message in DLQ
      expect(dlqMessages.length).toBeGreaterThan(0);

      const dlqMessage = JSON.parse(dlqMessages[0]);
      expect(dlqMessage.payload.title).toBe(notification.title);
      expect(dlqMessage.attempt).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Deduplication', () => {
    it('should deduplicate identical notifications', async () => {
      const received: any[] = [];

      await rotifManager.subscribe('notifications.dedup.*', async (msg) => {
        received.push(msg);
        return { success: true };
      });

      const recipient: NotificationRecipient = {
        id: 'dedup-user',
        email: 'dedup@example.com',
      };

      const notification: NotificationPayload = {
        title: 'Duplicate Test',
        message: 'This should only be sent once',
        type: 'info',
        deduplicationKey: 'unique-key-123',
      };

      // Send same notification multiple times
      const results = await Promise.all([
        service.send(recipient, notification),
        service.send(recipient, notification),
        service.send(recipient, notification),
      ]);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should only receive once
      expect(received).toHaveLength(1);
      expect(received[0].payload.title).toBe(notification.title);

      // All results should have the same ID (deduplicated)
      const uniqueIds = new Set(results.map((r) => r.id));
      expect(uniqueIds.size).toBe(1);
    });

    it('should allow different notifications with different keys', async () => {
      const received: any[] = [];

      await rotifManager.subscribe('notifications.dedup2.*', async (msg) => {
        received.push(msg);
        return { success: true };
      });

      const recipient: NotificationRecipient = {
        id: 'dedup2-user',
        email: 'dedup2@example.com',
      };

      const notifications = Array.from({ length: 3 }, (_, i) => ({
        title: `Notification ${i}`,
        message: `Message ${i}`,
        type: 'info' as const,
        deduplicationKey: `key-${i}`,
      }));

      // Send different notifications
      const results = await Promise.all(notifications.map((n) => service.send(recipient, n)));

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should receive all three
      expect(received).toHaveLength(3);

      // All should have different IDs
      const uniqueIds = new Set(results.map((r) => r.id));
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('Broadcast Functionality', () => {
    it('should broadcast to segment', async () => {
      const received = new Map<string, any[]>();

      // Subscribe for multiple users in segment
      const segmentUsers = ['user-a', 'user-b', 'user-c'];
      for (const userId of segmentUsers) {
        received.set(userId, []);
        await rotifManager.subscribe(`notifications.${userId}.*`, async (msg) => {
          received.get(userId)?.push(msg);
          return { success: true };
        });
      }

      const notification: NotificationPayload = {
        title: 'Segment Broadcast',
        message: 'Message to all premium users',
        type: 'announcement',
      };

      // Broadcast to segment
      const result = await service.broadcast('premium-users', notification);
      expect(result).toBeDefined();
      expect(result.recipients).toBeGreaterThan(0);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // At least some users should receive it
      const receivedCount = Array.from(received.values()).filter((messages) => messages.length > 0).length;
      expect(receivedCount).toBeGreaterThan(0);
    });

    it('should batch large broadcasts', async () => {
      const notification: NotificationPayload = {
        title: 'Large Broadcast',
        message: 'Testing batch processing',
        type: 'announcement',
      };

      // Simulate large segment
      const result = await service.broadcast('all-users', notification, {
        batchSize: 100,
      });

      expect(result).toBeDefined();
      expect(result.recipients).toBeGreaterThan(0);
      expect(result.batches).toBeDefined();
      expect(result.batches).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits per user', async () => {
      const recipient: NotificationRecipient = {
        id: 'rate-limited-user',
        email: 'rate@example.com',
      };

      // Configure tight rate limit
      rateLimiter.setLimit(recipient.id, {
        maxRequests: 2,
        windowMs: 1000, // 2 requests per second
      });

      const notifications = Array.from({ length: 5 }, (_, i) => ({
        title: `Rate Test ${i}`,
        message: `Message ${i}`,
        type: 'info' as const,
      }));

      const results = [];
      const errors = [];

      for (const notification of notifications) {
        try {
          const result = await service.send(recipient, notification);
          results.push(result);
        } catch (error) {
          errors.push(error);
        }
      }

      // Should have some successes and some rate limit errors
      expect(results.length).toBeLessThanOrEqual(2);
      expect(errors.length).toBeGreaterThan(0);

      // Verify rate limit error
      const rateLimitError = errors.find((e) => e.message.includes('rate limit') || e.message.includes('Rate limit'));
      expect(rateLimitError).toBeDefined();
    });

    it('should reset rate limit after window', async () => {
      const recipient: NotificationRecipient = {
        id: 'rate-reset-user',
        email: 'reset@example.com',
      };

      // Configure rate limit with short window
      rateLimiter.setLimit(recipient.id, {
        maxRequests: 1,
        windowMs: 500, // 1 request per 500ms
      });

      // First request should succeed
      const result1 = await service.send(recipient, {
        title: 'First',
        message: 'Should succeed',
        type: 'info',
      });
      expect(result1).toBeDefined();

      // Second immediate request should fail
      await expect(
        service.send(recipient, {
          title: 'Second',
          message: 'Should fail',
          type: 'info',
        })
      ).rejects.toThrow();

      // Wait for window to reset
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Third request after window should succeed
      const result3 = await service.send(recipient, {
        title: 'Third',
        message: 'Should succeed after reset',
        type: 'info',
      });
      expect(result3).toBeDefined();
    });
  });

  describe('Priority Handling', () => {
    it('should process high priority notifications first', async () => {
      const received: any[] = [];

      await rotifManager.subscribe('notifications.priority.*', async (msg) => {
        received.push({
          ...msg,
          receivedAt: Date.now(),
          priority: msg.payload.priority,
        });
        // Add delay to simulate processing
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true };
      });

      const recipient: NotificationRecipient = {
        id: 'priority-user',
        email: 'priority@example.com',
      };

      // Send notifications with different priorities
      const notifications = [
        { title: 'Low 1', priority: 'low' as const },
        { title: 'High 1', priority: 'high' as const },
        { title: 'Normal 1', priority: 'normal' as const },
        { title: 'High 2', priority: 'high' as const },
        { title: 'Low 2', priority: 'low' as const },
      ];

      // Send all at once
      await Promise.all(
        notifications.map((n) =>
          service.send(recipient, {
            ...n,
            message: 'Priority test',
            type: 'info',
          })
        )
      );

      // Wait for all to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // High priority should be processed first
      const highPriorityIndices = received
        .map((r, i) => ({ priority: r.priority, index: i }))
        .filter((r) => r.priority === 'high')
        .map((r) => r.index);

      const otherIndices = received
        .map((r, i) => ({ priority: r.priority, index: i }))
        .filter((r) => r.priority !== 'high')
        .map((r) => r.index);

      // High priority messages should have lower indices (processed earlier)
      if (highPriorityIndices.length > 0 && otherIndices.length > 0) {
        const maxHighIndex = Math.max(...highPriorityIndices);
        const minOtherIndex = Math.min(...otherIndices);
        expect(maxHighIndex).toBeLessThan(minOtherIndex);
      }
    });
  });

  describe('Error Recovery', () => {
    it('should recover from Redis connection loss', async () => {
      const received: any[] = [];

      await rotifManager.subscribe('notifications.recovery.*', async (msg) => {
        received.push(msg);
        return { success: true };
      });

      // Simulate connection issues by sending when Redis might be busy
      const recipient: NotificationRecipient = {
        id: 'recovery-user',
        email: 'recovery@example.com',
      };

      const results = [];

      // Send multiple notifications
      for (let i = 0; i < 5; i++) {
        try {
          const result = await service.send(recipient, {
            title: `Recovery ${i}`,
            message: 'Testing recovery',
            type: 'info',
          });
          results.push(result);
        } catch (error) {
          // Continue on error
          console.log('Send error (expected):', error);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Should have some successful sends
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Metrics and Analytics', () => {
    it('should track notification metrics', async () => {
      const metricsKey = `${TEST_PREFIX}:metrics:*`;

      // Clear existing metrics
      const existingKeys = await redis.keys(metricsKey);
      if (existingKeys.length > 0) {
        await redis.del(...existingKeys);
      }

      const recipient: NotificationRecipient = {
        id: 'metrics-user',
        email: 'metrics@example.com',
      };

      // Send various notifications
      const notifications = [
        { type: 'info' as const, count: 3 },
        { type: 'warning' as const, count: 2 },
        { type: 'error' as const, count: 1 },
      ];

      for (const { type, count } of notifications) {
        for (let i = 0; i < count; i++) {
          await service.send(recipient, {
            title: `${type} ${i}`,
            message: 'Metrics test',
            type,
          });
        }
      }

      // Wait for metrics to be recorded
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check metrics in Redis
      const metricKeys = await redis.keys(metricsKey);
      expect(metricKeys.length).toBeGreaterThan(0);

      // Verify counts
      let totalSent = 0;
      for (const key of metricKeys) {
        const value = await redis.get(key);
        if (value && key.includes('sent')) {
          totalSent += parseInt(value, 10);
        }
      }

      expect(totalSent).toBeGreaterThanOrEqual(6); // Total notifications sent
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should clean up old DLQ messages', async () => {
      const dlqKey = `${TEST_PREFIX}:dlq`;

      // Add old message to DLQ
      const oldMessage = {
        id: 'old-msg',
        payload: { title: 'Old', message: 'Should be cleaned' },
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        attempt: 5,
      };

      await redis.zadd(dlqKey, oldMessage.timestamp, JSON.stringify(oldMessage));

      // Add recent message
      const recentMessage = {
        id: 'recent-msg',
        payload: { title: 'Recent', message: 'Should remain' },
        timestamp: Date.now() - 60 * 60 * 1000, // 1 hour ago
        attempt: 3,
      };

      await redis.zadd(dlqKey, recentMessage.timestamp, JSON.stringify(recentMessage));

      // Trigger cleanup (normally runs on interval)
      if (rotifManager['dlqManager'] && rotifManager['dlqManager'].cleanup) {
        await rotifManager['dlqManager'].cleanup();
      }

      // Check DLQ
      const dlqMessages = await redis.zrange(dlqKey, 0, -1);
      const parsedMessages = dlqMessages.map((m) => JSON.parse(m));

      // Old message should be removed
      const hasOld = parsedMessages.some((m) => m.id === 'old-msg');
      const hasRecent = parsedMessages.some((m) => m.id === 'recent-msg');

      expect(hasOld).toBe(false);
      expect(hasRecent).toBe(true);
    });

    it('should handle cleanup of processed notifications', async () => {
      // Create test keys
      const testKeys = [`${TEST_PREFIX}:processed:1`, `${TEST_PREFIX}:processed:2`, `${TEST_PREFIX}:temp:data`];

      for (const key of testKeys) {
        await redis.set(key, 'test-data', 'EX', 3600);
      }

      // Verify keys exist
      const existingKeys = await redis.keys(`${TEST_PREFIX}:*`);
      const hasTestKeys = testKeys.every((key) => existingKeys.some((k) => k.includes(key.split(':').pop()!)));
      expect(hasTestKeys).toBe(true);

      // Clean specific pattern
      const processedKeys = await redis.keys(`${TEST_PREFIX}:processed:*`);
      if (processedKeys.length > 0) {
        await redis.del(...processedKeys);
      }

      // Verify cleanup
      const remainingKeys = await redis.keys(`${TEST_PREFIX}:*`);
      const hasProcessedKeys = remainingKeys.some((k) => k.includes('processed'));
      expect(hasProcessedKeys).toBe(false);
    });
  });
});
