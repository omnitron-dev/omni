/**
 * Optimistic Updates - Instant UI feedback with automatic rollback
 *
 * Provides optimistic update patterns with:
 * - Instant UI updates
 * - Automatic rollback on error
 * - Conflict resolution
 * - Integration with cached resources
 */

import type { CachedResource } from './types.js';
import type {
  OptimisticUpdateOptions,
  OptimisticUpdateResult,
  MutationFunction,
} from './types.js';

/**
 * Perform an optimistic update on a cached resource
 *
 * Updates the resource immediately with optimistic data, then executes
 * the mutation. Automatically rolls back on error.
 *
 * @param resource - Cached resource to update
 * @param mutation - Async mutation function
 * @param options - Optimistic update options
 * @returns Promise resolving to mutation result
 *
 * @example
 * ```typescript
 * const todos = createCachedResource(() => fetchTodos());
 *
 * async function addTodo(text: string) {
 *   await optimisticUpdate(
 *     todos,
 *     async () => {
 *       const response = await fetch('/api/todos', {
 *         method: 'POST',
 *         body: JSON.stringify({ text })
 *       });
 *       return response.json();
 *     },
 *     {
 *       optimisticData: (current) => [
 *         ...(current ?? []),
 *         { id: Date.now(), text, done: false }
 *       ]
 *     }
 *   );
 * }
 * ```
 */
export async function optimisticUpdate<T, TResult = void>(
  resource: CachedResource<T>,
  mutation: () => Promise<TResult>,
  options: OptimisticUpdateOptions<T>
): Promise<TResult> {
  const {
    optimisticData,
    revalidate = true,
    rollbackOnError = true,
    onError,
  } = options;

  // Store current data for rollback
  const previousData = resource();

  // Apply optimistic update
  const newData =
    typeof optimisticData === 'function'
      ? (optimisticData as (prev: T | undefined) => T)(previousData)
      : optimisticData;

  resource.mutate(newData);

  try {
    // Execute mutation
    const result = await mutation();

    // Revalidate if requested
    if (revalidate) {
      await resource.refetch();
    }

    return result;
  } catch (error) {
    // Rollback on error if requested
    if (rollbackOnError && previousData !== undefined) {
      resource.mutate(previousData);
    }

    // Call error handler
    if (onError) {
      const rollback = () => {
        if (previousData !== undefined) {
          resource.mutate(previousData);
        }
      };
      onError(error as Error, rollback);
    }

    throw error;
  }
}

/**
 * Create an optimistic mutation function
 *
 * Wraps a mutation function with optimistic update logic that can be
 * reused across multiple calls.
 *
 * @param resource - Cached resource to update
 * @param mutation - Mutation function
 * @param getOptimisticData - Function to generate optimistic data from mutation args
 * @param options - Optimistic update options (optional)
 * @returns Wrapped mutation function
 *
 * @example
 * ```typescript
 * const todos = createCachedResource(() => fetchTodos());
 *
 * const addTodo = createOptimisticMutation(
 *   todos,
 *   async (text: string) => {
 *     const response = await fetch('/api/todos', {
 *       method: 'POST',
 *       body: JSON.stringify({ text })
 *     });
 *     return response.json();
 *   },
 *   (text: string) => (current) => [
 *     ...(current ?? []),
 *     { id: Date.now(), text, done: false }
 *   ]
 * );
 *
 * // Use it
 * await addTodo('Buy milk');
 * ```
 */
export function createOptimisticMutation<T, TArgs extends any[], TResult>(
  resource: CachedResource<T>,
  mutation: MutationFunction<TArgs, TResult>,
  getOptimisticData: (...args: TArgs) => T | ((prev: T | undefined) => T),
  options: Omit<OptimisticUpdateOptions<T>, 'optimisticData'> = {}
): MutationFunction<TArgs, TResult> {
  return async (...args: TArgs): Promise<TResult> =>
    optimisticUpdate(resource, () => mutation(...args), {
      ...options,
      optimisticData: getOptimisticData(...args),
    });
}

/**
 * Create a manual optimistic update controller
 *
 * Provides manual control over optimistic updates with explicit
 * commit and rollback methods.
 *
 * @param resource - Cached resource to update
 * @param optimisticData - Optimistic data to apply
 * @returns Optimistic update result with commit/rollback methods
 *
 * @example
 * ```typescript
 * const todos = createCachedResource(() => fetchTodos());
 *
 * async function addTodo(text: string) {
 *   // Apply optimistic update
 *   const update = applyOptimisticUpdate(todos, (current) => [
 *     ...(current ?? []),
 *     { id: Date.now(), text, done: false }
 *   ]);
 *
 *   try {
 *     const result = await saveTodo(text);
 *     update.commit(result);
 *   } catch (error) {
 *     update.rollback();
 *     throw error;
 *   }
 * }
 * ```
 */
export function applyOptimisticUpdate<T>(
  resource: CachedResource<T>,
  optimisticData: T | ((prev: T | undefined) => T)
): OptimisticUpdateResult<T> {
  // Store previous data
  const previousData = resource();

  // Apply optimistic update
  const newData =
    typeof optimisticData === 'function'
      ? (optimisticData as (prev: T | undefined) => T)(previousData)
      : optimisticData;

  resource.mutate(newData);

  // Return control methods
  return {
    commit: (data?: T) => {
      if (data !== undefined) {
        resource.mutate(data);
      }
      // Optionally refetch to ensure sync with server
      resource.refetch();
    },
    rollback: () => {
      if (previousData !== undefined) {
        resource.mutate(previousData);
      }
    },
  };
}

