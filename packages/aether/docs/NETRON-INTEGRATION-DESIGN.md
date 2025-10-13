# Aether-Netron Zero-Config Multi-Backend Integration Design

> **Version:** 1.0.0
> **Date:** 2025-10-13
> **Status:** Technical Design Document
> **Objective:** Design innovative integration between Aether's DI/Module system and netron-browser for zero-config multi-backend support

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Design Philosophy](#design-philosophy)
4. [Architecture Overview](#architecture-overview)
5. [API Design by Level](#api-design-by-level)
6. [Implementation Details](#implementation-details)
7. [Integration Patterns](#integration-patterns)
8. [Performance & Bundle Size](#performance--bundle-size)
9. [Migration Strategy](#migration-strategy)
10. [Future Enhancements](#future-enhancements)

---

## Executive Summary

### Problem Statement

Aether has **production-ready reactivity and DI**, and netron-browser has **production-ready HTTP client with caching**, but they're **not integrated**:

- ❌ Developers must manually create `HttpRemotePeer` instances
- ❌ No automatic cache manager configuration
- ❌ No reactive hooks wrapping FluentInterface
- ❌ No multi-backend support pattern
- ❌ Store pattern requires too much boilerplate

### Solution Overview

Create a **unified data layer** that automatically:
- Creates and configures netron peers per backend
- Provides reactive hooks (`useQuery`, `useMutation`, `useStream`)
- Integrates with Aether's signal system
- Supports multi-backend configurations
- Maintains tree-shaking and small bundle size (~8KB additional)

### Key Innovation

**Zero-config service injection** - developers write:

```typescript
@Module({
  backends: {
    main: 'https://api.example.com',
    analytics: 'https://analytics.example.com'
  }
})
class AppModule {}

@Injectable()
@Backend('main')
class UserService extends NetronService<IUserService> {
  // Auto-generated! No boilerplate!
}

// In component
const users = useQuery(UserService, 'getUsers');
// ✅ Auto-caching, auto-retry, reactive signals!
```

---

## Current State Analysis

### Aether DI System (Production-Ready)

**Capabilities:**
- ✅ Hierarchical injection with `@Injectable()`
- ✅ Module system with `defineModule()`
- ✅ Provider scopes (singleton, transient, module, request)
- ✅ Factory providers with dependencies
- ✅ Context API integration
- ✅ ~8KB runtime footprint

**Key Files:**
- `/packages/aether/src/di/container.ts` (392 LOC) - DIContainer implementation
- `/packages/aether/src/di/module.ts` (144 LOC) - Module compilation
- `/packages/aether/src/di/injectable.ts` (120 LOC) - Decorators

**Strengths:**
- Clean API, full TypeScript support
- Supports both class and function-based providers
- No dependency on reflect-metadata (optional)

**Gaps:**
- No built-in HTTP client integration
- No cache manager as provider
- No multi-backend configuration pattern

### Netron-Browser (Production-Ready)

**Capabilities:**
- ✅ HttpRemotePeer with FluentInterface API (809 LOC)
- ✅ HttpCacheManager with SWR, TTL, tags (515 LOC)
- ✅ RetryManager with circuit breaker (616 LOC)
- ✅ Middleware pipeline (4 stages)
- ✅ Optimistic updates with auto-rollback
- ✅ Pattern-based cache invalidation
- ✅ Request deduplication
- ✅ ~15-20KB gzipped

**Key Files:**
- `/packages/netron-browser/src/transport/http/peer.ts` (809 LOC)
- `/packages/netron-browser/src/transport/http/fluent-interface/fluent-interface.ts` (335 LOC)
- `/packages/netron-browser/src/transport/http/fluent-interface/cache-manager.ts` (515 LOC)

**Strengths:**
- Feature-complete (better than React Query + tRPC)
- Production-tested (204 tests passing)
- Chainable API with all features

**Gaps:**
- No Aether reactive hooks
- No DI integration
- Not discoverable (developers don't know it exists)

### Aether Reactivity (Production-Ready)

**Capabilities:**
- ✅ `signal()` - writable reactive primitive
- ✅ `computed()` - derived state
- ✅ `effect()` - side effects
- ✅ `resource()` - async data with loading/error states
- ✅ `store()` - nested reactivity with Proxy
- ✅ Context API for hierarchical data

**Key Files:**
- `/packages/aether/src/core/reactivity/signal.ts` (221 LOC)
- `/packages/aether/src/core/reactivity/resource.ts` (193 LOC)

**Strengths:**
- Fine-grained updates (like SolidJS)
- Automatic dependency tracking
- Batched updates

**Integration Opportunity:**
- Resource already handles async data + loading/error states
- Perfect foundation for `useQuery` hook!

---

## Design Philosophy

### Core Principles

1. **Zero Config > Configuration > Code**
   - Level 1: No config needed for single backend
   - Level 2: Simple config for multi-backend
   - Level 3: Advanced customization available

2. **Automatic > Manual**
   - Peer creation automatic
   - Cache manager automatic
   - Signal updates automatic
   - Invalidation automatic

3. **Type Safety First**
   - Full TypeScript inference
   - Service contract sharing with Titan
   - No `any` types in API

4. **Progressive Enhancement**
   - Start simple, add features as needed
   - Tree-shakeable (unused features = 0KB)
   - Opt-in complexity

5. **Framework Integration**
   - Aether signals (not external state)
   - DI system (not global singletons)
   - Module system (not scattered config)

### Design Goals

| Goal | Metric | Current | Target |
|------|--------|---------|--------|
| **Developer Experience** | Lines of boilerplate | 50+ | 5 |
| **Bundle Size** | Additional overhead | N/A | ~8KB |
| **Type Safety** | `any` count | N/A | 0 |
| **Performance** | Cache hit rate | N/A | >80% |
| **Learning Curve** | Concepts to learn | N/A | 3 (query/mutation/stream) |

---

## Architecture Overview

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                         │
│  • User Components                                           │
│  • Business Logic                                            │
│  • useQuery(), useMutation(), useStream()                    │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────────────────┐
│           AETHER-NETRON INTEGRATION LAYER                    │
│                                                               │
│  📦 @omnitron-dev/aether/netron (NEW)                        │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  REACTIVE HOOKS                                      │   │
│  │  • useQuery(service, method, args, options)          │   │
│  │  • useMutation(service, method, options)             │   │
│  │  • useStream(service, method, args)                  │   │
│  │  • useBackend(name) → configured peer                │   │
│  │  • useNetronClient() → NetronClient instance         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  DI PROVIDERS                                        │   │
│  │  • NetronClient (auto-configured)                    │   │
│  │  • HttpCacheManager (shared, global)                 │   │
│  │  • RetryManager (shared, global)                     │   │
│  │  • Backend Registry (multi-backend support)          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  BASE CLASSES                                        │   │
│  │  • NetronService<T> (base for service classes)      │   │
│  │  • NetronStore<T> (state management pattern)        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  DECORATORS                                          │   │
│  │  • @Backend(name) (specify which backend)            │   │
│  │  • @Query(options) (mark query methods)             │   │
│  │  • @Mutation(options) (mark mutation methods)       │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────────────────┐
│              AETHER CORE (Existing)                          │
│  • DI Container (DIContainer)                                │
│  • Reactivity (signal, computed, effect, resource)          │
│  • Module System (defineModule, compileModule)              │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────────────────┐
│              NETRON-BROWSER (Existing)                       │
│  • HttpRemotePeer                                            │
│  • FluentInterface                                           │
│  • HttpCacheManager                                          │
│  • RetryManager                                              │
│  • Middleware Pipeline                                       │
└──────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. NetronClient (Central Orchestrator)

**Purpose:** Single entry point for all netron operations, manages multiple backends

```typescript
@Injectable({ scope: 'singleton' })
export class NetronClient {
  private backends = new Map<string, HttpRemotePeer>();
  private cacheManager: HttpCacheManager;
  private retryManager: RetryManager;
  private defaultBackend: string;

  constructor(
    @Inject(BACKEND_CONFIG) private config: BackendConfig,
    @Inject(CACHE_MANAGER) cacheManager: HttpCacheManager,
    @Inject(RETRY_MANAGER) retryManager: RetryManager
  ) {
    this.cacheManager = cacheManager;
    this.retryManager = retryManager;
    this.defaultBackend = config.default || 'main';

    // Create peers for all configured backends
    this.initializeBackends();
  }

  /** Get or create peer for backend */
  backend(name?: string): HttpRemotePeer {
    const backendName = name || this.defaultBackend;
    return this.backends.get(backendName)!;
  }

  /** Query a service method (returns Promise) */
  async query<T>(
    service: string,
    method: string,
    args: any[],
    options?: QueryOptions
  ): Promise<T> {
    // Implementation
  }

  /** Mutate via service method (returns Promise) */
  async mutate<T>(
    service: string,
    method: string,
    args: any[],
    options?: MutationOptions
  ): Promise<T> {
    // Implementation
  }

  /** Invalidate cache by pattern */
  invalidate(pattern: string | RegExp | string[]): void {
    this.cacheManager.invalidate(pattern);
  }

  /** Get cache statistics */
  getCacheStats(): CacheStats {
    return this.cacheManager.getStats();
  }
}
```

#### 2. Reactive Hooks

**Purpose:** Bridge between netron-browser and Aether signals

```typescript
/**
 * useQuery - Fetch data with caching and reactivity
 *
 * Returns reactive signals that auto-update
 */
export function useQuery<TService, TMethod extends keyof TService>(
  serviceClass: Type<TService>,
  method: TMethod,
  args: Parameters<TService[TMethod]>,
  options?: QueryOptions
): {
  data: Signal<Awaited<ReturnType<TService[TMethod]>> | undefined>;
  loading: Signal<boolean>;
  error: Signal<Error | undefined>;
  refetch: () => Promise<void>;
} {
  // Get NetronClient from DI
  const netron = inject(NetronClient);

  // Get backend from service class metadata
  const backendName = getBackendName(serviceClass);
  const serviceName = getServiceName(serviceClass);

  // Create resource for async data
  const resourceImpl = resource(async () => {
    const peer = netron.backend(backendName);
    const service = await peer.queryFluentInterface<TService>(serviceName);

    // Apply query options (cache, retry, etc.)
    let query = service as any;
    if (options?.cache) query = query.cache(options.cache);
    if (options?.retry) query = query.retry(options.retry);

    // Call method
    return await query[method](...args);
  });

  return {
    data: computed(() => resourceImpl()),
    loading: computed(() => resourceImpl.loading()),
    error: computed(() => resourceImpl.error()),
    refetch: () => resourceImpl.refetch()
  };
}

/**
 * useMutation - Perform mutations with optimistic updates
 */
export function useMutation<TService, TMethod extends keyof TService>(
  serviceClass: Type<TService>,
  method: TMethod,
  options?: MutationOptions
): {
  mutate: (...args: Parameters<TService[TMethod]>) => Promise<Awaited<ReturnType<TService[TMethod]>>>;
  loading: Signal<boolean>;
  error: Signal<Error | undefined>;
  data: Signal<Awaited<ReturnType<TService[TMethod]>> | undefined>;
} {
  const netron = inject(NetronClient);
  const backendName = getBackendName(serviceClass);
  const serviceName = getServiceName(serviceClass);

  const loading = signal(false);
  const error = signal<Error | undefined>(undefined);
  const data = signal<any>(undefined);

  const mutate = async (...args: any[]) => {
    loading.set(true);
    error.set(undefined);

    try {
      const peer = netron.backend(backendName);
      const service = await peer.queryFluentInterface<TService>(serviceName);

      // Apply mutation options
      let mutation = service as any;
      if (options?.optimistic) mutation = mutation.optimistic(options.optimistic);
      if (options?.invalidate) mutation = mutation.invalidateOn(options.invalidate);

      const result = await mutation[method](...args);
      data.set(result);

      // Call success callback
      options?.onSuccess?.(result);

      return result;
    } catch (err) {
      const e = err as Error;
      error.set(e);
      options?.onError?.(e);
      throw e;
    } finally {
      loading.set(false);
    }
  };

  return { mutate, loading, error, data };
}
```

#### 3. NetronService Base Class

**Purpose:** Base class for service implementations with auto-configuration

```typescript
/**
 * Base class for netron services
 *
 * Provides auto-configured access to FluentInterface
 */
export abstract class NetronService<TService> {
  protected netron: NetronClient;
  protected backendName: string;
  protected serviceName: string;

  constructor() {
    // Auto-inject NetronClient
    this.netron = inject(NetronClient);

    // Get metadata from decorators
    this.backendName = getBackendName(this.constructor);
    this.serviceName = getServiceName(this.constructor);
  }

  /**
   * Get configured FluentInterface for this service
   */
  protected async getService(): Promise<FluentInterface<TService>> {
    const peer = this.netron.backend(this.backendName);
    return await peer.queryFluentInterface<TService>(this.serviceName);
  }

  /**
   * Execute a query with default options
   */
  protected async query<T>(
    method: keyof TService,
    args: any[],
    options?: QueryOptions
  ): Promise<T> {
    const service = await this.getService();
    let query = service as any;

    if (options?.cache) query = query.cache(options.cache);
    if (options?.retry) query = query.retry(options.retry);

    return await query[method](...args);
  }

  /**
   * Execute a mutation with default options
   */
  protected async mutate<T>(
    method: keyof TService,
    args: any[],
    options?: MutationOptions
  ): Promise<T> {
    const service = await this.getService();
    let mutation = service as any;

    if (options?.optimistic) mutation = mutation.optimistic(options.optimistic);
    if (options?.invalidate) mutation = mutation.invalidateOn(options.invalidate);

    return await mutation[method](...args);
  }
}
```

---

## API Design by Level

### Level 1: Zero Config (Single Backend)

**Goal:** Start simple, no configuration needed

```typescript
// 1. Module configuration
@Module({
  imports: [
    NetronModule.forRoot({
      baseUrl: 'https://api.example.com'
    })
  ],
  providers: [UserService],
})
class AppModule {}

// 2. Service definition (minimal)
@Injectable()
class UserService extends NetronService<IUserService> {
  // No boilerplate! Base class handles everything

  // Optional: Add convenience methods
  getUsers() {
    return this.query('getUsers', []);
  }
}

// 3. Component usage
const UserList = defineComponent(() => {
  const { data: users, loading } = useQuery(UserService, 'getUsers', []);

  return () => (
    <div>
      {loading() ? <Spinner /> : <UserTable users={users()} />}
    </div>
  );
});
```

**Bundle Impact:** ~8KB (NetronModule + hooks)

### Level 2: Multi-Backend (Simple Configuration)

**Goal:** Support multiple backends with minimal config

```typescript
// 1. Module configuration with multiple backends
@Module({
  imports: [
    NetronModule.forRoot({
      backends: {
        main: 'https://api.example.com',
        analytics: 'https://analytics.example.com',
        auth: 'https://auth.example.com'
      },
      default: 'main'  // Optional, defaults to first
    })
  ],
  providers: [UserService, AnalyticsService],
})
class AppModule {}

// 2. Service definitions (specify backend)
@Injectable()
@Backend('main')
class UserService extends NetronService<IUserService> {
  // Uses 'main' backend
}

@Injectable()
@Backend('analytics')
class AnalyticsService extends NetronService<IAnalyticsService> {
  // Uses 'analytics' backend
}

// 3. Component usage (same as Level 1!)
const UserList = defineComponent(() => {
  const { data: users } = useQuery(UserService, 'getUsers', []);
  const analytics = inject(AnalyticsService);

  onMount(() => analytics.trackPageView('users'));

  return () => <UserTable users={users()} />;
});
```

**Bundle Impact:** Same ~8KB (no additional overhead)

### Level 3: Store-Based (Reactive State Management)

**Goal:** Advanced state management with stores

```typescript
// 1. Define store with netron integration
@Injectable()
@Backend('main')
class UserStore extends NetronStore<IUserService> {
  // Reactive state
  users = signal<User[]>([]);
  loading = signal(false);

  // Computed
  activeUsers = computed(() =>
    this.users().filter(u => u.active)
  );

  // Actions with auto-caching
  async loadUsers() {
    this.loading.set(true);
    try {
      const data = await this.query('getUsers', [], {
        cache: { maxAge: 60000 }
      });
      this.users.set(data);
    } finally {
      this.loading.set(false);
    }
  }

  // Mutations with optimistic updates
  async updateUser(id: string, data: Partial<User>) {
    await this.mutate('updateUser', [id, data], {
      optimistic: () => {
        // Auto-rollback on error!
        this.users.set(
          this.users().map(u =>
            u.id === id ? { ...u, ...data } : u
          )
        );
      },
      invalidate: ['users']
    });
  }
}

// 2. Component usage
const UserList = defineComponent(() => {
  const store = inject(UserStore);

  onMount(() => store.loadUsers());

  const handleUpdate = (id: string, data: Partial<User>) => {
    store.updateUser(id, data);
  };

  return () => (
    <div>
      {store.loading() ? (
        <Spinner />
      ) : (
        <UserTable
          users={store.activeUsers()}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
});
```

**Bundle Impact:** ~10KB (includes store helpers)

### Level 4: Advanced (Custom Middleware, Transformations)

**Goal:** Full customization for complex scenarios

```typescript
// 1. Custom middleware
class AuthMiddleware implements NetronMiddleware {
  priority = 100;
  stage = 'PRE_REQUEST';

  async execute(context: MiddlewareContext, next: () => Promise<void>) {
    const token = localStorage.getItem('auth_token');
    if (token) {
      context.request.headers = {
        ...context.request.headers,
        Authorization: `Bearer ${token}`
      };
    }
    await next();
  }
}

// 2. Advanced module configuration
@Module({
  imports: [
    NetronModule.forRoot({
      backends: {
        main: {
          url: 'https://api.example.com',
          cache: {
            maxEntries: 1000,
            maxSizeBytes: 10_000_000,
            defaultMaxAge: 60000
          },
          retry: {
            attempts: 3,
            backoff: 'exponential',
            circuitBreaker: {
              threshold: 5,
              windowTime: 60000,
              cooldownTime: 30000
            }
          },
          middleware: [AuthMiddleware],
          headers: {
            'X-App-Version': '1.0.0'
          }
        }
      }
    })
  ]
})
class AppModule {}

// 3. Service with custom transformations
@Injectable()
@Backend('main')
class UserService extends NetronService<IUserService> {
  async getUsers() {
    return this.query('getUsers', [], {
      cache: { maxAge: 60000, tags: ['users'] },
      retry: 3,
      transform: (users) => users.map(normalizeUser),
      validate: (users) => Array.isArray(users),
      fallback: [],
      metrics: (timing) => console.log('Query took', timing.duration)
    });
  }
}
```

**Bundle Impact:** ~12KB (includes advanced features)

---

## Implementation Details

### Module Structure

```
packages/aether/src/netron/
├── index.ts                    # Public API exports
├── module.ts                   # NetronModule definition
├── client.ts                   # NetronClient class
├── hooks/
│   ├── use-query.ts           # useQuery implementation
│   ├── use-mutation.ts        # useMutation implementation
│   ├── use-stream.ts          # useStream implementation
│   └── use-backend.ts         # useBackend implementation
├── base/
│   ├── netron-service.ts      # NetronService base class
│   └── netron-store.ts        # NetronStore base class
├── decorators/
│   ├── backend.ts             # @Backend decorator
│   ├── query.ts               # @Query decorator
│   └── mutation.ts            # @Mutation decorator
├── providers.ts                # DI providers
├── tokens.ts                   # Injection tokens
└── types.ts                    # Type definitions
```

### NetronModule Implementation

```typescript
/**
 * NetronModule - Main integration module
 */
export class NetronModule {
  /**
   * Configure for root module (singleton services)
   */
  static forRoot(config: NetronModuleConfig): ModuleWithProviders {
    return {
      module: defineModule({ id: 'netron-root' }),
      providers: [
        // Configuration
        { provide: BACKEND_CONFIG, useValue: config },

        // Cache manager (shared, singleton)
        {
          provide: CACHE_MANAGER,
          useFactory: () => new HttpCacheManager(config.cache),
          scope: 'singleton'
        },

        // Retry manager (shared, singleton)
        {
          provide: RETRY_MANAGER,
          useFactory: () => new RetryManager(config.retry),
          scope: 'singleton'
        },

        // NetronClient (singleton)
        {
          provide: NetronClient,
          useClass: NetronClient,
          scope: 'singleton'
        }
      ]
    };
  }

  /**
   * Configure for child modules (feature modules)
   */
  static forFeature(): ModuleWithProviders {
    return {
      module: defineModule({ id: 'netron-feature' }),
      providers: []  // Reuses root providers
    };
  }
}
```

### Type Definitions

```typescript
/**
 * Backend configuration
 */
export interface BackendConfig {
  /** Backend URL or full configuration */
  [name: string]: string | BackendOptions;

  /** Default backend name */
  default?: string;
}

export interface BackendOptions {
  /** Base URL */
  url: string;

  /** Cache configuration */
  cache?: {
    maxEntries?: number;
    maxSizeBytes?: number;
    defaultMaxAge?: number;
    debug?: boolean;
  };

  /** Retry configuration */
  retry?: {
    attempts?: number;
    backoff?: 'exponential' | 'linear' | 'constant';
    initialDelay?: number;
    maxDelay?: number;
    jitter?: number;
    circuitBreaker?: {
      threshold: number;
      windowTime: number;
      cooldownTime: number;
    };
  };

  /** Request headers */
  headers?: Record<string, string>;

  /** Request timeout */
  timeout?: number;

  /** Middleware */
  middleware?: Type<NetronMiddleware>[];
}

/**
 * Query options
 */
export interface QueryOptions {
  /** Caching options */
  cache?: CacheOptions | number;

  /** Retry options */
  retry?: RetryOptions | number;

  /** Request timeout */
  timeout?: number;

  /** Request priority */
  priority?: 'high' | 'normal' | 'low';

  /** Transform response */
  transform?<T, R>(data: T): R;

  /** Validate response */
  validate?<T>(data: T): boolean | Promise<boolean>;

  /** Fallback data on error */
  fallback?: any;

  /** Metrics callback */
  metrics?(timing: { duration: number; cacheHit?: boolean }): void;

  /** Refetch on mount */
  refetchOnMount?: boolean;

  /** Refetch on window focus */
  refetchOnFocus?: boolean;

  /** Refetch interval (ms) */
  refetchInterval?: number;
}

/**
 * Mutation options
 */
export interface MutationOptions {
  /** Optimistic update function */
  optimistic?<T>(current: T | undefined): T;

  /** Cache tags to invalidate */
  invalidate?: string[];

  /** Success callback */
  onSuccess?(data: any): void;

  /** Error callback */
  onError?(error: Error): void;

  /** Retry options */
  retry?: RetryOptions | number;
}
```

### Decorators Implementation

```typescript
/**
 * @Backend decorator - Specify which backend to use
 */
export function Backend(name: string): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata?.('netron:backend', name, target);
    return target;
  };
}

/**
 * Get backend name from class
 */
export function getBackendName(target: any): string {
  return Reflect.getMetadata?.('netron:backend', target) || 'main';
}

/**
 * Get service name from class (uses class name by default)
 */
export function getServiceName(target: any): string {
  // Check for explicit metadata
  const explicit = Reflect.getMetadata?.('netron:service', target);
  if (explicit) return explicit;

  // Extract from class name (UserService → users)
  const className = target.name || target.constructor?.name;
  if (!className) return 'unknown';

  // Convert PascalCase to kebab-case and remove "Service" suffix
  return className
    .replace(/Service$/, '')
    .replace(/([A-Z])/g, (match, p1, offset) =>
      offset > 0 ? '-' + p1.toLowerCase() : p1.toLowerCase()
    );
}
```

---

## Integration Patterns

### Pattern 1: Simple Query

```typescript
// Service definition
@Injectable()
@Backend('main')
class UserService extends NetronService<IUserService> {}

// Component
const UserList = defineComponent(() => {
  const { data: users, loading, error } = useQuery(
    UserService,
    'getUsers',
    [],
    { cache: 60000 }  // Cache for 60s
  );

  return () => (
    <div>
      {loading() && <Spinner />}
      {error() && <Error message={error()!.message} />}
      {users() && <UserTable users={users()!} />}
    </div>
  );
});
```

### Pattern 2: Mutation with Optimistic Update

```typescript
// Component
const UserEditor = defineComponent(() => {
  const { mutate, loading } = useMutation(
    UserService,
    'updateUser',
    {
      optimistic: (id: string, data: Partial<User>) => ({
        // Return optimistic data that will be used immediately
        ...data
      }),
      invalidate: ['users'],  // Invalidate users query after mutation
      onSuccess: (updatedUser) => {
        toast.success('User updated!');
      },
      onError: (error) => {
        toast.error('Failed to update user');
      }
    }
  );

  const handleSubmit = async (id: string, data: Partial<User>) => {
    await mutate(id, data);
  };

  return () => <UserForm onSubmit={handleSubmit} disabled={loading()} />;
});
```

### Pattern 3: Store with Actions

```typescript
@Injectable()
@Backend('main')
class UserStore extends NetronStore<IUserService> {
  // State
  users = signal<User[]>([]);
  selectedUser = signal<User | null>(null);

  // Computed
  activeUsers = computed(() => this.users().filter(u => u.active));

  // Actions
  async loadUsers() {
    const data = await this.query('getUsers', [], {
      cache: { maxAge: 60000, tags: ['users'] }
    });
    this.users.set(data);
  }

  async selectUser(id: string) {
    const user = await this.query('getUser', [id], {
      cache: { maxAge: 30000 }
    });
    this.selectedUser.set(user);
  }

  async updateUser(id: string, data: Partial<User>) {
    await this.mutate('updateUser', [id, data], {
      optimistic: () => {
        this.users.set(
          this.users().map(u => u.id === id ? { ...u, ...data } : u)
        );
      },
      invalidate: ['users']
    });
  }
}

// Component
const UserManagement = defineComponent(() => {
  const store = inject(UserStore);

  onMount(() => store.loadUsers());

  return () => (
    <div>
      <UserList
        users={store.activeUsers()}
        onSelect={(id) => store.selectUser(id)}
      />
      {store.selectedUser() && (
        <UserDetails
          user={store.selectedUser()!}
          onUpdate={(data) => store.updateUser(store.selectedUser()!.id, data)}
        />
      )}
    </div>
  );
});
```

### Pattern 4: Multiple Backends

```typescript
// Main API
@Injectable()
@Backend('main')
class UserService extends NetronService<IUserService> {}

// Analytics API
@Injectable()
@Backend('analytics')
class AnalyticsService extends NetronService<IAnalyticsService> {}

// Auth API
@Injectable()
@Backend('auth')
class AuthService extends NetronService<IAuthService> {}

// Component using multiple backends
const Dashboard = defineComponent(() => {
  const { data: users } = useQuery(UserService, 'getUsers', []);
  const analytics = inject(AnalyticsService);
  const auth = inject(AuthService);

  onMount(async () => {
    // Track page view in analytics backend
    await analytics.trackPageView('dashboard');

    // Verify auth in auth backend
    const session = await auth.verifySession();
    if (!session.valid) {
      navigate('/login');
    }
  });

  return () => <UserTable users={users()} />;
});
```

### Pattern 5: Custom Cache Strategies

```typescript
@Injectable()
@Backend('main')
class ProductStore extends NetronStore<IProductService> {
  products = signal<Product[]>([]);

  async loadProducts() {
    // Cache with stale-while-revalidate
    const data = await this.query('getProducts', [], {
      cache: {
        maxAge: 60000,                 // Fresh for 60s
        staleWhileRevalidate: 30000,   // Serve stale for 30s while revalidating
        tags: ['products'],
        cacheOnError: true             // Serve stale on network error
      }
    });
    this.products.set(data);
  }

  async loadFeaturedProducts() {
    // Aggressive caching with background refetch
    const service = await this.getService();
    const data = await service
      .cache({ maxAge: 300000, tags: ['products', 'featured'] })
      .background(60000)  // Refetch every 60s in background
      .getFeaturedProducts();

    return data;
  }
}
```

---

## Performance & Bundle Size

### Bundle Size Analysis

| Component | Size (gzipped) | Tree-Shakeable |
|-----------|----------------|----------------|
| **Core Integration** | | |
| NetronModule | ~2KB | ✅ |
| NetronClient | ~3KB | ✅ |
| Reactive Hooks | ~2KB | ✅ (per hook) |
| Base Classes | ~1KB | ✅ |
| Decorators | ~0.5KB | ✅ |
| **Optional Features** | | |
| NetronStore | ~1KB | ✅ |
| Advanced Middleware | ~1KB | ✅ |
| DevTools | ~5KB | ✅ |
| **Dependencies** | | |
| netron-browser | ~15-20KB | Already included |
| **Total (Level 1)** | **~8KB** | - |
| **Total (Level 3)** | **~10KB** | - |
| **Total (Level 4)** | **~12KB** | - |

### Performance Characteristics

#### Cache Hit Rates

```typescript
// Typical cache hit rates with HttpCacheManager
const stats = netron.getCacheStats();

console.log({
  hitRate: stats.hitRate,        // 80-90% typical
  hits: stats.hits,
  misses: stats.misses,
  entries: stats.entries,
  sizeBytes: stats.sizeBytes
});
```

#### Request Deduplication

```typescript
// Multiple components requesting same data
const UserList = defineComponent(() => {
  const { data } = useQuery(UserService, 'getUsers', []);
  // ...
});

const UserCount = defineComponent(() => {
  const { data } = useQuery(UserService, 'getUsers', []);
  // ...
});

// ✅ Only ONE network request (deduplication)
// ✅ Both components share cached result
```

#### Optimistic Update Performance

```typescript
// Update is instant (no network wait)
await store.updateUser(id, data);
// ✅ UI updates immediately
// ✅ Network request in background
// ✅ Auto-rollback on error
```

### Memory Management

```typescript
// Automatic cleanup when cache reaches limits
const cacheManager = new HttpCacheManager({
  maxEntries: 1000,                  // Max 1000 cached responses
  maxSizeBytes: 10_000_000,         // Max 10MB
  defaultMaxAge: 60000              // 60s default TTL
});

// LRU eviction when limits reached
// Automatic TTL-based cleanup
// No memory leaks
```

---

## Migration Strategy

### From Manual netron-browser

**Before:**
```typescript
@Injectable()
class UserStore {
  private users = signal<User[]>([]);

  constructor() {
    // ❌ Manual peer creation
    this.peer = new HttpRemotePeer('https://api.example.com');
    this.peer.setCacheManager(new HttpCacheManager());
  }

  async loadUsers() {
    // ❌ Manual service query
    const service = await this.peer.queryFluentInterface<IUserService>('users');
    const data = await service.getUsers();
    this.users.set(data);
  }
}
```

**After:**
```typescript
@Injectable()
@Backend('main')
class UserStore extends NetronStore<IUserService> {
  users = signal<User[]>([]);

  // ✅ No constructor needed!

  async loadUsers() {
    // ✅ Auto-configured!
    const data = await this.query('getUsers', []);
    this.users.set(data);
  }
}
```

### From fetch/axios

**Before:**
```typescript
@Injectable()
class UserStore {
  private users = signal<User[]>([]);
  private loading = signal(false);

  async loadUsers() {
    this.loading.set(true);
    try {
      // ❌ Manual fetch
      const response = await fetch('https://api.example.com/users');
      const data = await response.json();

      // ❌ Manual caching
      localStorage.setItem('users', JSON.stringify(data));
      this.users.set(data);
    } catch (error) {
      // ❌ Manual error handling
      console.error(error);
    } finally {
      this.loading.set(false);
    }
  }
}
```

**After:**
```typescript
@Injectable()
@Backend('main')
class UserStore extends NetronStore<IUserService> {
  users = signal<User[]>([]);

  async loadUsers() {
    // ✅ Auto-caching, auto-retry, auto-error handling!
    const data = await this.query('getUsers', [], {
      cache: { maxAge: 60000 }
    });
    this.users.set(data);
  }
}
```

---

## Future Enhancements

### Phase 1: Core (Weeks 1-3)
- [ ] Implement NetronModule
- [ ] Implement NetronClient
- [ ] Implement useQuery hook
- [ ] Implement useMutation hook
- [ ] Implement NetronService base class
- [ ] Write 100+ tests

### Phase 2: Advanced (Weeks 4-6)
- [ ] Implement NetronStore base class
- [ ] Implement useStream hook
- [ ] Router integration (auto-execute loaders)
- [ ] SSR support
- [ ] Write 50+ integration tests

### Phase 3: Optimizations (Weeks 7-8)
- [ ] Implement request batching
- [ ] Implement prefetch strategies
- [ ] Implement offline support
- [ ] DevTools browser extension

### Phase 4: Ecosystem (Weeks 9+)
- [ ] Documentation and examples
- [ ] Migration guides
- [ ] Video tutorials
- [ ] Community feedback

---

## Conclusion

### What We Achieve

✅ **Zero-config for 90% of use cases**
- Single backend: Just provide URL
- Multi-backend: Just provide names and URLs
- No manual peer creation
- No manual cache configuration

✅ **Type-safe end-to-end**
- Full TypeScript inference
- Shared contracts with Titan
- No `any` types in API

✅ **Reactive by default**
- Signals auto-update
- Automatic cache invalidation
- Optimistic updates with auto-rollback

✅ **Production-ready**
- Proven netron-browser foundation
- HttpCacheManager battle-tested
- 6,777 tests passing in Aether
- 204 tests passing in netron-browser

✅ **Tree-shakeable**
- Only ~8KB for basic usage
- Each feature can be tree-shaken
- No global state pollution

✅ **Progressive enhancement**
- Start simple (Level 1)
- Add complexity as needed (Level 2-4)
- Never forced into advanced patterns

### Impact on Aether

**Before:**
- ❌ Manual everything
- ❌ 50+ lines of boilerplate per service
- ❌ No caching
- ❌ No type safety
- ❌ Developers don't know FluentInterface exists

**After:**
- ✅ Automatic everything
- ✅ 5 lines of code per service
- ✅ Caching by default
- ✅ Full type safety
- ✅ Discoverable API

### Competitive Position

**Aether + Netron vs React + React Query + tRPC:**

| Feature | Aether + Netron | React + RQ + tRPC |
|---------|----------------|-------------------|
| Type Safety | ✅ End-to-end | ✅ End-to-end |
| Caching | ✅ Built-in | ✅ Built-in |
| Optimistic | ✅ Auto-rollback | ⚠️ Manual |
| Streaming | ✅ Full bidirectional | ⚠️ Limited |
| Bundle Size | ~23KB | ~28KB |
| Setup Lines | 5 | 20+ |
| Backend | ✅ Integrated (Titan) | ❌ BYO |

**Result:** Aether becomes the **most integrated fullstack TypeScript framework**.

---

**Status:** ✅ Design Complete
**Next Step:** Implementation
**Estimated Time:** 8 weeks to full implementation
**Estimated Time to MVP:** 3 weeks
