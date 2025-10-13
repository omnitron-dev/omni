/**
 * @fileoverview useQuery reactive hook for data fetching
 * @module @omnitron-dev/aether/netron
 */

import { inject } from '../../di/index.js';
import { signal, computed, effect, onCleanup } from '../../core/index.js';
import { resource } from '../../core/reactivity/resource.js';
import { NetronClient } from '../client.js';
import { getBackendName, getServiceName } from '../decorators/index.js';
import type { WritableSignal } from '../../core/reactivity/types.js';
import type { Type, QueryOptions, QueryResult } from '../types.js';

/**
 * useQuery - Reactive hook for data fetching with caching
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @param args - Method arguments
 * @param options - Query options
 * @returns Query result with reactive signals
 *
 * @example
 * ```typescript
 * const { data, loading, error, refetch } = useQuery(
 *   UserService,
 *   'getUsers',
 *   [],
 *   { cache: 60000 }
 * );
 * ```
 */
export function useQuery<TService, TMethod extends keyof TService>(
  serviceClass: Type<TService> | string,
  method: TMethod,
  args: TService[TMethod] extends (...args: infer P) => any ? P : never,
  options?: QueryOptions
): QueryResult<TService[TMethod] extends (...args: any[]) => Promise<infer R> ? R : never> {
  // Get NetronClient from DI
  const netron = inject(NetronClient);

  // Extract backend and service names
  const backendName = typeof serviceClass === 'string' ? 'main' : getBackendName(serviceClass);
  const serviceName = typeof serviceClass === 'string' ? serviceClass : getServiceName(serviceClass);

  // Create enabled signal
  const enabled = signal(options?.enabled !== false);

  // Track if currently fetching
  const isFetching = signal(false);

  // Track if data is stale
  const isStale = signal(false);

  // Create resource for async data
  const resourceImpl = resource(async () => {
    // Check if query is enabled
    if (!enabled()) {
      return options?.fallback;
    }

    isFetching.set(true);
    try {
      const result = await netron.query(serviceName, method as string, args as any[], options, backendName);
      isStale.set(false);
      return result;
    } finally {
      isFetching.set(false);
    }
  });

  // Handle refetch on mount
  if (options?.refetchOnMount) {
    // Use effect to trigger on mount
    effect(() => {
      resourceImpl.refetch();
    });
  }

  // Handle refetch on window focus
  if (options?.refetchOnFocus) {
    const handleFocus = () => {
      if (!document.hidden) {
        resourceImpl.refetch();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleFocus);

      onCleanup(() => {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleFocus);
      });
    }
  }

  // Handle refetch interval
  if (options?.refetchInterval) {
    const interval = setInterval(() => {
      resourceImpl.refetch();
    }, options.refetchInterval);

    onCleanup(() => {
      clearInterval(interval);
    });
  }

  // Return query result
  return {
    data: computed(() => resourceImpl()) as any,
    loading: computed(() => resourceImpl.loading()),
    error: computed(() => resourceImpl.error()),
    refetch: () => resourceImpl.refetch(),
    isFetching,
    isStale,
  };
}

/**
 * useQueries - Execute multiple queries in parallel
 *
 * @param queries - Array of query configurations
 * @returns Array of query results
 *
 * @example
 * ```typescript
 * const results = useQueries([
 *   { service: UserService, method: 'getUsers', args: [] },
 *   { service: PostService, method: 'getPosts', args: [] },
 * ]);
 * ```
 */
export function useQueries<
  T extends ReadonlyArray<{
    service: Type<any> | string;
    method: string;
    args: any[];
    options?: QueryOptions;
  }>,
>(queries: T): { [K in keyof T]: QueryResult } {
  return queries.map((query) => useQuery(query.service, query.method, query.args, query.options)) as any;
}

