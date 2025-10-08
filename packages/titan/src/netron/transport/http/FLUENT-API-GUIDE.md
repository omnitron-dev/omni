# Enhanced Fluent API Guide for Netron HTTP Transport

> **Complete guide to using the enhanced, natural Netron-style fluent API**
> **Version**: 1.0.0
> **Last Updated**: 2025-10-08

---

## Table of Contents

1. [Introduction](#introduction)
2. [Quick Start](#quick-start)
3. [Core Concepts](#core-concepts)
4. [API Reference](#api-reference)
5. [Advanced Features](#advanced-features)
6. [Best Practices](#best-practices)
7. [Migration Guide](#migration-guide)
8. [Performance](#performance)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

The Enhanced Fluent API provides a natural, Netron-native way to call remote services with powerful configuration options. Unlike the traditional `call().execute()` pattern, the fluent API allows you to configure caching, retries, transformations, and more, then call methods directly on the service interface.

### Why Use the Fluent API?

**Natural Netron-Style Calls**:
```typescript
// ✨ Enhanced Fluent API
const user = await userService
  .cache(60000)
  .retry(3)
  .getUser('user-123');
```

**Instead of Traditional API**:
```typescript
// Old call().execute() pattern
const user = await userService
  .call('getUser', 'user-123')
  .cache(60000)
  .retry(3)
  .execute();
```

### Key Benefits

- **🎯 Natural**: Call methods directly on service interface
- **⚡ Performant**: Minimal proxy overhead, optimized execution
- **🔧 Flexible**: Chain configurations as needed
- **💪 Type-Safe**: Full TypeScript support with generics
- **🚀 Feature-Rich**: Caching, retries, optimistic updates, background refetch, and more
- **📦 Composable**: Create reusable configuration presets

---

## Quick Start

### 1. Create Fluent Interface

```typescript
import { HttpRemotePeer } from '@omnitron-dev/titan/netron';
import { HttpCacheManager, RetryManager } from '@omnitron-dev/titan/netron/transport/http';

// Define your service interface
interface IUserService {
  getUser(id: string): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

// Create HTTP peer
const peer = new HttpRemotePeer(
  connection,
  netron,
  'http://localhost:3000'
);

// Create fluent interface
const userService = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    cache: new HttpCacheManager(),
    retry: new RetryManager()
  }
);
```

### 2. Make Calls with Configuration

```typescript
// Simple call
const user = await userService.getUser('user-123');

// With caching
const cachedUser = await userService
  .cache(60000)
  .getUser('user-123');

// With retry
const retryUser = await userService
  .retry(3)
  .getUser('user-123');

// Combined configurations
const result = await userService
  .cache({ maxAge: 60000, staleWhileRevalidate: 10000 })
  .retry({ attempts: 3, backoff: 'exponential' })
  .timeout(5000)
  .getUser('user-123');
```

---

## Core Concepts

### 1. FluentInterface

The main entry point for creating service proxies. Created via `peer.createFluentInterface()`.

```typescript
const service = await peer.createFluentInterface<TService>(
  'ServiceName@version',
  {
    cache?: HttpCacheManager,      // Optional cache manager
    retry?: RetryManager,           // Optional retry manager
    globalOptions?: QueryOptions    // Default options for all calls
  }
);
```

### 2. ConfigurableProxy

Returned when you call configuration methods like `.cache()`, `.retry()`, etc. Accumulates options and creates method proxies.

```typescript
const proxy = service
  .cache(60000)      // Returns ConfigurableProxy
  .retry(3)          // Returns ConfigurableProxy
  .timeout(5000);    // Returns ConfigurableProxy

// Now call method on proxy
const result = await proxy.getUser('123');
```

### 3. QueryBuilder

Handles actual query execution. Created internally when you call a method.

```typescript
// Internal flow:
service.cache(60000).getUser('123')
  ↓
Creates QueryBuilder
  ↓
Applies options (cache, retry, etc.)
  ↓
Executes request
  ↓
Returns result
```

### 4. Options Accumulation

Configuration options accumulate through the chain:

```typescript
const service = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    globalOptions: {
      retry: { attempts: 3 }  // Global default
    }
  }
);

const result = await service
  .cache(60000)        // Adds cache option
  .timeout(5000)       // Adds timeout option
  .getUser('123');     // Uses: retry (global) + cache + timeout
```

---

## API Reference

### FluentInterface Methods

#### Configuration Methods

All configuration methods return a `ConfigurableProxy` with accumulated options.

##### `.cache(options: CacheOptions | number): ConfigurableProxy`

Enable caching for the next method call.

```typescript
// Simple: cache for 60 seconds
await service.cache(60000).getUser('123');

// Advanced: with stale-while-revalidate
await service.cache({
  maxAge: 60000,
  staleWhileRevalidate: 10000,
  tags: ['users', 'profile']
}).getUser('123');
```

**CacheOptions**:
- `maxAge: number` - Maximum cache age in milliseconds
- `staleWhileRevalidate?: number` - Serve stale data while revalidating
- `tags?: string[]` - Tags for grouped invalidation
- `key?: string` - Custom cache key

##### `.retry(options: RetryOptions | number): ConfigurableProxy`

Enable retry logic for the next method call.

```typescript
// Simple: retry 3 times
await service.retry(3).getUser('123');

// Advanced: with exponential backoff
await service.retry({
  attempts: 5,
  backoff: 'exponential',
  initialDelay: 1000,
  maxDelay: 30000,
  shouldRetry: (error) => error.code !== 'NOT_FOUND'
}).getUser('123');
```

**RetryOptions**:
- `attempts: number` - Maximum retry attempts
- `backoff?: 'constant' | 'linear' | 'exponential'` - Backoff strategy
- `initialDelay?: number` - Initial delay in milliseconds
- `maxDelay?: number` - Maximum delay between retries
- `shouldRetry?: (error) => boolean` - Custom retry predicate

##### `.timeout(ms: number): ConfigurableProxy`

Set request timeout.

```typescript
await service
  .timeout(5000)  // 5 second timeout
  .getUser('123');
```

##### `.priority(level: 'high' | 'normal' | 'low'): ConfigurableProxy`

Set request priority (affects queuing in transport layer).

```typescript
await service
  .priority('high')
  .getUser('123');
```

##### `.transform<T>(fn: (data: any) => T): ConfigurableProxy`

Transform response data before returning.

```typescript
const userName = await service
  .transform((user: User) => user.name)
  .getUser('123');
// Returns string instead of User object
```

##### `.validate(fn: (data: any) => boolean | Promise<boolean>): ConfigurableProxy`

Validate response data. Throws error if validation fails.

```typescript
await service
  .validate((user: User) => user.id && user.name)
  .getUser('123');
```

##### `.fallback(data: any): ConfigurableProxy`

Provide fallback data if request fails.

```typescript
const user = await service
  .fallback({ id: '123', name: 'Unknown' })
  .getUser('123');
// Returns fallback if request fails
```

##### `.optimistic<T>(updater: (current: T | undefined) => T): ConfigurableProxy`

Apply optimistic update to cache immediately, rollback on error.

```typescript
await service
  .cache(60000)
  .optimistic((current: User) => ({
    ...current,
    name: 'New Name'
  }))
  .updateUser('123', { name: 'New Name' });
// Cache updated immediately, rolled back if request fails
```

##### `.invalidateOn(tags: string[]): ConfigurableProxy`

Set cache invalidation tags for this request.

```typescript
await service
  .cache(60000)
  .invalidateOn(['users', 'profile'])
  .updateUser('123', data);
```

##### `.dedupe(key: string): ConfigurableProxy`

Set custom deduplication key for this request.

```typescript
await service
  .dedupe('user-123-fetch')
  .getUser('123');
// Multiple concurrent calls with same dedupe key share single request
```

##### `.background(interval: number): ConfigurableProxy`

Enable background refetch at specified interval.

```typescript
await service
  .cache(60000)
  .background(30000)  // Refresh every 30 seconds
  .getUser('123');
// First call: fresh data
// Subsequent calls: cached data
// Every 30s: silent background refresh
```

##### `.metrics(fn: (timing: { duration: number; cacheHit?: boolean }) => void): ConfigurableProxy`

Track request metrics.

```typescript
await service
  .metrics(({ duration, cacheHit }) => {
    console.log(`Request took ${duration}ms (cache: ${cacheHit})`);
  })
  .getUser('123');
```

#### Global Configuration Methods

These methods modify the FluentInterface itself and affect all subsequent calls.

##### `.globalCache(options: CacheOptions): FluentInterface`

Set default cache options for all method calls.

```typescript
service.globalCache({ maxAge: 60000 });

// All calls now cached by default
await service.getUser('123');  // Uses global cache
```

##### `.globalRetry(options: RetryOptions): FluentInterface`

Set default retry options for all method calls.

```typescript
service.globalRetry({ attempts: 3 });

// All calls now have retry by default
await service.getUser('123');  // Uses global retry
```

---

## Advanced Features

### 1. Global Configuration Presets

Define reusable configuration presets:

```typescript
const CACHE_PRESETS = {
  short: { maxAge: 30000, staleWhileRevalidate: 10000 },
  medium: { maxAge: 300000, staleWhileRevalidate: 60000 },
  long: { maxAge: 3600000, staleWhileRevalidate: 300000 }
} as const;

const userService = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    globalOptions: {
      cache: CACHE_PRESETS.medium,
      retry: { attempts: 3 }
    }
  }
);

// All calls inherit global options
const user = await userService.getUser('123');
// ↑ Automatically cached with medium preset + 3 retries
```

### 2. Method-Specific Configuration

Create pre-configured proxies for specific use cases:

```typescript
// Create a pre-configured proxy
const cachedUserService = userService
  .cache(CACHE_PRESETS.long)
  .retry(5);

// All subsequent calls use this configuration
const user1 = await cachedUserService.getUser('123');
const user2 = await cachedUserService.getUser('456');
// Both use long cache + 5 retries

// Original service remains unconfigured
const freshUser = await userService.getUser('789');
// No cache, no retry
```

### 3. Tagged Cache Invalidation

Group cache entries for batch invalidation:

```typescript
// Tag cache entries
await productService
  .cache({ maxAge: 300000 })
  .invalidateOn(['products', 'category:electronics'])
  .getProducts({ category: 'electronics' });

// Later, invalidate all products
productService.invalidate(['products']);

// Or invalidate specific category
productService.invalidate(['category:electronics']);
```

### 4. Optimistic Updates with Rollback

Update cache immediately for instant UI, rollback on error:

```typescript
const updatedUser = await userService
  .cache(60000)
  .optimistic((currentUser: User | undefined) => ({
    ...currentUser!,
    name: 'New Name',
    updatedAt: Date.now()
  }))
  .updateUser('user-123', { name: 'New Name' });

// Timeline:
// 1. Cache immediately updated with optimistic value
// 2. Request sent to server
// 3a. Success: Cache updated with server response
// 3b. Error: Cache rolled back to previous value
```

### 5. Request Deduplication

Automatically deduplicate concurrent identical requests:

```typescript
// Multiple simultaneous calls
const [user1, user2, user3] = await Promise.all([
  userService.cache(60000).getUser('123'),
  userService.cache(60000).getUser('123'),
  userService.cache(60000).getUser('123')
]);

// Only 1 HTTP request is made!
// All three promises resolve with same data
```

**Custom Dedupe Keys**:

```typescript
// Control deduplication with custom keys
const [result1, result2] = await Promise.all([
  service.dedupe('fetch-user-123').getUser('123'),
  service.dedupe('fetch-user-123').getUser('123')
]);
// Deduplicated (same key)

const [result3, result4] = await Promise.all([
  service.dedupe('fetch-1').getUser('123'),
  service.dedupe('fetch-2').getUser('123')
]);
// NOT deduplicated (different keys)
```

### 6. Background Refresh

Keep cache fresh with automatic background updates:

```typescript
const products = await productService
  .cache({ maxAge: 300000 })
  .background(60000)  // Refresh every minute
  .getProducts();

// Timeline:
// First call: Fresh data from server (300ms)
// Subsequent calls: Cached data (instant)
// Every 60s: Silent background refresh keeps cache fresh
```

**Cleanup**:

```typescript
import { QueryBuilder } from '@omnitron-dev/titan/netron/transport/http';

// Stop all background refetch intervals
QueryBuilder.stopAllBackgroundRefetch();

// Check active background intervals
const count = QueryBuilder.getActiveBackgroundRefetchCount();
```

### 7. Query Cancellation

Cancel in-flight requests using AbortController:

```typescript
const builder = service.call('getUser', '123');

// Start request
const promise = builder.execute();

// Cancel request
builder.cancel();

// Promise will reject with 'Query cancelled' error
await promise; // throws Error('Query cancelled')
```

**Early Cancellation**:

```typescript
const builder = service.call('getUser', '123');

// Can cancel even before execute()
builder.cancel();

// Will immediately reject
await builder.execute(); // throws Error('Query cancelled')
```

### 8. Pipeline Composition

Compose multiple transformations:

```typescript
const topProducts = await productService
  .cache({ maxAge: 300000 })
  .transform(products => products.filter(p => p.rating >= 4.5))
  .transform(products => products.sort((a, b) => b.sales - a.sales))
  .transform(products => products.slice(0, 10))
  .getProducts();

// Transforms applied in order:
// 1. Filter high-rated products
// 2. Sort by sales
// 3. Take top 10
```

### 9. Conditional Execution with Validation

Execute with validation and fallback:

```typescript
const getLatestProducts = () => productService
  .cache(60000)
  .transform(products => products.filter(p => p.stock > 0))
  .validate(products => products.length > 0)
  .fallback([])
  .getProducts();

const products = await getLatestProducts();
// If validation fails (no products in stock), returns []
// No error thrown
```

---

## Best Practices

### 1. Use Global Configuration for Common Settings

```typescript
// ✅ Good: Set common options globally
const service = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    globalOptions: {
      retry: { attempts: 3 },
      timeout: 5000
    }
  }
);

// Override when needed
await service.retry(5).getUser('123');
```

### 2. Create Reusable Configuration Presets

```typescript
// ✅ Good: Define reusable presets
const PRESETS = {
  cache: {
    short: { maxAge: 30000, staleWhileRevalidate: 10000 },
    long: { maxAge: 3600000, staleWhileRevalidate: 300000 }
  },
  retry: {
    aggressive: { attempts: 5, backoff: 'exponential' },
    gentle: { attempts: 2, backoff: 'linear' }
  }
} as const;

// Use presets
await service
  .cache(PRESETS.cache.long)
  .retry(PRESETS.retry.aggressive)
  .getUser('123');
```

### 3. Use Optimistic Updates for Better UX

```typescript
// ✅ Good: Optimistic updates for instant feedback
const updateName = async (userId: string, name: string) => {
  return userService
    .cache(60000)
    .optimistic((current: User) => ({ ...current, name }))
    .invalidateOn(['users'])
    .updateUser(userId, { name });
};

// UI updates instantly, rollback if server rejects
```

### 4. Use Background Refresh for Real-Time Data

```typescript
// ✅ Good: Background refresh for dashboards
const getDashboard = () => analyticsService
  .cache({ maxAge: 60000 })
  .background(30000)  // Refresh every 30s
  .getDashboardData();

// Data always fresh without loading states
```

### 5. Always Handle Errors

```typescript
// ✅ Good: Use fallback for graceful degradation
const getProducts = async () => {
  try {
    return await productService
      .cache(60000)
      .retry(3)
      .fallback([])
      .getProducts();
  } catch (error) {
    logger.error('Failed to fetch products', error);
    return [];
  }
};
```

### 6. Clean Up Resources

```typescript
// ✅ Good: Stop background intervals on unmount
useEffect(() => {
  return () => {
    QueryBuilder.stopAllBackgroundRefetch();
  };
}, []);
```

### 7. Use Dedupe Keys for Fine-Grained Control

```typescript
// ✅ Good: Control deduplication explicitly
const fetchUserData = (userId: string) => {
  return service
    .dedupe(`user-${userId}`)
    .cache(60000)
    .getUser(userId);
};

// Multiple components can fetch same user without duplicate requests
```

---

## Migration Guide

### From HttpInterface to FluentInterface

#### Old API (HttpInterface)

```typescript
// Create interface
const userService = await peer.createHttpInterface<IUserService>(
  'UserService@1.0.0'
);

// Make calls
const user = await userService
  .call('getUser', 'user-123')
  .cache(60000)
  .retry(3)
  .execute();
```

#### New API (FluentInterface)

```typescript
// Create interface
const userService = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0'
);

// Make calls
const user = await userService
  .cache(60000)
  .retry(3)
  .getUser('user-123');
```

### Key Differences

1. **No `.call()` method** - Call methods directly
2. **No `.execute()` method** - Methods execute automatically
3. **More natural** - Reads like standard method call
4. **Same features** - All HttpInterface features available

### Migration Steps

1. **Replace `createHttpInterface` with `createFluentInterface`**:
   ```typescript
   // Before
   const service = await peer.createHttpInterface<T>('Service@1.0.0');

   // After
   const service = await peer.createFluentInterface<T>('Service@1.0.0');
   ```

2. **Remove `.call()` and `.execute()`**:
   ```typescript
   // Before
   await service.call('method', args).cache(60000).execute();

   // After
   await service.cache(60000).method(args);
   ```

3. **Update global configuration**:
   ```typescript
   // Before
   service.globalCache({ maxAge: 60000 });
   service.globalRetry({ attempts: 3 });

   // After
   const service = await peer.createFluentInterface<T>('Service@1.0.0', {
     globalOptions: {
       cache: { maxAge: 60000 },
       retry: { attempts: 3 }
     }
   });
   ```

### Backward Compatibility

Both APIs work side-by-side:

```typescript
// Old API - still works
const oldService = await peer.createHttpInterface<T>('Service@1.0.0');
const result1 = await oldService.call('method', args).execute();

// New API - recommended
const newService = await peer.createFluentInterface<T>('Service@1.0.0');
const result2 = await newService.method(args);
```

---

## Performance

### Benchmark Results

Based on performance benchmarks (see `performance.spec.ts`):

| Operation | HttpInterface | FluentInterface | Ratio |
|-----------|--------------|-----------------|-------|
| Simple call | ~0.5ms | ~0.5ms | 1.0x |
| With cache | ~0.7ms | ~0.7ms | 1.0x |
| With retry | ~0.8ms | ~0.8ms | 1.0x |
| Cache chain (5 configs) | ~1.5ms | ~4.0ms | 2.7x |
| Direct method call | ~0.5ms | ~0.3ms | 0.6x |

**Key Findings**:

1. **Simple calls**: FluentInterface has same performance as HttpInterface
2. **Direct calls**: FluentInterface is actually faster (no `.execute()` overhead)
3. **Long chains**: FluentInterface ~2-3x slower for chains with 5+ configs
4. **Real-world**: Most chains are 1-2 configs, so performance is equivalent

### Performance Tips

1. **Reuse configured proxies** instead of creating new chains:
   ```typescript
   // ✅ Good: Reuse proxy
   const cachedService = service.cache(60000).retry(3);
   await cachedService.getUser('1');
   await cachedService.getUser('2');

   // ❌ Avoid: Recreating chain
   await service.cache(60000).retry(3).getUser('1');
   await service.cache(60000).retry(3).getUser('2');
   ```

2. **Use global configuration** for common settings:
   ```typescript
   // ✅ Good: Global config
   const service = await peer.createFluentInterface<T>('Service@1.0.0', {
     globalOptions: { cache: { maxAge: 60000 } }
   });
   ```

3. **Cache manager configuration**:
   ```typescript
   // ✅ Good: Configure cache limits
   const cache = new HttpCacheManager({
     maxEntries: 1000,
     maxSizeBytes: 10 * 1024 * 1024, // 10MB
     defaultMaxAge: 60000
   });
   ```

---

## Examples

See [Examples & Use Cases](#examples--use-cases) in the specification for complete examples:

- E-Commerce Product Catalog
- User Authentication & Profile
- Real-Time Analytics Dashboard
- Microservice Communication

---

## Troubleshooting

### Common Issues

#### 1. Type Errors with Method Calls

**Problem**: TypeScript errors when calling methods

```typescript
// Error: Property 'getUser' does not exist
const user = await service.cache(60000).getUser('123');
```

**Solution**: Ensure service interface is properly typed

```typescript
// Add type parameter
const service = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0'
);
```

#### 2. Cache Not Working

**Problem**: Calls not cached as expected

**Solution**: Ensure CacheManager is provided

```typescript
const service = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    cache: new HttpCacheManager()  // ← Required for caching
  }
);
```

#### 3. Background Refetch Not Stopping

**Problem**: Background intervals continue after component unmount

**Solution**: Call cleanup method

```typescript
import { QueryBuilder } from '@omnitron-dev/titan/netron/transport/http';

// In cleanup (e.g., React useEffect return)
QueryBuilder.stopAllBackgroundRefetch();
```

#### 4. Optimistic Updates Not Rolling Back

**Problem**: Cache not rolled back on error

**Solution**: Ensure cache is enabled

```typescript
// ❌ Wrong: No cache
await service
  .optimistic(updater)
  .updateUser('123', data);

// ✅ Correct: Cache required
await service
  .cache(60000)
  .optimistic(updater)
  .updateUser('123', data);
```

#### 5. Retry Not Working

**Problem**: Requests not retrying on failure

**Solution**: Ensure RetryManager is provided

```typescript
const service = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    retry: new RetryManager()  // ← Required for retry
  }
);
```

---

## Summary

The Enhanced Fluent API provides a natural, powerful way to interact with Netron services over HTTP. Key features include:

- **Natural method calls** - No `.call()` or `.execute()` needed
- **Powerful configuration** - Cache, retry, transforms, and more
- **Advanced features** - Optimistic updates, background refresh, deduplication
- **Type-safe** - Full TypeScript support
- **Performant** - Minimal overhead, optimized execution
- **Flexible** - Global and per-call configuration

Start using the Fluent API today for a better developer experience!

---

**Questions or Issues?**

- Check [Troubleshooting](#troubleshooting)
- See [Examples](#examples)
- Review [ENHANCED-FLUENT-API-SPEC.md](./ENHANCED-FLUENT-API-SPEC.md)
- Open an issue on GitHub
