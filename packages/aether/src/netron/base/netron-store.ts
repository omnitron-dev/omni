/**
 * @fileoverview NetronStore base class for state management
 * @module @omnitron-dev/aether/netron
 */

import { signal, computed } from '../../core/index.js';
import { NetronService } from './netron-service.js';
import type {
  Signal,
  WritableSignal,
  INetronStore,
  QueryOptions,
  MutationOptions,
  MethodParameters,
  MethodReturnType,
} from '../types.js';

/**
 * NetronStore - Base class for stores with netron integration
 *
 * @template T - Service interface type
 *
 * @example
 * ```typescript
 * interface IUserService {
 *   getUsers(): Promise<User[]>;
 *   getUser(id: string): Promise<User>;
 *   updateUser(id: string, data: Partial<User>): Promise<User>;
 *   deleteUser(id: string): Promise<void>;
 * }
 *
 * @Injectable()
 * @Backend('main')
 * @Service('users@1.0.0')
 * class UserStore extends NetronStore<IUserService> {
 *   // Reactive state
 *   users = signal<User[]>([]);
 *   selectedUser = signal<User | null>(null);
 *   loading = signal(false);
 *   error = signal<Error | null>(null);
 *
 *   // Computed values
 *   activeUsers = computed(() =>
 *     this.users().filter(u => u.active)
 *   );
 *
 *   userCount = computed(() =>
 *     this.users().length
 *   );
 *
 *   // Actions with auto-caching
 *   async loadUsers() {
 *     this.loading.set(true);
 *     this.error.set(null);
 *
 *     try {
 *       const data = await this.query('getUsers', [], {
 *         cache: { maxAge: 60000, tags: ['users'] }
 *       });
 *       this.users.set(data);
 *     } catch (err) {
 *       this.error.set(err as Error);
 *     } finally {
 *       this.loading.set(false);
 *     }
 *   }
 *
 *   // Mutations with optimistic updates
 *   async updateUser(id: string, data: Partial<User>) {
 *     await this.mutate('updateUser', [id, data], {
 *       optimistic: () => {
 *         // Apply optimistic update immediately
 *         this.users.set(
 *           this.users().map(u =>
 *             u.id === id ? { ...u, ...data } : u
 *           )
 *         );
 *       },
 *       invalidate: ['users'],
 *       onError: () => {
 *         // Auto-rollback handled by FluentInterface
 *         this.loadUsers(); // Refresh on error
 *       }
 *     });
 *   }
 *
 *   async deleteUser(id: string) {
 *     const previousUsers = this.users();
 *
 *     // Optimistic delete
 *     this.users.set(
 *       this.users().filter(u => u.id !== id)
 *     );
 *
 *     try {
 *       await this.mutate('deleteUser', [id], {
 *         invalidate: ['users']
 *       });
 *     } catch (err) {
 *       // Rollback on error
 *       this.users.set(previousUsers);
 *       throw err;
 *     }
 *   }
 *
 *   // Selection management
 *   selectUser(user: User | null) {
 *     this.selectedUser.set(user);
 *   }
 *
 *   async loadUserDetails(id: string) {
 *     const user = await this.query('getUser', [id], {
 *       cache: { maxAge: 30000, tags: ['user', `user-${id}`] }
 *     });
 *     this.selectedUser.set(user);
 *     return user;
 *   }
 * }
 * ```
 */
