/**
 * Server Functions - Type-safe RPC for client-server communication
 *
 * Provides type-safe server function calls with:
 * - Automatic serialization/deserialization
 * - Built-in caching support
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - Integration with Netron RPC
 */

import { getCacheManager, generateCacheKey } from './cache-manager.js';
import type { ServerFunction, ServerFunctionOptions, WrappedServerFunction } from './types.js';

/**
 * Default server function options
 */
const DEFAULT_OPTIONS: Required<Omit<ServerFunctionOptions, 'cache'>> = {
  name: 'anonymous',
  retry: {
    maxRetries: 3,
    delay: 1000,
    backoff: 2,
  },
  timeout: 30000,
};

/**
 * Create a type-safe server function
 *
 * Wraps a function for RPC calls with caching, retries, and timeout support.
 *
 * @param fn - Server function to wrap
 * @param options - Server function options
 * @returns Wrapped server function
 *
 * @example
 * ```typescript
 * // Define server function
 * const getUser = serverFunction(
 *   async (id: number) => {
 *     const response = await fetch(`/api/users/${id}`);
 *     return response.json();
 *   },
 *   {
 *     name: 'getUser',
 *     cache: { ttl: 60000, staleWhileRevalidate: true }
 *   }
 * );
 *
 * // Call from client
 * const user = await getUser(123);
 * ```
 */
export function serverFunction<TArgs extends any[], TReturn>(
  fn: ServerFunction<TArgs, TReturn>,
  options: ServerFunctionOptions = {}
): WrappedServerFunction<TArgs, TReturn> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cache = options.cache ? getCacheManager() : undefined;

  /**
   * Execute function with retry logic
   */
  async function executeWithRetry(args: TArgs, attempt = 0): Promise<TReturn> {
    try {
      // Create timeout promise with cleanup
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Server function timeout after ${opts.timeout}ms`)),
          opts.timeout
        );
      });

      try {
        // Race between function execution and timeout
        const result = await Promise.race([fn(...args), timeoutPromise]);

        // Clear timeout if function completed first
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        return result;
      } catch (error) {
        // Clear timeout on error
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        throw error;
      }
    } catch (error) {
      // Check if we should retry
      const { maxRetries = 0, delay = 1000, backoff = 2 } = opts.retry;

      // Retry if attempt count is less than maxRetries
      // attempt 0 = initial try, attempt 1 = first retry, etc.
      if (attempt < maxRetries) {
        // Calculate delay with exponential backoff
        const retryDelay = delay * Math.pow(backoff, attempt);

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        // Retry
        return executeWithRetry(args, attempt + 1);
      }

      // Max retries reached, throw error
      throw error;
    }
  }

  /**
   * Wrapped function with caching and retry logic
   */
  async function wrappedFunction(...args: TArgs): Promise<TReturn> {
    // Check cache if enabled
    if (cache && options.cache) {
      const cacheKey = options.cache.key ? options.cache.key(...args) : generateCacheKey(opts.name, args);

      // Check if cached and valid
      const cached = cache.get<TReturn>(cacheKey);

      if (cached !== undefined) {
        // Stale-while-revalidate: return stale data and revalidate in background
        if (options.cache.staleWhileRevalidate) {
          const staleTime = options.cache.staleTime ?? 0;

          if (cache.isStale(cacheKey, staleTime)) {
            // Mark as revalidating
            cache.setRevalidating(cacheKey, true);

            // Revalidate in background
            executeWithRetry(args)
              .then((result) => {
                cache.set(cacheKey, result, options.cache!.ttl);
                cache.setRevalidating(cacheKey, false);
              })
              .catch((error) => {
                console.error('Background revalidation failed:', error);
                cache.setRevalidating(cacheKey, false);
              });
          }
        }

        return cached;
      }

      // Not cached, execute function
      const result = await executeWithRetry(args);

      // Cache result
      cache.set(cacheKey, result, options.cache.ttl);

      return result;
    }

    // No cache, just execute
    return executeWithRetry(args);
  }

  /**
   * Invalidate cached results for specific arguments
   */
  function invalidate(...args: TArgs): void {
    if (!cache || !options.cache) {
      return;
    }

    const cacheKey = options.cache.key ? options.cache.key(...args) : generateCacheKey(opts.name, args);

    cache.delete(cacheKey);
  }

  /**
   * Get cached result without triggering a request
   */
  function getCached(...args: TArgs): TReturn | undefined {
    if (!cache || !options.cache) {
      return undefined;
    }

    const cacheKey = options.cache.key ? options.cache.key(...args) : generateCacheKey(opts.name, args);

    return cache.get<TReturn>(cacheKey);
  }

  // Attach utility methods
  return Object.assign(wrappedFunction, {
    invalidate,
    getCached,
  });
}

/**
 * Create a server function that integrates with Netron RPC
 *
 * @param serviceName - Netron service name
 * @param methodName - Method name to call
 * @param options - Server function options
 * @returns Wrapped server function
 *
 * @example
 * ```typescript
 * // Create Netron-backed server function
 * const getUser = netronServerFunction<[number], User>(
 *   'users@1.0.0',
 *   'getUser',
 *   {
 *     cache: { ttl: 60000 }
 *   }
 * );
 *
 * // Call from client
 * const user = await getUser(123);
 * ```
 */
export function netronServerFunction<TArgs extends any[], TReturn>(
  serviceName: string,
  methodName: string,
  options: ServerFunctionOptions = {}
): WrappedServerFunction<TArgs, TReturn> {
  // Create function that calls Netron RPC
  const fn: ServerFunction<TArgs, TReturn> = async (...args: TArgs) => {
    // In a real implementation, this would use the Netron client
    // For now, we'll create a fetch-based implementation that follows Netron's protocol
    const response = await fetch('/netron/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service: serviceName,
        method: methodName,
        args,
      }),
    });

    if (!response.ok) {
      throw new Error(`Netron RPC failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.data as TReturn;
  };

  // Use provided name or generate from service/method
  const name = options.name ?? `${serviceName}.${methodName}`;

  return serverFunction(fn, { ...options, name });
}

/**
 * Batch multiple server function calls
 *
 * @param calls - Array of server function calls
 * @returns Promise resolving to array of results
 *
 * @example
 * ```typescript
 * const [user, posts, comments] = await batchServerFunctions([
 *   getUser(123),
 *   getPosts(123),
 *   getComments(123)
 * ]);
 * ```
 */
export async function batchServerFunctions<T extends any[]>(calls: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  return Promise.all(calls) as Promise<T>;
}

/**
 * Create a server function with optimistic update support
 *
 * @param fn - Server function
 * @param options - Server function options
 * @returns Wrapped server function with optimistic updates
 *
 * @example
 * ```typescript
 * const updateUser = optimisticServerFunction(
 *   async (id: number, data: Partial<User>) => {
 *     const response = await fetch(`/api/users/${id}`, {
 *       method: 'PATCH',
 *       body: JSON.stringify(data)
 *     });
 *     return response.json();
 *   },
 *   { name: 'updateUser' }
 * );
 * ```
 */
export function optimisticServerFunction<TArgs extends any[], TReturn>(
  fn: ServerFunction<TArgs, TReturn>,
  options: ServerFunctionOptions = {}
): WrappedServerFunction<TArgs, TReturn> {
  // For now, this is the same as serverFunction
  // Optimistic updates are handled by the optimistic.ts module
  return serverFunction(fn, options);
}
