/**
 * Optimistic Update Helper
 * @module store/optimistic
 *
 * Provides optimistic update wrapper for mutations with automatic rollback.
 * Applies updates immediately before server confirmation, rolls back on error.
 */

import type { OptimisticOptions, OptimisticMutation } from './types.js';
import { signal } from '../core/reactivity/signal.js';

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate retry delay
 */
function getRetryDelay(attempt: number, delay: number | ((attempt: number) => number) | undefined): number {
  if (delay === undefined) {
    // Exponential backoff: 100ms, 200ms, 400ms, 800ms...
    return Math.min(100 * Math.pow(2, attempt), 5000);
  }

  if (typeof delay === 'function') {
    return delay(attempt);
  }

  return delay;
}

/**
 * Create an optimistic mutation wrapper
 *
 * Wraps an async mutation function with optimistic update logic:
 * 1. Takes snapshot of current state
 * 2. Applies optimistic update immediately
 * 3. Executes mutation
 * 4. On success: calls onSuccess callback
 * 5. On error: rolls back to snapshot
 *
 * @param mutationFn - Async function to execute
 * @param options - Optimistic update configuration
 * @returns Wrapped mutation function with tracking
 *
 * @example
 * ```typescript
 * const users = signal<User[]>([]);
 *
 * const updateUser = optimistic(
 *   async (id: string, data: Partial<User>) => {
 *     const service = await netron.service<IUserService>('users');
 *     return await service.updateUser(id, data);
 *   },
 *   {
 *     update: (id, data) => {
 *       users.set(users().map(u => u.id === id ? { ...u, ...data } : u));
 *     },
 *     rollback: (snapshot) => {
 *       users.set(snapshot);
 *     },
 *     snapshot: () => users.peek(),
 *     onSuccess: (result) => {
 *       console.log('Update successful:', result);
 *     },
 *     onError: (error, snapshot) => {
 *       console.error('Update failed, rolling back:', error);
 *     },
 *     retry: {
 *       attempts: 3,
 *       delay: (attempt) => attempt * 1000
 *     }
 *   }
 * );
 *
 * // Usage
 * await updateUser('user-1', { name: 'Alice' });
 * ```
 */
export function optimistic<TArgs extends any[], TResult, TSnapshot = any>(
  mutationFn: (...args: TArgs) => Promise<TResult>,
  options: OptimisticOptions<TArgs, TResult, TSnapshot>
): OptimisticMutation<TArgs, TResult> {
  // Track mutation state
  const isPending = signal(false);
  const error = signal<Error | undefined>(undefined);

  // Default snapshot function
  const takeSnapshot = options.snapshot ?? (() => undefined as TSnapshot);

  const wrappedMutation = async (...args: TArgs): Promise<TResult> => {
    // Check if already pending
    if (isPending.peek()) {
      throw new Error('Mutation already in progress');
    }

    // Take snapshot before update
    const snapshot = takeSnapshot();

    // Apply optimistic update immediately
    try {
      options.update(...args);
    } catch (updateError) {
      console.error('Error applying optimistic update:', updateError);
      throw updateError;
    }

    // Mark as pending
    isPending.set(true);
    error.set(undefined);

    // Execute mutation with retry logic
    let lastError: Error | undefined;
    const maxAttempts = options.retry?.attempts ?? 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await mutationFn(...args);

        // Success - mark as complete
        isPending.set(false);

        // Check for conflicts if handler provided
        if (options.onConflict) {
          try {
            options.onConflict(snapshot, result);
          } catch (conflictError) {
            console.error('Error in conflict resolution:', conflictError);
          }
        }

        // Call success handler
        if (options.onSuccess) {
          try {
            options.onSuccess(result);
          } catch (successError) {
            console.error('Error in onSuccess handler:', successError);
          }
        }

        return result;
      } catch (err) {
        lastError = err as Error;

        // If not last attempt, wait before retry
        if (attempt < maxAttempts - 1) {
          const delay = getRetryDelay(attempt, options.retry?.delay);
          await sleep(delay);
          continue;
        }

        // All retries failed - rollback
        break;
      }
    }

    // Mutation failed - rollback
    isPending.set(false);
    error.set(lastError);

    // Call error handler before rollback
    if (options.onError && lastError) {
      try {
        options.onError(lastError, snapshot);
      } catch (errorHandlerError) {
        console.error('Error in onError handler:', errorHandlerError);
      }
    }

    // Perform rollback
    try {
      options.rollback(snapshot);
    } catch (rollbackError) {
      console.error('Error rolling back optimistic update:', rollbackError);
    }

    throw lastError;
  };

  // Add utility methods
  (wrappedMutation as any).isPending = () => isPending.peek();
  (wrappedMutation as any).getError = () => error.peek();
  (wrappedMutation as any).clearError = () => error.set(undefined);

  return wrappedMutation as OptimisticMutation<TArgs, TResult>;
}