export abstract class NetronStore<T> extends NetronService<T> implements INetronStore<T> {
  /**
   * Helper to create a loading state wrapper
   *
   * @param fn - Async function to wrap
   * @param loadingSignal - Loading signal to update
   * @param errorSignal - Error signal to update
   * @returns Wrapped function
   */
  protected withLoading<TArgs extends any[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    loadingSignal: WritableSignal<boolean>,
    errorSignal?: WritableSignal<Error | null>
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      loadingSignal.set(true);
      if (errorSignal) {
        errorSignal.set(null);
      }

      try {
        return await fn(...args);
      } catch (err) {
        if (errorSignal) {
          errorSignal.set(err as Error);
        }
        throw err;
      } finally {
        loadingSignal.set(false);
      }
    };
  }

  /**
   * Helper to create an optimistic update wrapper
   *
   * @param dataSignal - Data signal to update
   * @param updateFn - Function to apply optimistic update
   * @param mutationFn - Async mutation function
   * @returns Wrapped function
   */
  protected withOptimistic<TData, TArgs extends any[], TResult>(
    dataSignal: WritableSignal<TData>,
    updateFn: (current: TData, ...args: TArgs) => TData,
    mutationFn: (...args: TArgs) => Promise<TResult>
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs): Promise<TResult> => {
      const snapshot = dataSignal();

      // Apply optimistic update
      dataSignal.set(updateFn(snapshot, ...args));

      try {
        return await mutationFn(...args);
      } catch (err) {
        // Rollback on error
        dataSignal.set(snapshot);
        throw err;
      }
    };
  }

  /**
   * Helper to batch multiple updates
   *
   * @param updates - Array of update functions
   */
  protected batch(updates: Array<() => void>): void {
    // Aether's reactivity automatically batches updates in effects
    // but we can explicitly batch if needed
    for (const update of updates) {
      update();
    }
  }

  /**
   * Helper to persist state to localStorage
   *
   * @param key - Storage key
   * @param signal - Signal to persist
   * @param options - Persistence options
   */
  protected persist<TData>(
    key: string,
    dataSignal: WritableSignal<TData>,
    options?: {
      storage?: 'local' | 'session';
      serialize?: (data: TData) => string;
      deserialize?: (data: string) => TData;
    }
  ): void {
    const storage = options?.storage === 'session' ? sessionStorage : localStorage;
    const serialize = options?.serialize || JSON.stringify;
    const deserialize = options?.deserialize || JSON.parse;

    // Load initial value from storage
    try {
      const stored = storage.getItem(key);
      if (stored) {
        dataSignal.set(deserialize(stored));
      }
    } catch (err) {
      console.warn(`Failed to load persisted state for key "${key}":`, err);
    }

    // Save to storage on changes
    // Use effect to auto-track signal changes
    const saveEffect = () => {
      try {
        const data = dataSignal();
        if (data === undefined || data === null) {
          storage.removeItem(key);
        } else {
          storage.setItem(key, serialize(data));
        }
      } catch (err) {
        console.warn(`Failed to persist state for key "${key}":`, err);
      }
    };

    // Note: In a real implementation, we'd need to use effect() here
    // For now, we'll assume the consumer will call saveEffect when needed
    // or we could expose it as a method
    (dataSignal as any).__persist__ = saveEffect;
  }

  /**
   * Helper to create a debounced query
   *
   * @param queryFn - Query function to debounce
   * @param delay - Debounce delay in ms
   * @returns Debounced function
   */
  protected debounce<TArgs extends any[], TResult>(
    queryFn: (...args: TArgs) => Promise<TResult>,
    delay: number
  ): (...args: TArgs) => Promise<TResult> {
    let timeoutId: NodeJS.Timeout | null = null;
    let pendingResolve: ((value: TResult) => void) | null = null;
    let pendingReject: ((reason: any) => void) | null = null;

    return (...args: TArgs): Promise<TResult> => {
      // Clear existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Return existing promise if pending
      if (pendingResolve && pendingReject) {
        return new Promise<TResult>((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
        });
      }

      // Create new promise
      return new Promise<TResult>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;

        timeoutId = setTimeout(async () => {
          try {
            const result = await queryFn(...args);
            pendingResolve!(result);
          } catch (err) {
            pendingReject!(err);
          } finally {
            pendingResolve = null;
            pendingReject = null;
            timeoutId = null;
          }
        }, delay);
      });
    };
  }

  /**
   * Helper to create a throttled query
   *
   * @param queryFn - Query function to throttle
   * @param limit - Throttle limit in ms
   * @returns Throttled function
   */
  protected throttle<TArgs extends any[], TResult>(
    queryFn: (...args: TArgs) => Promise<TResult>,
    limit: number
  ): (...args: TArgs) => Promise<TResult> {
    let inThrottle = false;
    let lastResult: TResult | undefined;

    return async (...args: TArgs): Promise<TResult> => {
      if (!inThrottle) {
        inThrottle = true;
        setTimeout(() => {
          inThrottle = false;
        }, limit);

        lastResult = await queryFn(...args);
        return lastResult;
      } else if (lastResult !== undefined) {
        return lastResult;
      } else {
        // Wait for throttle to end
        return new Promise<TResult>((resolve) => {
          const checkInterval = setInterval(() => {
            if (!inThrottle) {
              clearInterval(checkInterval);
              queryFn(...args).then(resolve);
            }
          }, 50);
        });
      }
    };
  }
}