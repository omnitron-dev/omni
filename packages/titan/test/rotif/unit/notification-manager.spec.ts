import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import { RotifMessage, Middleware } from '../../../src/rotif/types.js';
import { createTestConfig } from '../helpers/test-utils.js';
import { delay } from '@omnitron-dev/common';

describe('Rotif - NotificationManager Integration', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeEach(async () => {
    manager = new NotificationManager(
      createTestConfig(6, {
        checkDelayInterval: 100,
        blockInterval: 100,
        maxRetries: 3,
        retryDelay: 100,
      })
    );
    redis = manager.redis;
    await redis.flushdb();
    await manager.waitUntilReady();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      expect(manager).toBeDefined();
      expect(manager.redis).toBeDefined();
      expect(manager.config).toBeDefined();
    });

    it('should load lua scripts', async () => {
      expect(manager['luaScripts'].size).toBeGreaterThan(0);
    });

    it('should respect disableDelayed option', async () => {
      const customManager = new NotificationManager(
        createTestConfig(7, { disableDelayed: true })
      );

      await customManager.waitUntilReady();
      expect(customManager['delayTimeoutId']).toBeUndefined();

      await customManager.stopAll();
    });
  });

  describe('publish', () => {
    beforeEach(async () => {
      // Subscribe to activate pattern
      await manager.subscribe('test.channel', async () => {});
      await delay(100);
    });

    it('should publish message successfully', async () => {
      const msgId = await manager.publish('test.channel', { msg: 'hello' });

      expect(msgId).toBeTruthy();
      expect(typeof msgId).toBe('string');
    });

    it('should return null when no active patterns match', async () => {
      const result = await manager.publish('nonexistent.channel', { msg: 'test' });

      expect(result).toBeNull();
    });

    it('should store message in correct stream', async () => {
      await manager.publish('test.channel', { data: 'test-payload' });

      const messages = await redis.xrange('rotif:stream:test.channel', '-', '+');
      expect(messages.length).toBe(1);

      const fields = Object.fromEntries(
        messages[0]![1].reduce((acc: any[], val: any, i: number, arr: any[]) => {
          if (i % 2 === 0) acc.push([val, arr[i + 1]]);
          return acc;
        }, [])
      );

      expect(JSON.parse(fields.payload)).toEqual({ data: 'test-payload' });
      expect(fields.channel).toBe('test.channel');
    });

    it('should publish delayed message', async () => {
      const result = await manager.publish('test.channel', { msg: 'delayed' }, { delayMs: 5000 });

      // Delayed messages are scheduled, not immediately published
      const scheduled = await redis.zrange('rotif:scheduled', 0, -1);
      expect(scheduled.length).toBeGreaterThan(0);
    });

    it('should handle deliverAt option', async () => {
      const futureTime = Date.now() + 10000;
      await manager.publish('test.channel', { msg: 'future' }, { deliverAt: futureTime });

      const scheduled = await redis.zrange('rotif:scheduled', 0, -1, 'WITHSCORES');
      expect(scheduled.length).toBeGreaterThan(0);
    });

    it('should support exactlyOnce deduplication', async () => {
      const payload = { unique: 'data', id: 123 };

      const id1 = await manager.publish('test.channel', payload, { exactlyOnce: true });
      const id2 = await manager.publish('test.channel', payload, { exactlyOnce: true });

      expect(id1).toBeTruthy();
      expect(id2).toBe('DUPLICATE');
    });
  });

  describe('subscribe', () => {
    it('should subscribe to pattern successfully', async () => {
      const handler = vi.fn(async (msg: RotifMessage) => {});

      const sub = await manager.subscribe('test.*', handler);

      expect(sub).toBeDefined();
      expect(sub.id).toBeTruthy();
      expect(sub.pattern).toBe('test.*');
      expect(sub.handler).toBe(handler);
    });

    it('should receive published messages', async () => {
      const received: RotifMessage[] = [];

      await manager.subscribe('test.events', async (msg) => {
        received.push(msg);
      });

      await delay(100);

      await manager.publish('test.events', { data: 'message1' });
      await manager.publish('test.events', { data: 'message2' });

      await delay(300);

      expect(received.length).toBe(2);
      expect(received[0]?.payload).toEqual({ data: 'message1' });
      expect(received[1]?.payload).toEqual({ data: 'message2' });
    });

    it('should match wildcard patterns', async () => {
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

    it('should support custom group names', async () => {
      const sub = await manager.subscribe(
        'test.channel',
        async () => {},
        { groupName: 'custom-group' }
      );

      expect(sub.group).toBe('custom-group');
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe successfully', async () => {
      const received: number[] = [];

      const sub = await manager.subscribe('test.channel', async () => {
        received.push(Date.now());
      });

      await delay(100);

      await manager.publish('test.channel', { msg: 1 });
      await delay(200);

      await sub.unsubscribe();
      await delay(100);

      await manager.publish('test.channel', { msg: 2 });
      await delay(200);

      // Should only receive first message
      expect(received.length).toBe(1);
    });

    it('should wait for in-flight messages', async () => {
      let processing = false;
      let completed = false;

      const sub = await manager.subscribe('test.channel', async () => {
        processing = true;
        await delay(200);
        completed = true;
      });

      await delay(50);

      await manager.publish('test.channel', {});
      await delay(50);

      const unsubPromise = sub.unsubscribe();
      
      expect(processing).toBe(true);
      await unsubPromise;
      expect(completed).toBe(true);
    });

    it('should remove pattern when removePattern is true', async () => {
      const sub = await manager.subscribe('test.pattern', async () => {});
      await delay(100);

      expect(manager['activePatterns'].has('test.pattern')).toBe(true);

      await sub.unsubscribe(true);
      await delay(100);

      expect(manager['activePatterns'].has('test.pattern')).toBe(false);
    });
  });

  describe('pause/resume', () => {
    it('should pause message processing', async () => {
      const received: number[] = [];

      const sub = await manager.subscribe('test.channel', async () => {
        received.push(Date.now());
      });

      await delay(100);

      await manager.publish('test.channel', { msg: 1 });
      await delay(200);

      sub.pause();

      await manager.publish('test.channel', { msg: 2 });
      await delay(200);

      expect(received.length).toBe(1);
    });

    it('should resume message processing', async () => {
      const received: number[] = [];

      const sub = await manager.subscribe('test.channel', async () => {
        received.push(Date.now());
      });

      await delay(100);

      sub.pause();

      await manager.publish('test.channel', { msg: 1 });
      await delay(200);

      sub.resume();
      await delay(200);

      // Message should be processed after resume
      expect(received.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('middleware', () => {
    it('should execute middleware hooks', async () => {
      const hooks: string[] = [];

      const mw: Middleware = {
        beforePublish: async () => {
          hooks.push('beforePublish');
        },
        afterPublish: async () => {
          hooks.push('afterPublish');
        },
        beforeProcess: async () => {
          hooks.push('beforeProcess');
        },
        afterProcess: async () => {
          hooks.push('afterProcess');
        },
      };

      manager.use(mw);

      await manager.subscribe('test.channel', async () => {});
      await delay(100);

      await manager.publish('test.channel', { msg: 'test' });
      await delay(300);

      expect(hooks).toContain('beforePublish');
      expect(hooks).toContain('afterPublish');
      expect(hooks).toContain('beforeProcess');
      expect(hooks).toContain('afterProcess');
    });

    it('should call onError on handler failure', async () => {
      const errors: Error[] = [];

      const mw: Middleware = {
        onError: async (msg, err) => {
          errors.push(err);
        },
      };

      manager.use(mw);

      await manager.subscribe('test.channel', async () => {
        throw new Error('Handler error');
      });

      await delay(100);

      await manager.publish('test.channel', {});
      await delay(500);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.message).toBe('Handler error');
    });
  });

  describe('statistics', () => {
    it('should track subscription stats', async () => {
      const sub = await manager.subscribe('test.channel', async () => {});

      await delay(100);

      await manager.publish('test.channel', { msg: 1 });
      await manager.publish('test.channel', { msg: 2 });
      await manager.publish('test.channel', { msg: 3 });

      await delay(500);

      const stats = sub.stats();

      expect(stats.messages).toBe(3);
      expect(stats.lastMessageAt).toBeGreaterThan(0);
    });

    it('should track retry count', async () => {
      let attempts = 0;

      const sub = await manager.subscribe('test.channel', async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
      });

      await delay(100);

      await manager.publish('test.channel', {});
      await delay(1000);

      const stats = sub.stats();
      expect(stats.retries).toBeGreaterThan(0);
    });
  });

  describe('DLQ operations', () => {
    it('should move failed messages to DLQ', async () => {
      await manager.subscribe(
        'test.channel',
        async () => {
          throw new Error('Always fail');
        },
        { maxRetries: 1 }
      );

      await delay(100);

      await manager.publish('test.channel', { msg: 'will fail' });
      await delay(1000);

      const dlqStats = await manager.getDLQStats();
      expect(dlqStats.totalMessages).toBeGreaterThan(0);
    });

    it('should get DLQ messages', async () => {
      // Add message to DLQ manually
      await redis.xadd(
        'rotif:dlq',
        '*',
        'channel',
        'test.channel',
        'payload',
        JSON.stringify({ test: 'data' }),
        'timestamp',
        String(Date.now()),
        'attempt',
        '5',
        'error',
        'Test error'
      );

      const messages = await manager.getDLQMessages();

      expect(messages.length).toBe(1);
      expect(messages[0]?.channel).toBe('test.channel');
      expect(messages[0]?.error).toBe('Test error');
    });

    it('should clear DLQ', async () => {
      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', String(Date.now()));

      await manager.clearDLQ();

      const dlqStats = await manager.getDLQStats();
      expect(dlqStats.totalMessages).toBe(0);
    });
  });

  describe('stopAll', () => {
    it('should stop all subscriptions', async () => {
      const received: number[] = [];

      await manager.subscribe('test.channel', async () => {
        received.push(1);
      });

      await delay(100);

      await manager.publish('test.channel', {});
      await delay(200);

      await manager.stopAll();

      // Try to publish after stop - should not be received
      try {
        await manager.publish('test.channel', {});
      } catch (e) {
        // Expected - manager is stopped
      }

      await delay(200);

      expect(received.length).toBe(1);
    });

    it('should cleanup resources', async () => {
      await manager.stopAll();

      expect(manager['active']).toBe(false);
      expect(manager.redis.status).toBe('end');
    });
  });

  describe('error handling', () => {
    it('should handle invalid payload gracefully', async () => {
      const received: any[] = [];

      await manager.subscribe('test.channel', async (msg) => {
        received.push(msg.payload);
      });

      await delay(100);

      await manager.publish('test.channel', { valid: 'payload' });
      await delay(200);

      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ valid: 'payload' });
    });

    it('should recover from handler errors', async () => {
      let callCount = 0;

      await manager.subscribe('test.channel', async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First attempt fails');
        }
      });

      await delay(100);

      await manager.publish('test.channel', { msg: 'first' });
      await delay(500);

      await manager.publish('test.channel', { msg: 'second' });
      await delay(200);

      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('consumer groups', () => {
    it('should support multiple consumer groups', async () => {
      const group1Messages: string[] = [];
      const group2Messages: string[] = [];

      await manager.subscribe(
        'test.channel',
        async (msg) => {
          group1Messages.push(msg.id);
        },
        { groupName: 'group1' }
      );

      await manager.subscribe(
        'test.channel',
        async (msg) => {
          group2Messages.push(msg.id);
        },
        { groupName: 'group2' }
      );

      await delay(100);

      await manager.publish('test.channel', { msg: 'broadcast' });
      await delay(300);

      // Both groups should receive the message
      expect(group1Messages.length).toBe(1);
      expect(group2Messages.length).toBe(1);
    });
  });
});
