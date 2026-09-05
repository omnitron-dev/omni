/**
 * Tests for Notifications Transport Subscription Pause/Resume/Stats Control
 *
 * Verifies that NotificationSubscription properly exposes pause, resume, and stats
 * functionality through the MessagingTransport interface.
 */

import { vi } from 'vitest';
import Redis from 'ioredis';
import { NotificationManager } from '../src/rotif/rotif.js';
import { RotifTransport } from '../src/transport/rotif.transport.js';
import type { IncomingNotification } from '../src/transport/transport.interface.js';
import { getTestRedisConfig } from './rotif/helpers/test-utils.js';

/**
 * Check if real Redis is available from global setup
 */
async function isRealRedisAvailable(): Promise<boolean> {
  if (process.env.USE_MOCK_REDIS === 'true' || process.env.SKIP_DOCKER_TESTS === 'true') {
    return false;
  }
  // Ask Redis, not the filesystem about Redis.
  //
  // This used to answer by looking for `.redis-test-info.json` in
  // `process.cwd()` and returning false when it was absent. Only
  // `packages/titan/globalSetup.ts` writes that file, and into titan's OWN
  // directory — so from this package it is never there, and all 22 tests below
  // were skipped on every run whether or not Redis was up.
  const { host, port, db } = getRedisConfig();
  const probe = new Redis({ host, port, db, lazyConnect: true, retryStrategy: () => null });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

/**
 * Redis endpoint for this suite. `getTestRedisConfig` resolves the globalSetup
 * info file, then REDIS_URL/TEST_REDIS_URL, then TEST_REDIS_PORT, defaulting to
 * the compose stack on 16379.
 *
 * The local version of this defaulted to 6379 — a developer's own Redis, which
 * this suite then flushed. Keeping the test stack off 6379 is the reason the
 * shared helper exists.
 */
function getRedisConfig(): { host: string; port: number; db: number } {
  const { host, port, db } = getTestRedisConfig(0);
  return { host, port, db };
}

// Decided once, before the suite is registered.
const redisAvailable = await isRealRedisAvailable();
if (!redisAvailable) {
  console.warn('[SKIP] Notifications transport subscription tests require real Redis');
}
const describeWithRedis = redisAvailable ? describe : describe.skip;

describeWithRedis('Notifications Transport Subscription Control', () => {
  let redis: Redis;
  let manager: NotificationManager;
  let transport: RotifTransport;

  beforeEach(async () => {
    const redisConfig = getRedisConfig();

    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db,
      maxRetriesPerRequest: null,
    });

    // flushdb on THIS worker's database, not flushall.
    //
    // The suite used to call `flushall` against db 0 on the shared test Redis.
    // Databases 0-4 belong to other suites (and, right now, to a second
    // session working in this repo), and `flushall` ignores the selected db
    // and erases every one of them. It never did any harm only because this
    // whole file was gated on a file that is never present, so it had not run.
    // `toTestDb` partitions by vitest worker precisely so a flush is safe.
    await redis.flushdb();

    manager = new NotificationManager({
      redis: {
        host: redisConfig.host,
        port: redisConfig.port,
        db: redisConfig.db,
      },
      maxRetries: 3,
      checkDelayInterval: 100,
      deduplicationTTL: 60,
      // The consumer loop observes `resume()`'s reclaim request at the top of
      // an iteration, and each iteration parks in `XREADGROUP ... BLOCK
      // blockInterval` (5s by default). The pause/resume tests below therefore
      // cannot see a redelivery inside a few hundred ms at the default. This
      // is the knob the docs point callers at for exactly that reason.
      blockInterval: 200,
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
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 25 });

      // Pause the subscription
      subscription.pause();

      // Publish a message while paused
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'while paused' },
      });

      // Wait and verify message was not processed
      // Nothing to wait FOR here — the assertion is that nothing arrives —
      // so a fixed window is right. One blockInterval plus slack.
      await new Promise((resolve) => setTimeout(resolve, 500));
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
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 25 });

      // Pause and publish second message
      subscription.pause();
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'second' },
      });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 25 });

      // Resume, then wait for the redelivery rather than guessing at a delay.
      // `resume()` flags the loop to reclaim its pending messages, and the loop
      // acts on that when its blocking read next returns — within one
      // `blockInterval`, set to 200ms for this suite.
      subscription.resume();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2), { timeout: 5000, interval: 25 });
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

      await vi.waitFor(() => expect(subscription.stats().messages).toBeGreaterThan(initialCount), {
        timeout: 5000,
        interval: 25,
      });

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

      await vi.waitFor(() => expect(subscription.stats().messages).toBeGreaterThan(0), {
        timeout: 5000,
        interval: 25,
      });

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
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 25 });

      // Unsubscribe
      await subscription.unsubscribe();

      // Publish second message
      await transport.publish('test.channel', {
        type: 'test',
        data: { message: 'second' },
      });
      // Nothing to wait FOR — the assertion is that nothing arrives. One
      // blockInterval plus slack.
      await new Promise((resolve) => setTimeout(resolve, 500));

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

      // Wait for the delivery that should happen; that the other has not
      // fired by then is the actual claim.
      await vi.waitFor(() => expect(handler2).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 25 });

      // Only handler2 should be called
      expect(handler1).toHaveBeenCalledTimes(0);
      expect(handler2).toHaveBeenCalledTimes(1);

      // Resume sub1. The redelivery arrives when the consumer loop's blocking
      // read next returns — within one `blockInterval` — so wait for it rather
      // than guessing at a fixed delay.
      sub1.resume();
      await vi.waitFor(() => expect(handler1).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 25 });
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

      await vi.waitFor(
        () => {
          expect(sub1.stats().messages).toBeGreaterThan(0);
          expect(sub2.stats().messages).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 25 }
      );

      const stats1 = sub1.stats();
      const stats2 = sub2.stats();

      // Stats should be different
      expect(stats1.messages).toBe(2);
      expect(stats2.messages).toBe(1);
    });
  });
});
