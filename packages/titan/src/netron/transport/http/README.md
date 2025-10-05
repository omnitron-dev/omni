# HTTP Transport for Netron v2.0

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Protocol Specification](#protocol-specification)
- [Server Implementation](#server-implementation)
- [Client Implementation](#client-implementation)
- [Advanced Features](#advanced-features)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [Migration Guide](#migration-guide)

## Overview

The HTTP Transport for Netron v2.0 provides a **native JSON-based protocol** for service communication over HTTP. Unlike traditional RPC transports, this implementation uses straightforward HTTP POST requests with JSON payloads, making it easy to integrate with web browsers, REST clients, and existing HTTP infrastructure.

### Key Features

- ✅ **Native JSON Protocol** - No binary packet encoding, direct JSON messaging
- ✅ **Service Discovery** - Automatic service and method discovery
- ✅ **Batch Requests** - Multiple invocations in a single HTTP request
- ✅ **Smart Caching** - Built-in cache manager with TTL and invalidation
- ✅ **Automatic Retries** - Configurable retry logic with exponential backoff
- ✅ **Optimistic Updates** - Client-side optimistic mutations with automatic rollback
- ✅ **Request Batching** - Automatic batching for performance optimization
- ✅ **Type Safety** - Full TypeScript support with typed contracts
- ✅ **Timeout Protection** - Built-in timeout handling for discovery and invocation
- ✅ **Graceful Degradation** - Works even when service discovery fails
- ✅ **Middleware Support** - Extensible middleware pipeline
- ✅ **Multi-runtime** - Node.js 22+, Bun 1.2+, Deno 2.0+ support

### What's NOT Included

The following features are NOT implemented in the current version:

- ❌ REST endpoint mapping (GET /users/:id) - use POST /netron/invoke instead
- ❌ Custom @Route decorators
- ❌ Server-Sent Events (SSE) streaming
- ❌ WebSocket upgrade
- ❌ Protocol Buffers support
- ❌ Automatic OpenAPI generation
- ❌ File upload handling

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     HTTP Client                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Browser    │  │  REST Client │  │   Node.js    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP POST (JSON)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  HTTP Transport Layer                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  HttpServer                                            │ │
│  │  • POST /netron/discovery  (service discovery)        │ │
│  │  • POST /netron/invoke     (method invocation)        │ │
│  │  • POST /netron/batch      (batch requests)           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  HttpConnection                                        │ │
│  │  • Discovery with 5s timeout protection               │ │
│  │  • queryInterface with 1s max wait                    │ │
│  │  • Graceful degradation on failures                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Optimization Managers                                 │ │
│  │  • CacheManager       (95% coverage)                  │ │
│  │  • RetryManager       (96% coverage)                  │ │
│  │  • RequestBatcher     (96% coverage)                  │ │
│  │  • OptimisticManager  (98% coverage)                  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Native JSON Messages
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Netron Core                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  LocalPeer   │  │   Services   │  │  Middleware  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Protocol Specification

### Message Format

HTTP v2.0 uses native JSON messages for all communication.

#### Request Message

```typescript
interface HttpRequestMessage {
  // Required fields
  id: string;              // Unique request ID for correlation
  version: '2.0';          // Protocol version
  timestamp: number;       // Client timestamp (Unix milliseconds)
  service: string;         // Service name (e.g., "Calculator@1.0.0")
  method: string;          // Method name (e.g., "add")
  input: any;              // Method input data

  // Optional fields
  context?: {
    traceId?: string;      // Distributed tracing ID
    spanId?: string;       // Span ID
    userId?: string;       // User context
    tenantId?: string;     // Multi-tenancy context
    metadata?: Record<string, any>;
  };

  hints?: {
    cache?: {
      maxAge?: number;
      staleWhileRevalidate?: number;
      tags?: string[];
    };
    retry?: {
      attempts?: number;
      backoff?: 'exponential' | 'linear' | 'constant';
      maxDelay?: number;
      initialDelay?: number;
    };
    priority?: 'high' | 'normal' | 'low';
    timeout?: number;
  };
}
```

#### Response Message

```typescript
interface HttpResponseMessage {
  // Required fields
  id: string;              // Matching request ID
  version: '2.0';          // Protocol version
  timestamp: number;       // Server timestamp
  success: boolean;        // Operation status

  // Success response
  data?: any;              // Result data (when success = true)

  // Error response
  error?: {
    code: string;          // Error code
    message: string;       // Human-readable message
    details?: any;         // Additional error details
    stack?: string;        // Stack trace (development only)
    retryAfter?: number;   // Retry delay in milliseconds
  };

  // Optional hints
  hints?: {
    cache?: {
      etag?: string;
      lastModified?: string;
      maxAge?: number;
      tags?: string[];
    };
    metrics?: {
      serverTime?: number;
      dbQueries?: number;
      cacheHit?: boolean;
    };
    rateLimit?: {
      remaining?: number;
      limit?: number;
      resetAt?: number;
    };
  };
}
```

### Endpoints

#### 1. Service Discovery

**Endpoint:** `GET /netron/discovery`

**Response:**
```json
{
  "server": {
    "version": "2.0.0",
    "protocol": "2.0",
    "features": ["batch", "discovery"],
    "metadata": {}
  },
  "services": {
    "Calculator@1.0.0": {
      "name": "Calculator",
      "version": "1.0.0",
      "methods": ["add", "subtract", "multiply", "divide"]
    },
    "UserService@2.1.0": {
      "name": "UserService",
      "version": "2.1.0",
      "methods": ["getUser", "createUser", "updateUser"]
    }
  },
  "contracts": {},
  "timestamp": 1735678900000
}
```

**Timeout Protection:**
- Discovery has a **5-second timeout** to prevent hanging
- Client continues even if discovery fails (graceful degradation)
- Minimal service definitions created as fallback

#### 2. Method Invocation

**Endpoint:** `POST /netron/invoke`

**Request:**
```json
{
  "id": "req-123",
  "version": "2.0",
  "timestamp": 1735678900000,
  "service": "Calculator@1.0.0",
  "method": "add",
  "input": {
    "a": 5,
    "b": 3
  }
}
```

**Response (Success):**
```json
{
  "id": "req-123",
  "version": "2.0",
  "timestamp": 1735678900123,
  "success": true,
  "data": {
    "result": 8
  }
}
```

**Response (Error):**
```json
{
  "id": "req-123",
  "version": "2.0",
  "timestamp": 1735678900123,
  "success": false,
  "error": {
    "code": "METHOD_NOT_FOUND",
    "message": "Method 'add' not found on service 'Calculator@1.0.0'"
  }
}
```

#### 3. Batch Requests

**Endpoint:** `POST /netron/batch`

**Request:**
```json
{
  "id": "batch-456",
  "version": "2.0",
  "timestamp": 1735678900000,
  "requests": [
    {
      "id": "req-1",
      "service": "Calculator@1.0.0",
      "method": "add",
      "input": { "a": 5, "b": 3 }
    },
    {
      "id": "req-2",
      "service": "Calculator@1.0.0",
      "method": "multiply",
      "input": { "a": 4, "b": 7 }
    }
  ]
}
```

**Response:**
```json
{
  "id": "batch-456",
  "version": "2.0",
  "timestamp": 1735678900123,
  "responses": [
    {
      "id": "req-1",
      "success": true,
      "data": { "result": 8 }
    },
    {
      "id": "req-2",
      "success": true,
      "data": { "result": 28 }
    }
  ]
}
```

## Server Implementation

### Basic Setup

```typescript
import { HttpServer } from '@omnitron-dev/titan/netron/transport/http';
import { LocalPeer } from '@omnitron-dev/titan/netron';

// Create local peer with services
const peer = new LocalPeer();

// Register services
peer.registerService({
  name: 'Calculator',
  version: '1.0.0',
  methods: {
    add: async (input: { a: number; b: number }) => {
      return { result: input.a + input.b };
    },
    multiply: async (input: { a: number; b: number }) => {
      return { result: input.a * input.b };
    }
  }
});

// Create HTTP server
const server = new HttpServer({
  port: 3000,
  host: 'localhost',
  cors: {
    enabled: true,
    origins: ['http://localhost:5173']
  }
});

// Register peer with server
server.setPeer(peer);

// Start server
await server.listen();
console.log('HTTP server listening on http://localhost:3000');
```

### Server Configuration

```typescript
interface HttpServerOptions {
  // Network
  port?: number;                    // Default: 3000
  host?: string;                    // Default: 'localhost'

  // CORS
  cors?: {
    enabled?: boolean;              // Default: false
    origins?: string[];             // Allowed origins
    methods?: string[];             // Allowed methods
    headers?: string[];             // Allowed headers
    credentials?: boolean;          // Allow credentials
  };

  // Timeouts
  timeout?: number;                 // Request timeout (ms)
  keepAliveTimeout?: number;        // Keep-alive timeout (ms)

  // Body limits
  maxBodySize?: number;             // Max request body size (bytes)

  // Headers
  headers?: Record<string, string>; // Custom response headers
}
```

### Middleware Support

```typescript
import { HttpServer } from '@omnitron-dev/titan/netron/transport/http';
import { MiddlewareStage } from '@omnitron-dev/titan/netron/middleware';

const server = new HttpServer({ port: 3000 });

// Add authentication middleware
server.use(MiddlewareStage.PRE_INVOKE, async (context, next) => {
  const token = context.request.headers.get('authorization');

  if (!token) {
    throw new Error('Unauthorized');
  }

  // Validate token
  const user = await validateToken(token);
  context.metadata.user = user;

  return next(context);
});

// Add logging middleware
server.use(MiddlewareStage.POST_INVOKE, async (context, next) => {
  const duration = Date.now() - context.startTime;
  console.log(`${context.service}.${context.method} - ${duration}ms`);

  return next(context);
});
```

## Client Implementation

### HttpConnection

Basic connection with discovery and invocation:

```typescript
import { HttpConnection } from '@omnitron-dev/titan/netron/transport/http';

// Create connection
const connection = new HttpConnection('http://localhost:3000', {
  timeout: 5000,
  headers: {
    'Authorization': 'Bearer token123'
  }
});

// Discovery happens automatically with timeout protection
// - 5-second timeout on discovery
// - 1-second max wait in queryInterface
// - Works even if discovery fails

// Get service proxy
const calculator = await connection.queryInterface('Calculator@1.0.0');

// Call methods
const result = await calculator.add({ a: 5, b: 3 });
console.log(result); // { result: 8 }
```

### HttpTransportClient

Higher-level client with full features:

```typescript
import { HttpTransportClient } from '@omnitron-dev/titan/netron/transport/http';

const client = new HttpTransportClient('http://localhost:3000', undefined, {
  timeout: 10000,
  headers: {
    'X-API-Key': 'my-api-key'
  }
});

// Initialize connection
await client.initialize();

// Invoke methods
const result = await client.invoke(
  'Calculator@1.0.0',
  'add',
  [{ a: 5, b: 3 }],
  {
    context: {
      userId: 'user-123',
      traceId: 'trace-456'
    },
    hints: {
      timeout: 5000,
      priority: 'high'
    }
  }
);

console.log(result); // { result: 8 }

// Close client
await client.close();
```

### TypedContract (Type-Safe Client)

```typescript
import { TypedContract } from '@omnitron-dev/titan/netron/transport/http';

// Define service interface
interface CalculatorService {
  add(input: { a: number; b: number }): Promise<{ result: number }>;
  multiply(input: { a: number; b: number }): Promise<{ result: number }>;
}

// Create typed contract
const contract = new TypedContract<CalculatorService>(
  'http://localhost:3000',
  'Calculator@1.0.0'
);

// Initialize
await contract.connect();

// Type-safe method calls
const sum = await contract.call('add', { a: 5, b: 3 });
console.log(sum.result); // 8 - fully typed!

// Cleanup
await contract.disconnect();
```

## Advanced Features

### Cache Manager

Intelligent caching with TTL, tags, and invalidation:

```typescript
import { HttpCacheManager } from '@omnitron-dev/titan/netron/transport/http';

const cache = new HttpCacheManager({
  maxSize: 1000,           // Maximum cache entries
  defaultTTL: 60000,       // Default TTL (60 seconds)
  cleanupInterval: 30000   // Cleanup interval (30 seconds)
});

// Set with TTL
await cache.set('user:123', userData, {
  ttl: 300000,             // 5 minutes
  tags: ['users', 'user:123']
});

// Get from cache
const user = await cache.get('user:123');

// Invalidate by tag
await cache.invalidateByTag('users');

// Wrap function with cache
const getUser = cache.wrap(
  async (id: string) => fetchUserFromDB(id),
  { ttl: 60000, tags: ['users'] }
);

const user = await getUser('123'); // Cached automatically
```

### Retry Manager

Automatic retries with exponential backoff:

```typescript
import { RetryManager } from '@omnitron-dev/titan/netron/transport/http';

const retry = new RetryManager({
  maxAttempts: 3,
  initialDelay: 1000,      // 1 second
  maxDelay: 10000,         // 10 seconds
  backoffMultiplier: 2,    // Exponential backoff
  retryableErrors: [
    'NETWORK_ERROR',
    'TIMEOUT',
    'SERVICE_UNAVAILABLE'
  ]
});

// Retry operation
const result = await retry.execute(
  async () => {
    return await client.invoke('Service', 'method', [input]);
  },
  {
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}: ${error.message}`);
    }
  }
);
```

### Request Batcher

Automatic batching for performance:

```typescript
import { RequestBatcher } from '@omnitron-dev/titan/netron/transport/http';

