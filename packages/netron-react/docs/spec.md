# @omnitron-dev/netron-react

## Comprehensive Specification v2.0

> A thin, powerful React integration layer for netron-browser — providing React-native patterns without duplicating netron-browser's existing capabilities.

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Integration](#3-core-integration)
4. [Hook System](#4-hook-system)
5. [Service Integration](#5-service-integration)
6. [Real-time & Subscriptions](#6-real-time--subscriptions)
7. [Authentication Integration](#7-authentication-integration)
8. [Error Handling](#8-error-handling)
9. [Performance & Optimization](#9-performance--optimization)
10. [Developer Experience](#10-developer-experience)
11. [Testing Strategy](#11-testing-strategy)
12. [Development Plan](#12-development-plan)

---

## 1. Vision & Philosophy

### 1.1 Core Principles

**netron-react** is built on these principles:

1. **Leverage, Don't Duplicate**: Use netron-browser's capabilities directly — auth, connections, middleware, errors
2. **Thin React Layer**: Only add what React needs — state synchronization, lifecycle management, hooks
3. **Two Ergonomic Levels**: Simple API for 80% cases, full power access for 20%
4. **Type Safety End-to-End**: Full TypeScript inference from server to UI
5. **Minimal Bundle**: ~8KB gzipped (vs ~15KB in v1 spec)
6. **Zero Configuration Start**: Works with just a URL, grows with you

### 1.2 What We Add vs What We Reuse

| Concern | Source | netron-react Role |
|---------|--------|-------------------|
| **Connection** | netron-browser | Expose state as React hook |
| **Service Calls** | netron-browser | Add loading/error/data states |
| **Auth** | netron-browser AuthenticationClient | Sync to React context + events |
| **Subscriptions** | netron-browser core tasks | Bridge to React state |
| **Streaming** | NetronReadableStream | Hook with progress state |
| **Middleware** | netron-browser MiddlewarePipeline | Pass-through, no duplication |
| **Errors** | netron-browser error types | React Error Boundaries |
| **Query Caching** | **NEW** | React-level stale/fresh logic |
| **Optimistic Updates** | **NEW** | Mutation rollback support |

### 1.3 Feature Summary

| Feature | Description |
|---------|-------------|
| **useRPC** | Simple RPC call with loading/error/data |
| **useService** | Type-safe service proxy with hooks |
| **useSubscription** | Real-time events to React state |
| **useStream** | Streaming with progress tracking |
| **useConnection** | Connection state & metrics |
| **useAuth** | Auth state synced from AuthenticationClient |
| **Query Cache** | Stale-while-revalidate pattern |
| **Optimistic Updates** | Instant UI with rollback |
| **Suspense** | React 19 native integration |

---

## 2. Architecture Overview

### 2.1 Thin Layer Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     React Components                            │
│  useRPC() · useService() · useSubscription() · useStream()     │
├────────────────────────────────────────────────────────────────┤
│                     netron-react (thin layer)                   │
│  • React state management (loading/error/data)                 │
│  • Query cache (stale/fresh/invalidation)                      │
│  • Event → React state bridging                                │
│  • Lifecycle cleanup                                           │
├────────────────────────────────────────────────────────────────┤
│                     netron-browser (reused directly)           │
│  • NetronClient / HttpClient / WebSocketClient                 │
│  • AuthenticationClient (token mgmt, refresh, cross-tab)       │
│  • MiddlewarePipeline (logging, retry, auth headers)           │
│  • Subscriptions (subscribe/unsubscribe core tasks)            │
│  • NetronReadableStream / NetronWritableStream                 │
│  • All error types (NetronError, ConnectionError, etc.)        │
├────────────────────────────────────────────────────────────────┤
│                     Protocol Layer                              │
│  MessagePack · Packet · Error Serialization                    │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
Component           Hook                 Cache           netron-browser
    │                 │                    │                    │
    │── useRPC() ────▶│                    │                    │
    │                 │── cache.get() ────▶│                    │
    │                 │◀── stale data ─────│                    │
    │◀── data ────────│                    │                    │
    │                 │                    │── client.invoke() ▶│
    │                 │                    │◀── response ───────│
    │                 │◀── cache.set() ────│                    │
    │◀── fresh data ──│                    │                    │
```

### 2.3 Module Structure

```
packages/netron-react/
├── src/
│   ├── core/                    # Core primitives
│   │   ├── context.ts           # NetronContext (wraps netron-browser client)
│   │   ├── provider.tsx         # NetronProvider
│   │   └── types.ts             # Shared types
│   │
│   ├── hooks/                   # React hooks
│   │   ├── useRPC.ts            # Simple RPC hook
│   │   ├── useMutation.ts       # Mutation with optimistic updates
│   │   ├── useSubscription.ts   # Real-time subscriptions
│   │   ├── useStream.ts         # Streaming data
│   │   ├── useService.ts        # Type-safe service proxy
│   │   ├── useConnection.ts     # Connection state (from netron-browser)
│   │   ├── useAuth.ts           # Auth state (from AuthenticationClient)
│   │   └── useInfiniteRPC.ts    # Pagination
│   │
│   ├── cache/                   # Query caching (React-level only)
│   │   ├── query-cache.ts       # Stale/fresh logic
│   │   ├── mutation-cache.ts    # Optimistic queue
│   │   └── utils.ts             # Cache key generation
│   │
│   ├── auth/                    # Auth integration
│   │   ├── context.tsx          # Bridges AuthenticationClient to React
│   │   └── guard.tsx            # AuthGuard component
│   │
│   ├── service/                 # Service layer
│   │   └── registry.ts          # Service proxy factory
│   │
│   ├── devtools/                # Developer tools (optional)
│   │   └── index.ts             # DevTools panel
│   │
│   ├── test/                    # Test utilities
│   │   └── index.ts             # MockClient, TestProvider
│   │
│   └── index.ts                 # Public exports
│
└── package.json
```

---

## 3. Core Integration

### 3.1 NetronProvider

The provider wraps existing netron-browser clients — no new client class:

```typescript
import { NetronClient, AuthenticationClient } from '@omnitron-dev/netron-browser';

interface NetronProviderProps {
  // Pass existing netron-browser client
  client: NetronClient;

  // Optional: pass existing AuthenticationClient
  auth?: AuthenticationClient;

  // Query cache defaults
  defaults?: {
    staleTime?: number;        // Default: 0 (always stale)
    cacheTime?: number;        // Default: 5 minutes
    refetchOnWindowFocus?: boolean;  // Default: true
    refetchOnReconnect?: boolean;    // Default: true
    retry?: number | false;    // Default: 3
  };

  children: React.ReactNode;
}

// Usage — leverage your existing netron-browser setup
const client = createClient({
  url: 'https://api.example.com',
  transport: 'websocket',
  websocket: {
    reconnect: true,
    reconnectInterval: 1000,
  }
});

const auth = new AuthenticationClient({
  storage: new LocalTokenStorage(),
  autoRefresh: true,
  refreshThreshold: 5 * 60 * 1000,
  crossTabSync: { enabled: true },
});

// Middleware from netron-browser (not duplicated!)
client.use(createAuthMiddleware(auth));
client.use(createLoggingMiddleware({ level: 'debug' }));

function App() {
  return (
    <NetronProvider
      client={client}
      auth={auth}
      defaults={{ staleTime: 30000 }}
    >
      <MyApp />
    </NetronProvider>
  );
}
```

### 3.2 Context Hooks

```typescript
// Access netron-browser client directly
function useClient(): NetronClient;

// Access AuthenticationClient directly
function useAuthClient(): AuthenticationClient | null;

// Access query cache
function useQueryCache(): QueryCache;
```

**Key insight**: No wrapper client — direct access to netron-browser's full power.

---

## 4. Hook System

### 4.1 useRPC — Simple Data Fetching

The primary hook for RPC calls with React state management:

```typescript
interface UseRPCOptions<TData> {
  // Caching
  staleTime?: number;
  cacheTime?: number;

  // Behavior
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  refetchInterval?: number | false;
  retry?: number | false;

  // Callbacks
  onSuccess?: (data: TData) => void;
  onError?: (error: NetronError) => void;

  // Advanced
  select?: (data: TData) => any;
  placeholderData?: TData;

  // React 19
  suspense?: boolean;
}

interface UseRPCResult<TData> {
  data: TData | undefined;
  error: NetronError | null;

  isLoading: boolean;      // First load
  isFetching: boolean;     // Any fetch (including refetch)
  isError: boolean;
  isSuccess: boolean;
  isStale: boolean;

  dataUpdatedAt: number;

  refetch: () => Promise<TData>;
}

// Simple usage — auto-generates cache key from service + method + args
function useRPC<TData>(
  service: string,
  method: string,
  args?: any[],
  options?: UseRPCOptions<TData>
): UseRPCResult<TData>;

// Example
function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, error } = useRPC<User>(
    'users',
    'getUser',
    [userId],
    { staleTime: 5 * 60 * 1000 }
  );

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorDisplay error={error} />;
  return <Profile user={user} />;
}
```

### 4.2 useMutation — Data Modifications

```typescript
interface UseMutationOptions<TData, TVariables> {
  // Callbacks
  onMutate?: (variables: TVariables) => Promise<any> | any;
  onSuccess?: (data: TData, variables: TVariables, context: any) => void;
  onError?: (error: NetronError, variables: TVariables, context: any) => void;
  onSettled?: (data?: TData, error?: NetronError) => void;

  // Retry
  retry?: number | false;

  // Cache
  invalidateKeys?: string[][];  // Query keys to invalidate on success
}

interface UseMutationResult<TData, TVariables> {
  data: TData | undefined;
  error: NetronError | null;
  variables: TVariables | undefined;

  isIdle: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;

  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  reset: () => void;
}

function useMutation<TData, TVariables = void>(
  service: string,
  method: string,
  options?: UseMutationOptions<TData, TVariables>
): UseMutationResult<TData, TVariables>;

// Usage with optimistic update
function UpdateUser({ user }: { user: User }) {
  const cache = useQueryCache();

  const { mutate, isLoading } = useMutation<User, UpdateUserInput>(
    'users',
    'updateUser',
    {
      onMutate: async (input) => {
        // Snapshot & optimistic update
        const previous = cache.get(['users', 'getUser', user.id]);
        cache.set(['users', 'getUser', user.id], { ...previous, ...input });
        return { previous };
      },
      onError: (err, input, context) => {
        // Rollback
        cache.set(['users', 'getUser', user.id], context.previous);
      },
      invalidateKeys: [['users', 'getUser', user.id], ['users', 'listUsers']],
    }
  );

  return (
    <button onClick={() => mutate({ id: user.id, name: 'New Name' })}>
      {isLoading ? 'Saving...' : 'Update'}
    </button>
  );
}
```

### 4.3 useSubscription — Real-Time Events

Bridges netron-browser subscriptions to React state:

```typescript
interface UseSubscriptionOptions<TData> {
  // Filter/transform
  filter?: (data: any) => boolean;
  transform?: (data: any) => TData;

  // High-frequency optimization
  throttle?: number;

  // History
  keepHistory?: number;  // Keep last N events

  // Lifecycle
  enabled?: boolean;
  onData?: (data: TData) => void;
  onError?: (error: Error) => void;
}

interface UseSubscriptionResult<TData> {
  data: TData | undefined;
  history: TData[];

  isSubscribed: boolean;
  error: Error | null;

  unsubscribe: () => void;
  resubscribe: () => void;
  clearHistory: () => void;
}

function useSubscription<TData>(
  event: string,
  options?: UseSubscriptionOptions<TData>
): UseSubscriptionResult<TData>;

// Usage — leverages netron-browser's core task subscriptions
function LivePrices({ symbol }: { symbol: string }) {
  const { data: price, history } = useSubscription<PriceUpdate>(
    `price:${symbol}`,
    {
      throttle: 100,  // Max 10 updates/sec to UI
      keepHistory: 50,
      filter: (p) => p.symbol === symbol,
    }
  );

  return (
    <div>
      <CurrentPrice value={price} />
      <PriceChart data={history} />
    </div>
  );
}
```

### 4.4 useStream — Streaming Data

Bridges NetronReadableStream to React state:

```typescript
interface UseStreamOptions<TChunk, TResult = TChunk[]> {
  // Accumulation
  accumulator?: (chunks: TChunk[]) => TResult;

  // Lifecycle
  enabled?: boolean;
  onChunk?: (chunk: TChunk) => void;
  onComplete?: (result: TResult) => void;
  onError?: (error: Error) => void;
}

interface UseStreamResult<TChunk, TResult> {
  chunks: TChunk[];
  result: TResult | undefined;

  // Progress from NetronReadableStream metrics
  bytesReceived: number;
  packetsReceived: number;

  isStreaming: boolean;
  isComplete: boolean;
  isPaused: boolean;
  error: Error | null;

  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

function useStream<TChunk, TResult = TChunk[]>(
  service: string,
  method: string,
  args?: any[],
  options?: UseStreamOptions<TChunk, TResult>
): UseStreamResult<TChunk, TResult>;

// Usage
function LargeDataExport() {
  const { chunks, bytesReceived, isStreaming, isComplete, cancel } = useStream<DataRow>(
    'reports',
    'exportLargeDataset',
    [{ format: 'json' }],
    {
      onChunk: (chunk) => console.log('Got', chunk.length, 'rows'),
    }
  );

  return (
    <div>
      {isStreaming && (
        <>
          <span>Downloaded: {formatBytes(bytesReceived)}</span>
          <button onClick={cancel}>Cancel</button>
        </>
      )}
      {isComplete && <DataTable rows={chunks.flat()} />}
    </div>
  );
}
```

### 4.5 useConnection — Connection State

Exposes netron-browser's connection state to React:

```typescript
interface UseConnectionResult {
  // From netron-browser ConnectionState
  state: 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed';

  isConnected: boolean;
  isReconnecting: boolean;

  // From netron-browser ConnectionMetrics
  metrics: {
    requestsSent: number;
    responsesReceived: number;
    errors: number;
    avgLatency: number;
  };

  // Actions (delegate to netron-browser client)
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function useConnection(): UseConnectionResult;

// Usage
function ConnectionStatus() {
  const { state, isConnected, metrics } = useConnection();

  return (
    <StatusBadge
      status={state}
      latency={metrics.avgLatency}
    />
  );
}
```

### 4.6 useInfiniteRPC — Pagination

```typescript
interface UseInfiniteRPCOptions<TData, TPageParam> {
  getNextPageParam: (lastPage: TData) => TPageParam | undefined;
  getPreviousPageParam?: (firstPage: TData) => TPageParam | undefined;
  initialPageParam: TPageParam;

  // Same as useRPC
  staleTime?: number;
  enabled?: boolean;
}

interface UseInfiniteRPCResult<TData> {
  data: { pages: TData[]; pageParams: unknown[] } | undefined;

  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isFetchingNextPage: boolean;
  isFetchingPreviousPage: boolean;

  fetchNextPage: () => Promise<void>;
  fetchPreviousPage: () => Promise<void>;

  isLoading: boolean;
  isError: boolean;
  error: NetronError | null;
  refetch: () => Promise<void>;
}

function useInfiniteRPC<TData, TPageParam = string | undefined>(
  service: string,
  method: string,
  argsFactory: (pageParam: TPageParam) => any[],
  options: UseInfiniteRPCOptions<TData, TPageParam>
): UseInfiniteRPCResult<TData>;

// Usage
function UserList() {
  const {
    data,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteRPC<PaginatedUsers, string | undefined>(
    'users',
    'listUsers',
    (cursor) => [{ cursor, limit: 20 }],
    {
      getNextPageParam: (page) => page.nextCursor,
      initialPageParam: undefined,
    }
  );

  return (
    <div>
      {data?.pages.flatMap(p => p.users).map(user => (
        <UserCard key={user.id} user={user} />
      ))}

      {hasNextPage && (
        <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          Load More
        </button>
      )}
    </div>
  );
}
```

---

## 5. Service Integration

### 5.1 useService — Type-Safe Service Proxy

Builds on netron-browser's `client.service<T>()` with React hooks:

```typescript
interface ServiceMethod<TArgs extends any[], TReturn> {
  // Direct call (delegates to netron-browser)
  call: (...args: TArgs) => Promise<TReturn>;

  // As React query
  query: (
    ...args: [...TArgs, UseRPCOptions<TReturn>?]
  ) => UseRPCResult<TReturn>;

  // As React mutation
  mutation: (
    options?: UseMutationOptions<TReturn, TArgs>
  ) => UseMutationResult<TReturn, TArgs>;
}

type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? ServiceMethod<A, R>
    : never;
};

function useService<T>(serviceName: string): ServiceProxy<T>;

// Usage
interface UserService {
  getUser(id: string): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

function UserProfile({ userId }: { userId: string }) {
  const users = useService<UserService>('users');

  // Type-safe query - args and return type fully inferred
  const { data: user, isLoading } = users.getUser.query(userId, {
    staleTime: 5 * 60 * 1000,
  });

  // Type-safe mutation
  const { mutate: update, isLoading: isUpdating } = users.updateUser.mutation({
    invalidateKeys: [['users', 'getUser', userId]],
  });

  // Direct call when needed
  const handleRefresh = async () => {
    const freshUser = await users.getUser.call(userId);
    console.log('Fresh data:', freshUser);
  };

  if (isLoading) return <Skeleton />;

  return (
    <div>
      <h1>{user?.name}</h1>
      <button onClick={() => update(userId, { name: 'New Name' })}>
        {isUpdating ? 'Saving...' : 'Update'}
      </button>
    </div>
  );
}
```

### 5.2 Service Contract Types

Type contracts can be shared or generated:

```typescript
// Option 1: Manual contracts (recommended for small projects)
// shared/contracts/user.ts
export interface UserService {
  getUser(id: string): Promise<User>;
  updateUser(id: string, data: UpdateUserInput): Promise<User>;
  listUsers(params: ListParams): Promise<PaginatedResult<User>>;
}

// Option 2: Generated from Titan metadata
// $ npx netron-codegen --url http://localhost:3000 --output ./src/contracts
// Generates TypeScript interfaces from service metadata
```

---

## 6. Real-time & Subscriptions

### 6.1 Event-Based Query Invalidation

```typescript
interface InvalidationRule {
  event: string | RegExp;
  invalidate: string[][] | ((eventData: any) => string[][]);
  immediate?: boolean;  // Default: true
}

function useInvalidationRules(rules: InvalidationRule[]): void;

// Usage — automatically invalidate queries when events arrive
function App() {
  useInvalidationRules([
    {
      event: 'user:updated',
      invalidate: (data) => [
        ['users', 'getUser', data.userId],
        ['users', 'listUsers'],
      ],
    },
    {
      event: /^order:/,
      invalidate: [['orders', 'listOrders']],
    },
  ]);

  return <MyApp />;
}
```

### 6.2 Live Queries

Queries that automatically update from subscriptions:

```typescript
interface UseLiveRPCOptions<TData> extends UseRPCOptions<TData> {
  // Subscription event for live updates
  subscriptionEvent: string;

  // Merge strategy
  merge: (current: TData, update: any) => TData;

  // Filter updates
  filter?: (update: any) => boolean;
}

function useLiveRPC<TData>(
  service: string,
  method: string,
  args: any[],
  options: UseLiveRPCOptions<TData>
): UseRPCResult<TData>;

// Usage — initial fetch + live updates
function LiveOrderBook({ symbol }: { symbol: string }) {
  const { data: orderBook } = useLiveRPC<OrderBook>(
    'market',
    'getOrderBook',
    [symbol],
    {
      subscriptionEvent: `orderbook:${symbol}`,
      merge: (current, update) => ({
        bids: update.bids ?? current.bids,
        asks: update.asks ?? current.asks,
        timestamp: update.timestamp,
      }),
    }
  );

  return <OrderBookDisplay data={orderBook} />;
}
```

---

## 7. Authentication Integration

### 7.1 Auth Context

Bridges netron-browser's `AuthenticationClient` to React — no duplication:

```typescript
// Context syncs with AuthenticationClient events
interface AuthContextValue {
  // State (synced from AuthenticationClient)
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  error: Error | null;

  // Direct access to AuthenticationClient for full control
  authClient: AuthenticationClient;

  // Convenience methods (delegate to AuthenticationClient)
  login: (credentials: Credentials) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthResult>;
}

function useAuth(): AuthContextValue;

// Implementation hooks into AuthenticationClient events:
// - 'authenticated' → update isAuthenticated, user
// - 'unauthenticated' → clear state
// - 'token-refreshed' → update token
// - 'error' → set error
// - 'cross-tab-sync' → sync state across tabs (automatic!)
```

### 7.2 AuthGuard Component

```typescript
interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  redirectTo?: string;
  roles?: string[];
  permissions?: string[];
  onUnauthorized?: () => void;
}

function AuthGuard(props: AuthGuardProps): JSX.Element;

// Usage
function AdminPage() {
  return (
    <AuthGuard
      roles={['admin']}
      fallback={<AccessDenied />}
    >
      <AdminDashboard />
    </AuthGuard>
  );
}
```

### 7.3 Login Example

```typescript
function LoginForm() {
  const { login, isLoading, error } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);

    // AuthenticationClient handles:
    // - Token storage
    // - Auto-refresh setup
    // - Cross-tab sync
    await login({
      username: form.get('username') as string,
      password: form.get('password') as string,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="username" required />
      <input name="password" type="password" required />
      {error && <ErrorMessage error={error} />}
      <button disabled={isLoading}>
        {isLoading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
```

---

## 8. Error Handling

### 8.1 Using netron-browser Error Types

No new error types — use netron-browser's typed errors:

```typescript
import {
  NetronError,
  ConnectionError,
  TimeoutError,
  NetworkError,
  ServiceNotFoundError,
  MethodNotFoundError,
  RpcError,
} from '@omnitron-dev/netron-browser';

// In components
function UserProfile({ userId }: { userId: string }) {
  const { data, error } = useRPC<User>('users', 'getUser', [userId]);

  if (error) {
    if (error instanceof ConnectionError) {
      return <ConnectionLost retry={() => window.location.reload()} />;
    }
    if (error instanceof ServiceNotFoundError) {
      return <ServiceUnavailable service={error.serviceName} />;
    }
    return <GenericError message={error.message} />;
  }

  return <Profile user={data} />;
}
```

### 8.2 NetronErrorBoundary

```typescript
interface NetronErrorBoundaryProps {
  children: React.ReactNode;

  // Type-specific handlers
  onConnectionError?: (error: ConnectionError) => React.ReactNode;
  onTimeoutError?: (error: TimeoutError) => React.ReactNode;
  onServiceError?: (error: RpcError) => React.ReactNode;

  // Default fallback
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);

  // Reporting
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

function NetronErrorBoundary(props: NetronErrorBoundaryProps): JSX.Element;

// Usage
function App() {
  return (
    <NetronErrorBoundary
      onConnectionError={(err) => <ReconnectingOverlay />}
      onTimeoutError={(err) => <SlowConnectionWarning />}
      onError={(err) => reportToSentry(err)}
      fallback={(error, reset) => (
        <ErrorPage error={error} onRetry={reset} />
      )}
    >
      <MyApp />
    </NetronErrorBoundary>
  );
}
```

---

## 9. Performance & Optimization

### 9.1 Automatic Optimizations

**Request Deduplication**
```typescript
// Same service + method + args = single request shared across components
const ComponentA = () => useRPC('users', 'getUser', ['1']);
const ComponentB = () => useRPC('users', 'getUser', ['1']); // Shares request
```

**Stale-While-Revalidate**
```typescript
// Return cached data immediately, refetch in background
const { data } = useRPC('users', 'getUser', [id], {
  staleTime: 5 * 60 * 1000,  // Fresh for 5 min
  cacheTime: 30 * 60 * 1000, // Keep in cache for 30 min
});
```

**Structural Sharing**
```typescript
// Only re-render if data actually changed (deep comparison)
// Automatic for all hooks
```

### 9.2 Manual Optimizations

**Prefetching**
```typescript
function UserList({ users }: { users: User[] }) {
  const cache = useQueryCache();

  // Prefetch on hover
  const prefetchUser = (userId: string) => {
    cache.prefetch(['users', 'getUser', userId], () =>
      client.invoke('users', 'getUser', [userId])
    );
  };

  return users.map(user => (
    <Link
      key={user.id}
      to={`/users/${user.id}`}
      onMouseEnter={() => prefetchUser(user.id)}
    >
      {user.name}
    </Link>
  ));
}
```

**Selective Subscriptions**
```typescript
// Only process updates matching filter
const { data } = useSubscription('trades', {
  filter: (trade) => trade.symbol === 'BTC-USD' && trade.size > 100,
  throttle: 100,  // Max 10 updates/sec
});
```

### 9.3 Bundle Optimization

**Tree-Shakeable Exports**
```typescript
// Core (always included)
import { NetronProvider, useRPC, useMutation } from '@omnitron-dev/netron-react';

// Optional modules (tree-shaken if not used)
import { useSubscription } from '@omnitron-dev/netron-react/subscription';
import { useStream } from '@omnitron-dev/netron-react/stream';
import { AuthGuard } from '@omnitron-dev/netron-react/auth';
import { NetronDevtools } from '@omnitron-dev/netron-react/devtools';
```

**Bundle Size Targets**
- Core: ~5KB gzipped
- Full: ~8KB gzipped
- With DevTools: ~12KB gzipped

---

## 10. Developer Experience

### 10.1 DevTools (Optional Module)

```typescript
import { NetronDevtools } from '@omnitron-dev/netron-react/devtools';

function App() {
  return (
    <NetronProvider client={client}>
      <MyApp />
      {process.env.NODE_ENV === 'development' && (
        <NetronDevtools position="bottom-right" />
      )}
    </NetronProvider>
  );
}

// Features:
// - Query Inspector: view queries, data, timing, status
// - Mutation Log: track mutations with payload/result
// - Subscription Monitor: active subscriptions and messages
// - Connection Status: state, metrics, latency
// - Cache Explorer: browse query cache
```

### 10.2 Debug Logging

```typescript
import { setLogger } from '@omnitron-dev/netron-react';

// Development logging
if (process.env.NODE_ENV === 'development') {
  setLogger({
    queries: true,      // Log query execution
    mutations: true,    // Log mutations
    cache: true,        // Log cache operations
    subscriptions: true // Log subscription events
  });
}
```

### 10.3 TypeScript Integration

Full type inference from service contracts:

```typescript
interface UserService {
  getUser(id: string): Promise<User>;
  updateUser(id: string, data: UpdateUserInput): Promise<User>;
}

// Full inference
const users = useService<UserService>('users');

// ✓ data is User | undefined
const { data } = users.getUser.query('123');

// ✓ Compile error if wrong args
users.getUser.query(123); // Error: Argument of type 'number' is not assignable

// ✓ mutate has correct signature
const { mutate } = users.updateUser.mutation();
mutate('123', { name: 'New' }); // OK
mutate({ name: 'New' });        // Error: Expected 2 arguments
```

---

## 11. Testing Strategy

### 11.1 Test Utilities

```typescript
import {
  createMockClient,
  TestNetronProvider,
  mockRPC,
  mockSubscription
} from '@omnitron-dev/netron-react/test';

// Create mock client
const mockClient = createMockClient({
  mocks: [
    mockRPC('users', 'getUser', { id: '1', name: 'Test User' }),
    mockRPC('users', 'listUsers', { users: [], total: 0 }),
  ],
});

// Test wrapper
function renderWithNetron(ui: React.ReactElement) {
  return render(
    <TestNetronProvider client={mockClient}>
      {ui}
    </TestNetronProvider>
  );
}

// Usage
test('displays user name', async () => {
  renderWithNetron(<UserProfile userId="1" />);

  await waitFor(() => {
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });
});
```

### 11.2 Mocking Subscriptions

```typescript
test('updates on subscription event', async () => {
  const { emitEvent } = mockSubscription('price:BTC-USD');

  renderWithNetron(<LivePrice symbol="BTC-USD" />);

  // Initial state
  expect(screen.getByText('--')).toBeInTheDocument();

  // Emit event
  emitEvent({ symbol: 'BTC-USD', price: 50000 });

  await waitFor(() => {
    expect(screen.getByText('$50,000')).toBeInTheDocument();
  });
});
```

### 11.3 Integration Tests

```typescript
describe('UserService integration', () => {
  let client: NetronClient;

  beforeAll(async () => {
    client = createClient({ url: process.env.TEST_API_URL! });
    await client.connect();
  });

  afterAll(() => client.disconnect());

  it('fetches user correctly', async () => {
    const { result } = renderHook(
      () => useRPC<User>('users', 'getUser', ['test-id']),
      { wrapper: createWrapper(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: 'test-id' });
  });
});
```

---

## 12. Development Plan

### Phase 1: Core Foundation (Week 1-2)

#### 1.1 Project Setup
- [ ] Initialize package with TypeScript strict mode
- [ ] Configure build (tsup with tree-shaking)
- [ ] Setup Vitest for testing
- [ ] Configure ESLint/Prettier

#### 1.2 Provider & Context
- [ ] `NetronProvider` wrapping netron-browser client
- [ ] `useClient()` hook
- [ ] `useAuthClient()` hook
- [ ] Context hierarchy

### Phase 2: Query System (Week 3-4)

#### 2.1 Query Cache
- [ ] `QueryCache` class (stale/fresh/invalidate)
- [ ] Cache key generation utils
- [ ] Garbage collection
- [ ] `useQueryCache()` hook

#### 2.2 useRPC Hook
- [ ] Core implementation
- [ ] Caching integration
- [ ] Deduplication
- [ ] Refetch logic
- [ ] Error handling

### Phase 3: Mutations (Week 5)

#### 3.1 useMutation Hook
- [ ] Core implementation
- [ ] Optimistic update support
- [ ] Cache invalidation
- [ ] Rollback on error

### Phase 4: Real-Time (Week 6-7)

#### 4.1 Subscriptions
- [ ] `useSubscription` hook
- [ ] Event → React state bridging
- [ ] Throttling/filtering
- [ ] History buffer

#### 4.2 Live Queries
- [ ] `useLiveRPC` hook
- [ ] Merge strategies
- [ ] `useInvalidationRules` hook

#### 4.3 Streaming
- [ ] `useStream` hook
- [ ] Progress tracking from NetronReadableStream
- [ ] Pause/resume/cancel

### Phase 5: Service Layer (Week 8)

#### 5.1 Service Proxy
- [ ] `useService` hook
- [ ] Method → hook conversion
- [ ] Full type inference

### Phase 6: Auth Integration (Week 9)

#### 6.1 Auth Context
- [ ] Bridge AuthenticationClient events to React
- [ ] `useAuth` hook
- [ ] Cross-tab sync handling

#### 6.2 Guards
- [ ] `AuthGuard` component
- [ ] Role/permission checking

### Phase 7: Advanced Features (Week 10-11)

#### 7.1 Pagination
- [ ] `useInfiniteRPC` hook
- [ ] Cursor & offset pagination

#### 7.2 Error Handling
- [ ] `NetronErrorBoundary` component
- [ ] Error type handling

#### 7.3 Suspense
- [ ] React 19 Suspense integration
- [ ] Streaming SSR support

### Phase 8: DX & Polish (Week 12-13)

#### 8.1 DevTools
- [ ] Query inspector panel
- [ ] Mutation log
- [ ] Subscription monitor
- [ ] Cache explorer

#### 8.2 Testing Utils
- [ ] `createMockClient`
- [ ] `TestNetronProvider`
- [ ] Subscription mocking

#### 8.3 Documentation
- [ ] API reference
- [ ] Getting started guide
- [ ] Examples
- [ ] Migration guide (from v1 spec)

---

## API Quick Reference

### Hooks

```typescript
// Data fetching
useRPC<T>(service, method, args?, options?)
useMutation<T, V>(service, method, options?)
useInfiniteRPC<T, P>(service, method, argsFactory, options)

// Real-time
useSubscription<T>(event, options?)
useStream<C, R>(service, method, args?, options?)
useLiveRPC<T>(service, method, args, options)

// Services
useService<T>(serviceName)

// Infrastructure
useClient()
useAuthClient()
useQueryCache()
useConnection()
useAuth()

// Rules
useInvalidationRules(rules)
```

### Components

```tsx
<NetronProvider client={client} auth={auth}>
<AuthGuard roles={['admin']}>
<NetronErrorBoundary fallback={...}>
<NetronDevtools position="bottom-right">
```

### Cache Methods

```typescript
cache.get(key)
cache.set(key, data)
cache.invalidate(key)
cache.invalidateMatching(predicate)
cache.prefetch(key, fetcher)
cache.clear()
```

---

## Key Differences from v1.0 Spec

| Aspect | v1.0 Spec | v2.0 Spec |
|--------|-----------|-----------|
| Client | New `NetronReactClient` wrapper | Use `NetronClient` directly |
| Auth | Custom AuthProvider with config | Bridge `AuthenticationClient` events |
| Middleware | Own middleware layer | Use netron-browser's `MiddlewarePipeline` |
| Errors | Own error types | Use netron-browser error types |
| State Mgmt | Jotai/Zustand built-in | Out of scope (user choice) |
| Service Proxy | Duplicated logic | Extends netron-browser's `client.service()` |
| Bundle | ~15KB | ~8KB target |
| API Surface | 100+ interfaces | ~30 focused interfaces |

---

*This specification is a living document and will evolve as the library develops.*

**Version**: 2.0.0
**Last Updated**: 2024-12-28
**Authors**: Omnitron Development Team
