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
 * NR-3: `select` is a PER-QUERY projection — the SHARED QueryCache must hold RAW
 * data so two observers of the same key with different `select`s don't poison
 * each other (and a cache read doesn't double-apply `select`). Project the raw
 * cache/fetch value for THIS query here; the cache itself always stores raw.
 */
function projectQueryData(query: QueriesOptions<any, any>, raw: unknown): unknown {
  return raw !== undefined && query.select ? query.select(raw as never) : raw;
}

/**
 * Create initial state for a query
 */
function createInitialState<TData, TError>(
  query: QueriesOptions<TData, TError>,
  cached: TData | undefined,
  cachedError: TError | null = null,
  cachedErrorUpdatedAt = 0,
): QueryState<TData, TError> {
  // NR-3: the shared cache holds RAW data — project it for this query.
  let initialData = projectQueryData(query, cached) as TData | undefined;
  if (initialData === undefined && query.initialData !== undefined) {
    initialData = typeof query.initialData === 'function' ? (query.initialData as () => TData)() : query.initialData;
  }
  if (initialData === undefined && query.placeholderData !== undefined) {
    initialData =
      typeof query.placeholderData === 'function'
        ? (query.placeholderData as () => TData | undefined)()
        : query.placeholderData;
  }

  // Surface a cached error when there's no data to show. This lets a suspense
  // retry settle on the error (and escalate to the boundary) instead of seeing
  // an idle state and re-suspending forever.
  const hasError = initialData === undefined && cachedError != null;

  return {
    data: initialData,
    error: hasError ? cachedError : null,
    status: initialData !== undefined ? 'success' : hasError ? 'error' : 'idle',
    isFetching: false,
    dataUpdatedAt: query.initialDataUpdatedAt ?? 0,
    errorUpdatedAt: hasError ? cachedErrorUpdatedAt : 0,
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
  // keepPreviousData (per query): which queryKeyHash each index's `data` belongs
  // to. When it lags the current hash (that query's key changed) the carried-over
  // data is "previous" and we flag isPreviousData.
  const dataKeyRefs = useRef<string[]>([]);
  // suspense (per query): the in-flight cold-load prime promise per index.
  const suspendPromiseRefs = useRef<(Promise<void> | null)[]>([]);

  // Ensure fetchCounts has the right length
  if (fetchCounts.current.length !== queries.length) {
    fetchCounts.current = queries.map(() => 0);
  }

  // Initialize states for all queries
  const [states, setStates] = useState<QueryState<unknown, unknown>[]>(() =>
    queries.map((query) => {
      const cq = client.getQueryCache().getQuery(query.queryKey);
      // NR-3: cache holds RAW data; its state.error is loosely typed (unknown).
      return createInitialState(query, cq?.state.data, (cq?.state.error ?? null) as never, cq?.state.errorUpdatedAt);
    })
  );

  // Memoize query key hashes for dependency tracking
  const queryKeyHashes = useMemo(() => queries.map((q) => hashQueryKey(q.queryKey)), [queries]);
  const queryKeyHashString = queryKeyHashes.join(',');

  // Keep the per-index ref arrays sized to the queries array. On a structural
  // change (the count differs) reset key-ownership to the current hashes — the
  // initial state for each index was seeded from that key's cache entry.
  if (dataKeyRefs.current.length !== queries.length) {
    dataKeyRefs.current = queryKeyHashes.slice();
    suspendPromiseRefs.current = queries.map(() => null);
  }

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

            const raw = await query.queryFn(context);
            // NR-3: project for THIS query; the SHARED cache keeps RAW data so
            // observers with a different `select` aren't poisoned.
            result = projectQueryData(query, raw);

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

              // Update cache with RAW data (NR-3) + the writer's staleTime (NR-13).
              queryCache.set(query.queryKey, raw, query.staleTime ?? defaults.staleTime);
              dataKeyRefs.current[index] = queryKeyHashes[index]!; // data now belongs to this key
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
      // NR-6: read the FRESH result from the cache — the source of truth that
      // fetchQuery just wrote. The `states` array captured in this closure is a
      // stale snapshot after the await (the updateState fetchQuery triggered has
      // not been committed yet), so the returned result used to be pre-fetch.
      const query = queries[index];
      const cached = query ? client.getQueryCache().getQuery(query.queryKey) : undefined;
      const s = cached?.state;
      const stateStatus = s?.status ?? 'idle';
      const stateData = query && s ? projectQueryData(query, s.data) : undefined; // NR-3: project raw
      const stateError = s?.error ?? null;
      const stateDataUpdatedAt = s?.dataUpdatedAt ?? 0;
      const stateErrorUpdatedAt = s?.errorUpdatedAt ?? 0;

      return {
        data: stateData,
        error: stateError,
        status: stateStatus,
        isLoading: stateStatus === 'loading',
        isError: stateStatus === 'error',
        isSuccess: stateStatus === 'success',
        isIdle: stateStatus === 'idle',
        // The refetch awaited above has completed, so the query is no longer fetching.
        isFetching: false,
        isRefetching: false,
        isStale: true,
        isPreviousData: false,
        dataUpdatedAt: stateDataUpdatedAt,
        errorUpdatedAt: stateErrorUpdatedAt,
        refetch: createRefetch(index),
        remove: createRemove(index),
      };
    },
    [fetchQuery, queries, client, createRemove]
  );

  // suspense: a render-safe cold-load fetch for a single query. Writes the
  // result (or error) into the shared cache WITHOUT touching component state, so
  // it can run during render (in the throw path). On the post-resolve retry the
  // cache-seeded initial state renders (or escalates the error) normally.
  // Single-attempt — a cold suspense load that fails surfaces to the boundary.
  const primeQuery = useCallback(
    async (index: number): Promise<void> => {
      const query = queries[index];
      if (!query) return;
      const queryCache = client.getQueryCache();
      const controller = new AbortController();
      const context: QueryFunctionContext = { queryKey: query.queryKey, signal: controller.signal };
      try {
        const raw = await query.queryFn(context);
        queryCache.set(query.queryKey, raw, query.staleTime ?? defaults.staleTime);
      } catch (err) {
        queryCache.setError(query.queryKey, err);
      }
    },
    [queries, client, defaults.staleTime]
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
        // Sync from cache (NR-3: project the raw shared entry for this query).
        updateState(index, {
          data: projectQueryData(query, cached),
          status: 'success',
        });
        dataKeyRefs.current[index] = queryKeyHashes[index]!;
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
          updateState(index, { data: projectQueryData(query, cached) }); // NR-3: project per-query
          dataKeyRefs.current[index] = queryKeyHashes[index]!; // mirror belongs to current key
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

        // keepPreviousData: this index's `data` is "previous" while a key change
        // is in flight (its key-ownership lags the current hash). Gated per query.
        const isPreviousData =
          ((query as { keepPreviousData?: boolean } | undefined)?.keepPreviousData ?? false) &&
          dataKeyRefs.current[index] !== queryKeyHashes[index] &&
          state?.data !== undefined;

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
          isPreviousData,
          dataUpdatedAt: stateDataUpdatedAt,
          errorUpdatedAt: state?.errorUpdatedAt ?? 0,
          refetch: createRefetch(index),
          remove: createRemove(index),
        } as QueryObserverResult;
      }) as unknown as TResults,
    [states, queries, queryKeyHashString, defaults.staleTime, createRefetch, createRemove]
  );

  // Apply combine function if provided, otherwise return results array
  const combined = useMemo(() => {
    if (combine) {
      return combine(results);
    }
    return results as unknown as TCombinedResult;
  }, [results, combine]);

  // suspense + useErrorBoundary (per query), AFTER all hooks (plain control flow):
  //  - an error from a query that opted into useErrorBoundary (or suspense, which
  //    implies it) → re-throw to the nearest React error boundary;
  //  - a cold suspense query with no data/error yet → prime it and collect its
  //    in-flight promise, then throw the combined promise so a <Suspense>
  //    boundary shows its fallback until ALL such queries resolve.
  const resultList = results as unknown as QueryObserverResult[];
  const pendingSuspense: Promise<void>[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i] as
      | { enabled?: boolean; suspense?: boolean; useErrorBoundary?: boolean | ((e: unknown) => boolean) }
      | undefined;
    if (!q) continue;
    const err = resultList[i]?.error;

    if (err != null) {
      const opt = q.useErrorBoundary;
      const escalate = !!q.suspense || (typeof opt === 'function' ? opt(err) : !!opt);
      if (escalate) throw err;
      continue; // errored but not escalated → surface it in the result, don't suspend
    }

    const enabled = q.enabled ?? true;
    if (q.suspense && enabled && !isHydrating && resultList[i]?.data === undefined) {
      if (!suspendPromiseRefs.current[i]) {
        suspendPromiseRefs.current[i] = primeQuery(i).finally(() => {
          suspendPromiseRefs.current[i] = null;
        });
      }
      pendingSuspense.push(suspendPromiseRefs.current[i]!);
    }
  }
  if (pendingSuspense.length > 0) {
    throw Promise.all(pendingSuspense) as unknown as Promise<void>;
  }

  return combined;
}

export default useQueries;