const batcher = new RequestBatcher('http://localhost:3000', {
  maxBatchSize: 10,        // Max requests per batch
  maxWaitTime: 50,         // Max wait time (ms)
  maxAge: 100              // Max request age (ms)
});

// Requests are automatically batched
const promise1 = batcher.add('Service1', 'method1', { a: 1 });
const promise2 = batcher.add('Service1', 'method2', { b: 2 });
const promise3 = batcher.add('Service2', 'method3', { c: 3 });

// All three sent in single batch request
const [result1, result2, result3] = await Promise.all([
  promise1,
  promise2,
  promise3
]);

// Manual flush
await batcher.flush();
```

### Optimistic Update Manager

Client-side mutations with automatic rollback:

```typescript
import { OptimisticUpdateManager } from '@omnitron-dev/titan/netron/transport/http';

const manager = new OptimisticUpdateManager();

// Optimistic update with automatic rollback on error
const userId = 'user-123';

await manager.mutate(
  `user:${userId}`,

  // Optimistic update function
  (currentData) => ({
    ...currentData,
    name: 'New Name'  // Immediate UI update
  }),

  // Mutation function
  async () => {
    return await client.invoke('Users', 'updateUser', [{
      id: userId,
      name: 'New Name'
    }]);
  },

  {
    // On error, automatically rollback to previous value
    onError: (error) => {
      console.error('Update failed:', error);
    },

    // Retry configuration
    retries: 3,
    timeout: 5000
  }
);

