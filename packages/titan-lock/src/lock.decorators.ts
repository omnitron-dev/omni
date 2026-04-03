/* eslint-disable func-names */
/**
 * Lock Module Decorators
 *
 * Method decorators for distributed lock protection.
 *
 * @module titan/modules/lock
 */

import type { IWithDistributedLockContext } from './lock.types.js';

/**
 * Decorator that wraps a method with distributed lock protection.
 *
 * The decorated method will:
 * 1. Attempt to acquire a distributed lock
 * 2. Execute only if lock is acquired
 * 3. Skip execution if lock is already held (another instance is running)
 * 4. Always release the lock after execution (even on error)
 *
 * Requirements:
 * - The class must have __lockService__ property injected
 * - Optionally have logger or loggerModule for debug logging
 *
 * @param lockKey - Lock key (e.g., 'my-task:process')
 * @param ttlMs - Lock TTL in milliseconds (default: 60000)
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * class ScheduledTasksService {
 *   constructor(
 *     @Inject(LOCK_SERVICE_TOKEN) private readonly __lockService__: IDistributedLockService,
 *     @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule
 *   ) {}
 *
 *   @Cron(CronExpression.EVERY_30_SECONDS)
 *   @WithDistributedLock('my-task', 25000)
 *   async processTask() {
 *     // Only one instance will execute this at a time
 *   }
 * }
 * ```
 */
export function WithDistributedLock(lockKey: string, ttlMs: number = 60000): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    if (typeof originalMethod !== 'function') {
      throw new Error('@WithDistributedLock can only be applied to methods');
    }

    // Replace the method with a lock-protected version
    descriptor.value = async function (this: IWithDistributedLockContext, ...args: unknown[]): Promise<unknown> {
      const lockService = this.__lockService__;

      if (!lockService) {
        const constructorName = (target.constructor as { name?: string }).name ?? 'unknown';
        throw new Error(
          `DistributedLockService not found on ${constructorName}. ` +
            'Ensure the service is injected as __lockService__ with @Inject(LOCK_SERVICE_TOKEN).'
        );
      }

      // Try to acquire the lock
      const lockId = await lockService.acquireLock(lockKey, ttlMs);

      if (!lockId) {
        // Lock is held by another instance, skip execution
        const logger = this.logger ?? this.loggerModule?.logger;
        if (logger) {
          logger.debug(
            { lockKey, method: propertyKey.toString() },
            '[WithDistributedLock] Lock held by another instance, skipping'
          );
        }
        return undefined;
      }

      try {
        // Execute the original method
        return await originalMethod.apply(this, args);
      } finally {
        // Always release the lock
        await lockService.releaseLock(lockKey, lockId);
      }
    };

    return descriptor;
  };
}

/**
 * Alias for WithDistributedLock for shorter usage
 */
export const Lock = WithDistributedLock;
