/**
 * Lock Module
 *
 * Redis-based distributed locking for horizontal scaling.
 *
 * @module titan/modules/lock
 * @example
 * ```typescript
 * import { LockModule, LOCK_SERVICE_TOKEN, WithDistributedLock } from '@omnitron-dev/titan/module/lock';
 * ```
 */

export * from './lock.types.js';
export * from './lock.tokens.js';
export * from './lock.service.js';
export * from './lock.decorators.js';
export * from './lock.module.js';