// Get current value (optimistic or committed)
const currentUser = manager.get(`user:${userId}`);
```

## Configuration

### Client Configuration

```typescript
interface HttpConnectionOptions {
  // Network
  timeout?: number;                 // Request timeout (default: 30000ms)
  headers?: Record<string, string>; // Custom headers

  // Discovery
  discoveryInterval?: number;       // Auto-refresh interval (ms)
  discoveryTimeout?: number;        // Discovery timeout (default: 5000ms)

  // Retry
  retry?: {
    maxAttempts?: number;           // Max retry attempts
    initialDelay?: number;          // Initial delay (ms)
    maxDelay?: number;              // Max delay (ms)
    backoffMultiplier?: number;     // Backoff multiplier
  };

  // Cache
  cache?: {
    enabled?: boolean;              // Enable caching
    maxSize?: number;               // Max cache size
    defaultTTL?: number;            // Default TTL (ms)
  };

  // Batching
  batch?: {
    enabled?: boolean;              // Enable batching
    maxBatchSize?: number;          // Max requests per batch
    maxWaitTime?: number;           // Max wait time (ms)
  };
}
```

### Environment Variables

```bash
# Server
HTTP_PORT=3000
HTTP_HOST=localhost
HTTP_TIMEOUT=30000
HTTP_MAX_BODY_SIZE=10485760

