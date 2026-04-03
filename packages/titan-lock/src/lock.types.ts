/**
 * Lock Module Type Definitions
 *
 * Interfaces and types for distributed locking.
 *
 * @module titan/modules/lock
 */

import type { InjectionToken, DynamicModule } from '@omnitron-dev/titan/nexus';

/**
 * Options for lock acquisition
 */
export interface ILockOptions {
  /** Time-to-live in milliseconds (default: 30000) */
  ttl?: number;
  /** Number of retry attempts (default: 3) */
  retries?: number;
  /** Base delay between retries in ms (default: 100) */
  retryDelay?: number;
  /** Whether to use exponential backoff for retries (default: true) */
  exponentialBackoff?: boolean;
}

/**
 * Options for withLock helper
 */
export interface IWithLockOptions extends ILockOptions {
  /** Skip execution instead of throwing when lock cannot be acquired (default: false) */
  skipOnLockFailure?: boolean;
}

/**
 * Lock acquisition result
 */
export interface ILockHandle {
  /** Unique lock identifier (UUID) */
  lockId: string;
  /** Lock key */
  key: string;
  /** TTL in milliseconds */
  ttlMs: number;
  /** Timestamp when lock was acquired */
  acquiredAt: number;
}

/**
 * Distributed lock service interface
 */
export interface IDistributedLockService {
  /**
   * Acquire a distributed lock with TTL
   * @param key - Lock key
   * @param ttlMs - Time-to-live in milliseconds
   * @returns Lock ID (UUID) if acquired, null if lock is already held
   */
  acquireLock(key: string, ttlMs: number): Promise<string | null>;

  /**
   * Release a distributed lock
   * @param key - Lock key
   * @param lockId - Lock ID from acquireLock()
   * @returns true if released, false if not owned
   */
  releaseLock(key: string, lockId: string): Promise<boolean>;

  /**
   * Extend the TTL of a distributed lock
   * @param key - Lock key
   * @param lockId - Lock ID from acquireLock()
   * @param ttlMs - New TTL in milliseconds
   * @returns true if extended, false if not owned
   */
  extendLock(key: string, lockId: string, ttlMs: number): Promise<boolean>;

  /**
   * Execute a function with distributed lock protection
   * @param key - Lock key
   * @param fn - Function to execute under lock
   * @param options - Lock options
   * @returns Function result or undefined if skipped
   */
  withLock<T>(key: string, fn: () => Promise<T>, options?: IWithLockOptions): Promise<T>;

  /**
   * Check if a key is currently locked
   * @param key - Lock key
   * @returns true if locked
   */
  isLocked(key: string): Promise<boolean>;

  /**
   * Get the remaining TTL of a lock
   * @param key - Lock key
   * @returns TTL in milliseconds, -1 if no TTL, -2 if not exists
   */
  getLockTtl(key: string): Promise<number>;
}

/**
 * Lock module options
 */
export interface ILockModuleOptions {
  /** Default TTL for locks in milliseconds (default: 30000) */
  defaultTtl?: number;
  /** Key prefix for lock keys (default: 'lock') */
  keyPrefix?: string;
  /** Default number of retries (default: 3) */
  defaultRetries?: number;
  /** Default retry delay in ms (default: 100) */
  defaultRetryDelay?: number;
  /** Redis client name if using named Redis instances */
  redisClientName?: string;
  /** Register as global module (default: false) */
  isGlobal?: boolean;
}

/**
 * Async options for lock module
 */
export interface ILockModuleAsyncOptions {
  /** Module imports */
  imports?: DynamicModule['imports'];
  /** Factory function to create options */
  useFactory?: (...args: unknown[]) => Promise<ILockModuleOptions> | ILockModuleOptions;
  /** Injection tokens to inject into factory */
  inject?: InjectionToken<unknown>[];
  /** Register as global module */
  isGlobal?: boolean;
}

/**
 * Context interface for WithDistributedLock decorator
 */
export interface IWithDistributedLockContext {
  __lockService__?: IDistributedLockService;
  logger?: {
    debug: (obj: Record<string, unknown>, msg: string) => void;
  };
  loggerModule?: {
    logger: {
      debug: (obj: Record<string, unknown>, msg: string) => void;
    };
  };
}
