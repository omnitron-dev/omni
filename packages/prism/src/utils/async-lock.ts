/**
 * AsyncLock Utility
 *
 * Prevents race conditions in async operations like token refresh.
 * Ensures only one operation runs at a time, with subsequent calls
 * waiting for and sharing the result of the in-flight operation.
 *
 * @module @omnitron-dev/prism/utils
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for AsyncLock.
 */
export interface AsyncLockOptions {
  /** Timeout in milliseconds for the lock acquisition (default: 30000) */
  timeout?: number;
  /** Custom error message for timeout */
  timeoutMessage?: string;
}

/**
 * Result from a locked operation.
 */
export interface AsyncLockResult<T> {
  /** The result value */
  value: T;
  /** Whether this call executed the operation (vs waiting for another) */
  wasExecutor: boolean;
}

/**
 * State of the lock.
 */
export type AsyncLockState = 'idle' | 'locked' | 'releasing';

// =============================================================================
// ASYNC LOCK CLASS
// =============================================================================

/**
 * AsyncLock prevents race conditions in concurrent async operations.
 *
 * Use cases:
 * - Token refresh: Multiple API calls fail simultaneously, only one should refresh
 * - Resource initialization: Expensive setup should happen once
 * - Cache population: Prevent thundering herd problem
 *
 * @example
 * ```tsx
 * import { AsyncLock } from '@omnitron-dev/prism/utils';
 *
 * const tokenRefreshLock = new AsyncLock({ timeout: 10000 });
 *
 * async function refreshToken(): Promise<string> {
 *   const { value: newToken } = await tokenRefreshLock.acquire(
 *     'refresh-token',
 *     async () => {
 *       // This only runs once even if called concurrently
 *       const response = await fetch('/auth/refresh', { method: 'POST' });
 *       const data = await response.json();
 *       return data.accessToken;
 *     }
 *   );
 *   return newToken;
 * }
 *
 * // Multiple concurrent calls share the same result
 * const [token1, token2, token3] = await Promise.all([
 *   refreshToken(), // Executes the actual refresh
 *   refreshToken(), // Waits for first to complete
 *   refreshToken(), // Waits for first to complete
 * ]);
 * // token1 === token2 === token3
 * ```
 */
export class AsyncLock {
  private locks: Map<string, Promise<unknown>> = new Map();
  private resolvers: Map<string, (value: unknown) => void> = new Map();
  private rejecters: Map<string, (error: unknown) => void> = new Map();
  private options: Required<AsyncLockOptions>;

