/**
 * useQueries - Hook for executing multiple queries in parallel
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
 * Query observer result type (same as QueryResult)
 */
export type QueryObserverResult<TData = unknown, TError = NetronError> = QueryResult<TData, TError>;

/**
 * Options for a single query in useQueries
 */
export type QueriesOptions<TData = unknown, TError = NetronError> = QueryOptions<TData, TError>;

/**
 * Options for useQueries hook
 */
export interface UseQueriesOptions<TResults extends readonly QueryObserverResult[], TCombinedResult = TResults> {
  /** Array of query options to execute in parallel */
  queries: readonly [
    ...{ [K in keyof TResults]: QueriesOptions<TResults[K]['data'], NonNullable<TResults[K]['error']>> },
  ];
  /** Optional function to combine results into a custom shape */
  combine?: (results: TResults) => TCombinedResult;
}

/**
 * Internal state for a single query
 */
interface QueryState<TData, TError> {
  data: TData | undefined;
  error: TError | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  isFetching: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

/**
 * Create initial state for a query
 */
function createInitialState<TData, TError>(
  query: QueriesOptions<TData, TError>,
  cached: TData | undefined
): QueryState<TData, TError> {
  let initialData = cached;
  if (initialData === undefined && query.initialData !== undefined) {
    initialData = typeof query.initialData === 'function' ? (query.initialData as () => TData)() : query.initialData;
  }
  if (initialData === undefined && query.placeholderData !== undefined) {
    initialData =
      typeof query.placeholderData === 'function'
        ? (query.placeholderData as () => TData | undefined)()
        : query.placeholderData;
  }

  return {
    data: initialData,
    error: null,
    status: initialData !== undefined ? 'success' : 'idle',
    isFetching: false,
    dataUpdatedAt: query.initialDataUpdatedAt ?? 0,
    errorUpdatedAt: 0,
  };
}

/**
 * useQueries hook
 *
 * Executes multiple queries in parallel with combined state management.
 *
 * @example
 * ```tsx
 * const results = useQueries({
 *   queries: [
 *     { queryKey: ['user', 1], queryFn: () => fetchUser(1) },
 *     { queryKey: ['user', 2], queryFn: () => fetchUser(2) },
 *     { queryKey: ['posts'], queryFn: () => fetchPosts() },
 *   ],
 * });
 *
 * // With combine function
 * const { users, posts } = useQueries({
 *   queries: [
 *     { queryKey: ['users'], queryFn: fetchUsers },
 *     { queryKey: ['posts'], queryFn: fetchPosts },
 *   ],
 *   combine: (results) => ({
 *     users: results[0].data,
 *     posts: results[1].data,
 *   }),
 * });
 * ```
 */
export function useQueries<TResults extends readonly QueryObserverResult[], TCombinedResult = TResults>(
  options: UseQueriesOptions<TResults, TCombinedResult>
): TCombinedResult {
  const { queries, combine } = options;
  const client = useNetronClient();
  const defaults = useDefaults();
  const { isHydrating } = useHydration();

  // Refs for stable callbacks and tracking
  const isMounted = useRef(true);
  const fetchCounts = useRef<number[]>([]);

  // Ensure fetchCounts has the right length
  if (fetchCounts.current.length !== queries.length) {
    fetchCounts.current = queries.map(() => 0);
  }

  // Initialize states for all queries
  const [states, setStates] = useState<QueryState<unknown, unknown>[]>(() =>
    queries.map((query) => {
      const queryCache = client.getQueryCache();
      const cached = queryCache.get(query.queryKey);
      return createInitialState(query, cached);
    })
  );

  // Memoize query key hashes for dependency tracking
  const queryKeyHashes = useMemo(() => queries.map((q) => hashQueryKey(q.queryKey)), [queries]);
  const queryKeyHashString = queryKeyHashes.join(',');

  // Update a single query's state
  const updateState = useCallback((index: number, update: Partial<QueryState<unknown, unknown>>) => {
    if (!isMounted.current) return;
    setStates((prev) => {
      const next = [...prev];
      const current = next[index];
      if (current) {
        next[index] = { ...current, ...update };
      }
      return next;
    });
  }, []);

  // Fetch function for a single query
  const fetchQuery = useCallback(
    async (index: number): Promise<void> => {
      const query = queries[index];
      if (!query) return;

      fetchCounts.current[index] = (fetchCounts.current[index] ?? 0) + 1;
      const currentFetch = fetchCounts.current[index];
      const queryCache = client.getQueryCache();

      // Start fetch
      const abortController = queryCache.startFetch(query.queryKey);

      const currentState = states[index];
      const currentStatus = currentState?.status ?? 'idle';
      updateState(index, {
        isFetching: true,
        status: currentStatus === 'idle' ? 'loading' : currentStatus,
      });

      try {
        // Create context
        const context: QueryFunctionContext = {
          queryKey: query.queryKey,
          signal: abortController.signal,
        };

        // Retry configuration
        const retryConfig =
          typeof query.retry === 'number'
            ? { ...DEFAULT_RETRY, attempts: query.retry }
            : typeof query.retry === 'boolean'
              ? query.retry
                ? DEFAULT_RETRY
                : { attempts: 0 }
              : query.retry
                ? { ...DEFAULT_RETRY, ...query.retry }
                : typeof defaults.retry === 'number'
                  ? { ...DEFAULT_RETRY, attempts: defaults.retry }
                  : typeof defaults.retry === 'object'
                    ? { ...DEFAULT_RETRY, ...defaults.retry }
                    : DEFAULT_RETRY;

        let result: unknown;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= retryConfig.attempts; attempt++) {
          try {
            if (abortController.signal.aborted) {
              throw new Error('Query was cancelled');
            }

            result = await query.queryFn(context);

            // Apply selector if provided
            if (query.select) {
              result = query.select(result as never);
            }

            // Update state if still mounted and current fetch
            if (isMounted.current && currentFetch === fetchCounts.current[index]) {
              const now = timeUtils.now();
              updateState(index, {
                data: result,
                error: null,
                status: 'success',
                dataUpdatedAt: now,
                isFetching: false,
              });

              // Update cache
              queryCache.set(query.queryKey, result);
            }

            // Callbacks
            query.onSuccess?.(result as never);
            query.onSettled?.(result as never, null);

            return;
          } catch (err) {
            lastError = err;

            // Check if should retry
            const shouldRetry =
              attempt < retryConfig.attempts && (retryConfig.retryCondition?.(err as Error, attempt) ?? true);

            if (!shouldRetry) break;

            // Calculate delay
            const delay =
              typeof query.retryDelay === 'function'
                ? query.retryDelay(attempt, lastError as never)
                : typeof query.retryDelay === 'number'
                  ? query.retryDelay
                  : calculateRetryDelay(attempt, retryConfig);

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        // All retries failed
        throw lastError;
      } catch (err) {
        if (isMounted.current && currentFetch === fetchCounts.current[index]) {
          const now = timeUtils.now();
          updateState(index, {
            error: err as never,
            status: 'error',
            errorUpdatedAt: now,
            isFetching: false,
          });

          // Update cache
          queryCache.setError(query.queryKey, err);
        }

        // Callbacks
        query.onError?.(err as never);
        query.onSettled?.(undefined, err as never);
      } finally {
        queryCache.endFetch(query.queryKey);
      }
    },
    [queries, client, defaults.retry, states, updateState]
  );

  // Remove function for a single query
  const createRemove = useCallback(
    (index: number) => () => {
      const query = queries[index];
      if (!query) return;
      client.getQueryCache().remove(query.queryKey);
      updateState(index, {
        data: undefined,
        error: null,
        status: 'idle',
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
      });
    },
    [queries, client, updateState]
  );

  // Refetch function for a single query - defined after createRemove to avoid circular dependency
  const createRefetch = useCallback(
    (index: number) => async (): Promise<QueryResult<unknown, unknown>> => {
      await fetchQuery(index);
      const state = states[index];
      const stateData = state?.data;
      const stateError = state?.error ?? null;
      const stateStatus = state?.status ?? 'idle';
      const stateIsFetching = state?.isFetching ?? false;
      const stateDataUpdatedAt = state?.dataUpdatedAt ?? 0;
      const stateErrorUpdatedAt = state?.errorUpdatedAt ?? 0;

      return {
        data: stateData,
        error: stateError,
        status: stateStatus,
        isLoading: stateStatus === 'loading',
        isError: stateStatus === 'error',
        isSuccess: stateStatus === 'success',
        isIdle: stateStatus === 'idle',
        isFetching: stateIsFetching,
        isRefetching: stateIsFetching && stateStatus !== 'loading',
        isStale: true,
        dataUpdatedAt: stateDataUpdatedAt,
        errorUpdatedAt: stateErrorUpdatedAt,
        refetch: createRefetch(index),
        remove: createRemove(index),
      };
    },
    [fetchQuery, states, createRemove]
  );

  // Initial fetch effect - runs all queries in parallel
  useEffect(() => {
    if (isHydrating) return;

    const fetchPromises: Promise<void>[] = [];

    queries.forEach((query, index) => {
      const enabled = query.enabled ?? true;
      if (!enabled) return;

      const staleTime = query.staleTime ?? defaults.staleTime;
      const cached = client.getQueryCache().get(query.queryKey);
      const stateDataUpdatedAt = states[index]?.dataUpdatedAt ?? 0;
      const isStale = staleTime === 0 || (staleTime !== Infinity && timeUtils.isExpired(stateDataUpdatedAt, staleTime));
      const needsFetch = cached === undefined || isStale;

      if (needsFetch) {
        fetchPromises.push(fetchQuery(index));
      } else if (cached !== undefined && states[index]?.data === undefined) {
        // Sync from cache
        updateState(index, {
          data: cached,
          status: 'success',
        });
      }
    });

    // Execute all fetches in parallel
    if (fetchPromises.length > 0) {
      Promise.all(fetchPromises).catch(() => {
        // Errors already handled in individual fetchQuery calls
      });
    }
  }, [queryKeyHashString, isHydrating]);

  // Cache subscriptions for all queries
  useEffect(() => {
    const unsubscribers = queries.map((query, index) =>
      client.getQueryCache().subscribe(query.queryKey, () => {
        const cached = client.getQueryCache().get(query.queryKey);
        if (cached !== undefined) {
          updateState(index, { data: cached });
        }
      })
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [client, queryKeyHashString, queries, updateState]);

  // Refetch intervals
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = [];

    queries.forEach((query, index) => {
      const enabled = query.enabled ?? true;
      const refetchInterval = query.refetchInterval;

      if (enabled && refetchInterval && refetchInterval > 0) {
        const intervalId = setInterval(() => {
          fetchQuery(index).catch(() => {});
        }, refetchInterval);
        intervals.push(intervalId);
      }
    });

    return () => {
      intervals.forEach((id) => clearInterval(id));
    };
  }, [queries, fetchQuery]);

  // Window focus refetch
  useEffect(() => {
    const handleFocus = () => {
      queries.forEach((query, index) => {
        const enabled = query.enabled ?? true;
        const refetchOnWindowFocus = query.refetchOnWindowFocus ?? defaults.refetchOnWindowFocus;
        const staleTime = query.staleTime ?? defaults.staleTime;
        const stateDataUpdatedAt = states[index]?.dataUpdatedAt ?? 0;
        const isStale =
          staleTime === 0 || (staleTime !== Infinity && timeUtils.isExpired(stateDataUpdatedAt, staleTime));

        if (enabled && refetchOnWindowFocus && isStale) {
          fetchQuery(index).catch(() => {});
        }
      });
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [queries, defaults.refetchOnWindowFocus, defaults.staleTime, states, fetchQuery]);

  // Cleanup
  useEffect(
    () => () => {
      isMounted.current = false;
    },
    []
  );

  // Build results array
  const results = useMemo(
    () =>
      states.map((state, index) => {
        const query = queries[index];
        const staleTime = query?.staleTime ?? defaults.staleTime;
        const stateDataUpdatedAt = state?.dataUpdatedAt ?? 0;
        const isStale =
          staleTime === 0 || (staleTime !== Infinity && timeUtils.isExpired(stateDataUpdatedAt, staleTime));

        const stateStatus = state?.status ?? 'idle';
        const stateIsFetching = state?.isFetching ?? false;

        return {
          data: state?.data,
          error: state?.error ?? null,
          status: stateStatus,
          isLoading: stateStatus === 'loading',
          isError: stateStatus === 'error',
          isSuccess: stateStatus === 'success',
          isIdle: stateStatus === 'idle',
          isFetching: stateIsFetching,
          isRefetching: stateIsFetching && stateStatus !== 'loading',
          isStale,
          dataUpdatedAt: stateDataUpdatedAt,
          errorUpdatedAt: state?.errorUpdatedAt ?? 0,
          refetch: createRefetch(index),
          remove: createRemove(index),
        } as QueryObserverResult;
      }) as unknown as TResults,
    [states, queries, defaults.staleTime, createRefetch, createRemove]
  );

  // Apply combine function if provided, otherwise return results array
  return useMemo(() => {
    if (combine) {
      return combine(results);
    }
    return results as unknown as TCombinedResult;
  }, [results, combine]);
}

export default useQueries;