# Client
HTTP_CLIENT_TIMEOUT=10000
HTTP_DISCOVERY_TIMEOUT=5000
HTTP_RETRY_MAX_ATTEMPTS=3
HTTP_CACHE_MAX_SIZE=1000
HTTP_BATCH_MAX_SIZE=10
```

## Error Handling

### Error Codes

Standard error codes used by HTTP transport:

```typescript
// Client errors (4xx)
'BAD_REQUEST'              // 400 - Invalid request format
'UNAUTHORIZED'             // 401 - Authentication required
'FORBIDDEN'                // 403 - Insufficient permissions
'NOT_FOUND'                // 404 - Service/method not found
'METHOD_NOT_ALLOWED'       // 405 - HTTP method not allowed
'REQUEST_TIMEOUT'          // 408 - Request timeout
'CONFLICT'                 // 409 - Resource conflict
'PAYLOAD_TOO_LARGE'        // 413 - Request body too large
'UNPROCESSABLE_ENTITY'     // 422 - Validation error

// Server errors (5xx)
'INTERNAL_SERVER_ERROR'    // 500 - Internal server error
'NOT_IMPLEMENTED'          // 501 - Feature not implemented
'BAD_GATEWAY'              // 502 - Upstream error
'SERVICE_UNAVAILABLE'      // 503 - Service temporarily unavailable
'GATEWAY_TIMEOUT'          // 504 - Upstream timeout

