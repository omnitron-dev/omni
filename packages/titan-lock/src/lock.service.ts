/**
 * Distributed Lock Service
 *
 * Redis-based distributed locking for horizontal scaling.
 * Ensures only one instance executes critical sections.
 *
 * Features:
 * - Atomic lock acquisition using SET NX PX
 * - Lua scripts for safe release and extension
 * - UUID-based lock ownership
 * - Retry with exponential backoff
 * - Script SHA caching for performance
 *
 * @module titan/modules/lock
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { InjectRedis, type IRedisClient } from '@omnitron-dev/titan-redis';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import type { IDistributedLockService, ILockModuleOptions, IWithLockOptions } from './lock.types.js';
import { LOCK_OPTIONS_TOKEN, DEFAULT_LOCK_PREFIX } from './lock.tokens.js';

/**
 * Lua script for safe lock release.
 * Only releases the lock if the current value matches the provided lock ID.
 *
 * KEYS[1] = lock key
 * ARGV[1] = lock ID (UUID)
 * Returns: 1 if deleted, 0 if not owned
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Lua script for safe lock extension.
 * Only extends the TTL if the current value matches the provided lock ID.
 *
 * KEYS[1] = lock key
 * ARGV[1] = lock ID (UUID)
 * ARGV[2] = TTL in milliseconds
 * Returns: 1 if extended, 0 if not owned
 */
const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * Default options for lock service
 */
const DEFAULT_OPTIONS: Required<Omit<ILockModuleOptions, 'redisClientName' | 'isGlobal'>> = {
  defaultTtl: 30000,
  keyPrefix: DEFAULT_LOCK_PREFIX,
  defaultRetries: 3,
  defaultRetryDelay: 100,
};

/**
 * Distributed Lock Service
 *
 * Provides Redis-based distributed locking with:
 * - Atomic operations using Lua scripts
 * - UUID-based ownership verification
 * - Retry support with exponential backoff
 * - TTL extension for long-running tasks
 *
 * @example
 * ```typescript
 * // Simple lock acquisition
 * const lockId = await lockService.acquireLock('my-task', 30000);
 * if (lockId) {
 *   try {
 *     await doWork();
 *   } finally {
 *     await lockService.releaseLock('my-task', lockId);
 *   }
 * }
 *
 * // Using withLock helper (recommended)
 * await lockService.withLock('my-task', async () => {
 *   await doWork();
 * }, { ttl: 30000, retries: 3 });
 * ```
 */
@Injectable()
export class DistributedLockService implements IDistributedLockService {
  private _releaseLockSha: Promise<string> | null = null;
  private _extendLockSha: Promise<string> | null = null;
  private readonly options: Required<Omit<ILockModuleOptions, 'redisClientName' | 'isGlobal'>>;

  constructor(
    @InjectRedis() private readonly redis: IRedisClient,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
    @Inject(LOCK_OPTIONS_TOKEN) options: ILockModuleOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Lazily load Lua scripts on first use */
  private get releaseLockSha(): Promise<string> {
    if (!this._releaseLockSha) this._releaseLockSha = this.loadScript(RELEASE_LOCK_SCRIPT);
    return this._releaseLockSha;
  }

  private get extendLockSha(): Promise<string> {
    if (!this._extendLockSha) this._extendLockSha = this.loadScript(EXTEND_LOCK_SCRIPT);
    return this._extendLockSha;
  }

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Load a Lua script and return its SHA1 hash.
   * Scripts are cached on the Redis server for efficient execution.
   */
  private async loadScript(script: string): Promise<string> {
    try {
      const sha = await this.redis.script('LOAD', script);
      return sha;
    } catch (error) {
      this.logger.error({ error }, '[DistributedLock] Failed to load Lua script');
      throw error;
    }
  }

  /**
   * Acquire a distributed lock with TTL.
   *
   * Uses SET key value NX PX milliseconds for atomic acquisition.
   *
   * @param key - Lock key (will be prefixed)
   * @param ttlMs - Time-to-live in milliseconds
   * @returns Lock ID (UUID) if acquired, null if lock is already held
   */
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const lockId = generateUuidV7();
    const lockKey = this.getLockKey(key);

    try {
      // SET key value NX PX milliseconds
      const result = (await this.redis.eval(
        `return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])`,
        1,
        lockKey,
        lockId,
        ttlMs.toString()
      )) as string | null;

      if (result === 'OK') {
        this.logger.debug({ key, lockId, ttlMs }, '[DistributedLock] Lock acquired');
        return lockId;
      }

      this.logger.debug({ key }, '[DistributedLock] Lock already held');
      return null;
    } catch (error) {
      this.logger.error({ key, error }, '[DistributedLock] Failed to acquire lock');
      return null;
    }
  }

