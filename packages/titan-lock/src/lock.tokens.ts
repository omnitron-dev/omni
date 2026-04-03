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
 * Default lock key prefix
 */
export const DEFAULT_LOCK_PREFIX = 'lock';
