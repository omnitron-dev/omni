# Cache Invalidation Implementation

## Overview

Successfully extracted and adapted the cache invalidation core task from Titan's Netron for the browser client. This implementation provides client-side cache invalidation coordination with the server, supporting both service definition cache and HTTP response cache.

## Implementation Summary

### Files Created

1. **Core Task Definition**
   - `/src/core-tasks/invalidate-cache.ts` - Cache invalidation core task
     - Request/response types
     - Pattern matching helper function
     - Validation functions
     - Support for wildcards and exact matching

2. **Test Files**
   - `/tests/unit/cache-invalidation.test.ts` - Core task tests (40 tests)
     - Pattern matching tests (exact, wildcards, special chars, edge cases)
     - Request/response validation tests
     - Type validation tests

   - `/tests/unit/peer-cache-invalidation.test.ts` - Peer integration tests (14 tests)
     - HttpRemotePeer cache invalidation tests
     - HttpCacheManager integration tests
     - Pattern-based invalidation tests
     - Selective cache type invalidation tests

### Files Modified

3. **Transport Layer**
   - `/src/transport/http/peer.ts` - Added `invalidateCache()` method
     - Supports both service and HTTP cache invalidation
     - Pattern matching with wildcards
     - Selective cache type invalidation
     - Returns count of invalidated entries

   - `/src/transport/ws/peer.ts` - Added `invalidateCache()` method
     - Service definition cache invalidation
     - Optional server-side invalidation request
     - Graceful error handling

4. **Exports**
   - `/src/core-tasks/index.ts` - Export invalidate-cache task
   - `/src/index.ts` - Export cache invalidation API

## Features

### 1. Pattern Matching
- **Exact match**: `UserService@1.0.0`
- **Prefix wildcard**: `User*` (matches UserService, UserAuthService, etc.)
- **Suffix wildcard**: `*@1.0.0` (matches all services at version 1.0.0)
- **Multiple wildcards**: `User*Service@*` (flexible matching)
- **Complex patterns**: `com.example.*@1.0.0`

### 2. Cache Types
- **service**: Service definition cache (default)
- **http**: HTTP response cache (for HttpRemotePeer only)
- **all**: Both service and HTTP cache

### 3. Peer Integration

#### HttpRemotePeer
```typescript
const peer = new HttpRemotePeer('http://localhost:3000');

// Clear all cache
await peer.invalidateCache();

// Clear specific service
await peer.invalidateCache('UserService@1.0.0');

// Clear all services starting with "User"
await peer.invalidateCache('User*');

// Clear only HTTP cache
await peer.invalidateCache(undefined, 'http');

// Clear only service cache
await peer.invalidateCache(undefined, 'service');
```

#### WebSocketPeer
```typescript
const peer = new WebSocketPeer('ws://localhost:3000');

// Clear all local cache
await peer.invalidateCache();

// Clear specific service locally
await peer.invalidateCache('UserService@1.0.0');

// Clear cache on both client and server
await peer.invalidateCache('User*', true);
```

### 4. HttpCacheManager Integration
The `HttpCacheManager` already supports invalidation with:
- String patterns (prefix matching with `*`)
- Regular expressions
- Tag-based invalidation (arrays of tags)

The peer integration leverages these capabilities for HTTP response cache invalidation.

## API Reference

### Core Task

```typescript
// Constants
CORE_TASK_INVALIDATE_CACHE = 'netron.invalidate_cache'

// Request Type
interface InvalidateCacheRequest {
  pattern?: string;  // Service name pattern (supports *)
  cacheType?: 'service' | 'http' | 'all';  // Default: 'all'
}

// Response Type
interface InvalidateCacheResponse {
  count: number;  // Number of entries invalidated
  breakdown?: {
    service?: number;
    http?: number;
  };
}

// Helper Functions
createInvalidateCacheRequest(pattern?: string, cacheType?: 'service' | 'http' | 'all'): InvalidateCacheRequest
isInvalidateCacheResponse(obj: any): obj is InvalidateCacheResponse
matchesPattern(name: string, pattern: string): boolean
```

