/**
 * Comprehensive tests for DistributedLockService
 *
 * Tests cover:
 * - Lock acquisition (success, already held, Redis errors)
 * - Lock release (success, wrong lockId, not owned)
 * - Lock extension (success, wrong lockId)
 * - withLock helper (success, retries, exponential backoff, skipOnLockFailure, error propagation)
 * - isLocked and getLockTtl utility methods
 * - Lua script loading
 * - Edge cases (empty keys, zero TTL, special characters, error handling)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DistributedLockService } from '../src/lock.service.js';
import type { IRedisClient } from '@omnitron-dev/titan/module/redis';
import type { ILoggerModule } from '@omnitron-dev/titan/module/logger';
import type { ILockModuleOptions } from '../src/lock.types.js';

/**
 * Mock Redis client
 */
function createMockRedis(): IRedisClient {
  return {
    eval: vi.fn(),
    evalsha: vi.fn(),
    script: vi.fn(),
    exists: vi.fn(),
    pttl: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    // Add other required methods as stubs
    quit: vi.fn(),
    disconnect: vi.fn(),
    ping: vi.fn(),
  } as unknown as IRedisClient;
}

/**
 * Mock Logger module
 */
function createMockLogger(): ILoggerModule {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    },
  } as unknown as ILoggerModule;
}

