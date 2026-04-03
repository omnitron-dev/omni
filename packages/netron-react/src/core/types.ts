/**
 * Core type definitions for @omnitron-dev/netron-react
 */

import type { AuthenticationClient, NetronError } from '@omnitron-dev/netron-browser';

// ============================================================================
// Query Types
// ============================================================================

/**
 * Unique identifier for a query
 */
export type QueryKey = readonly unknown[];

/**
 * Query status
 */
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Mutation status
 */
export type MutationStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Number of retry attempts */
  attempts: number;
  /** Initial delay in ms */
  initialDelay?: number;
  /** Maximum delay in ms */
  maxDelay?: number;
  /** Backoff multiplier */
  backoff?: 'exponential' | 'linear' | 'constant';
  /** Custom retry condition */
  retryCondition?: (error: Error, attempt: number) => boolean;
}

/**
 * Query options
 */
export interface QueryOptions<TData = unknown, TError = NetronError> {
  /** Unique query key */
  queryKey: QueryKey;
  /** Function to fetch data */
  queryFn: (context: QueryFunctionContext) => Promise<TData>;
  /** Time in ms before data is considered stale */
  staleTime?: number;
  /** Time in ms to keep unused data in cache */
  cacheTime?: number;
  /** Enable/disable the query */
  enabled?: boolean;
  /** Refetch on window focus */
  refetchOnWindowFocus?: boolean;
  /** Refetch on reconnect */
  refetchOnReconnect?: boolean;
  /** Refetch interval in ms */
  refetchInterval?: number | false;
  /** Retry configuration */
  retry?: number | boolean | RetryConfig;
  /** Retry delay function */
  retryDelay?: number | ((attempt: number, error: TError) => number);
  /** Success callback */
  onSuccess?: (data: TData) => void;
  /** Error callback */
  onError?: (error: TError) => void;
  /** Settled callback */
  onSettled?: (data: TData | undefined, error: TError | null) => void;
  /** Data selector/transformer */
  select?: (data: TData) => unknown;
  /** Placeholder data while loading */
  placeholderData?: TData | (() => TData | undefined);
  /** Initial data */
  initialData?: TData | (() => TData);
  /** Initial data updated timestamp */
  initialDataUpdatedAt?: number;
  /** Use React Suspense */
  suspense?: boolean;
  /** Use Error Boundary */
  useErrorBoundary?: boolean | ((error: TError) => boolean);
}

/**
 * Query function context
 */
export interface QueryFunctionContext {
  queryKey: QueryKey;
  signal: AbortSignal;
  pageParam?: unknown;
}

/**
 * Query result
 */
export interface QueryResult<TData = unknown, TError = NetronError> {
  /** The query data */
  data: TData | undefined;
  /** Error if query failed */
  error: TError | null;
  /** Query status */
  status: QueryStatus;
  /** Is initial loading */
  isLoading: boolean;
  /** Is error state */
  isError: boolean;
  /** Is success state */
  isSuccess: boolean;
  /** Is idle state */
  isIdle: boolean;
  /** Is currently fetching (including background) */
  isFetching: boolean;
  /** Is refetching */
  isRefetching: boolean;
  /** Is data stale */
  isStale: boolean;
  /** Last data update timestamp */
  dataUpdatedAt: number;
  /** Last error update timestamp */
  errorUpdatedAt: number;
  /** Refetch function */
  refetch: () => Promise<QueryResult<TData, TError>>;
  /** Remove query from cache */
  remove: () => void;
}

// ============================================================================
// Mutation Types
// ============================================================================

/**
 * Mutation options
 */
export interface MutationOptions<TData = unknown, TError = NetronError, TVariables = unknown, TContext = unknown> {
  /** Mutation function */
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** Mutation key for tracking */
  mutationKey?: QueryKey;
  /** Called before mutation */
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  /** Called on success */
  onSuccess?: (data: TData, variables: TVariables, context: TContext) => void | Promise<void>;
  /** Called on error */
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => void | Promise<void>;
  /** Called when settled (success or error) */
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    context: TContext | undefined
  ) => void | Promise<void>;
  /** Retry configuration */
  retry?: number | boolean | RetryConfig;
  /** Retry delay */
  retryDelay?: number | ((attempt: number, error: TError) => number);
  /** Query keys to invalidate on success */
  invalidateQueries?: QueryKey[];
}

/**
 * Mutation result
 */
export interface MutationResult<TData = unknown, TError = NetronError, TVariables = unknown, TContext = unknown> {
  /** Mutation data */
  data: TData | undefined;
  /** Error if mutation failed */
  error: TError | null;
  /** Variables passed to mutate */
  variables: TVariables | undefined;
  /** Mutation status */
  status: MutationStatus;
  /** Is idle */
  isIdle: boolean;
  /** Is loading */
  isLoading: boolean;
  /** Is success */
  isSuccess: boolean;
  /** Is error */
  isError: boolean;
  /** Trigger mutation (fire and forget) */
  mutate: (variables: TVariables) => void;
  /** Trigger mutation (returns promise) */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  /** Reset mutation state */
  reset: () => void;
  /** Context from onMutate */
  context: TContext | undefined;
}