### Peer Methods

```typescript
// HttpRemotePeer
async invalidateCache(
  pattern?: string,
  cacheType?: 'service' | 'http' | 'all'
): Promise<number>

// WebSocketPeer
async invalidateCache(
  pattern?: string,
  serverSide?: boolean
): Promise<number>
```

## Pattern Matching Algorithm

The pattern matching implementation:
1. Checks for exact match first (fast path)
2. If pattern contains `*`, converts to regex:
   - Escapes regex special characters: `.+?^${}()|[]\\`
   - Replaces `*` with `.*` (matches any characters)
   - Creates anchored regex: `^pattern$`
3. Tests the service name against the regex

### Examples

| Pattern | Service Name | Match |
|---------|-------------|-------|
| `UserService@1.0.0` | `UserService@1.0.0` | ✅ |
| `User*` | `UserService@1.0.0` | ✅ |
| `User*` | `OrderService@1.0.0` | ❌ |
| `*@1.0.0` | `UserService@1.0.0` | ✅ |
| `*Service*` | `UserService@1.0.0` | ✅ |
| `*` | (any service) | ✅ |

## Test Coverage

### Core Task Tests (40 tests)
- ✅ Constants validation
- ✅ Request creation (5 tests)
- ✅ Response validation (7 tests)
- ✅ Pattern matching (28 tests)
  - Exact match
  - Wildcard patterns (prefix, suffix, multiple)
  - Special character escaping
  - Edge cases
  - Case sensitivity
  - Version patterns
  - Complex patterns

### Peer Integration Tests (14 tests)
- ✅ HttpRemotePeer invalidation (10 tests)
  - Clear all cache
  - Selective cache type invalidation
  - Pattern-based invalidation
  - Wildcard matching
  - Empty cache handling
  - No matches handling
- ✅ HttpCacheManager integration (4 tests)
  - String pattern invalidation
  - Regex pattern invalidation
  - Tag-based invalidation

### Test Results
```
✓ tests/unit/cache-invalidation.test.ts (40 tests) 3ms
✓ tests/unit/peer-cache-invalidation.test.ts (14 tests) 5ms
✓ All unit tests (136 tests) 354ms
```

## Build Verification

```bash
npm run build
# ✅ Build successful
# ESM ⚡️ Build success in 283ms
# DTS ⚡️ Build success in 2738ms
```

## Architecture

### Client-Side Cache Layers

```
┌─────────────────────────────────────────────────────────┐
│                    HttpRemotePeer                        │
│                                                          │
│  ┌────────────────────┐    ┌────────────────────────┐  │
│  │ Service Definition │    │   HTTP Response Cache   │  │
│  │      Cache         │    │   (HttpCacheManager)    │  │
│  │                    │    │                         │  │
│  │ - services Map     │    │ - Request/Response      │  │
│  │ - interfaces Map   │    │ - Stale-while-revalidate│  │
│  │ - Pattern matching │    │ - Tag-based invalidation│  │
│  └────────────────────┘    └────────────────────────┘  │
│                                                          │
│              invalidateCache(pattern, cacheType)        │
│              - 'service': Clear left cache              │
│              - 'http': Clear right cache                │
│              - 'all': Clear both caches                 │
└─────────────────────────────────────────────────────────┘
```

### WebSocket Cache Coordination