describe('DistributedLockService', () => {
  let lockService: DistributedLockService;
  let mockRedis: IRedisClient;
  let mockLogger: ILoggerModule;
  let defaultOptions: ILockModuleOptions;

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockLogger = createMockLogger();
    defaultOptions = {
      defaultTtl: 30000,
      keyPrefix: 'lock',
      defaultRetries: 3,
      defaultRetryDelay: 100,
    };

    // Mock script loading to return a SHA
    (mockRedis.script as Mock).mockResolvedValue('mock-sha-123');

    lockService = new DistributedLockService(mockRedis, mockLogger, defaultOptions);

    // Wait for scripts to load
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Lua Script Loading', () => {
    it('should load release script lazily on first releaseLock call', async () => {
      // Scripts are lazy-loaded, not in constructor
      expect(mockRedis.script).not.toHaveBeenCalled();

      // Trigger acquire + release
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);
      const lockId = await lockService.acquireLock('test-key', 30000);
      expect(lockId).toBeTruthy();

      await lockService.releaseLock('test-key', lockId!);

      // Release script loaded
      expect(mockRedis.script).toHaveBeenCalledWith('LOAD', expect.stringContaining('redis.call'));
    });

    it('should log error when script loading fails during release', async () => {
      const scriptError = new Error('Script load failed');
      (mockRedis.script as Mock).mockRejectedValueOnce(scriptError);
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const freshService = new DistributedLockService(mockRedis, mockLogger, defaultOptions);
      const lockId = await freshService.acquireLock('test-key', 30000);
      expect(lockId).toBeTruthy();

      // Release returns false because script failed to load
      const released = await freshService.releaseLock('test-key', lockId!);
      expect(released).toBe(false);

      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        { error: scriptError },
        '[DistributedLock] Failed to load Lua script'
      );
    });
  });

  describe('acquireLock', () => {
    it('should successfully acquire a lock', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const lockId = await lockService.acquireLock('test-key', 5000);

      expect(lockId).toBeTruthy();
      expect(typeof lockId).toBe('string');
      expect(lockId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.stringContaining('SET'), 1, 'lock:test-key', lockId, '5000');
      expect(mockLogger.logger.debug).toHaveBeenCalledWith(
        { key: 'test-key', lockId, ttlMs: 5000 },
        '[DistributedLock] Lock acquired'
      );
    });

    it('should return null when lock is already held', async () => {
      (mockRedis.eval as Mock).mockResolvedValue(null);

      const lockId = await lockService.acquireLock('test-key', 5000);

      expect(lockId).toBeNull();
      expect(mockLogger.logger.debug).toHaveBeenCalledWith({ key: 'test-key' }, '[DistributedLock] Lock already held');
    });

    it('should handle Redis errors during acquisition', async () => {
      const redisError = new Error('Redis connection failed');
      (mockRedis.eval as Mock).mockRejectedValue(redisError);

      const lockId = await lockService.acquireLock('test-key', 5000);

      expect(lockId).toBeNull();
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        { key: 'test-key', error: redisError },
        '[DistributedLock] Failed to acquire lock'
      );
    });

    it('should handle empty key', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const lockId = await lockService.acquireLock('', 5000);

      expect(lockId).toBeTruthy();
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:', expect.any(String), '5000');
    });

    it('should handle zero TTL', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const lockId = await lockService.acquireLock('test-key', 0);

      expect(lockId).toBeTruthy();
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:test-key', expect.any(String), '0');
    });

    it('should handle special characters in key', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const specialKey = 'test:key:with:colons-and-dashes_and_underscores';
      const lockId = await lockService.acquireLock(specialKey, 5000);

      expect(lockId).toBeTruthy();
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `lock:${specialKey}`,
        expect.any(String),
        '5000'
      );
    });

    it('should use custom key prefix if provided', async () => {
      const customOptions = { ...defaultOptions, keyPrefix: 'custom-prefix' };
      const customLockService = new DistributedLockService(mockRedis, mockLogger, customOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      (mockRedis.eval as Mock).mockResolvedValue('OK');

      await customLockService.acquireLock('test-key', 5000);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'custom-prefix:test-key',
        expect.any(String),
        '5000'
      );
    });
  });

  describe('releaseLock', () => {
    beforeEach(() => {
      // Mock evalsha to return success
      (mockRedis.evalsha as Mock).mockResolvedValue(1);
    });

    it('should successfully release a lock', async () => {
      const lockId = 'test-lock-id';
      const result = await lockService.releaseLock('test-key', lockId);

      expect(result).toBe(true);
      expect(mockRedis.evalsha).toHaveBeenCalledWith('mock-sha-123', 1, 'lock:test-key', lockId);
      expect(mockLogger.logger.debug).toHaveBeenCalledWith(
        { key: 'test-key', lockId },
        '[DistributedLock] Lock released'
      );
    });

    it('should return false when lock is not owned', async () => {
      (mockRedis.evalsha as Mock).mockResolvedValue(0);

      const result = await lockService.releaseLock('test-key', 'wrong-lock-id');

      expect(result).toBe(false);
      expect(mockLogger.logger.debug).toHaveBeenCalledWith(
        { key: 'test-key', lockId: 'wrong-lock-id' },
        '[DistributedLock] Lock not owned or already released'
      );
    });

    it('should return false when lock has already been released', async () => {
      (mockRedis.evalsha as Mock).mockResolvedValue(0);

      const result = await lockService.releaseLock('test-key', 'expired-lock-id');

      expect(result).toBe(false);
    });

    it('should handle Redis errors during release', async () => {
      const redisError = new Error('Redis error');
      (mockRedis.evalsha as Mock).mockRejectedValue(redisError);

      const result = await lockService.releaseLock('test-key', 'lock-id');

      expect(result).toBe(false);
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        { key: 'test-key', lockId: 'lock-id', error: redisError },
        '[DistributedLock] Failed to release lock'
      );
    });

    it('should handle empty lockId', async () => {
      (mockRedis.evalsha as Mock).mockResolvedValue(0);

      const result = await lockService.releaseLock('test-key', '');

      expect(result).toBe(false);
      expect(mockRedis.evalsha).toHaveBeenCalledWith('mock-sha-123', 1, 'lock:test-key', '');
    });

    it('should handle special characters in lockId', async () => {
      const specialLockId = 'lock-id-with-special-chars:/@#$%';
      const result = await lockService.releaseLock('test-key', specialLockId);

      expect(result).toBe(true);
      expect(mockRedis.evalsha).toHaveBeenCalledWith('mock-sha-123', 1, 'lock:test-key', specialLockId);
    });
  });

  describe('extendLock', () => {
    beforeEach(() => {
      // Mock evalsha to return success
      (mockRedis.evalsha as Mock).mockResolvedValue(1);
    });

    it('should successfully extend a lock', async () => {
      const lockId = 'test-lock-id';
      const newTtl = 10000;
      const result = await lockService.extendLock('test-key', lockId, newTtl);

      expect(result).toBe(true);
      expect(mockRedis.evalsha).toHaveBeenCalledWith('mock-sha-123', 1, 'lock:test-key', lockId, '10000');
      expect(mockLogger.logger.debug).toHaveBeenCalledWith(
        { key: 'test-key', lockId, ttlMs: newTtl },
        '[DistributedLock] Lock extended'
      );
    });

    it('should return false when trying to extend with wrong lockId', async () => {
      (mockRedis.evalsha as Mock).mockResolvedValue(0);

      const result = await lockService.extendLock('test-key', 'wrong-lock-id', 5000);

      expect(result).toBe(false);
      expect(mockLogger.logger.debug).toHaveBeenCalledWith(
        { key: 'test-key', lockId: 'wrong-lock-id' },
        '[DistributedLock] Lock not owned, cannot extend'
      );
    });

    it('should handle Redis errors during extension', async () => {
      const redisError = new Error('Redis error');
      (mockRedis.evalsha as Mock).mockRejectedValue(redisError);

      const result = await lockService.extendLock('test-key', 'lock-id', 5000);

      expect(result).toBe(false);
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        { key: 'test-key', lockId: 'lock-id', error: redisError },
        '[DistributedLock] Failed to extend lock'
      );
    });

    it('should handle zero TTL extension', async () => {
      const result = await lockService.extendLock('test-key', 'lock-id', 0);

      expect(result).toBe(true);
      expect(mockRedis.evalsha).toHaveBeenCalledWith('mock-sha-123', 1, 'lock:test-key', 'lock-id', '0');
    });

    it('should handle negative TTL extension', async () => {
      const result = await lockService.extendLock('test-key', 'lock-id', -1000);

      expect(result).toBe(true);
      expect(mockRedis.evalsha).toHaveBeenCalledWith('mock-sha-123', 1, 'lock:test-key', 'lock-id', '-1000');
    });
  });

  describe('withLock', () => {
    it('should execute function with lock protection', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('success');
      const result = await lockService.withLock('test-key', fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockRedis.eval).toHaveBeenCalledTimes(1); // acquire
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(1); // release
    });

    it('should release lock even if function throws error', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const error = new Error('Function error');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(lockService.withLock('test-key', fn)).rejects.toThrow('Function error');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(1); // Still released
    });

    it('should retry on lock acquisition failure', async () => {
      (mockRedis.eval as Mock)
        .mockResolvedValueOnce(null) // First attempt fails
        .mockResolvedValueOnce(null) // Second attempt fails
        .mockResolvedValueOnce('OK'); // Third attempt succeeds
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('success');
      const result = await lockService.withLock('test-key', fn, { retries: 3 });

      expect(result).toBe('success');
      expect(mockRedis.eval).toHaveBeenCalledTimes(3);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff for retries', async () => {
      (mockRedis.eval as Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const startTime = Date.now();
      const fn = vi.fn().mockResolvedValue('success');

      await lockService.withLock('test-key', fn, {
        retries: 3,
        retryDelay: 100,
        exponentialBackoff: true,
      });

      const elapsed = Date.now() - startTime;

      // Should wait: 100ms (1st retry) + 200ms (2nd retry) = 300ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(250); // Allow some tolerance
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use constant delay when exponentialBackoff is false', async () => {
      (mockRedis.eval as Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const startTime = Date.now();
      const fn = vi.fn().mockResolvedValue('success');

      await lockService.withLock('test-key', fn, {
        retries: 3,
        retryDelay: 100,
        exponentialBackoff: false,
      });

      const elapsed = Date.now() - startTime;

      // Should wait: 100ms + 100ms = 200ms
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(350); // Should not be exponential
    });

    it('should throw error after all retries fail', async () => {
      (mockRedis.eval as Mock).mockResolvedValue(null); // Always fail

      const fn = vi.fn();

      await expect(lockService.withLock('test-key', fn, { retries: 3, retryDelay: 10 })).rejects.toThrow(
        'Failed to acquire lock for key: test-key after 3 retries'
      );

      expect(fn).not.toHaveBeenCalled();
      expect(mockRedis.eval).toHaveBeenCalledTimes(3);
    });

    it('should skip execution when skipOnLockFailure is true', async () => {
      (mockRedis.eval as Mock).mockResolvedValue(null); // Lock fails

      const fn = vi.fn().mockResolvedValue('success');
      const result = await lockService.withLock('test-key', fn, {
        retries: 2,
        retryDelay: 10,
        skipOnLockFailure: true,
      });

      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
      expect(mockLogger.logger.debug).toHaveBeenCalledWith(
        { key: 'test-key', retries: 2 },
        '[DistributedLock] Lock acquisition failed, skipping'
      );
    });

    it('should use default options when not specified', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('success');
      await lockService.withLock('test-key', fn);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:test-key',
        expect.any(String),
        '30000' // Default TTL
      );
    });

    it('should use custom TTL when specified', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('success');
      await lockService.withLock('test-key', fn, { ttl: 5000 });

      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:test-key', expect.any(String), '5000');
    });

    it('should propagate return value from function', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const complexResult = { data: 'test', count: 42, nested: { value: true } };
      const fn = vi.fn().mockResolvedValue(complexResult);
      const result = await lockService.withLock('test-key', fn);

      expect(result).toEqual(complexResult);
    });

    it('should handle async function that returns primitive values', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const numberFn = vi.fn().mockResolvedValue(123);
      const stringFn = vi.fn().mockResolvedValue('test');
      const boolFn = vi.fn().mockResolvedValue(true);
      const nullFn = vi.fn().mockResolvedValue(null);

      expect(await lockService.withLock('key1', numberFn)).toBe(123);
      expect(await lockService.withLock('key2', stringFn)).toBe('test');
      expect(await lockService.withLock('key3', boolFn)).toBe(true);
      expect(await lockService.withLock('key4', nullFn)).toBe(null);
    });

    it('should handle concurrent withLock calls on different keys', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn1 = vi.fn().mockResolvedValue('result1');
      const fn2 = vi.fn().mockResolvedValue('result2');
      const fn3 = vi.fn().mockResolvedValue('result3');

      const [r1, r2, r3] = await Promise.all([
        lockService.withLock('key1', fn1),
        lockService.withLock('key2', fn2),
        lockService.withLock('key3', fn3),
      ]);

      expect(r1).toBe('result1');
      expect(r2).toBe('result2');
      expect(r3).toBe('result3');
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(fn3).toHaveBeenCalledTimes(1);
    });
  });

  describe('isLocked', () => {
    it('should return true when key is locked', async () => {
      (mockRedis.exists as Mock).mockResolvedValue(1);

      const result = await lockService.isLocked('test-key');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('lock:test-key');
    });

    it('should return false when key is not locked', async () => {
      (mockRedis.exists as Mock).mockResolvedValue(0);

      const result = await lockService.isLocked('test-key');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      const redisError = new Error('Redis error');
      (mockRedis.exists as Mock).mockRejectedValue(redisError);

      const result = await lockService.isLocked('test-key');

      expect(result).toBe(false);
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        { key: 'test-key', error: redisError },
        '[DistributedLock] Failed to check lock status'
      );
    });

    it('should handle empty key', async () => {
      (mockRedis.exists as Mock).mockResolvedValue(0);

      const result = await lockService.isLocked('');

      expect(result).toBe(false);
      expect(mockRedis.exists).toHaveBeenCalledWith('lock:');
    });

    it('should handle special characters in key', async () => {
      (mockRedis.exists as Mock).mockResolvedValue(1);

      const specialKey = 'key:with:special-chars_123';
      const result = await lockService.isLocked(specialKey);

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith(`lock:${specialKey}`);
    });
  });

  describe('getLockTtl', () => {
    it('should return TTL in milliseconds for existing lock', async () => {
      (mockRedis.pttl as Mock).mockResolvedValue(15000);

      const ttl = await lockService.getLockTtl('test-key');

      expect(ttl).toBe(15000);
      expect(mockRedis.pttl).toHaveBeenCalledWith('lock:test-key');
    });

    it('should return -1 when key exists but has no TTL', async () => {
      (mockRedis.pttl as Mock).mockResolvedValue(-1);

      const ttl = await lockService.getLockTtl('test-key');

      expect(ttl).toBe(-1);
    });

    it('should return -2 when key does not exist', async () => {
      (mockRedis.pttl as Mock).mockResolvedValue(-2);

      const ttl = await lockService.getLockTtl('test-key');

      expect(ttl).toBe(-2);
    });

    it('should return -2 on Redis error', async () => {
      const redisError = new Error('Redis error');
      (mockRedis.pttl as Mock).mockRejectedValue(redisError);

      const ttl = await lockService.getLockTtl('test-key');

      expect(ttl).toBe(-2);
      expect(mockLogger.logger.error).toHaveBeenCalledWith(
        { key: 'test-key', error: redisError },
        '[DistributedLock] Failed to get lock TTL'
      );
    });

    it('should handle empty key', async () => {
      (mockRedis.pttl as Mock).mockResolvedValue(-2);

      const ttl = await lockService.getLockTtl('');

      expect(ttl).toBe(-2);
      expect(mockRedis.pttl).toHaveBeenCalledWith('lock:');
    });

    it('should handle special characters in key', async () => {
      (mockRedis.pttl as Mock).mockResolvedValue(5000);

      const specialKey = 'key:with:colons/slashes\\backslashes';
      const ttl = await lockService.getLockTtl(specialKey);

      expect(ttl).toBe(5000);
      expect(mockRedis.pttl).toHaveBeenCalledWith(`lock:${specialKey}`);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle very large TTL values', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const largeTtl = Number.MAX_SAFE_INTEGER;
      const lockId = await lockService.acquireLock('test-key', largeTtl);

      expect(lockId).toBeTruthy();
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:test-key',
        expect.any(String),
        String(largeTtl)
      );
    });

    it('should handle Unicode characters in key', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const unicodeKey = 'test-key-你好-مرحبا-🔒';
      const lockId = await lockService.acquireLock(unicodeKey, 5000);

      expect(lockId).toBeTruthy();
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `lock:${unicodeKey}`,
        expect.any(String),
        '5000'
      );
    });

    it('should handle very long key names', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');

      const longKey = 'a'.repeat(1000);
      const lockId = await lockService.acquireLock(longKey, 5000);

      expect(lockId).toBeTruthy();
      expect(mockRedis.eval).toHaveBeenCalledWith(expect.any(String), 1, `lock:${longKey}`, expect.any(String), '5000');
    });

    it('should handle rapid acquire and release cycles', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      for (let i = 0; i < 10; i++) {
        const lockId = await lockService.acquireLock(`key-${i}`, 5000);
        expect(lockId).toBeTruthy();
        const released = await lockService.releaseLock(`key-${i}`, lockId as string);
        expect(released).toBe(true);
      }

      expect(mockRedis.eval).toHaveBeenCalledTimes(10);
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(10);
    });

    it('should handle function that returns undefined', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue(undefined);
      const result = await lockService.withLock('test-key', fn);

      expect(result).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle synchronous function wrapped in async', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn(async () => 'sync-result');
      const result = await lockService.withLock('test-key', fn);

      expect(result).toBe('sync-result');
    });

    it('should maintain lock key prefix consistency', async () => {
      const customPrefix = 'my-app:locks';
      const customOptions = { ...defaultOptions, keyPrefix: customPrefix };
      const customService = new DistributedLockService(mockRedis, mockLogger, customOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);
      (mockRedis.exists as Mock).mockResolvedValue(1);
      (mockRedis.pttl as Mock).mockResolvedValue(5000);

      const lockId = await customService.acquireLock('test', 5000);
      await customService.releaseLock('test', lockId as string);
      await customService.isLocked('test');
      await customService.getLockTtl('test');

      const allCalls = [
        ...(mockRedis.eval as Mock).mock.calls,
        ...(mockRedis.evalsha as Mock).mock.calls,
        ...(mockRedis.exists as Mock).mock.calls,
        ...(mockRedis.pttl as Mock).mock.calls,
      ];

      allCalls.forEach((call) => {
        const keyArg = call.find((arg: any) => typeof arg === 'string' && arg.startsWith(customPrefix));
        if (keyArg) {
          expect(keyArg).toBe(`${customPrefix}:test`);
        }
      });
    });

    it('should handle options with missing optional fields', async () => {
      const minimalOptions: ILockModuleOptions = {};
      const minimalService = new DistributedLockService(mockRedis, mockLogger, minimalOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn().mockResolvedValue('success');
      const result = await minimalService.withLock('test-key', fn);

      expect(result).toBe('success');
      // Should use default values
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringContaining('lock:'), // Default prefix
        expect.any(String),
        '30000' // Default TTL
      );
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete lock lifecycle', async () => {
      // Setup
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);
      (mockRedis.exists as Mock).mockResolvedValue(1);
      (mockRedis.pttl as Mock).mockResolvedValue(5000);

      // Acquire
      const lockId = await lockService.acquireLock('lifecycle-test', 10000);
      expect(lockId).toBeTruthy();

      // Check if locked
      const isLocked = await lockService.isLocked('lifecycle-test');
      expect(isLocked).toBe(true);

      // Get TTL
      const ttl = await lockService.getLockTtl('lifecycle-test');
      expect(ttl).toBe(5000);

      // Extend
      const extended = await lockService.extendLock('lifecycle-test', lockId as string, 15000);
      expect(extended).toBe(true);

      // Release
      const released = await lockService.releaseLock('lifecycle-test', lockId as string);
      expect(released).toBe(true);
    });

    it('should handle withLock with lock extension during execution', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const fn = vi.fn(async () => {
        // Simulate long-running task that needs lock extension
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Try to extend lock during execution
        const extended = await lockService.extendLock('test-key', 'current-lock-id', 10000);

        return { completed: true, extended };
      });

      const result = await lockService.withLock('test-key', fn);

      expect(result).toEqual({ completed: true, extended: true });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle nested withLock calls on different keys', async () => {
      (mockRedis.eval as Mock).mockResolvedValue('OK');
      (mockRedis.evalsha as Mock).mockResolvedValue(1);

      const innerFn = vi.fn().mockResolvedValue('inner-result');
      const outerFn = vi.fn(async () => {
        const innerResult = await lockService.withLock('inner-key', innerFn);
        return `outer-${innerResult}`;
      });

      const result = await lockService.withLock('outer-key', outerFn);

      expect(result).toBe('outer-inner-result');
      expect(outerFn).toHaveBeenCalledTimes(1);
      expect(innerFn).toHaveBeenCalledTimes(1);
      expect(mockRedis.eval).toHaveBeenCalledTimes(2); // Two acquires
      expect(mockRedis.evalsha).toHaveBeenCalledTimes(2); // Two releases
    });
  });
});
