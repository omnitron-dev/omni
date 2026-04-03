'use client';

/**
 * useLazyQuery Hook
 *
 * A hook for manual query execution with loading, error, and caching support.
 *
 * @module @omnitron/prism/hooks/use-lazy-query
 */

import { useState, useCallback, useRef } from 'react';

/**
 * State for a lazy query.
 */
export interface LazyQueryState<TData, TError> {
  /** Query result data */
  data: TData | undefined;
  /** Error from query */
  error: TError | undefined;
  /** Whether query is currently executing */
  isLoading: boolean;
  /** Whether query has succeeded at least once */
  isSuccess: boolean;
  /** Whether query has failed */
  isError: boolean;
  /** Whether query has been called at least once */
  isCalled: boolean;
  /** Whether query is fetching (includes refetch) */
  isFetching: boolean;
  /** Whether this is a refetch */
  isRefetching: boolean;
}

/**
 * Options for useLazyQuery hook.
 */
export interface UseLazyQueryOptions<TData, TError, TVariables> {
  /** Called on successful query */
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  /** Called on query error */
  onError?: (error: TError, variables: TVariables) => void | Promise<void>;
  /** Called after query settles (success or error) */
  onSettled?: (data: TData | undefined, error: TError | undefined, variables: TVariables) => void | Promise<void>;
  /** Cache time in ms (0 = no cache) */
  cacheTime?: number;
  /** Stale time in ms (data considered fresh for this duration) */
  staleTime?: number;
  /** Retry count on failure */
  retry?: number | boolean;
  /** Delay between retries in ms */
  retryDelay?: number | ((attempt: number) => number);
  /** Initial data */
  initialData?: TData;
}

/**
 * Return type for useLazyQuery hook.
 */
export interface UseLazyQueryReturn<TData, TError, TVariables> {
  /** Current query state */
  data: TData | undefined;
  error: TError | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isCalled: boolean;
  isFetching: boolean;
  isRefetching: boolean;
  /** Execute the query */
  query: (variables: TVariables) => Promise<TData>;
  /** Refetch with last variables */
  refetch: () => Promise<TData | undefined>;
  /** Reset query state */
  reset: () => void;
  /** Manually set data */
  setData: (data: TData | ((prev: TData | undefined) => TData)) => void;
}

interface CacheEntry<TData> {
  data: TData;
  timestamp: number;
  variables: unknown;
}

const defaultRetryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000);

/**
 * Hook for manual query execution with caching support.
 *
 * @param queryFn - Async function to execute
 * @param options - Configuration options
 * @returns Query state and control methods
 *
 * @example
 * ```tsx
 * function UserSearch() {
 *   const users = useLazyQuery(
 *     async (query: string) => {
 *       const response = await fetch(`/api/users?q=${query}`);
 *       if (!response.ok) throw new Error('Search failed');
 *       return response.json();
 *     },
 *     {
 *       onSuccess: (data) => console.log('Found users:', data.length),
 *       cacheTime: 5 * 60 * 1000, // 5 minutes
 *     }
 *   );
 *
 *   const handleSearch = async (query: string) => {
 *     const results = await users.query(query);
 *     console.log('Results:', results);
 *   };
 *
 *   return (
 *     <div>
 *       <SearchInput onSearch={handleSearch} />
 *       {users.isLoading && <Spinner />}
 *       {users.isError && <div>Error: {String(users.error)}</div>}
 *       {users.data?.map((user) => <UserCard key={user.id} user={user} />)}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With caching
 * const userDetails = useLazyQuery(
 *   async (id: string) => fetchUser(id),
 *   {
 *     cacheTime: 10 * 60 * 1000, // Keep in cache for 10 min
 *     staleTime: 60 * 1000, // Consider fresh for 1 min
 *   }
 * );
 *
 * // First call fetches, subsequent calls within staleTime return cache
 * await userDetails.query('123');
 * await userDetails.query('123'); // Returns from cache if not stale
 * ```
 *
 * @example
 * ```tsx
 * // Manual data management
 * const { data, setData, reset } = useLazyQuery(fetchData);
 *
 * // Optimistic update
 * setData((prev) => prev ? { ...prev, count: prev.count + 1 } : prev);
 *
 * // Reset to clean state
 * reset();
 * ```
 */
