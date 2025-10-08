# HTTP Transport Unified API Migration - Aether

## Overview

Successfully ported the unified HTTP transport API from Titan (backend) to Aether (frontend/browser), providing React Query-like capabilities in Netron architecture while maintaining full compatibility with the backend.

## Changes Made

### 1. Created New Components

#### **configurable-proxy.ts** (New)
Accumulates configuration options and intercepts method calls.

**Features**:
- Chainable API for configuration
- Method interception via JavaScript Proxy
- Browser-optimized (SSR-safe)

**Usage**:
```typescript
// Proxy accumulates options and executes on method call
const result = await service
  .cache(60000)
  .retry(3)
  .timeout(5000)
  .getUser('123');
```

#### **query-builder.ts** (Rewritten)
Complete rewrite with browser-specific optimizations.

**Browser-Specific**:
- `number` timeout handles (not NodeJS.Timeout)
- Window performance API for metrics
- AbortController for cancellation
- SSR-safe implementation

**Features**:
- Request deduplication
- Background refetch
- Optimistic updates with rollback
- Cache integration
- Retry logic
- Request cancellation
- Transform & validate
- Fallback support

#### **fluent-interface.ts** (New)
Advanced HTTP features with fluent API.

**Features**:
- Chainable configuration methods
- Global options support
- React Query-like capabilities:
  - Caching with TTL
  - Optimistic updates
  - Background refetch
  - Request deduplication
  - Retry with backoff
  - Priority queuing
  - Transform & validate

**Usage**:
```typescript
const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

// Advanced features
const user = await service
  .cache(60000)           // Cache for 60s
  .retry(3)               // Retry up to 3 times
  .optimistic(current => ({ // Optimistic update
    ...current,
    name: 'New Name'
  }))
  .updateUser(userId, { name: 'New Name' });
```

### 2. Updated Existing Components

#### **interface.ts** (Simplified)
Converted to pure RPC proxy (no fluent methods).

**Before** (462 lines with QueryBuilder embedded):
```typescript
class HttpInterface {
  // Had cache(), retry(), call(), etc.
  cache(options: CacheOptions): QueryBuilder { ... }
  retry(options: RetryOptions): QueryBuilder { ... }
  // ... many fluent methods
}
```

**After** (103 lines, simple RPC only):
```typescript
class HttpInterface {
  // Pure RPC proxy
  // Methods are proxied directly to remote service
  // No configuration methods
}
```

#### **peer.ts** (Enhanced)
Added unified API methods.

**Added Fields**:
```typescript
private cacheManager?: HttpCacheManager;
private retryManager?: RetryManager;
private globalOptions: QueryOptions = {};
```

**Added Methods**:
```typescript
// Override queryInterface() - returns simple RPC interface
override async queryInterface<TService>(name: string): Promise<TService>

// New method - returns advanced HTTP interface
async queryFluentInterface<TService>(name: string): Promise<FluentInterface<TService>>

// Manager configuration
setCacheManager(manager: HttpCacheManager): this
setRetryManager(manager: RetryManager): this
setGlobalOptions(options: QueryOptions): this

// Getters
getCacheManager(): HttpCacheManager | undefined
getRetryManager(): RetryManager | undefined
getGlobalOptions(): QueryOptions
```

#### **index.ts** (Updated)
Reorganized exports for clarity.

**Changes**:
- Added exports for new components
- Removed SubscriptionManager and OptimisticUpdateManager exports
- Added QueryOptions, CacheOptions, RetryOptions type exports
- Improved documentation

### 3. Removed Components

#### **subscription-manager.ts** (Removed)
- 618 lines removed
- WebSocket-based functionality doesn't belong in HTTP transport
- Use WebSocket transport for subscriptions

#### **optimistic-update-manager.ts** (Removed)
- 489 lines removed
- Duplicate functionality - QueryBuilder already provides optimistic updates
- Never integrated into production code

**Total Removed**: 1107 lines of redundant code

## API Comparison

### Unified API (Titan & Aether)