/**
 * Perform multiple optimistic updates atomically
 *
 * Applies optimistic updates to multiple resources, with automatic
 * rollback of all updates if any mutation fails.
 *
 * @param updates - Array of resource/mutation pairs
 * @returns Promise resolving to array of mutation results
 *
 * @example
 * ```typescript
 * const user = createCachedResource(() => fetchUser());
 * const posts = createCachedResource(() => fetchPosts());
 *
 * await atomicOptimisticUpdate([
 *   {
 *     resource: user,
 *     mutation: () => updateUser({ name: 'New Name' }),
 *     optimisticData: { ...user(), name: 'New Name' }
 *   },
 *   {
 *     resource: posts,
 *     mutation: () => deletePost(123),
 *     optimisticData: posts()?.filter(p => p.id !== 123)
 *   }
 * ]);
 * ```
 */
export async function atomicOptimisticUpdate<T extends any[]>(
  updates: {
    resource: CachedResource<any>;
    mutation: () => Promise<any>;
    optimisticData: any | ((prev: any) => any);
  }[]
): Promise<T> {
  // Store previous data for all resources
  const previousData = updates.map(({ resource }) => resource());

  // Apply all optimistic updates
  updates.forEach(({ resource, optimisticData }) => {
    const newData =
      typeof optimisticData === 'function'
        ? optimisticData(resource())
        : optimisticData;
    resource.mutate(newData);
  });

  try {
    // Execute all mutations in parallel
    const results = await Promise.all(
      updates.map(({ mutation }) => mutation())
    );

    // Revalidate all resources
    await Promise.all(updates.map(({ resource }) => resource.refetch()));

    return results as T;
  } catch (error) {
    // Rollback all updates
    updates.forEach(({ resource }, index) => {
      const prev = previousData[index];
      if (prev !== undefined) {
        resource.mutate(prev);
      }
    });

    throw error;
  }
}

/**
 * Create a debounced optimistic mutation
 *
 * Debounces mutation calls while applying optimistic updates immediately.
 * Useful for auto-save scenarios.
 *
 * @param resource - Cached resource to update
 * @param mutation - Mutation function
 * @param getOptimisticData - Function to generate optimistic data
 * @param debounceMs - Debounce delay in milliseconds
 * @returns Debounced mutation function
 *
 * @example
 * ```typescript
 * const note = createCachedResource(() => fetchNote());
 *
 * const saveNote = createDebouncedOptimisticMutation(
 *   note,
 *   async (text: string) => {
 *     await fetch('/api/notes', {
 *       method: 'PUT',
 *       body: JSON.stringify({ text })
 *     });
 *   },
 *   (text: string) => ({ ...note(), text }),
 *   1000 // Save 1 second after last change
 * );
 *
 * // Each call applies optimistic update immediately
 * // but only saves once after 1 second of no changes
 * saveNote('Hello');
 * saveNote('Hello World');
 * saveNote('Hello World!');
 * ```
 */
export function createDebouncedOptimisticMutation<T, TArgs extends any[]>(
  resource: CachedResource<T>,
  mutation: MutationFunction<TArgs, void>,
  getOptimisticData: (...args: TArgs) => T | ((prev: T | undefined) => T),
  debounceMs: number
): MutationFunction<TArgs, void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: TArgs | undefined;

  return async (...args: TArgs): Promise<void> => {
    // Apply optimistic update immediately
    const optimisticData = getOptimisticData(...args);
    const newData =
      typeof optimisticData === 'function'
        ? (optimisticData as (prev: T | undefined) => T)(resource())
        : optimisticData;
    resource.mutate(newData);

    // Store pending args
    pendingArgs = args;

    // Clear existing timeout
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    // Set new timeout
    return new Promise<void>((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          if (pendingArgs) {
            await mutation(...pendingArgs);
            await resource.refetch();
          }
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          timeoutId = undefined;
          pendingArgs = undefined;
        }
      }, debounceMs);
    });
  };
}

/**
 * Merge server response with optimistic update
 *
 * Intelligently merges server response with local optimistic changes
 * to resolve conflicts.
 *
 * @param optimistic - Optimistically updated data
 * @param server - Server response data
 * @param strategy - Merge strategy ('server' | 'optimistic' | 'merge')
 * @returns Merged data
 *
 * @example
 * ```typescript
 * const merged = mergeOptimisticUpdate(
 *   { id: 1, name: 'Local', age: 30 },
 *   { id: 1, name: 'Server', email: 'server@example.com' },
 *   'merge'
 * );
 * // Result: { id: 1, name: 'Server', age: 30, email: 'server@example.com' }
 * ```
 */
export function mergeOptimisticUpdate<T extends Record<string, any>>(
  optimistic: T,
  server: T,
  strategy: 'server' | 'optimistic' | 'merge' = 'server'
): T {
  if (strategy === 'server') {
    return server;
  }

  if (strategy === 'optimistic') {
    return optimistic;
  }

  // Merge strategy: server data takes precedence, but preserve local-only changes
  return { ...optimistic, ...server };
}