// ============================================================================
// Subscription Types
// ============================================================================

/**
 * Subscription options
 */
export interface SubscriptionOptions<TData = unknown> {
  /** Event name to subscribe to */
  event: string;
  /** Filter incoming data */
  filter?: (data: TData) => boolean;
  /** Transform incoming data */
  transform?: (data: unknown) => TData;
  /** Buffer configuration for high-frequency updates */
  buffer?: {
    size: number;
    timeout: number;
    strategy: 'latest' | 'all' | 'first';
  };
  /** Enable/disable subscription */
  enabled?: boolean;
  /** Data callback */
  onData?: (data: TData) => void;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Connect callback */
  onConnect?: () => void;
  /** Disconnect callback */
  onDisconnect?: () => void;
}

/**
 * Subscription result
 */
export interface SubscriptionResult<TData = unknown> {
  /** Latest data received */
  data: TData | undefined;
  /** History of received data */
  history: TData[];
  /** Is connected */
  isConnected: boolean;
  /** Is actively subscribed */
  isSubscribed: boolean;
  /** Error if any */
  error: Error | null;
  /** Unsubscribe function */
  unsubscribe: () => void;
  /** Resubscribe function */
  resubscribe: () => void;
  /** Clear history */
  clearHistory: () => void;
}

// ============================================================================
// Stream Types
// ============================================================================

/**
 * Stream options
 */
export interface StreamOptions<TChunk = unknown, TResult = TChunk[]> {
  /** Function returning a ReadableStream */
  streamFn: () => Promise<ReadableStream<TChunk>>;
  /** Accumulate chunks into result */
  accumulator?: (chunks: TChunk[]) => TResult;
  /** Called on each chunk */
  onChunk?: (chunk: TChunk) => void;
  /** Enable/disable stream */
  enabled?: boolean;
  /** Called when stream completes */
  onComplete?: (result: TResult) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** High water mark for backpressure */
  highWaterMark?: number;
}

/**
 * Stream result
 */
export interface StreamResult<TChunk = unknown, TResult = TChunk[]> {
  /** All received chunks */
  chunks: TChunk[];
  /** Accumulated result */
  result: TResult | undefined;
  /** Progress (0-1 if known) */
  progress: number;
  /** Bytes received */
  bytesReceived: number;
  /** Is streaming */
  isStreaming: boolean;
  /** Is complete */
  isComplete: boolean;
  /** Error if any */
  error: Error | null;
  /** Pause stream */
  pause: () => void;
  /** Resume stream */
  resume: () => void;
  /** Cancel stream */
  cancel: () => void;
}

// ============================================================================
// Infinite Query Types
// ============================================================================

/**
 * Infinite query options
 */
export interface InfiniteQueryOptions<TData = unknown, TError = NetronError, TPageParam = unknown> extends Omit<
  QueryOptions<TData, TError>,
  'queryFn'
> {
  /** Query function with page param */
  queryFn: (context: QueryFunctionContext & { pageParam: TPageParam }) => Promise<TData>;
  /** Get next page param */
  getNextPageParam: (lastPage: TData, allPages: TData[]) => TPageParam | undefined;
  /** Get previous page param */
  getPreviousPageParam?: (firstPage: TData, allPages: TData[]) => TPageParam | undefined;
  /** Initial page param */
  initialPageParam: TPageParam;
  /** Max pages to keep in memory */
  maxPages?: number;
}

/**
 * Infinite query result
 */
export interface InfiniteQueryResult<TData = unknown, TError = NetronError> {
  /** Paginated data */
  data: { pages: TData[]; pageParams: unknown[] } | undefined;
  /** Error if any */
  error: TError | null;
  /** Has next page */
  hasNextPage: boolean;
  /** Has previous page */
  hasPreviousPage: boolean;
  /** Is fetching next page */
  isFetchingNextPage: boolean;
  /** Is fetching previous page */
  isFetchingPreviousPage: boolean;
  /** Fetch next page */
  fetchNextPage: () => Promise<void>;
  /** Fetch previous page */
  fetchPreviousPage: () => Promise<void>;
  /** Query status */
  status: QueryStatus;
  /** Is loading */
  isLoading: boolean;
  /** Is error */
  isError: boolean;
  /** Is success */
  isSuccess: boolean;
  /** Refetch all pages */
  refetch: () => Promise<void>;
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * Transport type
 */
export type TransportType = 'auto' | 'http' | 'websocket';

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Default stale time in ms */
  staleTime?: number;
  /** Default cache time in ms */
  cacheTime?: number;
  /** Maximum cache entries */
  maxEntries?: number;
  /** Enable cache persistence */
  persistence?:
    | boolean
    | {
        key: string;
        storage: 'localStorage' | 'sessionStorage' | 'indexedDB';
      };
}