```
┌──────────────┐                    ┌──────────────┐
│              │                    │              │
│  Client      │                    │   Server     │
│  (Browser)   │                    │   (Node.js)  │
│              │                    │              │
│ ┌──────────┐ │  WebSocket Packet │ ┌──────────┐ │
│ │  Local   │ │ ──────────────────>│ │  Server  │ │
│ │  Cache   │ │  TYPE_TASK         │ │  Cache   │ │
│ │          │ │  invalidate_cache  │ │          │ │
│ └──────────┘ │                    │ └──────────┘ │
│              │                    │              │
│ invalidateCache(pattern, true)    │              │
│ - Clear local cache               │              │
│ - Send invalidation request       │              │
└──────────────┘                    └──────────────┘
```

## Error Handling

### HttpRemotePeer
- Returns 0 if no cache manager is configured
- Gracefully handles empty cache
- Returns actual count of invalidated entries
- Logs invalidation operations

### WebSocketPeer
- Clears local cache regardless of server response
- Catches and logs server-side errors without throwing
- Graceful degradation if server is unavailable

## Performance Considerations

1. **Pattern Matching**: Exact match fast path before regex compilation
2. **Regex Caching**: Consider caching compiled regex patterns for frequently used patterns
3. **Batch Invalidation**: Pattern matching allows invalidating multiple entries efficiently
4. **Minimal Overhead**: Only counts invalidated entries, no expensive serialization

## Future Enhancements

1. **Regex Support**: Direct regex pattern support without wildcard conversion
2. **Async Invalidation**: Background cache cleanup for large invalidation operations
3. **Invalidation Events**: Emit events when cache is invalidated for monitoring
4. **Metrics**: Track invalidation statistics (total count, by pattern, by type)
5. **Selective Revalidation**: Revalidate instead of invalidate for specific patterns
6. **Cross-Tab Sync**: Use BroadcastChannel to sync invalidation across browser tabs

## Integration with Titan

The implementation is compatible with Titan's server-side cache invalidation:
- Same pattern matching logic
- Same wildcard support
- Same request/response format
- WebSocket peer can coordinate with server's `invalidate_cache` core task

## Usage Examples

### Basic Usage

```typescript
import { createClient } from '@omnitron-dev/netron-browser';

const client = createClient({ url: 'http://localhost:3000' });
const peer = client.getPeer();

// Clear all cache when user logs out
await peer.invalidateCache();

// Clear user-related cache when user profile changes
await peer.invalidateCache('User*');

// Clear only HTTP response cache for a specific service
await peer.invalidateCache('UserService@1.0.0', 'http');
```

### Advanced Usage

```typescript
import { HttpRemotePeer, HttpCacheManager } from '@omnitron-dev/netron-browser';

// Setup peer with cache manager
const peer = new HttpRemotePeer('http://localhost:3000');
const cacheManager = new HttpCacheManager({
  maxEntries: 1000,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
});
peer.setCacheManager(cacheManager);

// Clear cache for all services at a specific version
await peer.invalidateCache('*@1.0.0');

// Clear cache for all services in a namespace
await peer.invalidateCache('com.example.*');

// Monitor cache invalidation
cacheManager.on('cache-invalidate', ({ keys }) => {
  console.log(`Invalidated ${keys.length} cache entries`);
});
```

### WebSocket Server Coordination

```typescript
import { WebSocketPeer } from '@omnitron-dev/netron-browser';

const peer = new WebSocketPeer('ws://localhost:3000');
await peer.connect();

// Invalidate on both client and server
const count = await peer.invalidateCache('User*', true);
console.log(`Invalidated ${count} entries on client`);
// Server will also invalidate its cache
```

## Conclusion

The cache invalidation implementation provides:
- ✅ Pattern matching with wildcards
- ✅ Selective cache type invalidation
- ✅ Integration with both HTTP and WebSocket transports
- ✅ Coordination with HttpCacheManager
- ✅ Server-side invalidation support (WebSocket)
- ✅ Comprehensive test coverage (54 tests)
- ✅ Full type safety
- ✅ Graceful error handling
- ✅ Production-ready build

The implementation successfully adapts Titan's cache invalidation logic for browser clients while adding HTTP response cache support specific to the HTTP transport layer.
