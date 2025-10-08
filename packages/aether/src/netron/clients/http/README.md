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
│  │  • GET  /netron/discovery  (service discovery)        │ │
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
    "features": ["batch", "discovery", "metrics", "health"],
    "metadata": {
      "runtime": "node",
      "uptime": 123456
    }
  },
  "services": {
    "Calculator@1.0.0": {
      "name": "Calculator",
      "version": "1.0.0",
      "methods": ["add", "subtract", "multiply", "divide"],
      "description": "Calculator service",
      "metadata": {}
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
  ],
  "hints": {
    "successCount": 2,
    "failureCount": 0,
    "totalTime": 45
  }
}
```

**Batch Options:**
```typescript
{
  parallel?: boolean;        // Process requests in parallel (default: true)
  stopOnError?: boolean;     // Stop on first error (default: false)
  maxConcurrency?: number;   // Max parallel requests
}
```

#### 4. Health Check

**Endpoint:** `GET /health`

**Response (Healthy):**
```json
{
  "status": "online",
  "uptime": 123456,
  "services": ["Calculator@1.0.0", "UserService@1.0.0"],
  "version": "2.0.0"
}
```

**Response (Unhealthy):**
```json
{
  "status": "offline",
  "uptime": 123456,
  "services": [],
  "version": "2.0.0"
}
```

**HTTP Status:**
- `200` - Server is healthy
- `503` - Server is unhealthy

#### 5. Metrics

**Endpoint:** `GET /metrics`

**Response:**
```json
{
  "server": {
    "status": "online",
    "uptime": 123456,
    "connections": 5
  },
  "requests": {
    "total": 1000,
    "active": 3,
    "errors": 5,
    "bytesSent": 500000,
    "bytesReceived": 300000,
    "avgResponseTime": 45
  },
  "methods": {
    "Calculator.add": 250,
    "Calculator.multiply": 150,
    "UserService.getUser": 600
  },
  "statusCodes": {
    "200": 950,
    "400": 30,
    "404": 15,
    "500": 5
  }
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
interface TransportOptions {
  // Network
  port?: number;                    // Server port (default: 3000)
  host?: string;                    // Server host (default: 'localhost')

  // CORS
  cors?: {
    enabled?: boolean;              // Enable CORS (default: false)
    origins?: string[];             // Allowed origins
    methods?: string[];             // Allowed HTTP methods
    headers?: string[];             // Allowed headers
    credentials?: boolean;          // Allow credentials
  };

  // Connection
  timeout?: number;                 // Request timeout in milliseconds
  connectTimeout?: number;          // Connection timeout

  // Compression
  compression?: boolean | {         // Enable response compression
    threshold?: number;             // Min size for compression (bytes)
  };

  // Headers
  headers?: Record<string, string>; // Custom headers for all requests/responses

  // Buffer configuration
  bufferSize?: number;              // Buffer size for data transfer

  // Keep-alive
  keepAlive?: {
    enabled?: boolean;              // Enable keep-alive
    interval?: number;              // Keep-alive interval (ms)
    timeout?: number;               // Keep-alive timeout (ms)
  };

  // Reconnection (client-side)
  reconnect?: {
    enabled?: boolean;              // Enable auto-reconnect
    maxAttempts?: number;           // Max reconnection attempts
    delay?: number;                 // Initial delay (ms)
    maxDelay?: number;              // Max delay (ms)
    factor?: number;                // Backoff multiplier
  };
}
```

**Note:** HttpServer accepts `TransportOptions` and uses built-in middleware for CORS and compression. Custom middleware cannot be added directly to the server - use Netron peer middleware instead.

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
import { z } from 'zod';
import { TypedContract } from '@omnitron-dev/titan/netron/transport/http';

// Define contract with Zod schemas
const calculatorContract = {
  add: {
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() })
  },
  multiply: {
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() })
  }
} as const;

// Create typed contract
const contract = new TypedContract(calculatorContract);

// Generate HTTP client
const client = contract.generateClient('http://localhost:3000', {
  serviceName: 'Calculator@1.0.0'
});

// Type-safe method calls with full inference
const sum = await client.call('add', { a: 5, b: 3 }).execute();
console.log(sum.result); // 8 - fully typed!

// Or use direct service proxy
const result = await client.service.add({ a: 5, b: 3 });

// Batch multiple calls
const results = await client.batch([
  { method: 'add', input: { a: 1, b: 2 } },
  { method: 'multiply', input: { a: 3, b: 4 } }
]);
```

## Advanced Features

### Cache Manager

Intelligent caching with TTL, tags, and stale-while-revalidate:

```typescript
import { HttpCacheManager } from '@omnitron-dev/titan/netron/transport/http';

const cache = new HttpCacheManager({
  maxEntries: 1000,        // Maximum cache entries
  maxSizeBytes: 10000000,  // Max cache size (10MB)
  defaultMaxAge: 60000,    // Default max age (60 seconds)
  debug: false             // Enable debug logging
});

// Get with automatic fetching and caching
const user = await cache.get(
  'user:123',
  async () => {
    // Fetcher function - called on cache miss
    return await fetchUserFromDB('123');
  },
  {
    maxAge: 300000,                // 5 minutes
    staleWhileRevalidate: 60000,   // Serve stale for 1 min while revalidating
    tags: ['users', 'user:123'],
    cacheOnError: true             // Return stale on error
  }
);

// Manual set
cache.set('user:123', userData, {
  maxAge: 300000,
  tags: ['users', 'user:123']
});

// Invalidate by tag
cache.invalidateByTag('users');

// Clear all cache
cache.clear();

// Get statistics
const stats = cache.getStats();
console.log(stats); // { hits, misses, revalidations }
```

### Retry Manager

Automatic retries with exponential backoff and circuit breaker:

```typescript
import { RetryManager } from '@omnitron-dev/titan/netron/transport/http';

const retry = new RetryManager({
  defaultOptions: {
    attempts: 3,           // Number of retry attempts
    backoff: 'exponential',
    initialDelay: 1000,    // 1 second
    maxDelay: 30000,       // 30 seconds max
    factor: 2,             // Exponential backoff multiplier
    jitter: 0.1            // Add 10% jitter
  },
  circuitBreaker: {
    threshold: 5,          // Open after 5 failures
    timeout: 60000,        // Reset after 60 seconds
    halfOpenAttempts: 3    // Test with 3 attempts
  },
  debug: false
});

// Execute with retry
const result = await retry.execute(
  async () => {
    return await client.invoke('Service', 'method', [input]);
  },
  {
    attempts: 3,
    backoff: 'exponential',
    initialDelay: 1000,
    maxDelay: 10000,
    shouldRetry: (error, attempt) => {
      // Custom retry logic
      return error.code !== 400 && attempt < 3;
    },
    onRetry: (attempt, error, delay) => {
      console.log(`Retry attempt ${attempt}: ${error.message} (delay: ${delay}ms)`);
    },
    attemptTimeout: 5000   // Timeout per attempt
  }
);

// Get retry statistics
const stats = retry.getStats();
console.log(stats); // { totalAttempts, successfulRetries, failedRetries }
```

### Request Batcher

Automatic batching for performance:

```typescript
import {
  RequestBatcher,
  createRequestMessage
} from '@omnitron-dev/titan/netron/transport/http';

const batcher = new RequestBatcher('http://localhost:3000', {
  maxBatchSize: 10,        // Max requests per batch
  maxBatchWait: 50,        // Max wait time (ms)
  maxRequestAge: 100,      // Max request age (ms)
  enableRetry: true,       // Enable retry on failure
  maxRetries: 2,           // Max retry attempts
  batchEndpoint: '/netron/batch',
  headers: {
    'Authorization': 'Bearer token'
  }
});

// Create request messages
const req1 = createRequestMessage('Service1', 'method1', { a: 1 });
const req2 = createRequestMessage('Service1', 'method2', { b: 2 });
const req3 = createRequestMessage('Service2', 'method3', { c: 3 });

// Add to batch queue
const promise1 = batcher.add(req1);
const promise2 = batcher.add(req2);
const promise3 = batcher.add(req3);

// All three sent in single batch request automatically
const [result1, result2, result3] = await Promise.all([
  promise1,
  promise2,
  promise3
]);

// Manual flush
await batcher.flush();

// Get statistics
const stats = batcher.getStats();
console.log(stats);
// { totalBatches, totalRequests, successfulRequests, failedRequests, averageBatchSize }

// Close batcher
await batcher.close();
```

### Optimistic Update Manager

Client-side mutations with automatic rollback on error:

```typescript
import { OptimisticUpdateManager } from '@omnitron-dev/titan/netron/transport/http';

const manager = new OptimisticUpdateManager(
  undefined,  // Optional cache provider
  {
    timeout: 30000,      // Default timeout
    retry: true,         // Enable retry
    maxRetries: 2,       // Max retry attempts
    retryDelay: 1000,    // Retry delay
    keepOnError: false   // Rollback on error
  }
);

// Optimistic update with automatic rollback on error
const userId = 'user-123';

const result = await manager.mutate(
  `user:${userId}`,  // Key

  // Mutation function
  async () => {
    return await client.invoke('Users', 'updateUser', [{
      id: userId,
      name: 'New Name'
    }]);
  },

  // Optimistic update function (optional)
  (currentData) => ({
    ...currentData,
    name: 'New Name'  // Immediate UI update
  }),

  // Per-mutation options
  {
    timeout: 5000,
    retry: true,
    maxRetries: 3,
    retryDelay: 1000,
    keepOnError: false,  // Rollback on error
    onCommit: (value) => {
      console.log('Update committed:', value);
    },
    onRollback: (error) => {
      console.error('Update rolled back:', error);
    }
  }
);

// Get current value (optimistic or committed)
const currentUser = manager.getValue(`user:${userId}`);

// Clear specific key
manager.clear(`user:${userId}`);

// Get statistics
const stats = manager.getStats();
console.log(stats);
// { totalUpdates, committedUpdates, rolledBackUpdates, averageCommitTime }
```

## Configuration

HttpServer and HttpConnection both accept `TransportOptions` (see [Server Configuration](#server-configuration) section for full interface).

Advanced features like caching, retries, and batching are configured separately through their respective managers:
- **HttpCacheManager** - Cache configuration
- **RetryManager** - Retry and circuit breaker configuration
- **RequestBatcher** - Batch configuration
- **OptimisticUpdateManager** - Optimistic update configuration

See [Advanced Features](#advanced-features) for complete configuration examples.

## Error Handling

### Error Codes

HTTP transport uses the `ErrorCode` enum with numeric HTTP status codes:

```typescript
import { ErrorCode } from '@omnitron-dev/titan/errors';

// Client errors (4xx)
ErrorCode.BAD_REQUEST              // 400 - Invalid request format
ErrorCode.UNAUTHORIZED             // 401 - Authentication required
ErrorCode.FORBIDDEN                // 403 - Insufficient permissions
ErrorCode.NOT_FOUND                // 404 - Service/method not found
ErrorCode.METHOD_NOT_ALLOWED       // 405 - HTTP method not allowed
ErrorCode.REQUEST_TIMEOUT          // 408 - Request timeout
ErrorCode.CONFLICT                 // 409 - Resource conflict
ErrorCode.PAYLOAD_TOO_LARGE        // 413 - Request body too large
ErrorCode.UNPROCESSABLE_ENTITY     // 422 - Validation error
ErrorCode.TOO_MANY_REQUESTS        // 429 - Rate limited

// Server errors (5xx)
ErrorCode.INTERNAL_SERVER_ERROR    // 500 - Internal server error
ErrorCode.NOT_IMPLEMENTED          // 501 - Feature not implemented
ErrorCode.BAD_GATEWAY              // 502 - Upstream error
ErrorCode.SERVICE_UNAVAILABLE      // 503 - Service temporarily unavailable
ErrorCode.GATEWAY_TIMEOUT          // 504 - Upstream timeout

// Custom codes (600+)
ErrorCode.MULTIPLE_ERRORS          // 600 - Multiple errors occurred
ErrorCode.UNKNOWN_ERROR            // 601 - Unknown error
```

**Note:** Error codes are **numeric values**, not strings. The response `error.code` field contains the numeric code (e.g., `404`, not `"NOT_FOUND"`).

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
const contract = new TypedContract(myContractDefinition);
const client = contract.generateClient('http://localhost:3000', {
  serviceName: 'MyService@1.0.0'
});
const result = await client.call('myMethod', { typed: 'input' }).execute();

// ❌ Avoid - Untyped dynamic calls
const service = await connection.queryInterface('MyService');
const result = await service.myMethod({ untyped: 'input' });
```

### 2. Enable Caching for Read Operations

```typescript
// ✅ Good - Cache frequently read data
const cache = new HttpCacheManager({
  maxEntries: 1000,
  defaultMaxAge: 60000
});

const getUser = async (id: string) => {
  return cache.get(
    `user:${id}`,
    async () => client.invoke('Users', 'getUser', [{ id }]),
    { maxAge: 300000, tags: ['users'] }
  );
};

// Invalidate when data changes
await client.invoke('Users', 'updateUser', [userData]);
cache.invalidateByTag('users');
```

### 3. Use Request Batching

```typescript
import { RequestBatcher, createRequestMessage } from '@omnitron-dev/titan/netron/transport/http';

// ✅ Good - Batch multiple requests
const batcher = new RequestBatcher('http://localhost:3000', {
  maxBatchSize: 10,
  maxBatchWait: 50
});

const req1 = createRequestMessage('Service', 'method1', input1);
const req2 = createRequestMessage('Service', 'method2', input2);
const req3 = createRequestMessage('Service', 'method3', input3);

const results = await Promise.all([
  batcher.add(req1),
  batcher.add(req2),
  batcher.add(req3)
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
  async () => client.invoke('Service', 'update', [{ id, status: 'updated' }]),
  (current) => ({ ...current, status: 'updated' })
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
  OptimisticUpdateManager,
  createRequestMessage
} from '@omnitron-dev/titan/netron/transport/http';

// Setup managers
const cache = new HttpCacheManager({
  maxEntries: 1000,
  defaultMaxAge: 60000
});

const retry = new RetryManager({
  defaultOptions: {
    attempts: 3,
    backoff: 'exponential'
  }
});

const batcher = new RequestBatcher('http://localhost:3000', {
  maxBatchSize: 10,
  maxBatchWait: 50
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

// Read operation with caching and retry
const getUser = async (id: string) => {
  return cache.get(
    `user:${id}`,
    async () => {
      return retry.execute(
        async () => userService.getUser({ id }),
        { attempts: 3 }
      );
    },
    { maxAge: 300000, tags: ['users'] }
  );
};

const user = await getUser('123');

// Write operation with optimistic update
await optimistic.mutate(
  'user:123',
  async () => {
    await userService.updateUser({ id: '123', name: 'New Name' });
    cache.invalidateByTag('users');
  },
  (current) => ({ ...current, name: 'New Name' })
);

// Batch operations
const req1 = createRequestMessage('UserService@1.0.0', 'getUser', { id: '123' });
const req2 = createRequestMessage('UserService@1.0.0', 'getUser', { id: '456' });
const req3 = createRequestMessage('UserService@1.0.0', 'getUser', { id: '789' });

const results = await Promise.all([
  batcher.add(req1),
  batcher.add(req2),
  batcher.add(req3)
]);

// Cleanup
await batcher.flush();
await batcher.close();
await connection.close();
```

### Complete Server Example

```typescript
import { HttpServer } from '@omnitron-dev/titan/netron/transport/http';
import { LocalPeer } from '@omnitron-dev/titan/netron';

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

// Create server with CORS and compression
const server = new HttpServer({
  port: 3000,
  host: '0.0.0.0',
  cors: {
    enabled: true,
    origins: ['http://localhost:5173', 'https://app.example.com'],
    credentials: true
  },
  compression: {
    threshold: 1024  // Compress responses > 1KB
  },
  timeout: 30000,
  headers: {
    'X-Powered-By': 'Netron HTTP Transport'
  }
});

// Register peer with server
server.setPeer(peer);

// Start server
await server.listen();
console.log('Server running at http://0.0.0.0:3000');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
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

## Advanced API

For advanced use cases, HTTP transport provides additional features:

### HttpInterface (Fluent API)

```typescript
import { HttpInterface } from '@omnitron-dev/titan/netron/transport/http';

const interface = new HttpInterface(transport, definition);

// Chainable query builder
const result = await interface
  .method('getUser')
  .input({ id: '123' })
  .cache({ maxAge: 60000, tags: ['users'] })
  .retry({ attempts: 3 })
  .transform(data => ({ ...data, cached: true }))
  .execute();
```

### TypedHttpServer (OpenAPI Generation)

```typescript
import { TypedHttpServer } from '@omnitron-dev/titan/netron/transport/http';

const server = new TypedHttpServer({
  port: 3000,
  openapi: {
    title: 'My API',
    version: '1.0.0',
    description: 'Auto-generated OpenAPI from contracts'
  }
});

server.registerService({
  name: 'UserService',
  contract: userServiceContract,
  implementation: userServiceImpl
});

// OpenAPI spec available at /openapi.json
await server.listen();
```

## See Also

- [Netron Core Documentation](../../README.md)
- [Transport Interface](../README.md)
- [WebSocket Transport](../websocket/README.md)
- [Middleware System](../../middleware/README.md)
- [Error Handling](../../../errors/README.md)
- [Validation & Contracts](../../../validation/README.md)

---

**Version:** 2.0.0
**Last Updated:** 2025-10-05
**Coverage:** 54.21% (363/367 tests passing)
**Status:** Production Ready ✅
