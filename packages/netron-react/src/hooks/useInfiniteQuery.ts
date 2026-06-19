/**
 * useInfiniteQuery - Hook for paginated/infinite scroll data fetching
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { NetronError } from '@omnitron-dev/netron-browser';
import { useNetronClient, useDefaults, useHydration } from '../core/context.js';
import type {
  RetryConfig,
  InfiniteData,
  InfiniteQueryFunctionContext,
  InfiniteQueryOptions,
  InfiniteQueryResult,
} from '../core/types.js';
import { hashQueryKey, calculateRetryDelay, timeUtils } from '../cache/utils.js';

// Infinite-query types (InfiniteQueryOptions/Result/Data + the page-param
// context) are the canonical definitions in ../core/types.js — imported above.
// They previously lived here as a duplicate that shadowed the core ones.

// ============================================================================
// Default Retry Configuration
// ============================================================================

const DEFAULT_RETRY: RetryConfig = {
  attempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoff: 'exponential',
};

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useInfiniteQuery hook
 *
 * Fetches paginated data with automatic caching and infinite scroll support.
 *
 * @example
 * ```tsx
 * const {
 *   data,
 *   fetchNextPage,
 *   hasNextPage,
 *   isFetchingNextPage,
 * } = useInfiniteQuery({
 *   queryKey: ['posts'],
 *   queryFn: ({ pageParam }) => fetchPosts({ cursor: pageParam }),
 *   getNextPageParam: (lastPage) => lastPage.nextCursor,
 *   initialPageParam: undefined,
 * });
 *
 * // Render pages
 * {data?.pages.map((page) => page.items.map((item) => <Item key={item.id} {...item} />))}
 *
 * // Load more button
 * <button onClick={() => fetchNextPage()} disabled={!hasNextPage || isFetchingNextPage}>
 *   {isFetchingNextPage ? 'Loading...' : 'Load More'}
 * </button>
 * ```
 */
