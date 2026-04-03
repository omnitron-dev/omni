/**
 * Tests for Notifications Transport Subscription Pause/Resume/Stats Control
 *
 * Verifies that NotificationSubscription properly exposes pause, resume, and stats
 * functionality through the MessagingTransport interface.
 */

import { vi } from 'vitest';
import Redis from 'ioredis';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import { RotifTransport } from '../../../src/modules/notifications/transport/rotif.transport.js';
import type { IncomingNotification } from '../../../src/modules/notifications/transport/transport.interface.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if real Redis is available from global setup
 */
function isRealRedisAvailable(): boolean {
  if (process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true') {
    return false;
  }
  try {
    const infoPath = join(process.cwd(), '.redis-test-info.json');
    if (existsSync(infoPath)) {
      const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
      return info.port > 0 && !info.isMock;
    }
  } catch {
    // Ignore errors
  }
  return false;
}

// Skip entire test suite if Redis is not available
const describeWithRedis = isRealRedisAvailable() ? describe : describe.skip;

describeWithRedis('Notifications Transport Subscription Control', () => {
  let redis: Redis;
  let manager: NotificationManager;
  let transport: RotifTransport;

  /**
   * Get Redis connection info from global setup
   */
  function getRedisConfig(): { host: string; port: number } {
    try {
      const infoPath = join(process.cwd(), '.redis-test-info.json');
      if (existsSync(infoPath)) {
        const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
        return { host: info.host || 'localhost', port: info.port };
      }
    } catch {
      // Ignore errors
    }
    return { host: 'localhost', port: 6379 };
  }

  beforeEach(async () => {
    const redisConfig = getRedisConfig();

    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      maxRetriesPerRequest: null,
    });

    // Clear all Redis keys
    await redis.flushall();

    manager = new NotificationManager({
      redis: {
        host: redisConfig.host,
        port: redisConfig.port,
      },
      maxRetries: 3,
      checkDelayInterval: 100,
      deduplicationTTL: 60,
    });

    await manager.waitUntilReady();
    transport = new RotifTransport(manager);
  });

  afterEach(async () => {
    await manager.stopAll();
    await manager.destroy();
    await redis.quit();
  });

  describe('Subscription Interface', () => {
    it('should expose isPaused property on subscription', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription).toHaveProperty('isPaused');
      expect(typeof subscription.isPaused).toBe('boolean');
      expect(subscription.isPaused).toBe(false);
    });

    it('should have pause() method on subscription', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription).toHaveProperty('pause');
      expect(typeof subscription.pause).toBe('function');
    });

    it('should have resume() method on subscription', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription).toHaveProperty('resume');
      expect(typeof subscription.resume).toBe('function');
    });

    it('should have stats() method on subscription', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription).toHaveProperty('stats');
      expect(typeof subscription.stats).toBe('function');
    });
  });

  describe('Pause/Resume Functionality', () => {
    it('should update isPaused property when paused', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription.isPaused).toBe(false);

      subscription.pause();

      expect(subscription.isPaused).toBe(true);
    });

    it('should update isPaused property when resumed', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      subscription.pause();
      expect(subscription.isPaused).toBe(true);

      subscription.resume();
      expect(subscription.isPaused).toBe(false);
    });

    it('should stop processing messages when paused', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      // Publish a message before pausing
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'before pause' },
      });

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledTimes(1);

      // Pause the subscription
      subscription.pause();

      // Publish a message while paused
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'while paused' },
      });

      // Wait and verify message was not processed
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should resume processing messages when resumed', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      // Publish and verify first message
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'first' },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledTimes(1);

      // Pause and publish second message
      subscription.pause();
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'second' },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledTimes(1);

      // Resume and wait for pending message to be processed
      subscription.resume();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Subscription Statistics', () => {
    it('should return stats with messages count', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const initialStats = subscription.stats();
      expect(initialStats).toHaveProperty('messages');
      expect(typeof initialStats.messages).toBe('number');
    });

    it('should return stats with retries count', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const stats = subscription.stats();
      expect(stats).toHaveProperty('retries');
      expect(typeof stats.retries).toBe('number');
    });

    it('should return stats with optional failures count', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const stats = subscription.stats();
      if (stats.failures !== undefined) {
        expect(typeof stats.failures).toBe('number');
      }
    });

    it('should return stats with optional lastMessageAt timestamp', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const stats = subscription.stats();
      if (stats.lastMessageAt !== undefined) {
        expect(typeof stats.lastMessageAt).toBe('number');
      }
    });

    it('should return stats with optional inflightCount', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const stats = subscription.stats();
      if (stats.inflightCount !== undefined) {
        expect(typeof stats.inflightCount).toBe('number');
      }
    });

    it('should increment message count after processing messages', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const initialStats = subscription.stats();
      const initialCount = initialStats.messages;

      // Publish and process a message
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'test' },
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const newStats = subscription.stats();
      expect(newStats.messages).toBeGreaterThan(initialCount);
    });

    it('should update lastMessageAt timestamp after processing messages', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      const initialStats = subscription.stats();
      const initialTimestamp = initialStats.lastMessageAt;

      // Publish and process a message
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'test' },
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const newStats = subscription.stats();
      if (newStats.lastMessageAt !== undefined) {
        if (initialTimestamp === undefined) {
          expect(newStats.lastMessageAt).toBeGreaterThan(0);
        } else {
          expect(newStats.lastMessageAt).toBeGreaterThanOrEqual(initialTimestamp);
        }
      }
    });
  });

  describe('Subscription Metadata', () => {
    it('should expose subscription id', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription).toHaveProperty('id');
      expect(typeof subscription.id).toBe('string');
      expect(subscription.id.length).toBeGreaterThan(0);
    });

    it('should expose subscription pattern', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.pattern.*', handler);

      expect(subscription).toHaveProperty('pattern');
      expect(subscription.pattern).toBe('test.pattern.*');
    });

    it('should expose subscription group', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler, {
        groupName: 'test-group',
      });

      expect(subscription).toHaveProperty('group');
      expect(typeof subscription.group).toBe('string');
    });
  });

  describe('Subscription Unsubscribe', () => {
    it('should have unsubscribe method', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      expect(subscription).toHaveProperty('unsubscribe');
      expect(typeof subscription.unsubscribe).toBe('function');
    });

    it('should stop processing messages after unsubscribe', async () => {
      const handler = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const subscription = await transport.subscribe('test.channel', handler);

      // Publish and verify first message
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'first' },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe
      await subscription.unsubscribe();

      // Publish second message
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'second' },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Handler should not be called again
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration: Multiple Subscriptions', () => {
    it('should independently control pause/resume for multiple subscriptions', async () => {
      const handler1 = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });
      const handler2 = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const sub1 = await transport.subscribe('channel.1', handler1);
      const sub2 = await transport.subscribe('channel.2', handler2);

      // Pause only sub1
      sub1.pause();

      expect(sub1.isPaused).toBe(true);
      expect(sub2.isPaused).toBe(false);

      // Publish to both channels
      await transport.publish('channel.1', { type: 'test', data: {} });
      await transport.publish('channel.2', { type: 'test', data: {} });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Only handler2 should be called
      expect(handler1).toHaveBeenCalledTimes(0);
      expect(handler2).toHaveBeenCalledTimes(1);

      // Resume sub1
      sub1.resume();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Now handler1 should process the pending message
      expect(handler1).toHaveBeenCalledTimes(1);
    });

    it('should track stats independently for multiple subscriptions', async () => {
      const handler1 = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });
      const handler2 = vi.fn(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      const sub1 = await transport.subscribe('channel.1', handler1);
      const sub2 = await transport.subscribe('channel.2', handler2);

      // Publish different number of messages to each channel
      await transport.publish('channel.1', { type: 'test', data: {} });
      await transport.publish('channel.1', { type: 'test', data: {} });
      await transport.publish('channel.2', { type: 'test', data: {} });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const stats1 = sub1.stats();
      const stats2 = sub2.stats();

      // Stats should be different
      expect(stats1.messages).toBe(2);
      expect(stats2.messages).toBe(1);
    });
  });
});