```typescript
// Standard RPC (same across all transports)
const service = await peer.queryInterface<IUserService>('UserService@1.0.0');
const user = await service.getUser('123');

// Advanced HTTP features
const fluentService = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');
const cachedUser = await fluentService.cache(60000).retry(3).getUser('123');
```

### Browser-Specific Features

#### 1. **Performance Metrics**
```typescript
const user = await service
  .metrics((timing) => {
    console.log('Duration:', timing.duration);
    console.log('Cache hit:', timing.cacheHit);
  })
  .getUser('123');
```

#### 2. **Background Refetch**
```typescript
// Keeps data fresh in background
const data = await service
  .cache(60000)
  .background(30000)  // Refetch every 30s
  .getData();
```

#### 3. **Optimistic Updates**
```typescript
// Immediate UI update, rollback on error
const updated = await service
  .cache(60000)
  .optimistic((current) => ({
    ...current,
    status: 'updated'
  }))
  .updateItem(id, { status: 'updated' });
```

#### 4. **Request Deduplication**
```typescript
// Multiple identical requests = single network call
const [user1, user2, user3] = await Promise.all([
  service.dedupe('user-123').getUser('123'),
  service.dedupe('user-123').getUser('123'),
  service.dedupe('user-123').getUser('123')
]);
// Only 1 actual HTTP request
```

#### 5. **Request Cancellation**
```typescript
const builder = service.cache(60000).getUser('123');

// Cancel if needed
setTimeout(() => builder.cancel(), 1000);

try {
  await builder.execute();
} catch (err) {
  // Handle cancellation
}
```

## Browser-Specific Optimizations

### 1. **Timeout Handles**
```typescript
// Browser: setTimeout returns number
private static backgroundIntervals = new Map<string, number>();

const interval = setInterval(...) as unknown as number;
```

### 2. **Performance API**
```typescript
// Uses window.performance (available in browsers)
const startTime = performance.now();
const duration = performance.now() - startTime;
```

### 3. **AbortController**
```typescript
// Native browser API for cancellation
private abortController = new AbortController();

cancel(): void {
  this.abortController.abort();
}
```

### 4. **SSR Safety**
```typescript
// All code is SSR-safe
// No browser-specific globals accessed at module level
// Proper cleanup for background intervals
```

## Usage Examples

### Basic Setup

```typescript
import { HttpRemotePeer, HttpCacheManager, RetryManager } from '@omnitron-dev/aether/netron/transport/http';

// Create peer
const peer = new HttpRemotePeer(
  connection,
  netron,
  'https://api.example.com'
);

// Configure managers
peer.setCacheManager(new HttpCacheManager({ maxEntries: 1000 }));
peer.setRetryManager(new RetryManager({ maxAttempts: 3 }));

// Set global defaults
peer.setGlobalOptions({
  cache: { maxAge: 60000 },
  retry: { attempts: 2 }
});
```

### Simple RPC

```typescript
// queryInterface() returns simple RPC proxy
const userService = await peer.queryInterface<IUserService>('UserService@1.0.0');

// Direct method calls
const user = await userService.getUser('123');
const users = await userService.listUsers({ page: 1 });
```

### Advanced HTTP Features

```typescript
// queryFluentInterface() returns advanced interface
const userService = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

// Cached request
const user = await userService
  .cache(60000)
  .getUser('123');

// Cached with retry
const user = await userService
  .cache(60000)
  .retry(3)
  .getUser('123');

// Full-featured request
const user = await userService
  .cache({ maxAge: 60000, tags: ['user', 'user:123'] })
  .retry({ attempts: 3, backoff: 'exponential' })
  .timeout(5000)
  .priority('high')
  .transform((data) => ({ ...data, cached: true }))
  .validate((data) => !!data.id)
  .fallback({ id: '123', name: 'Unknown' })
  .metrics((timing) => console.log('Request took:', timing.duration))
  .getUser('123');
```

### Optimistic Updates (React Query-like)

```typescript
const todoService = await peer.queryFluentInterface<ITodoService>('TodoService@1.0.0');

// Optimistic todo completion
const updated = await todoService
  .cache(60000)
  .optimistic((current: Todo | undefined) => ({
    ...(current || {}),
    completed: true,
    completedAt: new Date().toISOString()
  }))
  .completeTodo(todoId);

// If server request fails, optimistic update is automatically rolled back
```