export function useLazyQuery<TData = unknown, TError = Error, TVariables = void>(
  queryFn: (variables: TVariables) => Promise<TData>,
  options: UseLazyQueryOptions<TData, TError, TVariables> = {}
): UseLazyQueryReturn<TData, TError, TVariables> {
  const {
    onSuccess,
    onError,
    onSettled,
    cacheTime = 0,
    staleTime = 0,
    retry = 0,
    retryDelay = defaultRetryDelay,
    initialData,
  } = options;

  const [state, setState] = useState<LazyQueryState<TData, TError>>({
    data: initialData,
    error: undefined,
    isLoading: false,
    isSuccess: !!initialData,
    isError: false,
    isCalled: !!initialData,
    isFetching: false,
    isRefetching: false,
  });

  // Track query ID for race conditions
  const queryIdRef = useRef(0);
  const lastVariablesRef = useRef<TVariables | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry<TData>>>(new Map());

  // Generate cache key from variables
  const getCacheKey = useCallback((variables: TVariables): string => JSON.stringify(variables), []);

  // Check if cache entry is valid
  const isCacheValid = useCallback(
    (entry: CacheEntry<TData> | undefined): boolean => {
      if (!entry || cacheTime === 0) return false;
      const age = Date.now() - entry.timestamp;
      return age < cacheTime;
    },
    [cacheTime]
  );

  // Check if cache entry is fresh (not stale)
  const isCacheFresh = useCallback(
    (entry: CacheEntry<TData> | undefined): boolean => {
      if (!entry || staleTime === 0) return false;
      const age = Date.now() - entry.timestamp;
      return age < staleTime;
    },
    [staleTime]
  );

  // Execute query
  const query = useCallback(
    async (variables: TVariables): Promise<TData> => {
      const currentId = ++queryIdRef.current;
      lastVariablesRef.current = variables;

      // Check cache
      const cacheKey = getCacheKey(variables);
      const cached = cacheRef.current.get(cacheKey);

      if (isCacheFresh(cached)) {
        // Return fresh cached data immediately
        setState((prev) => ({
          ...prev,
          data: cached!.data,
          isSuccess: true,
          isCalled: true,
        }));
        return cached!.data;
      }

      // If cache is valid but stale, update state with cached data while fetching
      if (isCacheValid(cached)) {
        setState({
          data: cached!.data,
          error: undefined,
          isLoading: false,
          isSuccess: true,
          isError: false,
          isCalled: true,
          isFetching: true,
          isRefetching: true,
        });
      } else {
        setState({
          data: undefined,
          error: undefined,
          isLoading: true,
          isSuccess: false,
          isError: false,
          isCalled: true,
          isFetching: true,
          isRefetching: false,
        });
      }

      const executeWithRetry = async (attempt: number): Promise<TData> => {
        try {
          const data = await queryFn(variables);

          // Check if this query was superseded
          if (queryIdRef.current !== currentId) {
            return data;
          }

          // Update cache
          cacheRef.current.set(cacheKey, {
            data,
            timestamp: Date.now(),
            variables,
          });

          setState({
            data,
            error: undefined,
            isLoading: false,
            isSuccess: true,
            isError: false,
            isCalled: true,
            isFetching: false,
            isRefetching: false,
          });

          // Call success callbacks
          await onSuccess?.(data, variables);
          await onSettled?.(data, undefined, variables);

          return data;
        } catch (err) {
          // Check if this query was superseded
          if (queryIdRef.current !== currentId) {
            throw err;
          }

          const error = err as TError;
          const maxRetries = typeof retry === 'boolean' ? (retry ? 3 : 0) : retry;

          // Retry if configured
          if (attempt < maxRetries) {
            const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
            await new Promise((resolve) => setTimeout(resolve, delay));
            return executeWithRetry(attempt + 1);
          }

          setState({
            data: undefined,
            error,
            isLoading: false,
            isSuccess: false,
            isError: true,
            isCalled: true,
            isFetching: false,
            isRefetching: false,
          });

          // Call error callbacks
          await onError?.(error, variables);
          await onSettled?.(undefined, error, variables);

          throw error;
        }
      };

      return executeWithRetry(0);
    },
    [queryFn, getCacheKey, isCacheFresh, isCacheValid, onSuccess, onError, onSettled, retry, retryDelay]
  );

  // Refetch with last variables
  const refetch = useCallback(async (): Promise<TData | undefined> => {
    if (lastVariablesRef.current === null) {
      return undefined;
    }
    return query(lastVariablesRef.current);
  }, [query]);

  // Reset state
  const reset = useCallback(() => {
    queryIdRef.current++;
    lastVariablesRef.current = null;
    cacheRef.current.clear();
    setState({
      data: initialData,
      error: undefined,
      isLoading: false,
      isSuccess: !!initialData,
      isError: false,
      isCalled: !!initialData,
      isFetching: false,
      isRefetching: false,
    });
  }, [initialData]);

  // Manual data setter
  const setData = useCallback((data: TData | ((prev: TData | undefined) => TData)) => {
    setState((prev) => {
      const newData = typeof data === 'function' ? (data as (prev: TData | undefined) => TData)(prev.data) : data;
      return {
        ...prev,
        data: newData,
        isSuccess: true,
      };
    });
  }, []);

  return {
    ...state,
    query,
    refetch,
    reset,
    setData,
  };
}
