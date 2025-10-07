# HTTP Interface & Retry Manager - Improvement Roadmap

> **Roadmap for enhancing HTTP transport intelligent features**
> **Last Updated**: 2025-10-07

---

## Current Status

### ✅ Fully Implemented

**RetryManager:**
- ✅ Exponential, linear, constant backoff strategies
- ✅ Jitter randomization (prevents thundering herd)
- ✅ Circuit breaker with proper state machine (CLOSED → OPEN → HALF-OPEN)
- ✅ Custom retry conditions with smart defaults
- ✅ Per-attempt timeouts
- ✅ Event emitter for monitoring
- ✅ Statistics tracking
- ✅ Manual circuit breaker control
- ✅ **Retry-After header support** (respects server rate limits)

**HttpInterface:**
- ✅ Fluent API with QueryBuilder pattern
- ✅ Type-safe service proxy generation
- ✅ Cache integration (via CacheManager)
- ✅ Retry integration (via RetryManager)
- ✅ Transform/validate pipeline
- ✅ Fallback data support
- ✅ Metrics tracking
- ✅ Request priority levels
- ✅ Per-request timeout
- ✅ Cache invalidation API
- ✅ **Request deduplication** (prevents duplicate in-flight requests)
- ✅ **Query cancellation** (AbortController support)
- ✅ **Optimistic updates** (integrated with CacheManager)

**CacheManager:**
- ✅ Stale-while-revalidate (SWR)
- ✅ Tag-based invalidation
- ✅ TTL management
- ✅ Statistics tracking
- ✅ Background revalidation
- ✅ Raw cache data access via `getRaw()`

---

## ⚡ Partially Implemented

### 1. Background Refetch

**Current State:**
- ✅ `background(interval)` method exists on QueryBuilder
- ❌ NOT implemented - option is stored but nothing happens

**Implementation Needed:**
```typescript
// In QueryBuilder or HttpInterface
private backgroundRefetchTimers = new Map<string, NodeJS.Timeout>();

background(interval: number): this {
  this.options.backgroundRefetch = interval;

  // Schedule background refetch
  const key = this.getCacheKey();
  const timer = setInterval(async () => {
    try {
      await this.executeRequest();
    } catch (error) {
      // Silent failure for background refresh
      if (this.options.debug) {
        console.log('[Background] Refresh failed:', error.message);
      }
    }
  }, interval);

  this.backgroundRefetchTimers.set(key, timer);

  return this;
}

// Cleanup on destroy
destroy() {
  this.backgroundRefetchTimers.forEach(timer => clearInterval(timer));
  this.backgroundRefetchTimers.clear();
}
```

**Benefit:**
- Keeps frequently accessed data fresh
- Reduces latency for users
- Proactive cache warming

**Priority:** MEDIUM

---

### 2. Optimistic Updates Integration

**Current State:**
- ✅ **IMPLEMENTED** - Full integration with CacheManager
- ✅ Optimistic update applied before request
- ✅ Automatic rollback on error
- ✅ Tagged with `__optimistic__` for tracking

**Usage:**
```typescript
await userInterface
  .call('updateUser', { id: 1, name: 'John' })
  .cache(60000)
  .optimistic((current) => ({
    ...current,
    name: 'John'  // Instant update
  }))
  .execute();
// Cache updated immediately, rolled back if error
```

**Note:** Optimistic updates require caching to be enabled

---

## ❌ Not Implemented

### 3. Query Cancellation

**Current State:**
- ✅ **IMPLEMENTED** - AbortController integration
- ✅ `cancel()` method on QueryBuilder
- ✅ Automatic cleanup on abort
- ✅ Proper error handling for cancelled requests

**Usage:**
```typescript
const query = interface.call('getUsers').cache(60000);
const promise = query.execute();

// Cancel if needed
setTimeout(() => query.cancel(), 1000);

try {
  await promise;
} catch (error) {
  if (error.message === 'Query cancelled') {
    // Handle cancellation
  }
}
```

**Note:** Transport layer (fetch) must support AbortController signal for full cancellation

---

### 4. Dependent Queries

**Current State:**
- ❌ No support for query dependencies

