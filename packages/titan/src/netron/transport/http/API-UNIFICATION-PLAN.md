# HTTP Transport API Unification Plan

## Current State Analysis

### Problem 1: Duplicate Fluent Functionality

**HttpInterface** (packages/titan/src/netron/transport/http/interface.ts):
```typescript
class HttpInterface<T> {
  cache(options): QueryBuilder<T>
  retry(options): QueryBuilder<T>
  call(method, input): QueryBuilder<T>
  get api(): T  // Direct service proxy
}
```

**FluentInterface** (packages/titan/src/netron/transport/http/fluent-interface.ts):
```typescript
class FluentInterface<T> {
  cache(options): ConfigurableProxy<T>  // Returns proxy with method access
  retry(options): ConfigurableProxy<T>
  timeout(ms): ConfigurableProxy<T>
  priority(level): ConfigurableProxy<T>
  // ... много других методов
}
```

**Issue**: Both classes provide fluent API capabilities, but FluentInterface is more complete and natural (Netron-style direct method calls).

### Problem 2: API Inconsistency with Other Transports

**Other Transports** (WebSocket, TCP, Unix):
```typescript
// AbstractPeer defines standard API
abstract class AbstractPeer {
  async queryInterface<T>(qualifiedName: string): Promise<T>
}

// Usage
const service = await peer.queryInterface<IUserService>('UserService@1.0.0');
await service.getUser('user-123');
```

**HTTP Transport**:
```typescript
class HttpRemotePeer extends AbstractPeer {
  // Non-standard API
  async createHttpInterface<T>(qualifiedName, options?): Promise<HttpInterface<T>>
  async createFluentInterface<T>(qualifiedName, options?): Promise<FluentInterface<T>>
}

// Usage
const service = await peer.createFluentInterface<IUserService>('UserService@1.0.0');
await service.getUser('user-123');
```

**Issue**: HTTP transport uses different method names (createHttpInterface/createFluentInterface) instead of queryInterface.

### Problem 3: AbstractPeer.queryInterface() Incompatibility

**AbstractPeer.queryInterface()**:
- Expects `queryInterfaceRemote()` to return a Definition
- Creates standard `Interface` instance (not HTTP-specific)
- Standard Interface doesn't support HTTP features (cache, retry, etc.)

**HttpRemotePeer.queryInterfaceRemote()**:
- ✅ Correctly implemented - returns Definition via HTTP endpoint
- ✅ Stores definition in local maps
- ❌ But parent's queryInterface() creates wrong type of interface

## Proposed Solution

### Goal: Unified API Matching Other Transports

```typescript
// Unified API - same across all transports
const service = await peer.queryInterface<IUserService>('UserService@1.0.0');

// Natural Netron-style calls with HTTP features
await service.cache(60000).getUser('user-123');
await service.retry(3).updateUser({ id: '123', name: 'Alice' });
await service.timeout(5000).deleteUser('user-123');
```

### Implementation Plan

#### Phase 1: Override queryInterface() in HttpRemotePeer

**File**: `packages/titan/src/netron/transport/http/peer.ts`

```typescript
class HttpRemotePeer extends AbstractPeer {
  /**
   * Query interface for HTTP service (returns FluentInterface)
   * Overrides AbstractPeer.queryInterface() to return HTTP-specific interface
   *
   * @override
   */
  async queryInterface<T>(qualifiedName: string): Promise<FluentInterface<T>> {
    // Get or fetch service definition (uses existing queryInterfaceRemote)
    const definition = await this.queryInterfaceRemote(qualifiedName);

    // Get or create HTTP transport client
    const transport = this.getOrCreateHttpClient();

    // Create FluentInterface (the main HTTP interface)
    const fluentInterface = new FluentInterface<T>(
      transport,
      definition,
      this.cacheManager,
      this.retryManager,
      this.globalOptions
    );

    // Store in interfaces cache (for reference counting)
    const iInfo = { instance: fluentInterface as any, refCount: 1 };
    this.interfaces.set(definition.id, iInfo);

    return fluentInterface;
  }

  /**
   * Create HttpInterface (legacy/simplified API)
   * @deprecated Use queryInterface() instead
   */
  async createHttpInterface<T>(qualifiedName: string, options?): Promise<HttpInterface<T>> {
    // Keep for backward compatibility
  }

  /**
   * Create FluentInterface (advanced API)
   * @deprecated Use queryInterface() instead
   */
  async createFluentInterface<T>(qualifiedName: string, options?): Promise<FluentInterface<T>> {
    // Delegate to queryInterface() for consistency
    return this.queryInterface<T>(qualifiedName);
  }
}
```