/**
 * DevTools configuration
 */
export interface DevToolsConfig {
  /** Position on screen */
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Initial open state */
  initialIsOpen?: boolean;
  /** Panels to show */
  panels?: ('queries' | 'mutations' | 'cache' | 'subscriptions' | 'network')[];
  /** Button position offset */
  buttonPosition?: { bottom: number; right: number };
}

/**
 * SSR configuration
 */
export interface SSRConfig {
  /** Enable SSR mode */
  enabled: boolean;
  /** Dehydrate timeout */
  dehydrateTimeout?: number;
}

/**
 * Default options for queries/mutations
 */
export interface DefaultOptions {
  /** Default query options */
  queries?: Partial<QueryOptions>;
  /** Default mutation options */
  mutations?: Partial<MutationOptions>;
}

/**
 * Auth configuration
 */
export interface AuthConfig {
  /** Use external auth client */
  client?: AuthenticationClient;
  /** Or configure built-in */
  refreshEndpoint?: string;
  /** Logout endpoint */
  logoutEndpoint?: string;
  /** Storage type */
  storage?: 'local' | 'session' | 'memory';
  /** Auto refresh tokens */
  autoRefresh?: boolean;
  /** Refresh threshold in ms */
  refreshThreshold?: number;
}

/**
 * Client configuration
 */
export interface NetronReactClientConfig {
  /** Server URL */
  url: string;
  /** Transport type */
  transport?: TransportType;
  /** Authentication config */
  auth?: AuthConfig;
  /** Cache config */
  cache?: CacheConfig;
  /** Default options */
  defaults?: {
    staleTime?: number;
    cacheTime?: number;
    retry?: number | RetryConfig;
    refetchOnWindowFocus?: boolean;
    refetchOnReconnect?: boolean;
  };
  /** DevTools config */
  devTools?: boolean | DevToolsConfig;
  /** SSR config */
  ssr?: SSRConfig;
  /** Request timeout in ms */
  timeout?: number;
  /** WebSocket protocols */
  protocols?: string | string[];
}

// ============================================================================
// Service Types
// ============================================================================

/**
 * Service options
 */
export interface ServiceOptions {
  /** Service version */
  version?: string;
  /** Request timeout */
  timeout?: number;
  /** Retry config */
  retry?: RetryConfig;
  /** Middleware */
  middleware?: Middleware[];
}

/**
 * Middleware function type
 */
export type Middleware = (context: MiddlewareContext, next: () => Promise<unknown>) => Promise<unknown>;

/**
 * Middleware context
 */
export interface MiddlewareContext {
  /** Service name */
  service: string;
  /** Method name */
  method: string;
  /** Arguments */
  args: unknown[];
  /** Request metadata */
  metadata: Map<string, unknown>;
  /** Timing info */
  timing: {
    start: number;
    end?: number;
  };
}

/**
 * Service method hook binding
 */
export interface ServiceMethodHooks<TArgs extends unknown[], TResult> {
  /** Direct call */
  call: (...args: TArgs) => Promise<TResult>;
  /** As query hook */
  useQuery: (args: TArgs, options?: Omit<QueryOptions<TResult>, 'queryFn' | 'queryKey'>) => QueryResult<TResult>;
  /** As mutation hook */
  useMutation: (
    options?: Omit<MutationOptions<TResult, NetronError, TArgs>, 'mutationFn'>
  ) => MutationResult<TResult, NetronError, TArgs>;
}

/**
 * Typed service proxy
 */
export type TypedServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? ServiceMethodHooks<A extends unknown[] ? A : never[], R>
    : never;
};

// ============================================================================
// Query Filters
// ============================================================================

/**
 * Query filters for invalidation/removal
 */
export interface QueryFilters {
  /** Filter by query key */
  queryKey?: QueryKey;
  /** Exact match */
  exact?: boolean;
  /** Filter by status */
  status?: QueryStatus;
  /** Filter by stale state */
  stale?: boolean;
  /** Filter by fetch state */
  fetching?: boolean;
  /** Custom predicate */
  predicate?: (query: Query) => boolean;
}

/**
 * Query state in cache
 */
export interface Query<TData = unknown, TError = NetronError> {
  queryKey: QueryKey;
  queryHash: string;
  state: {
    data: TData | undefined;
    error: TError | null;
    status: QueryStatus;
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    isInvalidated: boolean;
  };
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Unsubscribe function
 */
export type Unsubscribe = () => void;

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (data: T) => void;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Dehydrated state for SSR
 */
export interface DehydratedState {
  queries: Array<{
    queryKey: QueryKey;
    queryHash: string;
    state: Query['state'];
  }>;
  mutations: Array<{
    mutationKey?: QueryKey;
    state: unknown;
  }>;
}

/**
 * NoInfer helper type
 */
export type NoInfer<T> = [T][T extends unknown ? 0 : never];
