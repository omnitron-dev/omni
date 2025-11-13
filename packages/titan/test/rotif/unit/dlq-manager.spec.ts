import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import { DLQManager, DLQCleanupConfig } from '../../../src/rotif/dlq-manager.js';
import { RotifLogger } from '../../../src/rotif/types.js';
import { getTestRedisUrl } from '../helpers/test-utils.js';

// Mock logger
const createMockLogger = (): RotifLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('Rotif - DLQManager', () => {
  let redis: Redis;
  let logger: RotifLogger;
  let manager: DLQManager;

  beforeEach(async () => {
    redis = new Redis(getTestRedisUrl(5));
    await redis.flushdb();
    logger = createMockLogger();
  });

  afterEach(async () => {
    if (manager) {
      manager.stopAutoCleanup();
    }
    await redis.quit();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      manager = new DLQManager(redis, logger);
      const config = manager.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxAge).toBe(7 * 24 * 60 * 60 * 1000); // 7 days
      expect(config.maxSize).toBe(10000);
      expect(config.cleanupInterval).toBe(60 * 60 * 1000); // 1 hour
      expect(config.batchSize).toBe(100);
      expect(config.archiveBeforeDelete).toBe(false);
      expect(config.archivePrefix).toBe('rotif:dlq:archive');
    });

    it('should merge provided config with defaults', () => {
      const customConfig: DLQCleanupConfig = {
        enabled: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        maxSize: 5000,
      };

      manager = new DLQManager(redis, logger, customConfig);
      const config = manager.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxAge).toBe(24 * 60 * 60 * 1000);
      expect(config.maxSize).toBe(5000);
      expect(config.cleanupInterval).toBe(60 * 60 * 1000); // Still default
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      manager = new DLQManager(redis, logger);
    });

    it('should return empty stats for empty DLQ', async () => {
      const stats = await manager.getStats();

      expect(stats.totalMessages).toBe(0);
      expect(stats.messagesByChannel).toEqual({});
      expect(stats.oldestMessage).toBeUndefined();
      expect(stats.newestMessage).toBeUndefined();
      expect(stats.messagesCleanedUp).toBe(0);
      expect(stats.messagesArchived).toBe(0);
    });

    it('should count messages in DLQ', async () => {
      // Add messages to DLQ
      await redis.xadd('rotif:dlq', '*', 'channel', 'test1', 'payload', '{}', 'timestamp', '1000');
      await redis.xadd('rotif:dlq', '*', 'channel', 'test2', 'payload', '{}', 'timestamp', '2000');
      await redis.xadd('rotif:dlq', '*', 'channel', 'test1', 'payload', '{}', 'timestamp', '3000');

      const stats = await manager.getStats();

      expect(stats.totalMessages).toBe(3);
      expect(stats.messagesByChannel['test1']).toBe(2);
      expect(stats.messagesByChannel['test2']).toBe(1);
      expect(stats.oldestMessage).toBe(1000);
      expect(stats.newestMessage).toBe(3000);
    });
  });

  describe('getMessages', () => {
    beforeEach(async () => {
      manager = new DLQManager(redis, logger);

      // Add test messages
      await redis.xadd(
        'rotif:dlq',
        '*',
        'channel',
        'user.created',
        'payload',
        JSON.stringify({ id: 1 }),
        'timestamp',
        String(Date.now() - 5000),
        'attempt',
        '3',
        'error',
        'Test error 1'
      );

      await redis.xadd(
        'rotif:dlq',
        '*',
        'channel',
        'user.updated',
        'payload',
        JSON.stringify({ id: 2 }),
        'timestamp',
        String(Date.now() - 3000),
        'attempt',
        '2',
        'error',
        'Test error 2'
      );

      await redis.xadd(
        'rotif:dlq',
        '*',
        'channel',
        'user.created',
        'payload',
        JSON.stringify({ id: 3 }),
        'timestamp',
        String(Date.now() - 1000),
        'attempt',
        '5'
      );
    });

    it('should return all messages without filters', async () => {
      const messages = await manager.getMessages();

      expect(messages.length).toBe(3);
      expect(messages[0]?.channel).toBe('user.created');
      expect(messages[1]?.channel).toBe('user.updated');
      expect(messages[2]?.channel).toBe('user.created');
    });

    it('should filter by channel', async () => {
      const messages = await manager.getMessages({ channel: 'user.created' });

      expect(messages.length).toBe(2);
      expect(messages.every((m) => m.channel === 'user.created')).toBe(true);
    });

    it('should limit results', async () => {
      const messages = await manager.getMessages({ limit: 2 });

      expect(messages.length).toBe(2);
    });

    it('should apply offset', async () => {
      const messages = await manager.getMessages({ offset: 1, limit: 2 });

      expect(messages.length).toBe(2);
      expect(messages[0]?.channel).toBe('user.updated');
    });

    it('should filter by maxAge', async () => {
      const messages = await manager.getMessages({ maxAge: 4000 });

      expect(messages.length).toBe(2);
      expect(messages.every((m) => m.age <= 4000)).toBe(true);
    });

    it('should include message metadata', async () => {
      const messages = await manager.getMessages({ limit: 1 });
      const msg = messages[0]!;

      expect(msg.id).toBeTruthy();
      expect(msg.channel).toBeTruthy();
      expect(msg.payload).toBeDefined();
      expect(msg.timestamp).toBeGreaterThan(0);
      expect(msg.attempt).toBeGreaterThan(0);
      expect(msg.age).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      manager = new DLQManager(redis, logger);
    });

    it('should clear all messages from DLQ', async () => {
      // Add messages
      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', '1000');
      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', '2000');

      expect(await redis.xlen('rotif:dlq')).toBe(2);

      await manager.clear();

      expect(await redis.xlen('rotif:dlq')).toBe(0);
    });

    it('should log clear action', async () => {
      await manager.clear();

      expect(logger.info).toHaveBeenCalledWith('DLQ cleared');
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      manager = new DLQManager(redis, logger, {
        maxAge: 2000, // 2 seconds
        batchSize: 100,
      });
    });

    it('should remove old messages', async () => {
      const oldTimestamp = Date.now() - 5000; // 5 seconds ago
      const newTimestamp = Date.now() - 1000; // 1 second ago

      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', String(oldTimestamp));
      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', String(newTimestamp));

      const cleanedCount = await manager.cleanup();

      expect(cleanedCount).toBe(1);
      expect(await redis.xlen('rotif:dlq')).toBe(1);
    });

    it('should not remove recent messages', async () => {
      const recentTimestamp = Date.now() - 1000; // 1 second ago

      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', String(recentTimestamp));

      const cleanedCount = await manager.cleanup();

      expect(cleanedCount).toBe(0);
      expect(await redis.xlen('rotif:dlq')).toBe(1);
    });

    it('should process in batches', async () => {
      manager = new DLQManager(redis, logger, {
        maxAge: 1000,
        batchSize: 2, // Small batch size
      });

      // Add multiple old messages
      const oldTimestamp = Date.now() - 5000;
      for (let i = 0; i < 5; i++) {
        await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', '{}', 'timestamp', String(oldTimestamp));
      }

      const cleanedCount = await manager.cleanup();

      expect(cleanedCount).toBe(5);
      expect(await redis.xlen('rotif:dlq')).toBe(0);
    });
  });

  describe('updateConfig', () => {
    beforeEach(() => {
      manager = new DLQManager(redis, logger, { enabled: false });
    });

    it('should update configuration', () => {
      manager.updateConfig({ maxAge: 5000, maxSize: 1000 });

      const config = manager.getConfig();
      expect(config.maxAge).toBe(5000);
      expect(config.maxSize).toBe(1000);
    });

    it('should merge with existing config', () => {
      const originalConfig = manager.getConfig();

      manager.updateConfig({ maxAge: 8000 });

      const newConfig = manager.getConfig();
      expect(newConfig.maxAge).toBe(8000);
      expect(newConfig.maxSize).toBe(originalConfig.maxSize);
    });

    it('should stop auto-cleanup when disabled', () => {
      manager = new DLQManager(redis, logger, { enabled: true });
      manager.startAutoCleanup();

      manager.updateConfig({ enabled: false });

      expect(manager['cleanupTimer']).toBeUndefined();
    });
  });

  describe('auto-cleanup', () => {
    it('should not start auto-cleanup when disabled', () => {
      manager = new DLQManager(redis, logger, { enabled: false });
      manager.startAutoCleanup();

      expect(manager['cleanupTimer']).toBeUndefined();
    });

    it('should start auto-cleanup when enabled', () => {
      manager = new DLQManager(redis, logger, {
        enabled: true,
        cleanupInterval: 100,
      });

      manager.startAutoCleanup();

      expect(manager['cleanupTimer']).toBeDefined();
    });

    it('should stop auto-cleanup', () => {
      manager = new DLQManager(redis, logger, {
        enabled: true,
        cleanupInterval: 100,
      });

      manager.startAutoCleanup();
      expect(manager['cleanupTimer']).toBeDefined();

      manager.stopAutoCleanup();
      expect(manager['cleanupTimer']).toBeUndefined();
    });

    it('should log auto-cleanup start and stop', () => {
      manager = new DLQManager(redis, logger, {
        enabled: true,
        cleanupInterval: 100,
      });

      manager.startAutoCleanup();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('DLQ auto-cleanup started'));

      manager.stopAutoCleanup();
      expect(logger.info).toHaveBeenCalledWith('DLQ auto-cleanup stopped');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      manager = new DLQManager(redis, logger);
    });

    it('should handle empty DLQ during cleanup', async () => {
      const cleanedCount = await manager.cleanup();

      expect(cleanedCount).toBe(0);
    });

    it('should handle malformed messages gracefully', async () => {
      // Add message with missing fields
      await redis.xadd('rotif:dlq', '*', 'channel', 'test');

      const messages = await manager.getMessages();

      expect(messages.length).toBe(1);
      expect(messages[0]?.payload).toEqual({});
    });

    it('should handle invalid JSON in payload', async () => {
      await redis.xadd('rotif:dlq', '*', 'channel', 'test', 'payload', 'invalid-json', 'timestamp', '1000');

      const messages = await manager.getMessages();

      expect(messages.length).toBe(1);
      expect(messages[0]?.payload).toEqual({});
    });
  });
});
