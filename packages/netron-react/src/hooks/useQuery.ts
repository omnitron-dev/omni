/**
 * useQuery - Primary hook for data fetching
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { NetronError } from '@omnitron-dev/netron-browser';
import { useNetronClient, useDefaults, useHydration } from '../core/context.js';
import type { QueryOptions, QueryResult, QueryFunctionContext, RetryConfig } from '../core/types.js';
import { hashQueryKey, calculateRetryDelay, timeUtils } from '../cache/utils.js';

/**
 * Default retry configuration
 */
const DEFAULT_RETRY: RetryConfig = {
  attempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoff: 'exponential',
};

/**
 * useQuery hook
 *
 * Fetches data with automatic caching, refetching, and error handling.
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useQuery({
 *   queryKey: ['user', userId],
 *   queryFn: () => userService.getUser(userId),
 *   staleTime: 5 * 60 * 1000,
 * });
 * ```
 */
export function useQuery<TData = unknown, TError = NetronError>(
  options: QueryOptions<TData, TError>
): QueryResult<TData, TError> {
  const client = useNetronClient();
  const defaults = useDefaults();
  const { isHydrating } = useHydration();

  // Merge with defaults
  const {
    queryKey,
    queryFn,
    staleTime = defaults.staleTime,
    // Reserved for future cache implementation
    cacheTime = defaults.cacheTime,
    enabled = true,
    refetchOnWindowFocus = defaults.refetchOnWindowFocus,
    // Reserved for future reconnect handling
    refetchOnReconnect = defaults.refetchOnReconnect,
    refetchInterval = false,
    retry = defaults.retry,
    retryDelay,
    onSuccess,
    onError,
    onSettled,
    select,
    placeholderData,
    initialData,
    initialDataUpdatedAt,
  } = options;

  // Reserved for future cache implementation
  void cacheTime;

  // State
  const [data, setData] = useState<TData | undefined>(() => {
    // Check cache first
    const cached = client.getQueryCache().get<TData>(queryKey);
    if (cached !== undefined) return cached;

    // Use initial data
    if (initialData !== undefined) {
      return typeof initialData === 'function' ? (initialData as () => TData)() : initialData;
    }

    // Use placeholder
    if (placeholderData !== undefined) {
      return typeof placeholderData === 'function' ? (placeholderData as () => TData | undefined)() : placeholderData;
    }

    return undefined;
  });

  const [error, setError] = useState<TError | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(() => {
    if (data !== undefined) return 'success';
    return 'idle';
  });
  const [isFetching, setIsFetching] = useState(false);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(initialDataUpdatedAt ?? 0);
  const [errorUpdatedAt, setErrorUpdatedAt] = useState(0);

  // Refs for stable callbacks
  const queryKeyHash = useMemo(() => hashQueryKey(queryKey), [queryKey]);
  const isMounted = useRef(true);
  const fetchCount = useRef(0);

  // Determine if data is stale
  const isStale = useMemo(() => {
    if (staleTime === Infinity) return false;
    if (staleTime === 0) return true;
    return timeUtils.isExpired(dataUpdatedAt, staleTime);
  }, [dataUpdatedAt, staleTime]);

  // Core fetch function with retry logic (used by deduplication)
  const executeFetch = useCallback(
    async (signal: AbortSignal): Promise<TData> => {
      // Execute with retry
      let result: TData;
      let lastError: TError | null = null;
      const retryConfig =
        typeof retry === 'number'
          ? { ...DEFAULT_RETRY, attempts: retry }
          : typeof retry === 'boolean'
            ? retry
              ? DEFAULT_RETRY
              : { attempts: 0 }
            : { ...DEFAULT_RETRY, ...retry };

      for (let attempt = 0; attempt <= retryConfig.attempts; attempt++) {
        try {
          // Check if aborted
          if (signal.aborted) {
            throw new Error('Query was cancelled');
          }

          // Create context
          const context: QueryFunctionContext = {
            queryKey,
            signal,
          };

          result = await queryFn(context);

          // Apply selector if provided
          if (select) {
            result = select(result) as TData;
          }

          return result;
        } catch (err) {
          lastError = err as TError;

          // Check if should retry
          const shouldRetry =
            attempt < retryConfig.attempts && (retryConfig.retryCondition?.(err as Error, attempt) ?? true);

          if (!shouldRetry) break;

          // Calculate delay
          const delay =
            typeof retryDelay === 'function'
              ? retryDelay(attempt, lastError)
              : typeof retryDelay === 'number'
                ? retryDelay
                : calculateRetryDelay(attempt, retryConfig);

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // All retries failed
      throw lastError;
    },
    [queryKey, queryFn, retry, retryDelay, select]
  );

  // Fetch function using deduplication
  const fetchData = useCallback(async (): Promise<TData> => {
    const currentFetch = ++fetchCount.current;
    const queryCache = client.getQueryCache();

    setIsFetching(true);
    if (status === 'idle') setStatus('loading');

    try {
      // Use getOrCreateFetch for deduplication
      // This ensures multiple components with the same queryKey share one network request
      const result = await queryCache.getOrCreateFetch<TData>(queryKey, executeFetch);

      // Update local state if still mounted and current fetch
      if (isMounted.current && currentFetch === fetchCount.current) {
        setData(result);
        setError(null);
        setStatus('success');
        setDataUpdatedAt(timeUtils.now());
      }

      // Callbacks
      onSuccess?.(result);
      onSettled?.(result, null);

      return result;
    } catch (err) {
      const typedError = err as TError;

      if (isMounted.current && currentFetch === fetchCount.current) {
        setError(typedError);
        setStatus('error');
        setErrorUpdatedAt(timeUtils.now());
      }

      // Callbacks
      onError?.(typedError);
      onSettled?.(undefined, typedError);

      throw typedError;
    } finally {
      if (isMounted.current && currentFetch === fetchCount.current) {
        setIsFetching(false);
      }
    }
  }, [queryKey, executeFetch, onSuccess, onError, onSettled, client, status]);

  // Refetch function
  const refetch = useCallback(async (): Promise<QueryResult<TData, TError>> => {
    try {
      const result = await fetchData();
      return {
        data: result,
        error: null,
        status: 'success',
        isLoading: false,
        isError: false,
        isSuccess: true,
        isIdle: false,
        isFetching: false,
        isRefetching: false,
        isStale: false,
        dataUpdatedAt: timeUtils.now(),
        errorUpdatedAt: 0,
        refetch,
        remove,
      };
    } catch (err) {
      return {
        data: undefined,
        error: err as TError,
        status: 'error',
        isLoading: false,
        isError: true,
        isSuccess: false,
        isIdle: false,
        isFetching: false,
        isRefetching: false,
        isStale: true,
        dataUpdatedAt,
        errorUpdatedAt: timeUtils.now(),
        refetch,
        remove,
      };
    }
  }, [fetchData, dataUpdatedAt]);

  // Remove function
  const remove = useCallback(() => {
    client.getQueryCache().remove(queryKey);
    setData(undefined);
    setError(null);
    setStatus('idle');
    setDataUpdatedAt(0);
    setErrorUpdatedAt(0);
  }, [client, queryKey]);

  // Initial fetch effect
  useEffect(() => {
    if (!enabled || isHydrating) return;

    // Check if we need to fetch
    const cached = client.getQueryCache().get<TData>(queryKey);
    const needsFetch = cached === undefined || isStale;

    if (needsFetch) {
      fetchData().catch(() => {
        // Error already handled in fetchData
      });
    } else if (cached !== undefined && data === undefined) {
      // Sync from cache
      setData(cached);
      setStatus('success');
    }
  }, [queryKeyHash, enabled, isHydrating]);

  // Cache subscription
  useEffect(() => {
    const unsubscribe = client.getQueryCache().subscribe(queryKey, () => {
      const cached = client.getQueryCache().get<TData>(queryKey);
      if (cached !== undefined) {
        setData(cached);
      }
    });

    return unsubscribe;
  }, [client, queryKeyHash]);

  // Refetch interval
  useEffect(() => {
    if (!enabled || !refetchInterval || refetchInterval <= 0) return undefined;

    const intervalId = setInterval(() => {
      fetchData().catch(() => {});
    }, refetchInterval);

    return () => clearInterval(intervalId);
  }, [enabled, refetchInterval, fetchData]);

  // Window focus refetch
  useEffect(() => {
    if (!enabled || !refetchOnWindowFocus) return undefined;

    const handleFocus = () => {
      if (isStale) {
        fetchData().catch(() => {});
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [enabled, refetchOnWindowFocus, isStale, fetchData]);

  // Refetch on reconnect
  useEffect(() => {
    if (!enabled || !refetchOnReconnect) return undefined;

    // Subscribe to client reconnect events
    const unsubscribe = client.on('reconnect', () => {
      // Refetch if data is stale after reconnection
      if (isStale) {
        fetchData().catch(() => {});
      }
    });

    return unsubscribe;
  }, [enabled, refetchOnReconnect, isStale, fetchData, client]);

  // Cleanup
  useEffect(
    () => () => {
      isMounted.current = false;
    },
    []
  );

  // Return result
  return useMemo(
    () => ({
      data,
      error,
      status,
      isLoading: status === 'loading',
      isError: status === 'error',
      isSuccess: status === 'success',
      isIdle: status === 'idle',
      isFetching,
      isRefetching: isFetching && status !== 'loading',
      isStale,
      dataUpdatedAt,
      errorUpdatedAt,
      refetch,
      remove,
    }),
    [data, error, status, isFetching, isStale, dataUpdatedAt, errorUpdatedAt, refetch, remove]
  );
}

export default useQuery;
