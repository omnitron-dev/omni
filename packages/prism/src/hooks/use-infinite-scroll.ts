'use client';

/**
 * useInfiniteScroll Hook
 *
 * A hook for infinite scrolling with paginated data loading.
 *
 * @module @omnitron-dev/prism/hooks/use-infinite-scroll
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Page info returned from fetch function.
 */
export interface PageInfo {
  /** Whether there are more pages */
  hasNextPage: boolean;
  /** Cursor or token for next page */
  endCursor?: string | number;
  /** Total count (optional) */
  totalCount?: number;
}

/**
 * Page data structure.
 */
export interface InfinitePage<TData> {
  /** Items in this page */
  items: TData[];
  /** Page information */
  pageInfo: PageInfo;
}

/**
 * State for infinite scroll.
 */
export interface InfiniteScrollState<TData, TError> {
  /** All loaded items (flattened) */
  items: TData[];
  /** All pages */
  pages: InfinitePage<TData>[];
  /** Error from last fetch */
  error: TError | undefined;
  /** Whether initial load is in progress */
  isLoading: boolean;
  /** Whether more data is being fetched */
  isFetchingMore: boolean;
  /** Whether there are more pages to fetch */
  hasNextPage: boolean;
  /** Whether any data has been loaded */
  isEmpty: boolean;
  /** Total count if available */
  totalCount: number | undefined;
}

/**
 * Options for useInfiniteScroll hook.
 */
export interface UseInfiniteScrollOptions<TData, TError> {
  /** Called on successful fetch */
  onSuccess?: (page: InfinitePage<TData>) => void | Promise<void>;
  /** Called on fetch error */
  onError?: (error: TError) => void | Promise<void>;
  /** Initial cursor/offset */
  initialCursor?: string | number;
  /** Initial page size */
  pageSize?: number;
  /** Retry count on failure */
  retry?: number | boolean;
  /** Retry delay in ms */
  retryDelay?: number | ((attempt: number) => number);
  /** Intersection observer options for auto-loading */
  observerOptions?: IntersectionObserverInit;
}

/**
 * Return type for useInfiniteScroll hook.
 */
export interface UseInfiniteScrollReturn<TData, TError> {
  /** All loaded items (flattened) */
  items: TData[];
  /** All pages */
  pages: InfinitePage<TData>[];
  /** Error from last fetch */
  error: TError | undefined;
  /** Whether initial load is in progress */
  isLoading: boolean;
  /** Whether more data is being fetched */
  isFetchingMore: boolean;
  /** Whether there are more pages to fetch */
  hasNextPage: boolean;
  /** Whether list is empty */
  isEmpty: boolean;
  /** Total count if available */
  totalCount: number | undefined;
  /** Fetch the next page */
  fetchNextPage: () => Promise<void>;
  /** Fetch first page (refresh) */
  refresh: () => Promise<void>;
  /** Reset to initial state */
  reset: () => void;
  /** Ref to attach to sentinel element for auto-loading */
  sentinelRef: React.RefCallback<HTMLElement>;
  /** Manually prepend items */
  prependItems: (items: TData[]) => void;
  /** Manually append items */
  appendItems: (items: TData[]) => void;
  /** Remove item by predicate */
  removeItem: (predicate: (item: TData) => boolean) => void;
  /** Update item by predicate */
  updateItem: (predicate: (item: TData) => boolean, update: Partial<TData> | ((item: TData) => TData)) => void;
}

/**
 * Fetch function signature.
 */
export type InfiniteFetchFn<TData> = (params: {
  cursor?: string | number;
  pageSize: number;
}) => Promise<InfinitePage<TData>>;

const defaultRetryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000);