  constructor(options: AsyncLockOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30000,
      timeoutMessage: options.timeoutMessage ?? 'Lock acquisition timed out',
    };
  }

  /**
   * Current state of a specific lock.
   */
  getState(key: string): AsyncLockState {
    return this.locks.has(key) ? 'locked' : 'idle';
  }

  /**
   * Check if a specific lock is currently held.
   */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /**
   * Get all currently active lock keys.
   */
  getActiveLocks(): string[] {
    return Array.from(this.locks.keys());
  }

  /**
   * Acquire the lock and execute the operation.
   * If the lock is already held, waits for the existing operation.
   *
   * @param key - Unique identifier for this lock
   * @param operation - Async operation to execute
   * @returns Result with the value and whether this call was the executor
   */
  async acquire<T>(key: string, operation: () => Promise<T>): Promise<AsyncLockResult<T>> {
    // If lock exists, wait for it
    const existingLock = this.locks.get(key);
    if (existingLock) {
      const value = await this.waitWithTimeout(existingLock, key);
      return { value: value as T, wasExecutor: false };
    }

    // Create new lock
    let resolvePromise: (value: unknown) => void;
    let rejectPromise: (error: unknown) => void;

    const lockPromise = new Promise<unknown>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.locks.set(key, lockPromise);
    this.resolvers.set(key, resolvePromise!);
    this.rejecters.set(key, rejectPromise!);

    try {
      const result = await operation();

      // Resolve for all waiters
      const resolver = this.resolvers.get(key);
      if (resolver) {
        resolver(result);
      }

      return { value: result, wasExecutor: true };
    } catch (error) {
      // Reject for all waiters
      const rejecter = this.rejecters.get(key);
      if (rejecter) {
        rejecter(error);
      }

      throw error;
    } finally {
      // Clean up
      this.locks.delete(key);
      this.resolvers.delete(key);
      this.rejecters.delete(key);
    }
  }

  /**
   * Try to acquire the lock without waiting.
   * Returns immediately if lock is held.
   *
   * @param key - Unique identifier for this lock
   * @param operation - Async operation to execute
   * @returns Result or null if lock was already held
   */
  async tryAcquire<T>(key: string, operation: () => Promise<T>): Promise<AsyncLockResult<T> | null> {
    if (this.isLocked(key)) {
      return null;
    }
    return this.acquire(key, operation);
  }

  /**
   * Force release a lock (use with caution).
   * This will reject all waiters with the provided error.
   */
  forceRelease(key: string, error?: Error): void {
    const rejecter = this.rejecters.get(key);
    if (rejecter) {
      rejecter(error ?? new Error('Lock forcefully released'));
    }
    this.locks.delete(key);
    this.resolvers.delete(key);
    this.rejecters.delete(key);
  }

  /**
   * Clear all locks (use with caution, e.g., on logout).
   */
  clearAll(error?: Error): void {
    for (const key of this.locks.keys()) {
      this.forceRelease(key, error);
    }
  }

  /**
   * Wait for a promise with timeout.
   */
  private async waitWithTimeout<T>(promise: Promise<T>, key: string): Promise<T> {
    const { timeout, timeoutMessage } = this.options;

    if (timeout <= 0) {
      return promise;
    }

    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new AsyncLockTimeoutError(`${timeoutMessage} (key: ${key})`));
        }, timeout);
      }),
    ]);
  }
}

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Error thrown when lock acquisition times out.
 */
export class AsyncLockTimeoutError extends Error {
  readonly name = 'AsyncLockTimeoutError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AsyncLockTimeoutError.prototype);
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a singleton AsyncLock instance for a specific use case.
 *
 * @example
 * ```tsx
 * import { createAsyncLock } from '@omnitron-dev/prism/utils';
 *
 * // Create a singleton lock for token refresh
 * const tokenLock = createAsyncLock({ timeout: 10000 });
 *
 * // Use in multiple places - same lock instance
 * async function apiCall() {
 *   if (isTokenExpired()) {
 *     await tokenLock.acquire('token', refreshToken);
 *   }
 *   // Make API call...
 * }
 * ```
 */
export function createAsyncLock(options?: AsyncLockOptions): AsyncLock {
  return new AsyncLock(options);
}

/**
 * Create a pre-configured lock for token refresh operations.
 * Uses sensible defaults for auth token refresh scenarios.
 */
export function createTokenRefreshLock(): AsyncLock {
  return new AsyncLock({
    timeout: 15000,
    timeoutMessage: 'Token refresh timed out',
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Execute an operation with automatic locking.
 * Convenience function for one-off locked operations.
 *
 * @example
 * ```tsx
 * import { withLock } from '@omnitron-dev/prism/utils';
 *
 * const result = await withLock('init-cache', async () => {
 *   const data = await fetchData();
 *   cache.set('data', data);
 *   return data;
 * });
 * ```
 */
const globalLock = new AsyncLock();

export async function withLock<T>(key: string, operation: () => Promise<T>, options?: AsyncLockOptions): Promise<T> {
  const lock = options ? new AsyncLock(options) : globalLock;
  const { value } = await lock.acquire(key, operation);
  return value;
}

/**
 * Decorator factory for methods that should be locked.
 * Use with class methods to ensure single execution.
 *
 * @example
 * ```tsx
 * import { locked } from '@omnitron-dev/prism/utils';
 *
 * class AuthService {
 *   @locked('refresh')
 *   async refreshToken(): Promise<string> {
 *     // Only one instance runs at a time
 *     return await this.doRefresh();
 *   }
 * }
 * ```
 */
export function locked(key: string, options?: AsyncLockOptions) {
  const lock = new AsyncLock(options);

  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: object,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;

    if (!originalMethod) {
      return descriptor;
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const { value } = await lock.acquire(key, () => originalMethod.apply(this, args));
      return value;
    } as T;

    return descriptor;
  };
}