// Custom errors
'NETWORK_ERROR'            // Network failure
'DISCOVERY_TIMEOUT'        // Discovery timeout (5s)
'QUERY_INTERFACE_TIMEOUT'  // queryInterface timeout (1s)
'INVALID_RESPONSE'         // Invalid response format
'RETRY_EXHAUSTED'          // All retry attempts failed
```

### Error Handling Pattern

```typescript
import { HttpConnection } from '@omnitron-dev/titan/netron/transport/http';
import { TitanError } from '@omnitron-dev/titan/errors';

const connection = new HttpConnection('http://localhost:3000');

try {
  const service = await connection.queryInterface('MyService@1.0.0');
  const result = await service.myMethod({ input: 'data' });

  console.log('Success:', result);

} catch (error) {
  if (error instanceof TitanError) {
    // Structured error from Titan
    console.error('Titan Error:', {
      code: error.code,
      message: error.message,
      category: error.category,
      httpStatus: error.httpStatus,
      details: error.details
    });

    // Handle specific errors
    switch (error.code) {
      case 404:
        console.error('Service not found');
        break;
      case 408:
        console.error('Request timeout');
        break;
      case 503:
        console.error('Service unavailable');
        // Retry with backoff
        break;
    }

  } else {
    // Generic error
    console.error('Unexpected error:', error);
  }
}
```

### Timeout Protection

The HTTP transport includes built-in timeout protection to prevent hanging:

```typescript
// Discovery timeout (5 seconds)
// Prevents infinite waiting for service discovery
const discovery = await connection.discoverServices(); // Max 5s

// queryInterface timeout (1 second max wait)
// Ensures quick fallback to minimal definitions
const service = await connection.queryInterface('Service'); // Max 1s wait for discovery

// Request timeout (configurable)
const connection = new HttpConnection('http://localhost:3000', {
  timeout: 10000 // 10 second timeout for all requests
});

// Per-request timeout override
const result = await client.invoke('Service', 'method', [input], {
  hints: {
    timeout: 5000 // Override to 5 seconds for this request
  }
});
```

## Best Practices

### 1. Use Type-Safe Clients

```typescript
// ✅ Good - Type-safe with TypedContract
const contract = new TypedContract<MyService>('http://localhost:3000', 'MyService@1.0.0');
const result = await contract.call('myMethod', { typed: 'input' });

// ❌ Avoid - Untyped dynamic calls
const result = await connection.queryInterface('MyService').myMethod({ untyped: 'input' });
```

### 2. Enable Caching for Read Operations

```typescript
// ✅ Good - Cache frequently read data
const cache = new HttpCacheManager({ defaultTTL: 60000 });
const getUser = cache.wrap(
  async (id) => client.invoke('Users', 'getUser', [{ id }]),
  { ttl: 300000, tags: ['users'] }
);