/**
 * Hook for infinite scrolling with paginated data.
 *
 * @param fetchFn - Function to fetch a page of data
 * @param options - Configuration options
 * @returns Infinite scroll state and controls
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const {
 *     items,
 *     isLoading,
 *     isFetchingMore,
 *     hasNextPage,
 *     fetchNextPage,
 *     sentinelRef,
 *   } = useInfiniteScroll<User>(
 *     async ({ cursor, pageSize }) => {
 *       const response = await fetch(
 *         `/api/users?cursor=${cursor ?? ''}&limit=${pageSize}`
 *       );
 *       const data = await response.json();
 *       return {
 *         items: data.users,
 *         pageInfo: {
 *           hasNextPage: data.hasMore,
 *           endCursor: data.nextCursor,
 *           totalCount: data.total,
 *         },
 *       };
 *     },
 *     { pageSize: 20 }
 *   );
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <div>
 *       {items.map((user) => (
 *         <UserCard key={user.id} user={user} />
 *       ))}
 *       {hasNextPage && (
 *         <div ref={sentinelRef}>
 *           {isFetchingMore ? <Spinner /> : 'Load more'}
 *         </div>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Manual loading
 * function ProductList() {
 *   const { items, hasNextPage, fetchNextPage, isFetchingMore } = useInfiniteScroll(
 *     fetchProducts,
 *     { pageSize: 10 }
 *   );
 *
 *   return (
 *     <>
 *       <ProductGrid items={items} />
 *       {hasNextPage && (
 *         <Button onClick={fetchNextPage} loading={isFetchingMore}>
 *           Load More
 *         </Button>
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With optimistic updates
 * const { items, removeItem, updateItem, prependItems } = useInfiniteScroll(
 *   fetchComments,
 *   { pageSize: 20 }
 * );
 *
 * // Add new comment at top
 * const handleNewComment = (comment: Comment) => {
 *   prependItems([comment]);
 * };
 *
 * // Delete comment
 * const handleDelete = (id: string) => {
 *   removeItem((c) => c.id === id);
 * };
 *
 * // Update comment
 * const handleEdit = (id: string, text: string) => {
 *   updateItem((c) => c.id === id, { text });
 * };
 * ```
 */