  /**
   * Release a distributed lock.
   * Only succeeds if the caller owns the lock (lockId matches).
   *
   * Uses Lua script for atomic compare-and-delete.
   *
   * @param key - Lock key
   * @param lockId - Lock ID from acquireLock()
   * @returns true if released, false if not owned or already released
   */
  async releaseLock(key: string, lockId: string): Promise<boolean> {
    const lockKey = this.getLockKey(key);

    try {
      const sha = await this.releaseLockSha;
      const result = (await this.redis.evalsha(sha, 1, lockKey, lockId)) as number;

      if (result === 1) {
        this.logger.debug({ key, lockId }, '[DistributedLock] Lock released');
        return true;
      }

      this.logger.debug({ key, lockId }, '[DistributedLock] Lock not owned or already released');
      return false;
    } catch (error) {
      this.logger.error({ key, lockId, error }, '[DistributedLock] Failed to release lock');
      return false;
    }
  }

  /**
   * Extend the TTL of a distributed lock.
   * Only succeeds if the caller owns the lock (lockId matches).
   *
   * Useful for long-running tasks that need to maintain the lock.
   *
   * @param key - Lock key
   * @param lockId - Lock ID from acquireLock()
   * @param ttlMs - New TTL in milliseconds
   * @returns true if extended, false if not owned
   */
  async extendLock(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    const lockKey = this.getLockKey(key);

    try {
      const sha = await this.extendLockSha;
      const result = (await this.redis.evalsha(sha, 1, lockKey, lockId, ttlMs.toString())) as number;

      if (result === 1) {
        this.logger.debug({ key, lockId, ttlMs }, '[DistributedLock] Lock extended');
        return true;
      }

      this.logger.debug({ key, lockId }, '[DistributedLock] Lock not owned, cannot extend');
      return false;
    } catch (error) {
      this.logger.error({ key, lockId, error }, '[DistributedLock] Failed to extend lock');
      return false;
    }
  }

  /**
   * Execute a function with distributed lock protection.
   * Automatically acquires and releases the lock, with retry support.
   *
   * @param key - Lock key
   * @param fn - Function to execute under lock
   * @param options - Lock options (ttl, retries, retryDelay, skipOnLockFailure)
   * @returns Function result
   * @throws Error if lock cannot be acquired after retries (unless skipOnLockFailure is true)
   */
  async withLock<T>(key: string, fn: () => Promise<T>, options?: IWithLockOptions): Promise<T> {
    const ttl = options?.ttl ?? this.options.defaultTtl;
    const retries = options?.retries ?? this.options.defaultRetries;
    const retryDelay = options?.retryDelay ?? this.options.defaultRetryDelay;
    const exponentialBackoff = options?.exponentialBackoff ?? true;
    const skipOnLockFailure = options?.skipOnLockFailure ?? false;

    for (let i = 0; i < retries; i++) {
      const lockId = await this.acquireLock(key, ttl);

      if (lockId) {
        try {
          return await fn();
        } finally {
          await this.releaseLock(key, lockId);
        }
      }

      // If not the last retry, wait before trying again
      if (i < retries - 1) {
        const delay = exponentialBackoff ? retryDelay * (i + 1) : retryDelay;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (skipOnLockFailure) {
      this.logger.debug({ key, retries }, '[DistributedLock] Lock acquisition failed, skipping');
      return undefined as T;
    }

    throw new Error(`Failed to acquire lock for key: ${key} after ${retries} retries`);
  }

  /**
   * Check if a key is currently locked.
   *
   * @param key - Lock key
   * @returns true if locked
   */
  async isLocked(key: string): Promise<boolean> {
    const lockKey = this.getLockKey(key);
    try {
      const result = await this.redis.exists(lockKey);
      return result === 1;
    } catch (error) {
      this.logger.error({ key, error }, '[DistributedLock] Failed to check lock status');
      return false;
    }
  }

  /**
   * Get the remaining TTL of a lock.
   *
   * @param key - Lock key
   * @returns TTL in milliseconds, -1 if no TTL, -2 if not exists
   */
  async getLockTtl(key: string): Promise<number> {
    const lockKey = this.getLockKey(key);
    try {
      return await this.redis.pttl(lockKey);
    } catch (error) {
      this.logger.error({ key, error }, '[DistributedLock] Failed to get lock TTL');
      return -2;
    }
  }

  /**
   * Get namespaced lock key.
   * Prevents collisions with other Redis keys.
   */
  private getLockKey(key: string): string {
    return `${this.options.keyPrefix}:${key}`;
  }
}