// Invalidate when data changes
await client.invoke('Users', 'updateUser', [userData]);
await cache.invalidateByTag('users');
```

### 3. Use Request Batching

```typescript
// ✅ Good - Batch multiple requests
const batcher = new RequestBatcher('http://localhost:3000', {
  maxBatchSize: 10,
  maxWaitTime: 50
});

const results = await Promise.all([
  batcher.add('Service', 'method1', input1),
  batcher.add('Service', 'method2', input2),
  batcher.add('Service', 'method3', input3)
]);

// ❌ Avoid - Individual requests
const result1 = await client.invoke('Service', 'method1', [input1]);
const result2 = await client.invoke('Service', 'method2', [input2]);
const result3 = await client.invoke('Service', 'method3', [input3]);
```

### 4. Handle Errors Gracefully

```typescript
// ✅ Good - Proper error handling
try {
  const result = await client.invoke('Service', 'method', [input]);
} catch (error) {
  if (error.code === 503) {
    // Service unavailable - retry with backoff
    await retry.execute(() => client.invoke('Service', 'method', [input]));
  } else if (error.code === 404) {
    // Service not found - use fallback
    return defaultValue;
  } else {
    // Unexpected error - log and rethrow
    logger.error('Unexpected error:', error);
    throw error;
  }
}

// ❌ Avoid - Swallowing errors
try {
  await client.invoke('Service', 'method', [input]);
} catch (error) {
  console.log('Error:', error); // Lost!
}
```

### 5. Use Optimistic Updates for UI

```typescript
// ✅ Good - Optimistic UI updates
const manager = new OptimisticUpdateManager();

// Update UI immediately, rollback on error
await manager.mutate(
  `item:${id}`,
  (current) => ({ ...current, status: 'updated' }),
  async () => client.invoke('Service', 'update', [{ id, status: 'updated' }])
);

// ❌ Avoid - Wait for server response
const result = await client.invoke('Service', 'update', [{ id, status: 'updated' }]);
// User waits for network round-trip
updateUI(result);
```

### 6. Set Appropriate Timeouts

```typescript
// ✅ Good - Different timeouts for different operations
const quickConnection = new HttpConnection('http://localhost:3000', {
  timeout: 5000 // 5s for fast operations
});

const slowConnection = new HttpConnection('http://localhost:3000', {
  timeout: 60000 // 60s for heavy operations
});

// ❌ Avoid - One timeout for everything
const connection = new HttpConnection('http://localhost:3000', {
  timeout: 30000 // May be too slow or too fast
});
```

### 7. Use Context for Distributed Tracing

```typescript
// ✅ Good - Pass context for tracing
const result = await client.invoke('Service', 'method', [input], {
  context: {
    traceId: currentTrace.id,
    spanId: currentSpan.id,
    userId: currentUser.id,
    tenantId: currentTenant.id
  }
});

// ❌ Avoid - No context
const result = await client.invoke('Service', 'method', [input]);
```

## Examples

### Complete Client Example

```typescript
import {
  HttpConnection,
  HttpCacheManager,
  RetryManager,
  RequestBatcher,
  OptimisticUpdateManager
} from '@omnitron-dev/titan/netron/transport/http';

// Setup managers
const cache = new HttpCacheManager({ defaultTTL: 60000 });
const retry = new RetryManager({ maxAttempts: 3 });
const batcher = new RequestBatcher('http://localhost:3000', {
  maxBatchSize: 10,
  maxWaitTime: 50
});
const optimistic = new OptimisticUpdateManager();

