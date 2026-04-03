# HTTP Client Guide - Complete Reference

> **Comprehensive documentation for Netron HTTP transport client**
> **Includes**: Enhanced Fluent API, Examples, Performance, Legacy HttpInterface, RetryManager
> **Status**: Production Ready
> **Last Updated**: 2025-10-08

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Enhanced Fluent API](#enhanced-fluent-api)
   - [Introduction](#introduction)
   - [Core Concepts](#core-concepts)
   - [API Reference](#api-reference)
   - [Advanced Features](#advanced-features-1)
   - [Best Practices](#best-practices)
   - [Migration Guide](#migration-guide)
4. [Real-World Examples](#real-world-examples)
   - [E-Commerce Application](#e-commerce-application)
   - [User Management](#user-management-system)
   - [Analytics Dashboard](#real-time-analytics-dashboard)
   - [Microservices](#microservices-communication)
   - [Social Media](#social-media-platform)
   - [Financial Trading](#financial-trading-system)
5. [Performance Guide](#performance-guide)
   - [Benchmarks](#benchmark-results)
   - [Optimization](#optimization-strategies)
   - [Memory Management](#memory-management)
6. [HttpInterface (Legacy)](#httpinterface-legacy)
7. [RetryManager](#retrymanager)
8. [Architecture](#architecture)
9. [Integration Examples](#complete-integration-examples)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The HTTP transport provides **TanStack Query-like capabilities** for Netron RPC with:

- ✅ **Intelligent Retry Logic** - Exponential backoff, circuit breaker, Retry-After header support
- ✅ **Circuit Breaker Pattern** - Automatic failure detection and recovery
- ✅ **Fluent Query API** - Chainable, type-safe method calls
- ✅ **Cache Integration** - Stale-while-revalidate caching
- ✅ **Request Pipeline** - Transform, validate, fallback support
- ✅ **Metrics & Monitoring** - Built-in performance tracking
- ✅ **Deduplication** - Prevents duplicate in-flight requests
- ✅ **Query Cancellation** - AbortController support for resource management
- ✅ **Optimistic Updates** - Instant UI feedback with automatic rollback

### Key Features

| Feature | RetryManager | HttpInterface | CacheManager |
|---------|--------------|---------------|--------------|
| Exponential Backoff | ✅ | ✅ (via RetryManager) | ❌ |
| Circuit Breaker | ✅ | ✅ (via RetryManager) | ❌ |
| Jitter | ✅ | ✅ (via RetryManager) | ❌ |
| Retry-After Support | ✅ | ✅ (via RetryManager) | ❌ |
| Caching | ❌ | ✅ (via CacheManager) | ✅ |
| SWR | ❌ | ✅ (via CacheManager) | ✅ |
| Deduplication | ❌ | ✅ | ❌ |
| Query Cancellation | ❌ | ✅ | ❌ |
| Optimistic Updates | ❌ | ✅ | ✅ (integration) |
| Background Refetch | ❌ | ⚡ (partial) | ✅ (partial) |

---

## Quick Start

### Option 1: Enhanced Fluent API (Recommended)

```typescript
import { HttpRemotePeer } from '@omnitron-dev/titan/netron';
import { HttpCacheManager, RetryManager } from '@omnitron-dev/titan/netron/transport/http';

// Create fluent interface
const userService = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    cache: new HttpCacheManager(),
    retry: new RetryManager()
  }
);

// Natural method calls with configuration
const user = await userService
  .cache(60000)
  .retry(3)
  .getUser('user-123');
```

### Option 2: HttpInterface (Legacy)

```typescript
// Create interface
const userService = await peer.createHttpInterface<IUserService>(
  'UserService@1.0.0'
);

// Call with .execute()
const user = await userService
  .call('getUser', 'user-123')
  .cache(60000)
  .retry(3)
  .execute();
```

**See [Enhanced Fluent API](#enhanced-fluent-api) for complete documentation.**

---


---

# Enhanced Fluent API

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

---

# Real-World Examples

1. [E-Commerce Application](#e-commerce-application)
2. [User Management System](#user-management-system)
3. [Real-Time Analytics Dashboard](#real-time-analytics-dashboard)
4. [Microservices Communication](#microservices-communication)
5. [Social Media Platform](#social-media-platform)
6. [Financial Trading System](#financial-trading-system)

---

## E-Commerce Application

### Service Definition

```typescript
interface IProductService {
  getProducts(filters?: ProductFilters): Promise<Product[]>;
  getProduct(id: string): Promise<Product>;
  searchProducts(query: string): Promise<Product[]>;
  updateStock(productId: string, quantity: number): Promise<Product>;
  getCategories(): Promise<Category[]>;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  rating: number;
  sales: number;
}

interface ProductFilters {
  category?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
}
```

### Setup

```typescript
import { HttpRemotePeer } from '@omnitron-dev/titan/netron';
import { HttpCacheManager, RetryManager } from '@omnitron-dev/titan/netron/transport/http';

// Create cache and retry managers
const cache = new HttpCacheManager({
  maxEntries: 1000,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  defaultMaxAge: 60000
});

const retry = new RetryManager({
  defaultOptions: {
    attempts: 3,
    backoff: 'exponential'
  }
});

// Create fluent interface
const productService = await peer.createFluentInterface<IProductService>(
  'ProductService@1.0.0',
  {
    cache,
    retry
  }
);
```

### Example 1: Product Catalog with Caching

```typescript
/**
 * Get products with caching and filtering
 * - Cache for 5 minutes
 * - Serve stale for 1 minute while revalidating
 * - Filter out-of-stock items
 * - Fallback to empty array on error
 */
async function getAvailableProducts(category: string) {
  return productService
    .cache({
      maxAge: 300000,              // 5 minutes
      staleWhileRevalidate: 60000, // 1 minute
      tags: ['products', `category:${category}`]
    })
    .retry(3)
    .transform(products => products.filter(p => p.stock > 0))
    .validate(products => Array.isArray(products))
    .fallback([])
    .getProducts({ category, inStock: true });
}

// Usage
const electronics = await getAvailableProducts('electronics');
console.log(`Found ${electronics.length} products in stock`);
```

### Example 2: Real-Time Search (No Cache)

```typescript
/**
 * Search products in real-time
 * - No caching (fresh results)
 * - Short timeout for responsiveness
 * - Retry on network errors only
 * - Metrics tracking
 */
async function searchProducts(query: string) {
  return productService
    .retry({
      attempts: 2,
      shouldRetry: (error) => error.code === 'NETWORK_ERROR'
    })
    .timeout(3000)
    .validate(results => Array.isArray(results))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Search completed in ${duration}ms (cache: ${cacheHit})`);
    })
    .fallback([])
    .searchProducts(query);
}

// Usage
const laptops = await searchProducts('laptop');
```

### Example 3: Optimistic Stock Update

```typescript
/**
 * Update stock with optimistic UI
 * - Immediate cache update for instant feedback
 * - Automatic rollback on error
 * - Invalidate product cache
 */
async function decreaseStock(productId: string, quantity: number) {
  return productService
    .cache(60000)
    .optimistic((product: Product | undefined) => {
      if (!product) return undefined;
      return {
        ...product,
        stock: Math.max(0, product.stock - quantity)
      };
    })
    .invalidateOn(['products', `product:${productId}`])
    .retry(3)
    .updateStock(productId, -quantity);
}

// Usage
try {
  const updated = await decreaseStock('prod-123', 1);
  console.log(`Stock updated: ${updated.stock} remaining`);
} catch (error) {
  console.error('Stock update failed, cache rolled back');
}
```

### Example 4: Background-Refreshed Categories

```typescript
/**
 * Get categories with background refresh
 * - Cache for 10 minutes
 * - Auto-refresh every 5 minutes
 * - Always return cached data instantly
 */
async function getCategories() {
  return productService
    .cache({ maxAge: 600000 })
    .background(300000)  // Refresh every 5 minutes
    .retry(3)
    .fallback([])
    .getCategories();
}

// First call: Fetches from server
const categories = await getCategories();

// Subsequent calls: Instant (from cache)
const cachedCategories = await getCategories();

// Every 5 minutes: Silent background refresh keeps cache fresh
```

### Example 5: High-Priority Checkout

```typescript
/**
 * Get product for checkout
 * - High priority (fast-lane processing)
 * - Aggressive retry
 * - Long timeout for reliability
 */
async function getProductForCheckout(productId: string) {
  return productService
    .priority('high')
    .retry({
      attempts: 5,
      backoff: 'exponential',
      initialDelay: 500
    })
    .timeout(10000)
    .getProduct(productId);
}

// Usage in checkout flow
const product = await getProductForCheckout('prod-123');
```

### Example 6: Top-Rated Products Pipeline

```typescript
/**
 * Get top-rated products with transformation pipeline
 * - Cache for 15 minutes
 * - Multi-stage transformation
 * - Metrics tracking
 */
async function getTopRatedProducts(count: number = 10) {
  return productService
    .cache({ maxAge: 900000, tags: ['top-products'] })
    .transform(products => products.filter(p => p.rating >= 4.5))
    .transform(products => products.sort((a, b) => b.rating - a.rating))
    .transform(products => products.slice(0, count))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Top products loaded in ${duration}ms (cache: ${cacheHit})`);
    })
    .getProducts();
}

// Usage
const topProducts = await getTopRatedProducts(10);
```

---

## User Management System

### Service Definition

```typescript
interface IUserService {
  authenticate(credentials: Credentials): Promise<AuthResult>;
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(userId: string, data: Partial<UserProfile>): Promise<UserProfile>;
  getPreferences(userId: string): Promise<UserPreferences>;
  updatePreferences(userId: string, prefs: Partial<UserPreferences>): Promise<UserPreferences>;
  logout(): Promise<void>;
}

interface Credentials {
  email: string;
  password: string;
}

interface AuthResult {
  userId: string;
  token: string;
  expiresAt: number;
}

interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  bio: string;
}
```

### Setup

```typescript
const userService = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    cache: new HttpCacheManager(),
    retry: new RetryManager()
  }
);
```

### Example 1: Login with Retry and Metrics

```typescript
/**
 * Authenticate user with comprehensive error handling
 * - Retry only on network errors (not auth errors)
 * - Track metrics for monitoring
 * - Long timeout for slow networks
 */
async function login(email: string, password: string) {
  return userService
    .retry({
      attempts: 3,
      shouldRetry: (error) => {
        // Don't retry auth failures, only network issues
        return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
      },
      backoff: 'linear',
      initialDelay: 1000
    })
    .timeout(10000)
    .metrics(({ duration }) => {
      console.log(`Login attempt took ${duration}ms`);
      analytics.track('login_attempt', { duration });
    })
    .authenticate({ email, password });
}

// Usage
try {
  const auth = await login('user@example.com', 'password');
  console.log(`Logged in as ${auth.userId}`);
} catch (error) {
  if (error.code === 'INVALID_CREDENTIALS') {
    console.error('Invalid email or password');
  } else {
    console.error('Login failed:', error.message);
  }
}
```

### Example 2: Cached User Profile

```typescript
/**
 * Get user profile with caching
 * - Cache for 5 minutes
 * - Tagged for invalidation
 * - Fallback to guest profile
 */
const GUEST_PROFILE: UserProfile = {
  id: 'guest',
  email: 'guest@example.com',
  displayName: 'Guest User',
  avatar: '/default-avatar.png',
  bio: ''
};

async function getUserProfile(userId: string) {
  return userService
    .cache({
      maxAge: 300000,
      tags: ['user-profile', `user:${userId}`]
    })
    .retry(3)
    .fallback(GUEST_PROFILE)
    .getProfile(userId);
}

// Usage
const profile = await getUserProfile('user-123');
```

### Example 3: Optimistic Profile Update

```typescript
/**
 * Update profile with optimistic UI
 * - Immediate cache update
 * - Automatic rollback on error
 * - Invalidate related caches
 */
async function updateDisplayName(userId: string, displayName: string) {
  return userService
    .cache({ maxAge: 300000 })
    .optimistic((current: UserProfile | undefined) => {
      if (!current) return undefined;
      return {
        ...current,
        displayName
      };
    })
    .invalidateOn(['user-profile', `user:${userId}`])
    .retry(3)
    .updateProfile(userId, { displayName });
}

// Usage - UI updates instantly
const updated = await updateDisplayName('user-123', 'New Name');
console.log(`Profile updated: ${updated.displayName}`);
```

### Example 4: Deduplication Example

```typescript
/**
 * Get preferences with deduplication
 * - Multiple concurrent calls share single request
 * - Cache for 2 minutes
 */
async function getPreferences(userId: string) {
  return userService
    .dedupe(`prefs-${userId}`)
    .cache(120000)
    .retry(3)
    .getPreferences(userId);
}

// Multiple components call this simultaneously
const [prefs1, prefs2, prefs3] = await Promise.all([
  getPreferences('user-123'),
  getPreferences('user-123'),
  getPreferences('user-123')
]);

// Only 1 HTTP request made, all three get same result
console.log(prefs1 === prefs2); // true (same object reference)
```

### Example 5: Logout (No Cache, No Retry)

```typescript
/**
 * Logout user
 * - No caching
 * - No retry (logout should be immediate)
 * - Clear related caches
 */
async function logout(userId: string) {
  // Invalidate user caches first
  userService.invalidate([`user:${userId}`, 'user-profile']);

  // Then logout
  await userService
    .timeout(5000)
    .logout();
}

// Usage
await logout('user-123');
```

---

## Real-Time Analytics Dashboard

### Service Definition

```typescript
interface IAnalyticsService {
  getDashboard(timeRange: TimeRange): Promise<DashboardData>;
  getMetrics(metric: string, timeRange: TimeRange): Promise<MetricData>;
  getAlerts(): Promise<Alert[]>;
  getSystemStatus(): Promise<SystemStatus>;
}

interface TimeRange {
  start: Date;
  end: Date;
}

interface DashboardData {
  metrics: Record<string, number>;
  charts: ChartData[];
  summary: string;
}
```

### Setup

```typescript
const analyticsService = await peer.createFluentInterface<IAnalyticsService>(
  'AnalyticsService@1.0.0',
  {
    cache: new HttpCacheManager(),
    retry: new RetryManager(),
    globalOptions: {
      retry: {
        attempts: 5,
        backoff: 'exponential'
      },
      timeout: 30000
    }
  }
);
```

### Example 1: Dashboard with SWR and Background Refresh

```typescript
/**
 * Get dashboard data with aggressive caching
 * - Stale-while-revalidate for instant loading
 * - Background refresh every minute
 * - Transform to add timestamp
 * - Metrics tracking
 */
async function getDashboard() {
  const timeRange = {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
    end: new Date()
  };

  return analyticsService
    .cache({
      maxAge: 60000,               // 1 minute fresh
      staleWhileRevalidate: 30000, // 30s stale acceptable
      tags: ['dashboard']
    })
    .background(60000)  // Auto-refresh every minute
    .transform((data: DashboardData) => ({
      ...data,
      lastUpdated: Date.now()
    }))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Dashboard ${cacheHit ? 'cached' : 'fetched'} in ${duration}ms`);
    })
    .getDashboard(timeRange);
}

// First call: Fetches data (1000ms)
const dashboard1 = await getDashboard();

// Second call immediately: Returns cached (instant)
const dashboard2 = await getDashboard();

// After 70s: Returns stale data instantly, refetches in background
const dashboard3 = await getDashboard();

// After 2 minutes: Returns fresh data from background refetch (instant)
const dashboard4 = await getDashboard();
```

### Example 2: Critical Alerts (High Priority)

```typescript
/**
 * Get critical alerts
 * - High priority for fast processing
 * - Short timeout for responsiveness
 * - Aggressive retry
 * - No cache (always fresh)
 * - Fallback to empty array
 */
async function getCriticalAlerts() {
  return analyticsService
    .priority('high')
    .retry({
      attempts: 3,
      backoff: 'constant',
      initialDelay: 500
    })
    .timeout(5000)
    .fallback([])
    .getAlerts();
}

// Usage in monitoring loop
setInterval(async () => {
  const alerts = await getCriticalAlerts();
  if (alerts.length > 0) {
    console.warn(`${alerts.length} critical alerts!`);
    notifyAdmin(alerts);
  }
}, 10000); // Check every 10 seconds
```

### Example 3: Specific Metric with Validation

```typescript
/**
 * Get specific metric with validation
 * - Cache for 30 seconds
 * - Validate data structure
 * - Fallback to safe defaults
 * - Transform for UI
 */
async function getMetric(metric: string) {
  const timeRange = {
    start: new Date(Date.now() - 60 * 60 * 1000), // Last hour
    end: new Date()
  };

  return analyticsService
    .cache({ maxAge: 30000, tags: [`metric:${metric}`] })
    .retry(5)
    .validate((data: MetricData) => {
      return data && typeof data.value === 'number';
    })
    .transform((data: MetricData) => ({
      ...data,
      displayValue: formatNumber(data.value),
      trend: calculateTrend(data)
    }))
    .fallback({
      value: 0,
      trend: 'stable',
      displayValue: '0'
    })
    .getMetrics(metric, timeRange);
}

// Usage
const cpuMetric = await getMetric('cpu_usage');
const memoryMetric = await getMetric('memory_usage');
```

### Example 4: System Status with Cancellation

```typescript
/**
 * Get system status with cancellation support
 * - Can cancel if user navigates away
 * - Cache for 10 seconds
 */
async function getSystemStatus(signal?: AbortSignal) {
  const builder = analyticsService
    .cache(10000)
    .retry(3)
    .call('getSystemStatus');

  // Cancel if abort signal fires
  signal?.addEventListener('abort', () => {
    builder.cancel();
  });

  return builder.execute();
}

// Usage with AbortController
const controller = new AbortController();

const statusPromise = getSystemStatus(controller.signal);

// User navigates away - cancel request
setTimeout(() => {
  controller.abort();
}, 1000);

try {
  const status = await statusPromise;
} catch (error) {
  if (error.message === 'Query cancelled') {
    console.log('Status check cancelled');
  }
}
```

---

## Microservices Communication

### Service Definitions

```typescript
interface IOrderService {
  createOrder(order: CreateOrderDto): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
}

interface IInventoryService {
  checkAvailability(productId: string): Promise<InventoryCheck>;
  reserveStock(productId: string, quantity: number): Promise<boolean>;
  releaseStock(productId: string, quantity: number): Promise<boolean>;
}

interface IPaymentService {
  processPayment(orderId: string, payment: PaymentInfo): Promise<PaymentResult>;
  refund(orderId: string): Promise<RefundResult>;
}
```

### Setup with Circuit Breaker

```typescript
// Configure with circuit breaker for fault tolerance
const orderService = await peer.createFluentInterface<IOrderService>(
  'OrderService@1.0.0',
  {
    retry: new RetryManager({
      circuitBreaker: {
        threshold: 5,       // Open after 5 failures
        windowTime: 60000,  // In 60 second window
        cooldownTime: 30000 // Wait 30s before retry
      }
    })
  }
);

const inventoryService = await peer.createFluentInterface<IInventoryService>(
  'InventoryService@1.0.0',
  {
    retry: new RetryManager({
      circuitBreaker: {
        threshold: 3,
        windowTime: 30000,
        cooldownTime: 15000
      }
    })
  }
);

const paymentService = await peer.createFluentInterface<IPaymentService>(
  'PaymentService@1.0.0',
  {
    retry: new RetryManager({
      defaultOptions: {
        attempts: 5,
        backoff: 'exponential'
      }
    })
  }
);
```

### Example 1: Create Order Workflow

```typescript
/**
 * Create order with multi-service coordination
 * - Check inventory
 * - Reserve stock
 * - Process payment
 * - Create order
 * - Handle failures with rollback
 */
async function createOrder(orderData: CreateOrderDto) {
  const { productId, quantity, payment } = orderData;

  try {
    // Step 1: Check inventory
    const availability = await inventoryService
      .retry(3)
      .timeout(5000)
      .checkAvailability(productId);

    if (!availability.available || availability.quantity < quantity) {
      throw new Error('Product not available');
    }

    // Step 2: Reserve stock
    const reserved = await inventoryService
      .retry(3)
      .timeout(10000)
      .reserveStock(productId, quantity);

    if (!reserved) {
      throw new Error('Failed to reserve stock');
    }

    try {
      // Step 3: Process payment
      const paymentResult = await paymentService
        .retry(5)
        .timeout(30000)
        .metrics(({ duration }) => {
          console.log(`Payment processed in ${duration}ms`);
        })
        .processPayment('temp-order-id', payment);

      if (!paymentResult.success) {
        throw new Error('Payment failed');
      }

      // Step 4: Create order
      const order = await orderService
        .retry(3)
        .invalidateOn(['orders'])
        .createOrder({
          ...orderData,
          paymentId: paymentResult.paymentId
        });

      return order;

    } catch (error) {
      // Rollback: Release reserved stock
      await inventoryService
        .retry(3)
        .releaseStock(productId, quantity);
      throw error;
    }

  } catch (error) {
    console.error('Order creation failed:', error);
    throw error;
  }
}

// Usage
try {
  const order = await createOrder({
    productId: 'prod-123',
    quantity: 2,
    payment: { /* ... */ }
  });
  console.log(`Order created: ${order.id}`);
} catch (error) {
  console.error('Failed to create order:', error.message);
}
```

### Example 2: Get Order with Caching

```typescript
/**
 * Get order details with caching
 * - Cache for 1 minute
 * - Tagged for invalidation
 * - Deduplicated
 */
async function getOrder(orderId: string) {
  return orderService
    .dedupe(`order-${orderId}`)
    .cache({
      maxAge: 60000,
      tags: ['orders', `order:${orderId}`]
    })
    .retry(3)
    .getOrder(orderId);
}

// Multiple components can call this without duplicate requests
const [order1, order2, order3] = await Promise.all([
  getOrder('order-123'),
  getOrder('order-123'),
  getOrder('order-123')
]);
```

### Example 3: Update Order Status with Optimistic UI

```typescript
/**
 * Update order status with optimistic update
 * - Immediate cache update
 * - Invalidate order cache
 * - Rollback on error
 */
async function updateOrderStatus(orderId: string, status: OrderStatus) {
  return orderService
    .cache({ maxAge: 60000 })
    .optimistic((order: Order | undefined) => {
      if (!order) return undefined;
      return {
        ...order,
        status,
        updatedAt: new Date()
      };
    })
    .invalidateOn(['orders', `order:${orderId}`])
    .retry(3)
    .updateOrderStatus(orderId, status);
}

// Usage - UI updates instantly
await updateOrderStatus('order-123', 'shipped');
```

---

## Social Media Platform

### Service Definition

```typescript
interface ISocialService {
  getFeed(userId: string, page: number): Promise<Post[]>;
  getPost(postId: string): Promise<Post>;
  createPost(post: CreatePostDto): Promise<Post>;
  likePost(postId: string): Promise<Post>;
  unlikePost(postId: string): Promise<Post>;
  getNotifications(userId: string): Promise<Notification[]>;
}

interface Post {
  id: string;
  authorId: string;
  content: string;
  likes: number;
  comments: number;
  createdAt: Date;
}
```

### Example 1: Feed with Pagination and Background Refresh

```typescript
/**
 * Get user feed with smart caching
 * - Cache first page aggressively
 * - Background refresh every 30 seconds
 * - Transform to add UI metadata
 */
async function getFeed(userId: string, page: number = 1) {
  const cacheConfig = page === 1
    ? {
        maxAge: 60000,
        staleWhileRevalidate: 30000,
        tags: ['feed', `user:${userId}`]
      }
    : { maxAge: 300000 }; // Cache other pages longer

  return socialService
    .cache(cacheConfig)
    .background(page === 1 ? 30000 : 0) // Only refresh first page
    .transform((posts: Post[]) =>
      posts.map(post => ({
        ...post,
        isLiked: false, // Will be populated by client
        displayDate: formatDate(post.createdAt)
      }))
    )
    .retry(3)
    .fallback([])
    .getFeed(userId, page);
}

// Usage
const feed = await getFeed('user-123', 1);
```

### Example 2: Like with Optimistic Update

```typescript
/**
 * Like post with optimistic UI
 * - Immediate like count update
 * - Rollback if server rejects
 */
async function likePost(postId: string) {
  return socialService
    .cache({ maxAge: 60000 })
    .optimistic((post: Post | undefined) => {
      if (!post) return undefined;
      return {
        ...post,
        likes: post.likes + 1
      };
    })
    .invalidateOn(['feed', `post:${postId}`])
    .retry(3)
    .likePost(postId);
}

// Usage - UI updates instantly
const updatedPost = await likePost('post-123');
```

### Example 3: Notifications with Polling

```typescript
/**
 * Poll for notifications
 * - Short cache (5 seconds)
 * - High priority
 * - Deduplicated
 */
async function pollNotifications(userId: string) {
  return socialService
    .dedupe(`notifications-${userId}`)
    .cache({ maxAge: 5000 })
    .priority('high')
    .retry(2)
    .fallback([])
    .getNotifications(userId);
}

// Poll every 10 seconds
setInterval(async () => {
  const notifications = await pollNotifications('user-123');
  updateUI(notifications);
}, 10000);
```

---

## Financial Trading System

### Service Definition

```typescript
interface ITradingService {
  getQuote(symbol: string): Promise<Quote>;
  getOrderBook(symbol: string): Promise<OrderBook>;
  placeOrder(order: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getPortfolio(userId: string): Promise<Portfolio>;
}

interface Quote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}
```

### Example 1: Real-Time Quotes (No Cache)

```typescript
/**
 * Get real-time quote
 * - No caching (always fresh)
 * - High priority
 * - Short timeout
 * - Aggressive retry
 */
async function getRealTimeQuote(symbol: string) {
  return tradingService
    .priority('high')
    .timeout(1000)
    .retry({
      attempts: 3,
      backoff: 'constant',
      initialDelay: 100
    })
    .metrics(({ duration }) => {
      console.log(`Quote fetched in ${duration}ms`);
    })
    .getQuote(symbol);
}

// Usage in trading loop
setInterval(async () => {
  const quote = await getRealTimeQuote('AAPL');
  updateChart(quote);
}, 1000); // Update every second
```

### Example 2: Order Book with Short Cache

```typescript
/**
 * Get order book
 * - Very short cache (1 second)
 * - Background refresh every 500ms
 * - Transform for UI
 */
async function getOrderBook(symbol: string) {
  return tradingService
    .cache({ maxAge: 1000 })
    .background(500)
    .transform((orderBook: OrderBook) => ({
      ...orderBook,
      totalBids: calculateTotal(orderBook.bids),
      totalAsks: calculateTotal(orderBook.asks)
    }))
    .retry(3)
    .getOrderBook(symbol);
}
```

### Example 3: Place Order (Critical Operation)

```typescript
/**
 * Place trading order
 * - Maximum reliability
 * - Aggressive retry
 * - Long timeout
 * - Metrics for monitoring
 */
async function placeOrder(order: OrderRequest) {
  return tradingService
    .priority('high')
    .retry({
      attempts: 10,
      backoff: 'exponential',
      initialDelay: 500,
      maxDelay: 5000,
      shouldRetry: (error) => {
        // Don't retry on business logic errors
        return !['INSUFFICIENT_FUNDS', 'INVALID_ORDER'].includes(error.code);
      }
    })
    .timeout(30000)
    .metrics(({ duration }) => {
      console.log(`Order placed in ${duration}ms`);
      monitoring.track('order_placed', { duration });
    })
    .placeOrder(order);
}

// Usage
try {
  const order = await placeOrder({
    symbol: 'AAPL',
    type: 'limit',
    side: 'buy',
    quantity: 100,
    price: 150.00
  });
  console.log(`Order placed: ${order.id}`);
} catch (error) {
  console.error('Order failed:', error);
  alertUser('Failed to place order');
}
```

### Example 4: Portfolio with Optimistic Updates

```typescript
/**
 * Get portfolio with caching
 * - Cache for 10 seconds
 * - Background refresh
 */
async function getPortfolio(userId: string) {
  return tradingService
    .cache({ maxAge: 10000, tags: [`portfolio:${userId}`] })
    .background(5000)
    .retry(5)
    .getPortfolio(userId);
}

// Usage
const portfolio = await getPortfolio('user-123');
```

---

## Summary

These examples demonstrate:

1. **Caching strategies** - From aggressive (dashboards) to none (real-time quotes)
2. **Retry patterns** - Custom retry logic for different scenarios
3. **Optimistic updates** - Instant UI feedback with automatic rollback
4. **Background refresh** - Keep data fresh without user intervention
5. **Request deduplication** - Prevent duplicate requests automatically
6. **Priority handling** - Fast-lane critical operations
7. **Error handling** - Graceful degradation with fallbacks
8. **Metrics tracking** - Monitor performance and usage
9. **Transformation pipelines** - Multi-stage data processing
10. **Cancellation** - Cancel requests when no longer needed

Adapt these patterns to your specific use cases for optimal performance and user experience!

---

# Performance Guide

1. [Overview](#overview)
2. [Benchmark Results](#benchmark-results)
3. [Performance Characteristics](#performance-characteristics)
4. [Optimization Strategies](#optimization-strategies)
5. [Best Practices](#best-practices)
6. [Memory Management](#memory-management)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The Enhanced Fluent API is designed for high performance with minimal overhead. This guide provides benchmark results, performance characteristics, and optimization strategies.

### Key Performance Features

- **Lazy Proxy Creation**: Proxies are only created when needed
- **Efficient Option Merging**: Fast object spread and shallow copy
- **Minimal Overhead**: Direct method calls when no configuration
- **Smart Caching**: Reduces network requests significantly
- **Request Deduplication**: Prevents duplicate in-flight requests
- **Background Optimization**: Non-blocking cache updates

---

## Benchmark Results

All benchmarks run on Node.js 22.x with 1000 iterations per test.

### 1. Instance Creation Performance

Creating interface instances:

| API | Time (1000 instances) | Per Instance |
|-----|----------------------|--------------|
| HttpInterface | ~150ms | 0.15ms |
| FluentInterface | ~165ms | 0.165ms |
| **Difference** | +15ms | +0.015ms |
| **Overhead** | 10% | 10% |

**Conclusion**: FluentInterface has minimal creation overhead (~10%), which is negligible in real-world usage where you typically create 1-10 instances, not 1000.

### 2. Configuration Chain Performance

Building configuration chains (cache + retry + other options):

| API | Time (1000 chains) | Per Chain |
|-----|-------------------|-----------|
| HttpInterface | ~1.5ms | 0.0015ms |
| FluentInterface (2 configs) | ~2.0ms | 0.002ms |
| FluentInterface (5 configs) | ~4.0ms | 0.004ms |
| **Overhead (2 configs)** | 1.3x | 1.3x |
| **Overhead (5 configs)** | 2.7x | 2.7x |

**Conclusion**: FluentInterface has 1.3-2.7x overhead for configuration chains due to Proxy creation. However, absolute times are extremely small (<0.01ms per chain), making this negligible in practice.

### 3. Global Configuration Performance

Setting global options:

| Operation | Time (1000 operations) | Per Operation |
|-----------|----------------------|---------------|
| `globalCache()` | ~20ms | 0.02ms |
| `globalRetry()` | ~20ms | 0.02ms |
| **Total** | ~40ms | 0.04ms |

**Conclusion**: Global configuration is extremely fast (~0.02ms per operation) as it's just property assignment.

### 4. Method Call Performance

Direct method calls without configuration:

| API | Time (1000 calls) | Per Call |
|-----|------------------|----------|
| HttpInterface + execute() | ~0.5ms | 0.0005ms |
| FluentInterface (direct) | ~0.3ms | 0.0003ms |
| **Difference** | -0.2ms | -0.0002ms |

**Conclusion**: FluentInterface is actually *faster* for direct calls because there's no `.execute()` overhead.

### 5. Complete Request Performance

Full request lifecycle (with network I/O):

| Configuration | HttpInterface | FluentInterface | Overhead |
|--------------|--------------|-----------------|----------|
| No config | 50ms | 50ms | 0% |
| With cache | 0.5ms (cached) | 0.5ms (cached) | 0% |
| With retry | 150ms (2 retries) | 150ms (2 retries) | 0% |
| Cache + retry | 0.5ms (cached) | 0.5ms (cached) | 0% |

**Conclusion**: Network I/O dominates total time. API overhead is negligible compared to network latency.

---

## Performance Characteristics

### 1. Proxy Overhead

**What**: JavaScript Proxy adds minimal overhead for property access.

**Impact**:
- Proxy creation: ~0.001ms
- Property access: <0.0001ms
- Method call: <0.0001ms

**Mitigation**: Reuse configured proxies instead of recreating them.

```typescript
// ❌ Avoid: Creating new proxy each time
for (let i = 0; i < 1000; i++) {
  await service.cache(60000).retry(3).getUser(`${i}`);
}

// ✅ Better: Reuse proxy
const cachedService = service.cache(60000).retry(3);
for (let i = 0; i < 1000; i++) {
  await cachedService.getUser(`${i}`);
}
```

### 2. Option Merging

**What**: Configuration options are merged using object spread.

**Impact**:
- Shallow merge: ~0.0001ms
- Deep merge: ~0.0005ms

**Mitigation**: Use global configuration for common options.

```typescript
// ❌ Avoid: Repeating same options
await service.cache(60000).retry(3).getUser('1');
await service.cache(60000).retry(3).getUser('2');

// ✅ Better: Global configuration
const service = await peer.createFluentInterface<T>('Service@1.0.0', {
  globalOptions: {
    cache: { maxAge: 60000 },
    retry: { attempts: 3 }
  }
});

await service.getUser('1');
await service.getUser('2');
```

### 3. Cache Performance

**Hit Rate Impact**:

| Cache Hit Rate | Average Response Time |
|---------------|----------------------|
| 0% (no cache) | 50ms (network) |
| 50% (half cached) | 25ms (avg) |
| 90% (mostly cached) | 5.5ms (avg) |
| 99% (almost all cached) | 1ms (avg) |

**Cache Lookup**: ~0.1ms (very fast)

**Recommendation**: Use caching aggressively for read operations.

### 4. Deduplication Performance

**Impact of Concurrent Requests**:

| Concurrent Requests | Without Dedupe | With Dedupe | Savings |
|--------------------|---------------|-------------|---------|
| 1 | 50ms | 50ms | 0% |
| 5 | 250ms total | 50ms total | 80% |
| 10 | 500ms total | 50ms total | 90% |
| 100 | 5000ms total | 50ms total | 99% |

**Deduplication Overhead**: ~0.001ms (negligible)

**Recommendation**: Enable deduplication for any data that might be requested concurrently.

### 5. Background Refetch Performance

**Impact**: Zero (non-blocking)

```typescript
// Background refetch happens asynchronously
const data = await service
  .cache(60000)
  .background(30000)  // No impact on response time
  .getData();
// Returns immediately from cache
// Refetch happens in background
```

**Resource Usage**:
- CPU: <1% (interval checks)
- Memory: ~100 bytes per interval
- Network: Same as normal fetch

**Recommendation**: Use for dashboards and frequently accessed data.

### 6. Optimistic Update Performance

**Timeline**:
```
T+0ms: User action
T+0.1ms: Optimistic update applied to cache
T+0.1ms: UI updated (instant feedback!)
T+50ms: Server response received
T+50.1ms: Cache updated with real data
```

**Overhead**: ~0.1ms (extremely fast)

**Recommendation**: Use for all mutations to improve perceived performance.

---

## Optimization Strategies

### 1. Use Global Configuration

**Before**:
```typescript
// Repeating configuration everywhere
await service.cache(60000).retry(3).getUser('1');
await service.cache(60000).retry(3).getProduct('1');
await service.cache(60000).retry(3).getOrder('1');
```

**After**:
```typescript
// Set once, apply everywhere
const service = await peer.createFluentInterface<T>('Service@1.0.0', {
  globalOptions: {
    cache: { maxAge: 60000 },
    retry: { attempts: 3 }
  }
});

await service.getUser('1');
await service.getProduct('1');
await service.getOrder('1');
```

**Benefit**: Eliminates configuration overhead entirely.

### 2. Reuse Configured Proxies

**Before**:
```typescript
// Creating new proxy for each call
for (const id of userIds) {
  await service.cache(60000).retry(3).getUser(id);
}
```

**After**:
```typescript
// Create proxy once, reuse
const cachedService = service.cache(60000).retry(3);
for (const id of userIds) {
  await cachedService.getUser(id);
}
```

**Benefit**: Reduces proxy creation overhead by 99%.

### 3. Use Configuration Presets

**Before**:
```typescript
// Repeating complex configuration
await service.cache({
  maxAge: 300000,
  staleWhileRevalidate: 60000,
  tags: ['products']
}).retry({ attempts: 5, backoff: 'exponential' }).getProducts();
```

**After**:
```typescript
// Define presets once
const PRESETS = {
  cache: {
    medium: { maxAge: 300000, staleWhileRevalidate: 60000 }
  },
  retry: {
    aggressive: { attempts: 5, backoff: 'exponential' }
  }
};

// Use presets
await service
  .cache({ ...PRESETS.cache.medium, tags: ['products'] })
  .retry(PRESETS.retry.aggressive)
  .getProducts();
```

**Benefit**: Cleaner code, easier to maintain, faster configuration.

### 4. Optimize Cache Configuration

**Cache Manager Setup**:
```typescript
const cache = new HttpCacheManager({
  maxEntries: 1000,            // Limit memory usage
  maxSizeBytes: 10 * 1024 * 1024, // 10MB limit
  defaultMaxAge: 60000          // Default TTL
});
```

**Cache Strategy by Use Case**:

```typescript
// Read-heavy, rarely changes → Aggressive caching
const products = await service.cache({
  maxAge: 3600000,              // 1 hour
  staleWhileRevalidate: 600000  // 10 minutes
}).getProducts();

// Real-time data → No cache
const quote = await service.getQuote('AAPL');

// Medium refresh rate → Short cache + background
const dashboard = await service
  .cache({ maxAge: 60000 })
  .background(30000)
  .getDashboard();
```

### 5. Use Deduplication for Concurrent Requests

**Before**:
```typescript
// Multiple components fetch same data
const [data1, data2, data3] = await Promise.all([
  fetchUserData('123'),
  fetchUserData('123'),
  fetchUserData('123')
]);
// 3 HTTP requests!
```

**After**:
```typescript
// Automatic deduplication
const fetchUserData = (id: string) =>
  service.cache(60000).getUser(id);

const [data1, data2, data3] = await Promise.all([
  fetchUserData('123'),
  fetchUserData('123'),
  fetchUserData('123')
]);
// Only 1 HTTP request!
```

**Benefit**: Reduces network traffic by up to 99% for concurrent duplicate requests.

### 6. Batch Operations When Possible

**Before**:
```typescript
// Individual requests
for (const id of userIds) {
  await service.getUser(id); // 100 requests for 100 users
}
```

**After**:
```typescript
// Batch request
const users = await service.getUsers(userIds); // 1 request for 100 users
```

**Benefit**: Dramatically reduces network round-trips.

---

## Best Practices

### 1. Choose Right Cache Strategy

**Dashboard Data (Background Refresh)**:
```typescript
// Updates every minute, always instant load
await service
  .cache({ maxAge: 120000 })
  .background(60000)
  .getDashboard();
```

**User Profile (Optimistic Update)**:
```typescript
// Instant UI feedback
await service
  .cache(300000)
  .optimistic(current => ({ ...current, name: newName }))
  .updateProfile(userId, { name: newName });
```

**Real-Time Quotes (No Cache)**:
```typescript
// Always fresh data
await service.getQuote(symbol);
```

### 2. Monitor Performance with Metrics

```typescript
// Track cache hit rate
await service
  .cache(60000)
  .metrics(({ duration, cacheHit }) => {
    console.log(`Request: ${duration}ms, Cache: ${cacheHit}`);
    analytics.track('api_request', { duration, cacheHit });
  })
  .getUser('123');
```

### 3. Use Priority for Critical Operations

```typescript
// Fast-lane critical requests
await service
  .priority('high')
  .placeOrder(orderData);

// Low priority background tasks
await service
  .priority('low')
  .syncData();
```

### 4. Implement Graceful Degradation

```typescript
// Always have a fallback
const data = await service
  .retry(3)
  .fallback(DEFAULT_DATA)
  .getData();
```

### 5. Clean Up Resources

```typescript
import { QueryBuilder } from '@omnitron-dev/titan/netron/transport/http';

// Stop background intervals when done
useEffect(() => {
  return () => {
    QueryBuilder.stopAllBackgroundRefetch();
  };
}, []);
```

---

## Memory Management

### 1. Cache Memory Usage

**Estimation**:
```typescript
// Average cache entry: ~1KB
// 1000 entries ≈ 1MB
// 10000 entries ≈ 10MB

const cache = new HttpCacheManager({
  maxEntries: 1000,  // ~1MB
  maxSizeBytes: 10 * 1024 * 1024  // 10MB hard limit
});
```

### 2. Background Interval Memory

**Estimation**:
```typescript
// Each interval: ~100 bytes
// 100 active intervals: ~10KB (negligible)
```

**Cleanup**:
```typescript
// Stop all intervals to free memory
QueryBuilder.stopAllBackgroundRefetch();

// Check active intervals
const count = QueryBuilder.getActiveBackgroundRefetchCount();
console.log(`Active intervals: ${count}`);
```

### 3. Deduplication Map Memory

**Estimation**:
```typescript
// In-flight request: ~200 bytes
// 100 concurrent requests: ~20KB (negligible)
```

**Automatic Cleanup**: Map entries are automatically removed when requests complete.

---

## Troubleshooting

### Issue: Slow Performance

**Symptoms**: Requests taking longer than expected

**Diagnosis**:
```typescript
// Add metrics to identify bottleneck
await service
  .metrics(({ duration, cacheHit }) => {
    console.log(`Duration: ${duration}ms, Cache: ${cacheHit}`);
  })
  .getData();
```

**Solutions**:
1. **Enable caching** if cache hit rate is 0%
2. **Increase cache TTL** if data doesn't change often
3. **Use background refresh** for frequently accessed data
4. **Check network latency** if all requests are slow

### Issue: High Memory Usage

**Symptoms**: Memory usage growing over time

**Diagnosis**:
```typescript
// Check cache size
const stats = cacheManager.getStats();
console.log('Cache entries:', stats.entries);
console.log('Cache size:', stats.sizeBytes);

// Check background intervals
const intervalCount = QueryBuilder.getActiveBackgroundRefetchCount();
console.log('Active intervals:', intervalCount);
```

**Solutions**:
1. **Set cache limits**: `maxEntries`, `maxSizeBytes`
2. **Stop unused intervals**: `QueryBuilder.stopAllBackgroundRefetch()`
3. **Clear cache periodically**: `cacheManager.clear()`

### Issue: Stale Data

**Symptoms**: Showing old data after updates

**Diagnosis**:
```typescript
// Check cache TTL
const entry = cacheManager.getRaw(key);
console.log('Age:', Date.now() - entry?.timestamp);
```

**Solutions**:
1. **Invalidate after mutations**:
   ```typescript
   await service
     .invalidateOn(['users'])
     .updateUser(id, data);
   ```
2. **Reduce cache TTL** for frequently changing data
3. **Use optimistic updates** for instant UI feedback

### Issue: Duplicate Requests

**Symptoms**: Multiple identical requests in network tab

**Diagnosis**: Check if deduplication is enabled

**Solutions**:
1. **Enable cache**: Deduplication works automatically with cache
2. **Use custom dedupe key**:
   ```typescript
   await service.dedupe('unique-key').getData();
   ```

---

## Summary

### Performance Highlights

- ✅ **Minimal Overhead**: <0.01ms per configuration chain
- ✅ **Fast Direct Calls**: Actually faster than HttpInterface
- ✅ **Efficient Caching**: 100-1000x faster than network requests
- ✅ **Smart Deduplication**: 99% reduction in duplicate requests
- ✅ **Non-blocking Background**: Zero impact on response times
- ✅ **Optimistic Updates**: Instant UI feedback (<0.1ms)

### Key Recommendations

1. **Use global configuration** for common settings
2. **Reuse configured proxies** in loops
3. **Enable caching** for read operations
4. **Use deduplication** for concurrent requests
5. **Implement optimistic updates** for mutations
6. **Monitor with metrics** to identify bottlenecks
7. **Clean up resources** when done

### Performance Formula

```
Total Time = Network Time + API Overhead + Cache Lookup

Where:
- Network Time: 10-100ms (dominant factor)
- API Overhead: <0.01ms (negligible)
- Cache Lookup: 0.1ms (when cached)

Result: Cache hits are 100-1000x faster than network requests
```

The Enhanced Fluent API is designed for high performance. Follow the best practices in this guide to maximize throughput and minimize latency!

---

**Questions or Issues?**

- See [FLUENT-API-GUIDE.md](./FLUENT-API-GUIDE.md) for usage
- See [FLUENT-API-EXAMPLES.md](./FLUENT-API-EXAMPLES.md) for patterns
- Check [Troubleshooting](#troubleshooting) section above

---

# HttpInterface (Legacy)


## RetryManager

### Features <a name="retry-features"></a>

The `RetryManager` provides intelligent, configurable retry logic with enterprise-grade features:

**1. Multiple Backoff Strategies:**
- ✅ **Exponential** - Delay grows exponentially (default: factor 2)
- ✅ **Linear** - Delay increases by constant amount
- ✅ **Constant** - Fixed delay between retries

**2. Jitter Support:**
- Prevents thundering herd problem
- Randomizes delays to spread load
- Configurable jitter factor (0-1)

**3. Circuit Breaker:**
- Automatic failure detection
- Three states: CLOSED, OPEN, HALF-OPEN
- Configurable thresholds and cooldown

**4. Smart Retry Conditions:**
- Default logic handles network errors, 5xx, 429, 408
- Custom retry conditions per request
- Error type detection (network vs application)

**5. Monitoring:**
- Events for retry, success, failure, circuit breaker state changes
- Statistics tracking (attempts, success rate, avg delay)
- Debug logging support

### Configuration <a name="retry-configuration"></a>

#### Basic Configuration

```typescript
import { RetryManager } from '@omnitron-dev/titan/netron/transport/http';

// Create retry manager with defaults
const retryManager = new RetryManager({
  defaultOptions: {
    attempts: 3,
    backoff: 'exponential',
    initialDelay: 1000,
    maxDelay: 30000,
    factor: 2,
    jitter: 0.1
  },
  debug: true
});
```

#### With Circuit Breaker

```typescript
const retryManager = new RetryManager({
  defaultOptions: {
    attempts: 3,
    initialDelay: 1000
  },
  circuitBreaker: {
    threshold: 5,           // Open after 5 failures
    windowTime: 60000,      // Within 60 seconds
    cooldownTime: 30000,    // Wait 30s before half-open
    successThreshold: 3     // Need 3 successes to close from half-open
  },
  debug: true
});
```

#### Retry Options Reference

```typescript
interface RetryOptions {
  /** Maximum retry attempts (in addition to initial attempt) */
  attempts: number;

  /** Backoff strategy: 'exponential' | 'linear' | 'constant' */
  backoff?: 'exponential' | 'linear' | 'constant';

  /** Initial delay in milliseconds */
  initialDelay?: number;

  /** Maximum delay between retries in milliseconds */
  maxDelay?: number;

  /** Jitter factor (0-1) to randomize delays */
  jitter?: number;

  /** Custom retry condition */
  shouldRetry?: (error: any, attempt: number) => boolean | Promise<boolean>;

  /** Callback on retry */
  onRetry?: (attempt: number, error: any) => void;

  /** Timeout for each attempt in milliseconds */
  attemptTimeout?: number;

  /** Factor for exponential backoff (default: 2) */
  factor?: number;
}
```

### Circuit Breaker <a name="circuit-breaker"></a>

The circuit breaker prevents cascading failures by stopping requests when failure rate is high.

#### States

```
┌─────────┐
│ CLOSED  │ ────────┐
│ (Normal)│         │ threshold failures
└────┬────┘         │ within window
     │              ▼
     │         ┌────────┐
     │         │  OPEN  │
     │         │(Blocked)│
     │         └────┬───┘
     │              │ cooldown period
     │              ▼
     │         ┌──────────┐
     └─────────│HALF-OPEN │
success        │ (Testing)│
threshold      └──────────┘
                    │
                    └─── failure ───┐
                                    │
                                    ▼
                              Back to OPEN
```

#### State Transitions

1. **CLOSED → OPEN**:
   - Triggered when `failures >= threshold` within `windowTime`
   - All requests immediately fail with `SERVICE_UNAVAILABLE`

2. **OPEN → HALF-OPEN**:
   - Triggered after `cooldownTime` elapsed
   - Allows test requests through

3. **HALF-OPEN → CLOSED**:
   - Triggered when `successes >= successThreshold`
   - Normal operation resumes

4. **HALF-OPEN → OPEN**:
   - Any failure triggers immediate return to OPEN
   - Cooldown timer resets

#### Monitoring Circuit Breaker

```typescript
retryManager.on('circuit-breaker-open', ({ nextAttemptTime }) => {
  console.error(`Circuit breaker OPEN. Next attempt at ${new Date(nextAttemptTime)}`);
  alerting.sendAlert('Circuit breaker triggered!');
});

retryManager.on('circuit-breaker-half-open', () => {
  console.warn('Circuit breaker HALF-OPEN, testing connection...');
});

retryManager.on('circuit-breaker-closed', () => {
  console.info('Circuit breaker CLOSED, service healthy');
});

// Check current state
const state = retryManager.getCircuitBreakerState();
console.log('Circuit breaker state:', state); // 'closed' | 'open' | 'half-open'
```

### Examples <a name="retry-examples"></a>

#### Basic Retry

```typescript
import { RetryManager } from '@omnitron-dev/titan/netron/transport/http';

const retryManager = new RetryManager();

const result = await retryManager.execute(
  async () => {
    // Your async operation
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
  {
    attempts: 3,
    initialDelay: 1000,
    backoff: 'exponential'
  }
);
```

#### Exponential Backoff with Jitter

```typescript
// Retry with exponential backoff and jitter
const result = await retryManager.execute(
  async () => callUnreliableAPI(),
  {
    attempts: 5,                // Total: 6 attempts (initial + 5 retries)
    backoff: 'exponential',
    initialDelay: 1000,         // Start with 1 second
    factor: 2,                  // Double each time
    maxDelay: 30000,            // Cap at 30 seconds
    jitter: 0.3                 // ±30% randomization
  }
);

// Delay progression (approximate):
// Attempt 1: 0ms (immediate)
// Attempt 2: ~1000ms ± 300ms = 700-1300ms
// Attempt 3: ~2000ms ± 600ms = 1400-2600ms
// Attempt 4: ~4000ms ± 1200ms = 2800-5200ms
// Attempt 5: ~8000ms ± 2400ms = 5600-10400ms
// Attempt 6: ~16000ms ± 4800ms = 11200-20800ms
```

#### Custom Retry Condition

```typescript
const result = await retryManager.execute(
  async () => callAPI(),
  {
    attempts: 3,
    shouldRetry: (error, attempt) => {
      // Only retry on specific error codes
      if (error.code === 'ECONNRESET') return true;
      if (error.code === 'ETIMEDOUT') return true;

      // Retry on rate limit (but check Retry-After header)
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        if (retryAfter) {
          console.log(`Rate limited. Retry after ${retryAfter}s`);
        }
        return attempt < 2; // Max 2 retries for rate limit
      }

      // Don't retry 4xx client errors
      if (error.status >= 400 && error.status < 500) {
        return false;
      }

      return true; // Retry everything else
    },
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt} after error: ${error.message}`);
      metrics.increment('api.retry', { attempt, error: error.code });
    }
  }
);
```

#### Per-Attempt Timeout

```typescript
const result = await retryManager.execute(
  async () => slowOperation(),
  {
    attempts: 3,
    initialDelay: 1000,
    attemptTimeout: 5000  // Each attempt times out after 5 seconds
  }
);
```

#### Monitoring Retries

```typescript
retryManager.on('retry', ({ attempt, error, delay }) => {
  console.log(`Retrying (attempt ${attempt}) after ${delay}ms due to: ${error}`);
  metrics.histogram('retry.delay', delay);
});

retryManager.on('retry-success', ({ attempt, delay }) => {
  console.log(`Retry succeeded on attempt ${attempt}`);
  metrics.increment('retry.success', { attempt });
});

retryManager.on('retry-exhausted', ({ attempts, error }) => {
  console.error(`All ${attempts} retry attempts failed: ${error}`);
  metrics.increment('retry.exhausted');
  alerting.sendAlert(`API failing after ${attempts} retries`);
});

// Get statistics
const stats = retryManager.getStats();
console.log('Retry stats:', {
  totalAttempts: stats.totalAttempts,
  successfulRetries: stats.successfulRetries,
  failedRetries: stats.failedRetries,
  avgRetryDelay: stats.avgRetryDelay,
  circuitState: stats.circuitState
});
```

#### Manual Circuit Breaker Control

```typescript
// Manually trip the circuit breaker (emergency)
retryManager.tripCircuitBreaker();

// Manually reset (after manual intervention)
retryManager.resetCircuitBreaker();

// Reset all statistics
retryManager.resetStats();
```

---

## HttpInterface

### Fluent API <a name="fluent-api"></a>

The `HttpInterface` provides a **fluent, chainable API** similar to TanStack Query:

```typescript
import { HttpInterface } from '@omnitron-dev/titan/netron/transport/http';

// Create interface with cache and retry managers
const userInterface = new HttpInterface<IUserService>(
  transport,
  definition,
  {
    cache: cacheManager,
    retry: retryManager,
    globalOptions: {
      cache: { maxAge: 60000 },
      retry: { attempts: 3 }
    }
  }
);

// Use fluent API
const users = await userInterface
  .call('getUsers', { status: 'active' })
  .cache(300000)                    // Cache for 5 minutes
  .retry(5)                         // Retry up to 5 times
  .timeout(10000)                   // 10 second timeout
  .priority('high')                 // High priority request
  .transform(data => data.users)    // Extract users array
  .validate(data => Array.isArray(data)) // Validate response
  .fallback([])                     // Fallback to empty array on error
  .metrics(({ duration, cacheHit }) => {
    console.log(`Request took ${duration}ms, cache hit: ${cacheHit}`);
  })
  .execute();
```

### QueryBuilder <a name="querybuilder"></a>

The `QueryBuilder` class provides the chainable interface:

#### Available Methods

```typescript
class QueryBuilder<TService, TMethod> {
  // Core
  method(name: TMethod): this;
  input(data: any): this;
  execute(): Promise<any>;
  cancel(): void;  // ✅ NEW: Cancel in-flight request

  // Caching
  cache(options: CacheOptions | number): this;
  dedupe(key: string): this;  // ✅ Automatic for cached requests
  invalidateOn(tags: string[]): this;

  // Retry
  retry(options: RetryOptions | number): this;

  // Optimistic Updates
  optimistic<T>(updater: (current: T | undefined) => T): this;  // ✅ Fully integrated

  // Background Refetch (partial)
  background(interval: number): this;

  // Request Configuration
  timeout(ms: number): this;
  priority(level: 'high' | 'normal' | 'low'): this;

  // Response Pipeline
  transform<T>(fn: (data: any) => T): this;
  validate(fn: (data: any) => boolean | Promise<boolean>): this;
  fallback(data: any): this;

  // Monitoring
  metrics(fn: (timing: { duration: number; cacheHit?: boolean }) => void): this;
}
```

#### Method Chaining Examples

```typescript
// Simple cache
await interface.call('getUser', id).cache(60000).execute();

// Simple retry
await interface.call('updateUser', data).retry(3).execute();

// Cache with retry
await interface
  .call('getUsers')
  .cache({ maxAge: 300000, staleWhileRevalidate: 60000 })
  .retry({ attempts: 5, backoff: 'exponential' })
  .execute();

// Full pipeline
await interface
  .call('complexOperation', params)
  .cache(120000)
  .retry(3)
  .timeout(30000)
  .transform(response => response.data.items)
  .validate(items => Array.isArray(items) && items.length > 0)
  .fallback([])
  .metrics(({ duration }) => console.log(`Took ${duration}ms`))
  .execute();
```

#### Advanced Features (Phase 1 - Enterprise Grade)

##### 1. Request Deduplication

Automatically prevents duplicate in-flight requests for the same data:

```typescript
// Automatic deduplication for cached requests
const query1 = interface.call('getUsers').cache(60000);
const query2 = interface.call('getUsers').cache(60000);

// Both execute() calls will share the same underlying request
const [users1, users2] = await Promise.all([
  query1.execute(),
  query2.execute()
]);
// Only 1 HTTP request is made!

// Manual deduplication with custom key
await interface
  .call('getUser', userId)
  .dedupe(`user-${userId}`)
  .execute();
```

**How it works:**
- Cached requests are automatically deduplicated using cache key
- Manual deduplication with `dedupe(key)` for non-cached requests
- Static Map tracks in-flight requests across all QueryBuilder instances
- Requests are cleaned up automatically after completion

##### 2. Query Cancellation

Cancel in-flight requests when they're no longer needed:

```typescript
const query = interface
  .call('longRunningOperation', params)
  .timeout(30000)
  .execute();

// Cancel after 1 second (e.g., user navigated away)
setTimeout(() => query.cancel(), 1000);

try {
  const result = await query;
} catch (error) {
  if (error.message === 'Query cancelled') {
    console.log('User cancelled the operation');
  }
}
```

**Use cases:**
- User navigates away from page
- Component unmounts before request completes
- User triggers new search before previous completes
- Prevent race conditions
- Resource cleanup

##### 3. Optimistic Updates

Instant UI feedback with automatic rollback on error:

```typescript
// Update user profile optimistically
await userInterface
  .call('updateProfile', { name: 'John Doe', email: 'john@example.com' })
  .cache(60000)  // Required for optimistic updates
  .optimistic((current) => ({
    ...current,
    name: 'John Doe',
    email: 'john@example.com'
  }))
  .execute();

// Cache is updated immediately with optimistic data
// If request fails, cache is automatically rolled back
```

**Features:**
- Instant UI update before request completes
- Automatic rollback on error
- Tagged with `__optimistic__` for tracking
- Requires caching to be enabled
- Preserves original data for rollback

**Real-world example:**
```typescript
// Todo app with optimistic updates
async function toggleTodo(id: string) {
  try {
    await todoInterface
      .call('toggleTodo', { id })
      .cache(60000)
      .optimistic((current: Todo[]) =>
        current.map(todo =>
          todo.id === id
            ? { ...todo, completed: !todo.completed }
            : todo
        )
      )
      .execute();
    // UI updates instantly, syncs with server in background
  } catch (error) {
    // Cache automatically rolled back to pre-optimistic state
    toast.error('Failed to update todo');
  }
}
```

##### 4. Retry-After Header Support

Respects server rate limits by honoring `Retry-After` headers:

```typescript
const retryManager = new RetryManager({
  defaultOptions: {
    attempts: 5,
    backoff: 'exponential'
  }
});

// When server returns 429 with Retry-After header:
// HTTP/1.1 429 Too Many Requests
// Retry-After: 60
//
// RetryManager will wait 60 seconds before retrying,
// overriding the exponential backoff delay

const result = await interface
  .call('rateLimitedOperation')
  .retry(5)
  .execute();
```

**Supported formats:**
- Seconds: `Retry-After: 60` (wait 60 seconds)
- HTTP Date: `Retry-After: Wed, 21 Oct 2025 07:28:00 GMT`

**Debug logging:**
```typescript
const retryManager = new RetryManager({
  debug: true  // Enable to see Retry-After parsing
});
// [Retry] Retry-After header: 60s
// [Retry] Using Retry-After delay: 60000ms
```

### Integration <a name="integration"></a>

#### With Titan Service

```typescript
// Server (Titan)
import { Injectable, Service, Public } from '@omnitron-dev/titan';

@Injectable()
@Service('users@1.0.0')
export class UserService {
  @Public()
  async getUsers(filters?: { status?: string }): Promise<User[]> {
    return await this.db.users.findMany({ where: filters });
  }

  @Public()
  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    return await this.db.users.update({ where: { id }, data });
  }
}

// Client
import { HttpTransportClient } from '@omnitron-dev/titan/netron/transport/http';
import { HttpInterface } from '@omnitron-dev/titan/netron/transport/http';
import { HttpCacheManager } from '@omnitron-dev/titan/netron/transport/http';
import { RetryManager } from '@omnitron-dev/titan/netron/transport/http';

// Create managers
const cacheManager = new HttpCacheManager({ maxEntries: 100 });
const retryManager = new RetryManager({
  circuitBreaker: {
    threshold: 5,
    windowTime: 60000,
    cooldownTime: 30000
  }
});

// Create transport
const transport = new HttpTransportClient('http://localhost:3000');

// Get service definition
const definition = await transport.getDefinition('users@1.0.0');

// Create interface
const userInterface = new HttpInterface<IUserService>(
  transport,
  definition,
  {
    cache: cacheManager,
    retry: retryManager,
    globalOptions: {
      retry: { attempts: 3 },
      cache: { maxAge: 60000 }
    }
  }
);
```

### Examples <a name="interface-examples"></a>

#### Direct Service Proxy

```typescript
// Use the direct service proxy (applies global options)
const user = await userInterface.api.getUser('user-123');
const users = await userInterface.api.getUsers({ status: 'active' });
```

#### Custom Configuration Per Call

```typescript
// Override global options for specific call
const users = await userInterface
  .call('getUsers', { status: 'active' })
  .cache(600000)  // Cache for 10 minutes (overrides global)
  .retry(5)       // Retry 5 times (overrides global)
  .execute();
```

#### Cache Invalidation

```typescript
// Invalidate specific cache key
userInterface.invalidate('users@1.0.0.getUsers:*');

// Invalidate by pattern
userInterface.invalidate(/users@1\.0\.0\.getUser:.*/);

// Invalidate multiple patterns
userInterface.invalidate([
  'users@1.0.0.getUsers*',
  'users@1.0.0.getUser*'
]);

// Clear all cache
userInterface.clearCache();
```

#### Transform & Validate

```typescript
// Transform response
const userNames = await userInterface
  .call('getUsers')
  .transform((users: User[]) => users.map(u => u.name))
  .execute();
// Result: string[]

// Validate response
const users = await userInterface
  .call('getUsers')
  .validate((users) => {
    if (!Array.isArray(users)) return false;
    if (users.length === 0) return false;
    return users.every(u => u.id && u.name);
  })
  .execute();
```

#### Fallback Data

```typescript
// Return fallback on error
const users = await userInterface
  .call('getUsers')
  .fallback([])  // Return empty array on any error
  .execute();

// Fallback with complex object
const config = await userInterface
  .call('getConfig')
  .fallback({ theme: 'light', language: 'en' })
  .execute();
```

#### Metrics Tracking

```typescript
await userInterface
  .call('getUsers')
  .metrics(({ duration, cacheHit }) => {
    // Track in your metrics system
    metrics.histogram('api.duration', duration, {
      method: 'getUsers',
      cache: cacheHit ? 'hit' : 'miss'
    });

    if (duration > 1000) {
      console.warn(`Slow API call: ${duration}ms`);
    }
  })
  .execute();
```

---

## Complete Integration Examples

### Example 1: E-Commerce Product Service

```typescript
import {
  HttpTransportClient,
  HttpInterface,
  HttpCacheManager,
  RetryManager
} from '@omnitron-dev/titan/netron/transport/http';

// Service interface
interface IProductService {
  getProducts(filters?: { category?: string }): Promise<Product[]>;
  getProduct(id: string): Promise<Product>;
  searchProducts(query: string): Promise<Product[]>;
  updateStock(id: string, quantity: number): Promise<Product>;
}

// Setup
const cache = new HttpCacheManager({
  maxEntries: 500,
  defaultMaxAge: 300000  // 5 minutes
});

const retry = new RetryManager({
  defaultOptions: {
    attempts: 3,
    backoff: 'exponential',
    initialDelay: 1000,
    jitter: 0.2
  },
  circuitBreaker: {
    threshold: 10,
    windowTime: 60000,
    cooldownTime: 30000,
    successThreshold: 5
  }
});

const transport = new HttpTransportClient('https://api.shop.com');
const definition = await transport.getDefinition('products@1.0.0');

const productAPI = new HttpInterface<IProductService>(
  transport,
  definition,
  { cache, retry }
);

// Use cases

// 1. List products with caching
async function listProducts(category?: string) {
  return await productAPI
    .call('getProducts', { category })
    .cache({
      maxAge: 300000,              // 5 minutes
      staleWhileRevalidate: 60000, // Serve stale for 1 minute while revalidating
      tags: ['products', `category:${category}`]
    })
    .retry(3)
    .transform(products => products.sort((a, b) => b.popularity - a.popularity))
    .fallback([])
    .execute();
}

// 2. Get single product with retry
async function getProduct(id: string) {
  return await productAPI
    .call('getProduct', id)
    .cache({ maxAge: 600000 })  // 10 minutes
    .retry({
      attempts: 5,
      onRetry: (attempt, error) => {
        console.log(`Retrying getProduct (${attempt}): ${error.message}`);
      }
    })
    .timeout(5000)
    .execute();
}

// 3. Search without caching (always fresh)
async function searchProducts(query: string) {
  return await productAPI
    .call('searchProducts', query)
    .retry(2)
    .timeout(3000)
    .validate(results => Array.isArray(results))
    .fallback([])
    .metrics(({ duration }) => {
      metrics.histogram('search.duration', duration, { query });
    })
    .execute();
}

// 4. Update stock (no cache, high priority)
async function updateStock(id: string, quantity: number) {
  try {
    const product = await productAPI
      .call('updateStock', { id, quantity })
      .retry({
        attempts: 3,
        shouldRetry: (error, attempt) => {
          // Only retry on network errors, not on validation errors
          return error.code?.startsWith('E') || error.status >= 500;
        }
      })
      .priority('high')
      .execute();

    // Invalidate product caches
    productAPI.invalidate([
      `products@1.0.0.getProduct:${id}`,
      'products@1.0.0.getProducts*'
    ]);

    return product;
  } catch (error) {
    console.error('Failed to update stock:', error);
    throw error;
  }
}
```

### Example 2: Real-Time Analytics Dashboard

```typescript
interface IAnalyticsService {
  getDashboardData(timeRange: string): Promise<DashboardData>;
  getMetrics(metric: string, timeRange: string): Promise<MetricData>;
  getAlerts(): Promise<Alert[]>;
}

const analyticsAPI = new HttpInterface<IAnalyticsService>(
  transport,
  definition,
  {
    cache: new HttpCacheManager({ maxEntries: 50 }),
    retry: new RetryManager({
      defaultOptions: { attempts: 5, backoff: 'exponential' },
      circuitBreaker: { threshold: 3, windowTime: 30000, cooldownTime: 10000 }
    }),
    globalOptions: {
      retry: { attempts: 5 },
      cache: { maxAge: 30000 }  // Default 30 seconds
    }
  }
);

// Dashboard data with SWR
async function loadDashboard(timeRange: string) {
  return await analyticsAPI
    .call('getDashboardData', timeRange)
    .cache({
      maxAge: 60000,               // 1 minute
      staleWhileRevalidate: 30000  // Serve stale for 30s while refetching
    })
    .retry(5)
    .timeout(10000)
    .transform(data => ({
      ...data,
      timestamp: Date.now()
    }))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Dashboard loaded in ${duration}ms (cache: ${cacheHit})`);
    })
    .execute();
}

// Critical alerts - no cache, high priority
async function getAlerts() {
  return await analyticsAPI
    .call('getAlerts')
    .retry({
      attempts: 3,
      initialDelay: 500,
      backoff: 'constant'  // Fixed delay for alerts
    })
    .priority('high')
    .timeout(3000)
    .fallback([])
    .execute();
}
```

### Example 3: Microservice Communication

```typescript
// Order service calling User service
interface IUserService {
  getUser(id: string): Promise<User>;
  getUserPreferences(id: string): Promise<Preferences>;
}

interface IOrderService {
  createOrder(data: CreateOrderDto): Promise<Order>;
  getOrders(userId: string): Promise<Order[]>;
}

// Configure with circuit breaker for service resilience
const userAPI = new HttpInterface<IUserService>(
  new HttpTransportClient('http://user-service:3000'),
  await getUserDefinition(),
  {
    cache: new HttpCacheManager({ maxEntries: 1000 }),
    retry: new RetryManager({
      circuitBreaker: {
        threshold: 5,        // Open after 5 failures
        windowTime: 60000,   // In 60 seconds
        cooldownTime: 30000  // Wait 30s before retry
      },
      debug: true
    })
  }
);

// Monitor circuit breaker
userAPI.retryManager.on('circuit-breaker-open', () => {
  console.error('[UserService] Circuit breaker OPEN - service degraded');
  alerting.sendAlert('User service circuit breaker triggered');
});

// Use with fallback for degraded service
async function createOrderWithUser(data: CreateOrderDto) {
  let user: User | null = null;

  try {
    // Try to get user data
    user = await userAPI
      .call('getUser', data.userId)
      .cache(60000)
      .retry(3)
      .timeout(2000)
      .execute();
  } catch (error) {
    console.warn('Failed to fetch user, proceeding with minimal data');
    // Service continues in degraded mode
  }

  // Create order with or without full user data
  return await orderAPI
    .call('createOrder', {
      ...data,
      userName: user?.name || 'Unknown User'
    })
    .retry(3)
    .priority('high')
    .execute();
}
```

---

## Best Practices

### 1. Configure Circuit Breaker Appropriately

```typescript
// Good: Reasonable thresholds
const retry = new RetryManager({
  circuitBreaker: {
    threshold: 5,         // Not too aggressive
    windowTime: 60000,    // 1 minute window
    cooldownTime: 30000,  // 30s cooldown gives service time to recover
    successThreshold: 3   // Need multiple successes before fully trusting
  }
});

// Bad: Too aggressive
const badRetry = new RetryManager({
  circuitBreaker: {
    threshold: 1,        // Opens on first failure - too sensitive
    windowTime: 5000,    // Too short
    cooldownTime: 1000   // Too short - doesn't give time to recover
  }
});
```

### 2. Use Appropriate Backoff Strategies

```typescript
// Exponential for most cases (distributed systems)
.retry({ backoff: 'exponential', factor: 2 })

// Linear for rate-limited APIs
.retry({ backoff: 'linear', initialDelay: 1000 })

// Constant for time-sensitive operations
.retry({ backoff: 'constant', initialDelay: 500 })
```

### 3. Cache Strategically

```typescript
// Frequently accessed, slow-changing data - long cache
.cache({ maxAge: 3600000 })  // 1 hour

// Real-time data - short cache with SWR
.cache({
  maxAge: 30000,               // 30 seconds
  staleWhileRevalidate: 15000  // Serve stale for 15s while refetching
})

// User-specific data - no cache
// (No .cache() call)
```

### 4. Always Set Timeouts

```typescript
// Good: Explicit timeout
.timeout(5000)

// Better: Timeout + attemptTimeout in retry
.retry({
  attempts: 3,
  attemptTimeout: 3000  // Each attempt times out after 3s
})
.timeout(10000)  // Overall timeout 10s
```

### 5. Implement Proper Monitoring

```typescript
// Track all metrics
interface
  .call('method', data)
  .metrics(({ duration, cacheHit }) => {
    // Track duration
    metrics.histogram('api.duration', duration, {
      service: 'users',
      method: 'getUsers',
      cache: cacheHit ? 'hit' : 'miss'
    });

    // Alert on slow requests
    if (duration > 5000) {
      alerting.sendAlert(`Slow API call: ${duration}ms`);
    }
  })
  .execute();

// Monitor retry manager
retry.on('retry', ({ attempt, error }) => {
  metrics.increment('retry.attempt', { attempt, error: error.code });
});

retry.on('circuit-breaker-open', () => {
  metrics.increment('circuit_breaker.open');
  alerting.sendCriticalAlert('Circuit breaker triggered!');
});
```

### 6. Handle Errors Gracefully

```typescript
// With fallback
const users = await interface
  .call('getUsers')
  .fallback([])  // Return empty array on error
  .execute();

// With error handling
try {
  const user = await interface
    .call('getUser', id)
    .execute();
} catch (error) {
  if (error.code === ErrorCode.SERVICE_UNAVAILABLE) {
    // Circuit breaker open
    return renderServiceUnavailablePage();
  }

  if (error.code === ErrorCode.NOT_FOUND) {
    return renderUserNotFound();
  }

  throw error;
}
```

---

## Performance Considerations

### Memory Usage

```typescript
// Configure cache limits
const cache = new HttpCacheManager({
  maxEntries: 1000,         // Limit cache entries
  maxSizeBytes: 50_000_000  // 50MB max cache size
});

// Periodically clear old entries
setInterval(() => {
  cache.clear();
}, 3600000); // Clear every hour
```

### Request Deduplication

```typescript
// Use dedupe key to prevent duplicate in-flight requests
const users1 = interface.call('getUsers').dedupe('users-active').execute();
const users2 = interface.call('getUsers').dedupe('users-active').execute();
// Only one actual request is made
```

### Optimize Retry Delays

```typescript
// Don't set delays too high
.retry({
  attempts: 3,
  initialDelay: 500,     // Start small
  maxDelay: 5000,        // Cap at 5s
  backoff: 'exponential'
})

// Progression: 500ms, 1000ms, 2000ms, 4000ms (capped at 5000ms)
```

---

## Troubleshooting

### Circuit Breaker Stuck Open

```typescript
// Check circuit state
const state = retry.getCircuitBreakerState();
console.log('Circuit state:', state);

// Manual reset if needed (after fixing underlying issue)
retry.resetCircuitBreaker();
```

### Too Many Retries

```typescript
// Check retry stats
const stats = retry.getStats();
console.log('Retry stats:', stats);

// If too many retries, adjust retry condition
.retry({
  attempts: 3,
  shouldRetry: (error, attempt) => {
    // Be more selective
    return error.code === 'ECONNRESET' && attempt < 2;
  }
})
```

### Cache Not Working

```typescript
// Verify cache manager is passed
const interface = new HttpInterface(transport, definition, {
  cache: cacheManager  // ← Must be provided
});

// Check if cache option is set
.cache(60000)  // ← Must be called

// Monitor cache hits
.metrics(({ cacheHit }) => {
  console.log('Cache hit:', cacheHit);
})
```

### Slow Requests

```typescript
// Add timeout
.timeout(5000)

// Monitor duration
.metrics(({ duration }) => {
  if (duration > 1000) {
    console.warn(`Slow request: ${duration}ms`);
  }
})

// Use cache to avoid repeated slow requests
.cache({
  maxAge: 300000,
  staleWhileRevalidate: 60000
})
```

---

## Summary

The HTTP Interface and Retry Manager provide **enterprise-grade** resilience and performance for Netron RPC:

✅ **Production-Ready Features:**
- Intelligent retry with multiple backoff strategies
- Circuit breaker with proper state machine
- Fluent, chainable API for great DX
- Cache integration with SWR support
- Comprehensive monitoring and metrics

✅ **Best Practices Built-In:**
- Smart default retry conditions
- Jitter to prevent thundering herd
- Event emitters for observability
- Type-safe throughout

✅ **Flexible & Extensible:**
- Custom retry conditions
- Per-request configuration
- Transform/validate pipelines
- Fallback support

Use these tools to build **resilient, performant microservices** with confidence.

---

## Additional Resources

### Documentation

- **[FLUENT-API-GUIDE.md](./FLUENT-API-GUIDE.md)** - Complete guide to Enhanced Fluent API
- **[FLUENT-API-EXAMPLES.md](./FLUENT-API-EXAMPLES.md)** - Real-world examples for all features
- **[PERFORMANCE.md](./PERFORMANCE.md)** - Performance benchmarks and optimization guide
- **[ENHANCED-FLUENT-API-SPEC.md](./ENHANCED-FLUENT-API-SPEC.md)** - Technical specification

### Quick Links

- **Migration Guide**: See [Enhanced Fluent API - Migration](#migration-from-httpinterface)
- **Examples**: See [FLUENT-API-EXAMPLES.md](./FLUENT-API-EXAMPLES.md)
- **API Reference**: See [FLUENT-API-GUIDE.md - API Reference](./FLUENT-API-GUIDE.md#api-reference)
- **Troubleshooting**: See [FLUENT-API-GUIDE.md - Troubleshooting](./FLUENT-API-GUIDE.md#troubleshooting)

### Getting Started

1. **Read**: [Enhanced Fluent API](#enhanced-fluent-api) section above
2. **Try**: [Quick Start](#quick-start) examples
3. **Learn**: [FLUENT-API-EXAMPLES.md](./FLUENT-API-EXAMPLES.md)
4. **Optimize**: [PERFORMANCE.md](./PERFORMANCE.md)

### Support

- Open an issue on GitHub
- Check existing documentation
- Review examples and guides

---

**Last Updated**: 2025-10-08
**Version**: 1.0.0 (Enhanced Fluent API)
**Status**: ✅ Production Ready