/**
 * usePaginatedQuery - Query with pagination support
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @param page - Current page signal
 * @param pageSize - Page size
 * @param options - Query options
 * @returns Paginated query result
 *
 * @example
 * ```typescript
 * const page = signal(1);
 * const { data, loading, nextPage, prevPage } = usePaginatedQuery(
 *   UserService,
 *   'getUsers',
 *   page,
 *   10
 * );
 * ```
 */
export function usePaginatedQuery<TService, TMethod extends keyof TService>(
  serviceClass: Type<TService> | string,
  method: TMethod,
  page: WritableSignal<number>,
  pageSize: number,
  options?: QueryOptions
) {
  // Track total pages
  const totalPages = signal(0);

  // Build args with pagination
  const args = computed(() => [
    {
      page: page(),
      pageSize,
    },
  ]);

  // Execute query with reactive args
  const result = useQuery(serviceClass, method, args() as any, options);

  // Extract total pages from response
  effect(() => {
    const data = result.data() as any;
    if (data?.totalPages) {
      totalPages.set(data.totalPages);
    }
  });

  // Navigation helpers
  const nextPage = () => {
    if (page() < totalPages()) {
      page.set(page() + 1);
    }
  };

  const prevPage = () => {
    if (page() > 1) {
      page.set(page() - 1);
    }
  };

  const goToPage = (pageNum: number) => {
    if (pageNum >= 1 && pageNum <= totalPages()) {
      page.set(pageNum);
    }
  };

  return {
    ...result,
    page: computed(() => page()),
    totalPages,
    hasNextPage: computed(() => page() < totalPages()),
    hasPrevPage: computed(() => page() > 1),
    nextPage,
    prevPage,
    goToPage,
  };
}

/**
 * useInfiniteQuery - Query with infinite scroll support
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @param getNextPageParam - Function to get next page param
 * @param options - Query options
 * @returns Infinite query result
 *
 * @example
 * ```typescript
 * const { data, loading, fetchNextPage, hasNextPage } = useInfiniteQuery(
 *   UserService,
 *   'getUsers',
 *   (lastPage) => lastPage.nextCursor
 * );
 * ```
 */
export function useInfiniteQuery<
  TService,
  TMethod extends keyof TService,
  TData = TService[TMethod] extends (...args: any[]) => Promise<infer R> ? R : any,
>(
  serviceClass: Type<TService> | string,
  method: TMethod,
  getNextPageParam: (lastPage: TData, allPages: TData[]) => any,
  options?: QueryOptions
) {
  // Track all pages
  const pages = signal<TData[]>([]);
  const nextPageParam = signal<any>(undefined);
  const isFetchingNextPage = signal(false);

  // Extract backend and service names
  const netron = inject(NetronClient);
  const backendName = typeof serviceClass === 'string' ? 'main' : getBackendName(serviceClass);
  const serviceName = typeof serviceClass === 'string' ? serviceClass : getServiceName(serviceClass);

  // Fetch next page
  const fetchNextPage = async (): Promise<any> => {
    if (isFetchingNextPage() || !nextPageParam()) return undefined;

    isFetchingNextPage.set(true);
    try {
      const result = await netron.query(serviceName, method as string, [nextPageParam()], options, backendName);

      // Add to pages
      pages.set([...pages(), result as TData]);

      // Calculate next page param
      const next = getNextPageParam(result as TData, pages());
      nextPageParam.set(next);

      return result;
    } finally {
      isFetchingNextPage.set(false);
    }
  };

  // Initial fetch
  const { data, loading, error, refetch } = useQuery(serviceClass, method, [] as any, options);

  // Update pages when initial data loads
  effect(() => {
    const initialData = data();
    if (initialData && pages().length === 0) {
      pages.set([initialData as TData]);
      const next = getNextPageParam(initialData as TData, [initialData as TData]);
      nextPageParam.set(next);
    }
  });

  return {
    data: computed(() => pages()),
    loading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage: computed(() => !!nextPageParam()),
    isFetchingNextPage,
  };
}