### Cache Invalidation

```typescript
const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

// Invalidate specific cache
service.invalidate('users*');

// Invalidate by tag
peer.getCacheManager()?.invalidateByTag('user:123');

// Clear all cache
service.clearCache();
```

### Background Refetch (React Query-like)

```typescript
// Keep data fresh automatically
const stats = await service
  .cache(300000)        // Cache for 5min
  .background(60000)    // Refetch every 1min in background
  .getStats();

// Data stays fresh without manual refetch
```

## React/Aether Integration

### With Aether Signals

```typescript
import { createSignal, createEffect } from '@omnitron-dev/aether';

const [user, setUser] = createSignal<User | null>(null);
const [loading, setLoading] = createSignal(true);

// Fetch with cache
createEffect(async () => {
  setLoading(true);

  const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

  const result = await service
    .cache(60000)
    .retry(3)
    .getUser(userId());

  setUser(result);
  setLoading(false);
});
```

### With Optimistic Updates

```typescript
const updateUser = async (updates: Partial<User>) => {
  const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

  // Optimistic update
  const updated = await service
    .cache(60000)
    .optimistic((current) => ({
      ...current,
      ...updates
    }))
    .updateUser(userId(), updates);

  // UI updated immediately, rolled back on error
  setUser(updated);
};
```

## Migration from Old API

### Old API (Before)

```typescript
// Old way - embedded QueryBuilder in HttpInterface
const service = await peer.createHttpInterface<IUserService>('UserService@1.0.0', {
  cache: cacheManager,
  retry: retryManager
});

// Using call() method
const user = await service
  .call('getUser', '123')
  .cache(60000)
  .retry(3)
  .execute();
```

### New API (After)

```typescript
// Configure peer once
peer.setCacheManager(cacheManager);
peer.setRetryManager(retryManager);

// Simple RPC
const service = await peer.queryInterface<IUserService>('UserService@1.0.0');
const user = await service.getUser('123');

// Or advanced HTTP
const fluentService = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');
const user = await fluentService
  .cache(60000)
  .retry(3)
  .getUser('123');
```

## Benefits

### 1. **Unified API**
- ✅ Same API as Titan backend
- ✅ queryInterface() for simple RPC (all transports)
- ✅ queryFluentInterface() for HTTP features
- ✅ Consistent developer experience

### 2. **React Query-like Features**
- ✅ Caching with TTL and tags
- ✅ Optimistic updates with rollback
- ✅ Background refetch
- ✅ Request deduplication
- ✅ Retry with backoff
- ✅ Transform & validate
- ✅ Metrics & monitoring

### 3. **Browser Optimizations**
- ✅ SSR-safe implementation
- ✅ Performance API metrics
- ✅ AbortController cancellation
- ✅ Proper timeout handling
- ✅ Memory-efficient caching

### 4. **Code Quality**
- ✅ 1107 lines of redundant code removed
- ✅ Clear separation: simple RPC vs advanced HTTP
- ✅ Better tree-shaking
- ✅ Improved maintainability

### 5. **Developer Experience**
- ✅ Fluent, chainable API
- ✅ TypeScript inference
- ✅ Comprehensive examples
- ✅ Familiar patterns (React Query-like)

## Testing

### Build Status
- ✅ ESM build successful
- ✅ Source maps generated
- ⚠️ DTS build warning (jsx-runtime.d.ts conflict - existing issue)

### Test Coverage
- ✅ Existing tests pass
- ✅ No regressions from changes
- ✅ Browser compatibility verified

## Summary

Successfully ported Titan's unified HTTP transport API to Aether, providing:
- **Unified API**: Compatible with Titan backend
- **React Query-like features**: In Netron architecture
- **Browser optimizations**: SSR-safe, performance-focused
- **Code reduction**: 1107 lines removed
- **Better DX**: Fluent API, TypeScript inference

**Key Achievement**: Aether now has the same powerful HTTP features as Titan, with React Query-like capabilities, while maintaining Netron's architecture and philosophy.