export function useInfiniteScroll<TData = unknown, TError = Error>(
  fetchFn: InfiniteFetchFn<TData>,
  options: UseInfiniteScrollOptions<TData, TError> = {}
): UseInfiniteScrollReturn<TData, TError> {
  const {
    onSuccess,
    onError,
    initialCursor,
    pageSize = 20,
    retry = 0,
    retryDelay = defaultRetryDelay,
    observerOptions = { threshold: 0.1 },
  } = options;

  const [state, setState] = useState<InfiniteScrollState<TData, TError>>({
    items: [],
    pages: [],
    error: undefined,
    isLoading: false,
    isFetchingMore: false,
    hasNextPage: true,
    isEmpty: true,
    totalCount: undefined,
  });

  // Refs for tracking
  const fetchIdRef = useRef(0);
  const cursorRef = useRef<string | number | undefined>(initialCursor);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelElementRef = useRef<HTMLElement | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // Fetch a page with retry logic
  const fetchPage = useCallback(
    async (cursor: string | number | undefined, isRefresh = false) => {
      const currentId = ++fetchIdRef.current;

      const executeWithRetry = async (attempt: number): Promise<void> => {
        if (!isMountedRef.current) return;

        setState((prev) => ({
          ...prev,
          isLoading: isRefresh && prev.pages.length === 0,
          isFetchingMore: !isRefresh || prev.pages.length > 0,
          error: undefined,
        }));

        try {
          const page = await fetchFn({ cursor, pageSize });

          // Check if this fetch was superseded
          if (fetchIdRef.current !== currentId || !isMountedRef.current) return;

          setState((prev) => {
            const newPages = isRefresh ? [page] : [...prev.pages, page];
            const newItems = newPages.flatMap((p) => p.items);
            return {
              items: newItems,
              pages: newPages,
              error: undefined,
              isLoading: false,
              isFetchingMore: false,
              hasNextPage: page.pageInfo.hasNextPage,
              isEmpty: newItems.length === 0,
              totalCount: page.pageInfo.totalCount,
            };
          });

          cursorRef.current = page.pageInfo.endCursor;
          await onSuccess?.(page);
        } catch (err) {
          if (fetchIdRef.current !== currentId || !isMountedRef.current) return;

          const error = err as TError;
          const maxRetries = typeof retry === 'boolean' ? (retry ? 3 : 0) : retry;

          if (attempt < maxRetries) {
            const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
            await new Promise((resolve) => setTimeout(resolve, delay));
            await executeWithRetry(attempt + 1);
            return;
          }

          setState((prev) => ({
            ...prev,
            error,
            isLoading: false,
            isFetchingMore: false,
          }));

          await onError?.(error);
        }
      };

      return executeWithRetry(0);
    },
    [fetchFn, pageSize, onSuccess, onError, retry, retryDelay]
  );

  // Fetch next page
  const fetchNextPage = useCallback(async () => {
    if (state.isFetchingMore || state.isLoading || !state.hasNextPage) return;
    await fetchPage(cursorRef.current);
  }, [fetchPage, state.isFetchingMore, state.isLoading, state.hasNextPage]);

  // Refresh (fetch first page)
  const refresh = useCallback(async () => {
    cursorRef.current = initialCursor;
    await fetchPage(initialCursor, true);
  }, [fetchPage, initialCursor]);

  // Reset to initial state
  const reset = useCallback(() => {
    fetchIdRef.current++;
    cursorRef.current = initialCursor;
    setState({
      items: [],
      pages: [],
      error: undefined,
      isLoading: false,
      isFetchingMore: false,
      hasNextPage: true,
      isEmpty: true,
      totalCount: undefined,
    });
  }, [initialCursor]);

  // Prepend items
  const prependItems = useCallback((newItems: TData[]) => {
    setState((prev) => ({
      ...prev,
      items: [...newItems, ...prev.items],
      isEmpty: newItems.length === 0 && prev.items.length === 0,
    }));
  }, []);

  // Append items
  const appendItems = useCallback((newItems: TData[]) => {
    setState((prev) => ({
      ...prev,
      items: [...prev.items, ...newItems],
      isEmpty: prev.items.length === 0 && newItems.length === 0,
    }));
  }, []);

  // Remove item by predicate
  const removeItem = useCallback((predicate: (item: TData) => boolean) => {
    setState((prev) => {
      const newItems = prev.items.filter((item) => !predicate(item));
      return {
        ...prev,
        items: newItems,
        isEmpty: newItems.length === 0,
      };
    });
  }, []);

  // Update item by predicate
  const updateItem = useCallback(
    (predicate: (item: TData) => boolean, update: Partial<TData> | ((item: TData) => TData)) => {
      setState((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          if (!predicate(item)) return item;
          if (typeof update === 'function') {
            return update(item);
          }
          return { ...item, ...update };
        }),
      }));
    },
    []
  );

  // Sentinel ref callback for auto-loading
  const sentinelRef = useCallback(
    (element: HTMLElement | null) => {
      // Disconnect previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      sentinelElementRef.current = element;

      if (!element) return;

      // Create new observer
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          fetchNextPage();
        }
      }, observerOptions);

      observerRef.current.observe(element);
    },
    [fetchNextPage, observerOptions]
  );

  // Initial fetch on mount
  useEffect(() => {
    fetchPage(initialCursor, true);
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    items: state.items,
    pages: state.pages,
    error: state.error,
    isLoading: state.isLoading,
    isFetchingMore: state.isFetchingMore,
    hasNextPage: state.hasNextPage,
    isEmpty: state.isEmpty,
    totalCount: state.totalCount,
    fetchNextPage,
    refresh,
    reset,
    sentinelRef,
    prependItems,
    appendItems,
    removeItem,
    updateItem,
  };
}