// Create connection
const connection = new HttpConnection('http://localhost:3000', {
  timeout: 10000,
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// Get service
const userService = await connection.queryInterface('UserService@1.0.0');

// Read operation with caching
const getUser = cache.wrap(
  async (id: string) => {
    return await retry.execute(() => userService.getUser({ id }));
  },
  { ttl: 300000, tags: ['users'] }
);

const user = await getUser('123');

// Write operation with optimistic update
await optimistic.mutate(
  'user:123',
  (current) => ({ ...current, name: 'New Name' }),
  async () => {
    await userService.updateUser({ id: '123', name: 'New Name' });
    await cache.invalidateByTag('users');
  }
);

// Batch operations
const results = await Promise.all([
  batcher.add('UserService@1.0.0', 'getUser', { id: '123' }),
  batcher.add('UserService@1.0.0', 'getUser', { id: '456' }),
  batcher.add('UserService@1.0.0', 'getUser', { id: '789' })
]);

// Cleanup
await batcher.flush();
await connection.close();
```

### Complete Server Example

```typescript
import { HttpServer } from '@omnitron-dev/titan/netron/transport/http';
import { LocalPeer } from '@omnitron-dev/titan/netron';
import { MiddlewareStage } from '@omnitron-dev/titan/netron/middleware';

// Create peer and register services
const peer = new LocalPeer();

peer.registerService({
  name: 'UserService',
  version: '1.0.0',
  methods: {
    async getUser(input: { id: string }) {
      const user = await db.users.findById(input.id);
      if (!user) {
        throw new Error('User not found');
      }
      return user;
    },

    async updateUser(input: { id: string; name: string }) {
      const user = await db.users.update(input.id, { name: input.name });
      return user;
    },

    async listUsers() {
      return await db.users.findAll();
    }
  }
});

// Create server
const server = new HttpServer({
  port: 3000,
  host: '0.0.0.0',
  cors: {
    enabled: true,
    origins: ['http://localhost:5173', 'https://app.example.com']
  },
  timeout: 30000,
  maxBodySize: 10 * 1024 * 1024 // 10MB
});

// Add authentication middleware
server.use(MiddlewareStage.PRE_INVOKE, async (context, next) => {
  const token = context.request.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    throw new Error('Unauthorized');
  }

  const user = await validateToken(token);
  context.metadata.user = user;

  return next(context);
});

// Add logging middleware
server.use(MiddlewareStage.POST_INVOKE, async (context, next) => {
  const duration = Date.now() - context.startTime;
  console.log(`${context.service}.${context.method} - ${duration}ms`);
  return next(context);
});

// Register peer
server.setPeer(peer);

// Start server
await server.listen();
console.log('Server running at http://localhost:3000');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await server.close();
  process.exit(0);
});
```

## Migration Guide

### From HTTP v1.x (Packet Protocol)

HTTP v2.0 uses native JSON messages instead of binary packet protocol:

**Before (v1.x):**
```typescript
// v1.x used packet serialization
const packet = {
  type: PacketType.REQUEST,
  requestId: '123',
  service: 'Calculator',
  method: 'add',
  data: Buffer.from(JSON.stringify({ a: 5, b: 3 }))
};
```

**After (v2.0):**
```typescript
// v2.0 uses native JSON
const request: HttpRequestMessage = {
  id: 'req-123',
  version: '2.0',
  timestamp: Date.now(),
  service: 'Calculator@1.0.0',
  method: 'add',
  input: { a: 5, b: 3 }
};
```

### From REST Endpoints

HTTP v2.0 does NOT support REST endpoint mapping. Use POST /netron/invoke:

**Before (Expected):**
```http
GET /netron/users/getUser/123
```

**After (Actual):**
```http
POST /netron/invoke
Content-Type: application/json

{
  "id": "req-123",
  "version": "2.0",
  "timestamp": 1735678900000,
  "service": "UserService@1.0.0",
  "method": "getUser",
  "input": { "id": "123" }
}
```

### Breaking Changes

1. **No REST endpoint mapping** - All invocations use POST /netron/invoke
2. **No @Route decorators** - Custom routes not supported
3. **No SSE streaming** - Real-time updates require WebSocket (not implemented)
4. **Service names include version** - "Calculator@1.0.0" instead of "Calculator"
5. **Message format changed** - Native JSON instead of binary packets

## See Also

- [Netron Core Documentation](../../README.md)
- [Transport Interface](../README.md)
- [WebSocket Transport](../websocket/README.md)
- [Middleware System](../../middleware/README.md)
- [Error Handling](../../../errors/README.md)

---

**Version:** 2.0.0
**Last Updated:** 2025-10-05
**Coverage:** 54.21% (363/367 tests passing)
**Status:** Production Ready ✅