**Implementation Needed:**
```typescript
class QueryBuilder {
  dependsOn<T>(dependency: Promise<T> | (() => Promise<T>)): this {
    this.options.dependency = dependency;
    return this;
  }

  async execute(): Promise<any> {
    // Wait for dependency first
    if (this.options.dependency) {
      const dep = typeof this.options.dependency === 'function'
        ? this.options.dependency()
        : this.options.dependency;

      await dep;
    }

    return this.executeRequest();
  }
}

// Usage
const user = await interface.call('getUser', userId).execute();

const orders = await interface
  .call('getOrders', userId)
  .dependsOn(user)  // Only execute after user is fetched
  .execute();
```

**Benefit:**
- Waterfall prevention
- Clear dependency graph
- Better error handling

**Priority:** LOW

---

### 5. Infinite Queries

**Current State:**
- ❌ No pagination support

**Implementation Needed:**
```typescript
interface InfiniteQueryOptions {
  pageParam?: any;
  getNextPageParam?: (lastPage: any, allPages: any[]) => any;
  getPreviousPageParam?: (firstPage: any, allPages: any[]) => any;
}

class InfiniteQueryBuilder {
  private pages: any[] = [];

  async fetchNextPage(): Promise<any> {
    const nextParam = this.options.getNextPageParam?.(
      this.pages[this.pages.length - 1],
      this.pages
    );

    if (!nextParam) return null;

    const result = await this.execute();
    this.pages.push(result);
    return result;
  }

  hasNextPage(): boolean {
    return !!this.options.getNextPageParam?.(
      this.pages[this.pages.length - 1],
      this.pages
    );
  }
}

// Usage
const infiniteQuery = interface
  .infiniteQuery('searchProducts')
  .getNextPageParam((lastPage) => lastPage.nextCursor)
  .execute();

while (infiniteQuery.hasNextPage()) {
  await infiniteQuery.fetchNextPage();
}
```

**Benefit:**
- Infinite scroll support
- Cursor-based pagination
- Load more functionality

**Priority:** LOW

---

### 6. Parallel Query Batching

**Current State:**
- ❌ No request batching

**Implementation Needed:**
```typescript
class QueryBatcher {
  private batchWindow = 10; // ms
  private pendingQueries: QueryBuilder[] = [];
  private batchTimer?: NodeJS.Timeout;

  add(query: QueryBuilder): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingQueries.push({ query, resolve, reject });

      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.executeBatch(), this.batchWindow);
      }
    });
  }

  private async executeBatch() {
    const queries = this.pendingQueries.splice(0);
    this.batchTimer = undefined;

    // Execute all queries in parallel
    const results = await Promise.allSettled(
      queries.map(q => q.query.execute())
    );

    // Resolve/reject individual promises
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        queries[i].resolve(result.value);
      } else {
        queries[i].reject(result.reason);
      }
    });
  }
}

// Usage
const batcher = new QueryBatcher();

const [users, posts, comments] = await Promise.all([
  batcher.add(interface.call('getUsers')),
  batcher.add(interface.call('getPosts')),
  batcher.add(interface.call('getComments'))
]);
// All execute in single batch after 10ms window
```

**Benefit:**
- Reduce number of HTTP requests
- Better performance for multiple queries
- Server-side batching support

**Priority:** LOW

---

### 7. Bulkhead Pattern

**Current State:**
- ❌ No concurrent request limiting

**Implementation Needed:**
```typescript
class RetryManager {
  private concurrentRequests = 0;
  private maxConcurrent = 10;
  private queue: Array<{ fn: Function; resolve: Function; reject: Function }> = [];

  async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    // Check if we're at max concurrency
    if (this.concurrentRequests >= this.maxConcurrent) {
      // Queue the request
      return new Promise((resolve, reject) => {
        this.queue.push({ fn, resolve, reject });
      });
    }

    return this.executeWithBulkhead(fn, options);
  }

  private async executeWithBulkhead<T>(
    fn: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    this.concurrentRequests++;

    try {
      const result = await this.executeInternal(fn, options);
      return result;
    } finally {
      this.concurrentRequests--;

      // Process queue
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.executeWithBulkhead(next.fn, options)
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }
}
```