#### Phase 2: Simplify HttpInterface

**File**: `packages/titan/src/netron/transport/http/interface.ts`

Remove fluent methods from HttpInterface to eliminate duplication:

```typescript
/**
 * HTTP Interface - Simplified call-based API (Legacy)
 *
 * For modern fluent API, use FluentInterface via peer.queryInterface()
 */
class HttpInterface<T> {
  /**
   * Create a query for a specific method
   * @returns QueryBuilder for .execute()
   */
  call<M extends keyof T>(method: M, input?: any): QueryBuilder<T, M>

  /**
   * Get the direct service proxy (no configuration)
   * @deprecated Use FluentInterface for advanced features
   */
  get api(): T

  // REMOVED: cache(), retry(), globalCache(), globalRetry()
  // These belong in FluentInterface only
}
```

**Reasoning**:
- HttpInterface becomes simple call-based API: `interface.call('method', args).execute()`
- FluentInterface is the main API: `interface.cache(60000).method(args)`
- No duplication of fluent functionality

#### Phase 3: Update FluentInterface to Implement Interface-like API

**File**: `packages/titan/src/netron/transport/http/fluent-interface.ts`

Add interface-specific metadata to FluentInterface:

```typescript
class FluentInterface<TService> {
  // Add $def and $peer for compatibility with Interface
  get $def(): Definition {
    return this.definition;
  }

  get $peer(): HttpRemotePeer {
    return this.peer;
  }

  // Existing methods remain unchanged
  cache(options): ConfigurableProxy<TService>
  retry(options): ConfigurableProxy<TService>
  // ... etc
}
```

#### Phase 4: Update Documentation

**Files to update**:
- HTTP-CLIENT-GUIDE.md - Update all examples to use queryInterface()
- README.md - Update Quick Start examples
- Add migration guide for users using createHttpInterface/createFluentInterface

### Migration Guide

**Before (Old API)**:
```typescript
// Old way - non-standard
const service = await peer.createFluentInterface<IUserService>('UserService@1.0.0', {
  cache: new HttpCacheManager(),
  retry: new RetryManager()
});
```

**After (New API)**:
```typescript
// New way - unified with other transports
const service = await peer.queryInterface<IUserService>('UserService@1.0.0');

// Configure managers at peer level (optional)
peer.setCacheManager(new HttpCacheManager());
peer.setRetryManager(new RetryManager());
```

### Benefits

1. ✅ **Unified API**: Same queryInterface() across all transports
2. ✅ **No Duplication**: Single fluent interface (FluentInterface)
3. ✅ **Backward Compatible**: Old methods deprecated but still work
4. ✅ **Type Safety**: FluentInterface provides full TypeScript support
5. ✅ **Natural DX**: Netron-style method calls feel native
6. ✅ **Proper Inheritance**: HttpRemotePeer properly extends AbstractPeer

### Implementation Checklist

- [ ] Override queryInterface() in HttpRemotePeer
- [ ] Add cache/retry manager configuration to HttpRemotePeer
- [ ] Simplify HttpInterface (remove fluent methods)
- [ ] Add $def/$peer to FluentInterface
- [ ] Deprecate createHttpInterface/createFluentInterface
- [ ] Update all tests to use queryInterface()
- [ ] Update HTTP-CLIENT-GUIDE.md with new API
- [ ] Add migration guide section
- [ ] Test with both Node.js and Bun
- [ ] Verify all 457 tests still pass

### Breaking Changes

None! The changes are backward compatible:
- Old methods (createHttpInterface, createFluentInterface) are deprecated but still work
- Existing code continues to function
- Users can migrate gradually

### Timeline

- Phase 1-2: Implementation (~2 hours)
- Phase 3: Testing (~1 hour)
- Phase 4: Documentation (~1 hour)
- **Total**: ~4 hours

## Notes

This unification aligns HTTP transport with Netron's architecture:
- All transports use queryInterface()
- Each transport can return its own interface type
- HTTP returns FluentInterface with advanced features
- WebSocket/TCP return standard Interface
- Clean, consistent, predictable API

**Question**: Should we add similar fluent features to WebSocket transport in the future?
**Answer**: Potentially yes, but HTTP needs them more due to request/response nature.
