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

  // NR-3: `select` is a PER-OBSERVER projection — it must NOT be baked into the
  // SHARED QueryCache. Two observers of the same queryKey with different
  // `select`s would otherwise poison each other (the cache would hold whichever
  // observer fetched first), and a cache read would double-apply `select`. So we
  // cache RAW query data and project it for THIS observer at every read. A ref
  // keeps the projector stable so the cache-subscription effect never
  // re-subscribes when an inline `select` changes identity, while always using
  // the latest `select`.
  const selectRef = useRef(select);
  selectRef.current = select;
  const projectData = useCallback(
    (raw: TData | undefined): TData | undefined =>
      raw !== undefined && selectRef.current ? (selectRef.current(raw) as TData) : raw,
    [],
  );

  // Note: per-query `cacheTime` is wired through the subscribe
  // call below as a per-observer hint (see QueryCache.subscribe).

  // State — initialised from the shared QueryCache so a remount
  // inside the `staleTime` window hydrates synchronously
  // (`data` + `dataUpdatedAt` + `status='success'`) without firing
  // a refetch. Before this, `dataUpdatedAt` started at 0 on every
  // mount and `isStale` always evaluated true → tab-switch remounts
  // round-tripped to the network even when the cache was warm.
  const cachedQueryOnInit = useMemo(
    () => client.getQueryCache().getQuery<TData, TError>(queryKey),
    // We intentionally only read the cache once on the first
    // render — subsequent updates come through the subscription
    // effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [data, setData] = useState<TData | undefined>(() => {
    // NR-3: the shared cache holds RAW data — project it through this observer's select.
    if (cachedQueryOnInit?.state.data !== undefined) return projectData(cachedQueryOnInit.state.data);

    if (initialData !== undefined) {
      return typeof initialData === 'function' ? (initialData as () => TData)() : initialData;
    }

    if (placeholderData !== undefined) {
      return typeof placeholderData === 'function' ? (placeholderData as () => TData | undefined)() : placeholderData;
    }

    return undefined;
  });

  const [error, setError] = useState<TError | null>(
    cachedQueryOnInit?.state.error ?? null,
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(() => {
    // Cache hit → success. `placeholderData` / `initialData` also
    // mean we have data to show before fetching, so status='success'
    // mirrors TanStack's semantics (consumers branch on isLoading vs
    // isFetching, not on raw status).
    if (data !== undefined) return 'success';
    if (cachedQueryOnInit?.state.status === 'error') return 'error';
    return 'idle';
  });
  const [isFetching, setIsFetching] = useState(false);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(
    cachedQueryOnInit?.state.dataUpdatedAt ?? initialDataUpdatedAt ?? 0,
  );
  const [errorUpdatedAt, setErrorUpdatedAt] = useState(
    cachedQueryOnInit?.state.errorUpdatedAt ?? 0,
  );

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

          // NR-3: return RAW data. `select` is a per-observer projection applied
          // via projectData, NOT here — so the deduped/cached value stays raw and
          // cannot poison observers that use a different `select`.
          result = await queryFn(context);
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
    // NR-3: `select` intentionally removed — executeFetch produces raw data only.
    [queryKey, queryFn, retry, retryDelay]
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
      const raw = await queryCache.getOrCreateFetch<TData>(queryKey, executeFetch);
      // NR-3: the shared dedup/cache holds RAW data; project for THIS observer.
      const result = projectData(raw) as TData;

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
  }, [queryKey, executeFetch, onSuccess, onError, onSettled, client, status, projectData]);

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
      // Sync from cache (NR-3: project the raw shared entry through this observer's select).
      setData(projectData(cached));
      setStatus('success');
    }
  }, [queryKeyHash, enabled, isHydrating]);

  // Cache subscription. Observers see every cache mutation
  // (write, error, invalidate, evict) and must keep all of local
  // {data, status, error, dataUpdatedAt} in lockstep with the
  // shared store — not just `data`. Without the full sync, an
  // `invalidateQueries` call from elsewhere only updates one
  // mounted observer's data while leaving its `status` /
  // `dataUpdatedAt` frozen at the values from the original fetch,
  // making isStale lie. Pass per-observer `cacheTime` so the
  // shared GC respects the most-permissive caller's preference.
  useEffect(() => {
    const cache = client.getQueryCache();
    const unsubscribe = cache.subscribe(
      queryKey,
      () => {
        const query = cache.getQuery<TData, TError>(queryKey);
        if (!query) {
          // Entry GC'd while we were still mounted (rare race);
          // clear local mirror so isStale re-evaluates correctly.
          setData(undefined);
          setStatus('idle');
          setDataUpdatedAt(0);
          return;
        }
        const s = query.state;
        setData(projectData(s.data)); // NR-3: project the raw shared entry per-observer
        setError(s.error);
        setStatus(s.status === 'loading' ? (s.data !== undefined ? 'success' : 'loading') : s.status);
        setDataUpdatedAt(s.dataUpdatedAt);
        setErrorUpdatedAt(s.errorUpdatedAt);
      },
      cacheTime,
    );

    return unsubscribe;
  }, [client, queryKeyHash, cacheTime]);

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
  // Mount/unmount tracking. React.StrictMode in dev runs every
  // effect mount→cleanup→remount; without the explicit
  // `isMounted.current = true` on the mount path, the ref stays
  // `false` after the first cleanup and every subsequent
  // `setStatus('success')` / `setData()` call in `fetchData` is
  // silently dropped — the query never finalises and consumers
  // stay stuck on `isLoading: true` indefinitely.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

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