**Benefit:**
- Prevent resource exhaustion
- Better concurrency control
- Protect downstream services

**Priority:** MEDIUM

---

### 8. Advanced Cache Key Generation

**Current State:**
- ✅ Simple JSON.stringify for cache keys
- ❌ Not stable (object property order matters)
- ❌ No custom serialization

**Implementation Needed:**
```typescript
import { hash } from 'ohash'; // or similar

class QueryBuilder {
  private getCacheKey(): string {
    if (this.options.dedupeKey) {
      return this.options.dedupeKey;
    }

    // Stable hash that ignores object property order
    const argsHash = hash(this.methodInput);

    return `${this.definition.meta.name}.${String(this.methodName)}:${argsHash}`;
  }

  // Custom serializer
  customSerializer(fn: (input: any) => string): this {
    this.options.serializeKey = fn;
    return this;
  }
}

// Usage
.customSerializer((input) => `${input.userId}:${input.filter}`)
```

**Benefit:**
- More reliable caching
- Custom key strategies
- Better cache hit rate

**Priority:** LOW

---

## 🎯 Recommended Implementation Order

### ✅ Phase 1: COMPLETED - High Priority Fixes
1. ✅ **Deduplication** - Prevent duplicate in-flight requests
2. ✅ **Retry-After Support** - Respect server rate limits
3. ✅ **Query Cancellation** - Better resource management
4. ✅ **Optimistic Updates Integration** - Better mutation UX

### Phase 2: UX Improvements (Next)
1. **Bulkhead Pattern** - Concurrency control
2. **Background Refetch** - Keep data fresh

### Phase 3: Advanced Features
1. **Parallel Query Batching** - Performance optimization
2. **Advanced Cache Key Generation** - Better cache hit rate
3. **Dependent Queries** - Waterfall handling

### Phase 4: Nice to Have (Future)
1. **Infinite Queries** - Pagination support
2. Additional performance optimizations

---

## Testing Checklist

For each new feature:

- [ ] Unit tests for happy path
- [ ] Unit tests for error cases
- [ ] Integration tests with RetryManager
- [ ] Integration tests with CacheManager
- [ ] Performance benchmarks
- [ ] Documentation with examples
- [ ] TypeScript types are correct
- [ ] Events are emitted properly

---

## Breaking Changes to Consider

None of the proposed improvements require breaking changes. All can be added as:
- Optional parameters
- New methods
- Default-off flags

---

## Metrics to Track

Once implemented, track:

1. **Deduplication**:
   - `dedupe.hits` - Requests saved by deduplication
   - `dedupe.misses` - Unique requests

2. **Background Refetch**:
   - `background.refreshes` - Successful background refreshes
   - `background.errors` - Failed background refreshes

3. **Optimistic Updates**:
   - `optimistic.applied` - Optimistic updates applied
   - `optimistic.rollbacks` - Rollbacks due to errors

4. **Retry-After**:
   - `retry.retry_after_respected` - Times Retry-After was honored
   - `retry.retry_after_delay` - Delay distributions

5. **Bulkhead**:
   - `bulkhead.queued` - Requests queued
   - `bulkhead.queue_time` - Time spent in queue
   - `bulkhead.rejected` - Requests rejected (queue full)

---

## Community Feedback

Please provide feedback on:
- Priority of features
- Missing features not listed
- Implementation approaches
- Documentation clarity

---

## Conclusion

The HTTP Interface and Retry Manager have reached **enterprise-grade** status with Phase 1 improvements completed! 🎉

**Previous State**: ⭐⭐⭐⭐ (4/5 stars - Production Ready)
**Current State**: ⭐⭐⭐⭐⭐ (4.5/5 stars - Enterprise Grade)
**After All Improvements**: ⭐⭐⭐⭐⭐ (5/5 stars - Best-in-Class)

### Phase 1 Achievements (2025-10-07):
- ✅ **Deduplication**: Prevents duplicate in-flight requests, reduces server load
- ✅ **Retry-After Support**: Respects server rate limits with proper header parsing
- ✅ **Query Cancellation**: AbortController integration for resource management
- ✅ **Optimistic Updates**: Instant UI feedback with automatic rollback on error

All core intelligent features are now **fully functional** and **type-safe**!
