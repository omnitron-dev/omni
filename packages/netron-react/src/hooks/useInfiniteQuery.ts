/**
 * useInfiniteQuery - Hook for paginated/infinite scroll data fetching
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { NetronError } from '@omnitron-dev/netron-browser';
import { useNetronClient, useDefaults, useHydration } from '../core/context.js';
import type { QueryKey, RetryConfig, QueryFunctionContext } from '../core/types.js';
import { hashQueryKey, calculateRetryDelay, timeUtils } from '../cache/utils.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context passed to infinite query function
 */
export interface InfiniteQueryFunctionContext<TPageParam> extends Omit<QueryFunctionContext, 'pageParam'> {
  pageParam: TPageParam;
}

/**
 * Infinite query options
 */
export interface InfiniteQueryOptions<TData, TError, TPageParam> {
  /** Unique query key */
  queryKey: QueryKey;
  /** Query function with page param */
  queryFn: (context: InfiniteQueryFunctionContext<TPageParam>) => Promise<TData>;
  /** Get next page param from last page */
  getNextPageParam: (lastPage: TData, allPages: TData[]) => TPageParam | undefined;
  /** Get previous page param from first page */
  getPreviousPageParam?: (firstPage: TData, allPages: TData[]) => TPageParam | undefined;
  /** Initial page param for first page */
  initialPageParam: TPageParam;
  /** Maximum pages to keep in memory */
  maxPages?: number;
  /** Time in ms before data is considered stale */
  staleTime?: number;
  /** Time in ms to keep unused data in cache */
  cacheTime?: number;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Retry configuration */
  retry?: number | boolean | RetryConfig;
  /** Success callback */
  onSuccess?: (data: InfiniteData<TData>) => void;
  /** Error callback */
  onError?: (error: TError) => void;
}

/**
 * Paginated data structure
 */
export interface InfiniteData<TData> {
  pages: TData[];
  pageParams: unknown[];
}

/**
 * Infinite query result
 */
export interface InfiniteQueryResult<TData, TError> {
  /** Paginated data */
  data: InfiniteData<TData> | undefined;
  /** Error if any */
  error: TError | null;
  /** Query status */
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Is initial loading */
  isLoading: boolean;
  /** Is currently fetching any page */
  isFetching: boolean;
  /** Is fetching next page */
  isFetchingNextPage: boolean;
  /** Is fetching previous page */
  isFetchingPreviousPage: boolean;
  /** Is error state */
  isError: boolean;
  /** Is success state */
  isSuccess: boolean;
  /** Has next page available */
  hasNextPage: boolean;
  /** Has previous page available */
  hasPreviousPage: boolean;
  /** Fetch next page */
  fetchNextPage: () => Promise<void>;
  /** Fetch previous page */
  fetchPreviousPage: () => Promise<void>;
  /** Refetch all pages */
  refetch: () => Promise<void>;
}

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
  } = options;

  // Reserved for future cache implementation
  void cacheTime;

  // State
  const [data, setData] = useState<InfiniteData<TData> | undefined>(() => {
    // Check cache first
    const cached = client.getQueryCache().get<InfiniteData<TData>>(queryKey);
    return cached;
  });

  const [error, setError] = useState<TError | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(() => {
    if (data !== undefined) return 'success';
    return 'idle';
  });
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(0);

  // Refs for stable callbacks and preventing race conditions
  const queryKeyHash = useMemo(() => hashQueryKey(queryKey), [queryKey]);
  const isMounted = useRef(true);
  const fetchCount = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

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
      setError(null);
      setStatus('success');
      setDataUpdatedAt(timeUtils.now());

      // Update cache
      queryCache.set(queryKey, infiniteData);

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
  }, [client, executeFetchPage, initialPageParam, onError, onSuccess, queryKey, status]);

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
      queryCache.set(queryKey, infiniteData);

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
      queryCache.set(queryKey, infiniteData);

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
      queryCache.set(queryKey, infiniteData);

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
    const cached = client.getQueryCache().get<InfiniteData<TData>>(queryKey);
    const needsFetch = cached === undefined || isStale;

    if (needsFetch && !data) {
      fetchInitialPage().catch(() => {
        // Error already handled in fetchInitialPage
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
      const cached = client.getQueryCache().get<InfiniteData<TData>>(queryKey);
      if (cached !== undefined) {
        setData(cached);
      }
    });

    return unsubscribe;
  }, [client, queryKeyHash]);

  // Cleanup
  useEffect(
    () => () => {
      isMounted.current = false;
      abortControllerRef.current?.abort();
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
      isFetching,
      isFetchingNextPage,
      isFetchingPreviousPage,
      isError: status === 'error',
      isSuccess: status === 'success',
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
      hasNextPage,
      hasPreviousPage,
      fetchNextPage,
      fetchPreviousPage,
      refetch,
    ]
  );
}

export default useInfiniteQuery;
