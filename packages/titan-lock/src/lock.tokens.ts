/**
 * Lock Module DI Tokens
 *
 * Injection tokens for the distributed lock module.
 *
 * @module titan/modules/lock
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { IDistributedLockService, ILockModuleOptions } from './lock.types.js';

/**
 * Token for the lock service
 */
export const LOCK_SERVICE_TOKEN: Token<IDistributedLockService> =
  createToken<IDistributedLockService>('DistributedLockService');

/**
 * Token for lock module options
 */
export const LOCK_OPTIONS_TOKEN: Token<ILockModuleOptions> = createToken<ILockModuleOptions>('LockModuleOptions');

/**
 * Token for the Redis client the lock service uses.
 *
 * Exists so `redisClientName` can take effect. The service used to take its
 * client from `@InjectRedis()`, a decorator evaluated when the class is
 * defined, which can never consult a runtime option — so a deployment with
 * named Redis instances that pointed the lock module at one of them silently
 * got the default client, and its locks lived in a different Redis than
 * configured.
 */
export const LOCK_REDIS_TOKEN: Token<unknown> = createToken<unknown>('LockRedisClient');

/**
 * Default lock key prefix
 */
export const DEFAULT_LOCK_PREFIX = 'lock';