/**
 * Create optimistic mutation with signal-based state
 *
 * Simpler variant that automatically handles snapshot/rollback for a signal.
 *
 * @param signal - Signal to update optimistically
 * @param mutationFn - Async mutation function
 * @param optimisticUpdate - Function to compute optimistic value
 * @param options - Additional options
 * @returns Wrapped mutation
 *
 * @example
 * ```typescript
 * const users = signal<User[]>([]);
 *
 * const updateUser = optimisticSignal(
 *   users,
 *   async (id: string, data: Partial<User>) => {
 *     const service = await netron.service<IUserService>('users');
 *     return await service.updateUser(id, data);
 *   },
 *   (current, id, data) => current.map(u => u.id === id ? { ...u, ...data } : u)
 * );
 *
 * await updateUser('user-1', { name: 'Alice' });
 * ```
 */
export function optimisticSignal<T, TArgs extends any[], TResult>(
  targetSignal: { peek(): T; set(value: T): void },
  mutationFn: (...args: TArgs) => Promise<TResult>,
  optimisticUpdate: (current: T, ...args: TArgs) => T,
  options?: Partial<OptimisticOptions<TArgs, TResult, T>>
): OptimisticMutation<TArgs, TResult> {
  return optimistic(mutationFn, {
    update: (...args: TArgs) => {
      const current = targetSignal.peek();
      const optimisticValue = optimisticUpdate(current, ...args);
      targetSignal.set(optimisticValue);
    },
    rollback: (snapshot: T) => {
      targetSignal.set(snapshot);
    },
    snapshot: () => targetSignal.peek(),
    ...options,
  });
}

/**
 * Create optimistic mutation with array operations
 *
 * Specialized helper for common array operations (add, update, delete).
 *
 * @param signal - Signal containing array
 * @param mutationFn - Async mutation function
 * @param operation - Operation type
 * @param options - Additional options
 * @returns Wrapped mutation
 *
 * @example
 * ```typescript
 * const users = signal<User[]>([]);
 *
 * // Optimistic add
 * const addUser = optimisticArray(
 *   users,
 *   async (user: User) => {
 *     const service = await netron.service<IUserService>('users');
 *     return await service.createUser(user);
 *   },
 *   'add'
 * );
 *
 * // Optimistic update
 * const updateUser = optimisticArray(
 *   users,
 *   async (id: string, data: Partial<User>) => {
 *     const service = await netron.service<IUserService>('users');
 *     return await service.updateUser(id, data);
 *   },
 *   'update',
 *   { idField: 'id' }
 * );
 *
 * // Optimistic delete
 * const deleteUser = optimisticArray(
 *   users,
 *   async (id: string) => {
 *     const service = await netron.service<IUserService>('users');
 *     await service.deleteUser(id);
 *   },
 *   'delete',
 *   { idField: 'id' }
 * );
 * ```
 */
export function optimisticArray<T, TArgs extends any[], TResult>(
  arraySignal: { peek(): T[]; set(value: T[]): void },
  mutationFn: (...args: TArgs) => Promise<TResult>,
  operation: 'add' | 'update' | 'delete',
  options?: Partial<OptimisticOptions<TArgs, TResult, T[]>> & {
    idField?: keyof T;
  }
): OptimisticMutation<TArgs, TResult> {
  const idField = (options?.idField ?? 'id') as keyof T;

  return optimistic(mutationFn, {
    update: (...args: TArgs) => {
      const current = arraySignal.peek();

      switch (operation) {
        case 'add':
          // Assume first arg is the item to add
          arraySignal.set([...current, args[0] as unknown as T]);
          break;

        case 'update': {
          // Assume first arg is ID, second is update data
          const [id, data] = args;
          arraySignal.set(current.map((item) => (item[idField] === id ? { ...item, ...(data as Partial<T>) } : item)));
          break;
        }

        case 'delete': {
          // Assume first arg is ID
          const [id] = args;
          arraySignal.set(current.filter((item) => item[idField] !== id));
          break;
        }

        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    },
    rollback: (snapshot: T[]) => {
      arraySignal.set(snapshot);
    },
    snapshot: () => arraySignal.peek(),
    ...options,
  });
}