export function useInfiniteQuery<TData = unknown, TError = NetronError, TPageParam = unknown>(
  options: InfiniteQueryOptions<TData, TError, TPageParam>
): InfiniteQueryResult<TData, TError> {
  const client = useNetronClient();
  const defaults = useDefaults();
  const { isHydrating } = useHydration();

  // Destructure options with defaults
  const {
    queryKey,
    queryFn,
    getNextPageParam,
    getPreviousPageParam,
    initialPageParam,
    maxPages,
    staleTime = defaults.staleTime,
    cacheTime = defaults.cacheTime,
    enabled = true,
    retry = defaults.retry,
    onSuccess,
    onError,
    // Aliased off the use-prefixed option name so the eslint react-hooks plugin
    // doesn't treat the call below as a hook call (rules-of-hooks false positive).
    useErrorBoundary: errorBoundary = false,
    suspense = false,
    keepPreviousData = false,
  } = options;

  // State — initialised from the shared QueryCache so a remount
  // inside the `staleTime` window hydrates synchronously
  // (`data` + `dataUpdatedAt` + `status='success'`) without
  // refetching. See useQuery for the full rationale.
  const cachedQueryOnInit = useMemo(
    () => client.getQueryCache().getQuery<InfiniteData<TData>, TError>(queryKey, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [data, setData] = useState<InfiniteData<TData> | undefined>(
    cachedQueryOnInit?.state.data,
  );

  const [error, setError] = useState<TError | null>(
    cachedQueryOnInit?.state.error ?? null,
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(() => {
    if (data !== undefined) return 'success';
    if (cachedQueryOnInit?.state.status === 'error') return 'error';
    return 'idle';
  });
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(
    cachedQueryOnInit?.state.dataUpdatedAt ?? 0,
  );

  // Refs for stable callbacks and preventing race conditions
  const queryKeyHash = useMemo(() => hashQueryKey(queryKey), [queryKey]);
  const isMounted = useRef(true);
  const fetchCount = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  // keepPreviousData: which queryKeyHash the current `data` belongs to. When it
  // lags `queryKeyHash` (a key change is in flight) the carried-over pages are
  // "previous data": we keep rendering them and flag isPreviousData. Also lets
  // the initial-fetch effect distinguish "no data" from "data for the old key"
  // so a changed key actually refetches. Initialised to the mount key (any
  // initial `data` came from that key's cache entry).
  const dataKeyRef = useRef(queryKeyHash);
  // suspense: the in-flight initial-page prime promise thrown to a <Suspense>
  // boundary. Cleared when it settles so a fresh mount can re-prime.
  const suspendPromiseRef = useRef<Promise<void> | null>(null);

  // Get retry configuration
  const retryConfig = useMemo(() => {
    if (typeof retry === 'number') {
      return { ...DEFAULT_RETRY, attempts: retry };
    }
    if (typeof retry === 'boolean') {
      return retry ? DEFAULT_RETRY : { ...DEFAULT_RETRY, attempts: 0 };
    }
    return { ...DEFAULT_RETRY, ...retry };
  }, [retry]);

  // Determine if data is stale
  const isStale = useMemo(() => {
    if (staleTime === Infinity) return false;
    if (staleTime === 0) return true;
    return timeUtils.isExpired(dataUpdatedAt, staleTime);
  }, [dataUpdatedAt, staleTime]);

  // Calculate hasNextPage and hasPreviousPage
  const hasNextPage = useMemo(() => {
    if (!data || data.pages.length === 0) return false;
    const lastPage = data.pages[data.pages.length - 1]!;
    return getNextPageParam(lastPage, data.pages) !== undefined;
  }, [data, getNextPageParam]);

  const hasPreviousPage = useMemo(() => {
    if (!data || data.pages.length === 0 || !getPreviousPageParam) return false;
    const firstPage = data.pages[0]!;
    return getPreviousPageParam(firstPage, data.pages) !== undefined;
  }, [data, getPreviousPageParam]);

  // Execute fetch with retry logic
  const executeFetchPage = useCallback(
    async (pageParam: TPageParam, signal: AbortSignal): Promise<TData> => {
      let lastError: TError | null = null;

      for (let attempt = 0; attempt <= retryConfig.attempts; attempt++) {
        try {
          if (signal.aborted) {
            throw new Error('Query was cancelled');
          }

          const context: InfiniteQueryFunctionContext<TPageParam> = {
            queryKey,
            signal,
            pageParam,
          };

          return await queryFn(context);
        } catch (err) {
          lastError = err as TError;

          const shouldRetry =
            attempt < retryConfig.attempts && (retryConfig.retryCondition?.(err as Error, attempt) ?? true);

          if (!shouldRetry) break;

          const delay = calculateRetryDelay(attempt, retryConfig);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw lastError;
    },
    [queryKey, queryFn, retryConfig]
  );

  // Fetch initial page
  const fetchInitialPage = useCallback(async (): Promise<void> => {
    const currentFetch = ++fetchCount.current;
    const queryCache = client.getQueryCache();

    // Abort any existing fetch
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsFetching(true);
    if (status === 'idle') setStatus('loading');

    try {
      const result = await executeFetchPage(initialPageParam, controller.signal);

      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      const infiniteData: InfiniteData<TData> = {
        pages: [result],
        pageParams: [initialPageParam],
      };

      setData(infiniteData);
      dataKeyRef.current = queryKeyHash; // these pages now belong to the current key
      setError(null);
      setStatus('success');
      setDataUpdatedAt(timeUtils.now());

      // Update cache
      queryCache.set(queryKey, infiniteData, staleTime, true); // NR-13: staleTime; NR-3b: isInfinite

      onSuccess?.(infiniteData);
    } catch (err) {
      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      const typedError = err as TError;
      setError(typedError);
      setStatus('error');

      onError?.(typedError);
    } finally {
      if (isMounted.current && currentFetch === fetchCount.current) {
        setIsFetching(false);
      }
    }
  }, [client, executeFetchPage, initialPageParam, onError, onSuccess, queryKey, queryKeyHash, status]);

  // suspense: fetch the initial page and write it to the shared cache WITHOUT
  // touching component state (this runs during render, in the throw path). On
  // the post-resolve retry the cache-seeded initial state renders normally —
  // mirrors useQuery's getOrCreateFetch-on-suspend, adapted to the infinite
  // cache entry.
  const suspendInitialFetch = useCallback((): Promise<void> => {
    const queryCache = client.getQueryCache();
    const controller = new AbortController();
    return executeFetchPage(initialPageParam, controller.signal).then((result) => {
      const infiniteData: InfiniteData<TData> = { pages: [result], pageParams: [initialPageParam] };
      queryCache.set(queryKey, infiniteData, staleTime, true);
    });
  }, [client, executeFetchPage, initialPageParam, queryKey, staleTime]);

  // Fetch next page
  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (!data || data.pages.length === 0 || !hasNextPage || isFetchingNextPage) return;

    const currentFetch = ++fetchCount.current;
    const queryCache = client.getQueryCache();

    // Abort any existing fetch
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsFetching(true);
    setIsFetchingNextPage(true);

    try {
      const lastPage = data.pages[data.pages.length - 1]!;
      const nextPageParam = getNextPageParam(lastPage, data.pages);

      if (nextPageParam === undefined) {
        return;
      }

      const result = await executeFetchPage(nextPageParam as TPageParam, controller.signal);

      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      let newPages = [...data.pages, result];
      let newPageParams = [...data.pageParams, nextPageParam];

      // Enforce maxPages limit (remove from front)
      if (maxPages && newPages.length > maxPages) {
        newPages = newPages.slice(-maxPages);
        newPageParams = newPageParams.slice(-maxPages);
      }

      const infiniteData: InfiniteData<TData> = {
        pages: newPages,
        pageParams: newPageParams,
      };

      setData(infiniteData);
      setError(null);
      setDataUpdatedAt(timeUtils.now());

      // Update cache
      queryCache.set(queryKey, infiniteData, staleTime, true); // NR-13: staleTime; NR-3b: isInfinite

      onSuccess?.(infiniteData);
    } catch (err) {
      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      const typedError = err as TError;
      setError(typedError);

      onError?.(typedError);
    } finally {
      if (isMounted.current && currentFetch === fetchCount.current) {
        setIsFetching(false);
        setIsFetchingNextPage(false);
      }
    }
  }, [
    client,
    data,
    executeFetchPage,
    getNextPageParam,
    hasNextPage,
    isFetchingNextPage,
    maxPages,
    onError,
    onSuccess,
    queryKey,
  ]);

  // Fetch previous page
  const fetchPreviousPage = useCallback(async (): Promise<void> => {
    if (!data || data.pages.length === 0 || !hasPreviousPage || !getPreviousPageParam || isFetchingPreviousPage) {
      return;
    }

    const currentFetch = ++fetchCount.current;
    const queryCache = client.getQueryCache();

    // Abort any existing fetch
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsFetching(true);
    setIsFetchingPreviousPage(true);

    try {
      const firstPage = data.pages[0]!;
      const previousPageParam = getPreviousPageParam(firstPage, data.pages);

      if (previousPageParam === undefined) {
        return;
      }

      const result = await executeFetchPage(previousPageParam as TPageParam, controller.signal);

      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      let newPages = [result, ...data.pages];
      let newPageParams = [previousPageParam, ...data.pageParams];

      // Enforce maxPages limit (remove from back)
      if (maxPages && newPages.length > maxPages) {
        newPages = newPages.slice(0, maxPages);
        newPageParams = newPageParams.slice(0, maxPages);
      }

      const infiniteData: InfiniteData<TData> = {
        pages: newPages,
        pageParams: newPageParams,
      };

      setData(infiniteData);
      setError(null);
      setDataUpdatedAt(timeUtils.now());

      // Update cache
      queryCache.set(queryKey, infiniteData, staleTime, true); // NR-13: staleTime; NR-3b: isInfinite

      onSuccess?.(infiniteData);
    } catch (err) {
      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      const typedError = err as TError;
      setError(typedError);

      onError?.(typedError);
    } finally {
      if (isMounted.current && currentFetch === fetchCount.current) {
        setIsFetching(false);
        setIsFetchingPreviousPage(false);
      }
    }
  }, [
    client,
    data,
    executeFetchPage,
    getPreviousPageParam,
    hasPreviousPage,
    isFetchingPreviousPage,
    maxPages,
    onError,
    onSuccess,
    queryKey,
  ]);

  // Refetch all pages
  const refetch = useCallback(async (): Promise<void> => {
    if (!data || data.pages.length === 0) {
      // No data yet, fetch initial page
      await fetchInitialPage();
      return;
    }

    const currentFetch = ++fetchCount.current;
    const queryCache = client.getQueryCache();

    // Abort any existing fetch
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsFetching(true);

    try {
      // Refetch all pages sequentially to preserve order
      const newPages: TData[] = [];
      const newPageParams: unknown[] = [];

      for (let i = 0; i < data.pageParams.length; i++) {
        if (controller.signal.aborted) {
          throw new Error('Query was cancelled');
        }

        const pageParam = data.pageParams[i] as TPageParam;
        const result = await executeFetchPage(pageParam, controller.signal);

        newPages.push(result);
        newPageParams.push(pageParam);
      }

      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      const infiniteData: InfiniteData<TData> = {
        pages: newPages,
        pageParams: newPageParams,
      };

      setData(infiniteData);
      setError(null);
      setStatus('success');
      setDataUpdatedAt(timeUtils.now());

      // Update cache
      queryCache.set(queryKey, infiniteData, staleTime, true); // NR-13: staleTime; NR-3b: isInfinite

      onSuccess?.(infiniteData);
    } catch (err) {
      if (!isMounted.current || currentFetch !== fetchCount.current) return;

      const typedError = err as TError;
      setError(typedError);
      setStatus('error');

      onError?.(typedError);
    } finally {
      if (isMounted.current && currentFetch === fetchCount.current) {
        setIsFetching(false);
      }
    }
  }, [client, data, executeFetchPage, fetchInitialPage, onError, onSuccess, queryKey]);

  // Initial fetch effect
  useEffect(() => {
    if (!enabled || isHydrating) return;

    // Check if we need to fetch
    const cached = client.getQueryCache().get<InfiniteData<TData>>(queryKey, true);
    const needsFetch = cached === undefined || isStale;
    // A key change leaves `data` holding the PREVIOUS key's pages (carried over
    // for keepPreviousData). Treat that the same as "no data for this key" so the
    // new key actually loads — the bare `!data` guard would skip the fetch.
    const hasDataForThisKey = dataKeyRef.current === queryKeyHash && data !== undefined;

    if (needsFetch && !hasDataForThisKey) {
      fetchInitialPage().catch(() => {
        // Error already handled in fetchInitialPage
      });
    } else if (cached !== undefined && !hasDataForThisKey) {
      // Sync from cache (e.g. the new key was already cached)
      setData(cached);
      setStatus('success');
      dataKeyRef.current = queryKeyHash;
    }
  }, [queryKeyHash, enabled, isHydrating]);

  // Cache subscription — keep local mirror in lockstep with the
  // shared store on every mutation (write/error/invalidate/evict)
  // and forward the per-observer cacheTime hint for GC.
  useEffect(() => {
    const cache = client.getQueryCache();
    const unsubscribe = cache.subscribe(
      queryKey,
      () => {
        const query = cache.getQuery<InfiniteData<TData>, TError>(queryKey, true);
        if (!query) {
          setData(undefined);
          setStatus('idle');
          setDataUpdatedAt(0);
          return;
        }
        const s = query.state;
        setData(s.data);
        setError(s.error);
        setStatus(s.status === 'loading' ? (s.data !== undefined ? 'success' : 'loading') : s.status);
        setDataUpdatedAt(s.dataUpdatedAt);
        if (s.data !== undefined) dataKeyRef.current = queryKeyHash; // mirror belongs to current key
      },
      cacheTime,
      true, // NR-3b: subscribe to the infinite-query variant
    );

    return unsubscribe;
  }, [client, queryKeyHash, cacheTime]);

  // Mount/unmount tracking. See useQuery for the StrictMode
  // rationale — without explicit `isMounted.current = true` on
  // the mount path the ref stays `false` after the dev double-
  // mount cleanup and every subsequent state update is dropped.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  // keepPreviousData: while a key change is in flight the carried-over pages
  // (still in `data`) belong to the PREVIOUS key. Surface that via isPreviousData;
  // gated on the option (default off → always false).
  const isPreviousData =
    keepPreviousData && dataKeyRef.current !== queryKeyHash && data !== undefined;

  // Return result
  const result = useMemo(
    () => ({
      data,
      error,
      status,
      isLoading: status === 'loading',
      isFetching,
      isFetchingNextPage,
      isFetchingPreviousPage,
      isError: status === 'error',
      isSuccess: status === 'success',
      isPreviousData,
      hasNextPage,
      hasPreviousPage,
      fetchNextPage,
      fetchPreviousPage,
      refetch,
    }),
    [
      data,
      error,
      status,
      isFetching,
      isFetchingNextPage,
      isFetchingPreviousPage,
      isPreviousData,
      hasNextPage,
      hasPreviousPage,
      fetchNextPage,
      fetchPreviousPage,
      refetch,
    ]
  );

  // suspense: on the initial cold load (no pages yet) throw the in-flight prime
  // so a <Suspense> boundary shows its fallback. The prime fetches page 1 into
  // the shared cache; when it resolves React re-renders and the cache-seeded
  // initial state satisfies this hook without a throw. AFTER all hooks; gated on
  // the option (default off). keepPreviousData keeps `data` defined across a key
  // change, so this only fires for a genuine cold load, never a key swap.
  if (suspense && error === null && data === undefined && enabled && !isHydrating) {
    if (!suspendPromiseRef.current) {
      suspendPromiseRef.current = suspendInitialFetch().finally(() => {
        suspendPromiseRef.current = null;
      });
    }
    throw suspendPromiseRef.current;
  }

  // useErrorBoundary: re-throw a query error (boolean or predicate) to the
  // nearest React error boundary during render. AFTER all hooks; gated on the
  // option (default off → `result` returned unchanged).
  if (error !== null) {
    const escalate =
      typeof errorBoundary === 'function' ? errorBoundary(error) : !!errorBoundary;
    if (escalate) throw error;
  }

  return result;
}

export default useInfiniteQuery;
