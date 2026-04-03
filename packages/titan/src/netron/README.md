# Netron RPC Framework

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Core Concepts](#core-concepts)
  - [Services](#services)
  - [Peers](#peers)
  - [Interfaces](#interfaces)
  - [Tasks](#tasks)
  - [Streams](#streams)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [Netron Class](#netron-class)
  - [Service Decorators](#service-decorators)
  - [Peer Types](#peer-types)
  - [Transport Layer](#transport-layer)
  - [Middleware System](#middleware-system)
- [Advanced Topics](#advanced-topics)
  - [Service Discovery](#service-discovery)
  - [Load Balancing](#load-balancing)
  - [Error Handling](#error-handling)
  - [Security](#security)
- [Configuration](#configuration)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

## Overview

Netron is a powerful, transport-agnostic RPC (Remote Procedure Call) framework for building distributed TypeScript applications. It provides seamless communication between services with automatic serialization, type safety, and support for multiple transport protocols.

### Design Philosophy

- **Unified API**: Common `queryInterface()` pattern across all transports
- **Transport-Aware**: Binary transports (WS/TCP/Unix) use packets; HTTP uses native JSON
- **Type Safe**: Full TypeScript support with compile-time type checking
- **Streaming Support**: Native streaming for binary transports; SSE/chunked for HTTP
- **Pluggable**: Extensible through middleware and custom transports
- **Performance**: MessagePack for binary transports; optimized JSON for HTTP

## Key Features

- 🌐 **Multiple Transports**: WebSocket, HTTP, TCP, Unix domain sockets
- 🔒 **Type Safety**: Strong typing for RPC calls and responses
- 🌊 **Streaming**: Bidirectional streaming with async iterables (binary transports)
- 🔄 **Auto-Reconnection**: Built-in connection recovery (TCP, Unix)
- 📡 **Service Discovery**: Runtime service introspection via `queryInterface()`
- 🎭 **Middleware**: Multi-stage request/response interception
- 📦 **Dual Protocol**: Binary MessagePack (WS/TCP/Unix) or Native JSON (HTTP v1.0)
- 🔍 **HTTP Features**: CacheManager, RetryManager, RequestBatcher, RateLimiter
- 🔐 **Security**: Authentication, Authorization, ACLs, Policy Engine
- 🚀 **High Performance**: Optimized for low latency and high throughput

## Architecture

Netron supports two fundamentally different communication paths: **Binary Protocol** for persistent connections (WebSocket, TCP, Unix) and **Native HTTP JSON Protocol** for stateless request-response communication.

### Architecture Diagram

```mermaid
graph TB
    subgraph "Client Application"
        C1[Client Code]
        C2[Service Interface Proxy]
    end

    subgraph "Binary Path - Persistent Connections"
        BP1[RemotePeer]
        BP2[Netron Core]
        BP3[Task Manager]
        BP4[Packet System]
        BP5[MessagePack Serializer]
        subgraph "Binary Transports"
            BT1[WebSocket]
            BT2[TCP]
            BT3[Unix Socket]
        end
    end

    subgraph "HTTP Path - Stateless Request/Response"
        HP1[HttpRemotePeer]
        HP2[HttpTransportClient]
        HP3[Fluent Interface]
        subgraph "HTTP Features"
            HF1[CacheManager]
            HF2[RetryManager]
            HF3[RequestBatcher]
        end
        subgraph "HTTP Protocol v1.0"
            HM1[JSON Messages]
            HM2["POST /netron/invoke"]
            HM3["GET /netron/discovery"]
            HM4["POST /netron/batch"]
        end
        HT1[HTTP/HTTPS]
    end

    subgraph "Server Application"
        subgraph "Binary Server"
            BS1[LocalPeer]
            BS2[Service Stub]
            BS3[Packet Handler]
        end
        subgraph "HTTP Server"
            HS1[HttpServer]
            HS2[Service Resolver]
            HS3[Rate Limiter]
            HS4[SSE Streaming]
        end
        S1[Service Implementation]
        S2[Service Registry]
    end

    %% Client to Binary Path
    C1 --> C2
    C2 --> BP1
    BP1 --> BP2
    BP2 --> BP3
    BP3 --> BP4
    BP4 --> BP5
    BP5 --> BT1
    BP5 --> BT2
    BP5 --> BT3

    %% Client to HTTP Path
    C2 --> HP1
    HP1 --> HP2
    HP2 --> HP3
    HP3 --> HF1
    HP3 --> HF2
    HP3 --> HF3
    HP2 --> HM1
    HM1 --> HM2
    HM1 --> HM3
    HM1 --> HM4
    HM1 --> HT1

    %% Binary Transports to Server
    BT1 --> BS3
    BT2 --> BS3
    BT3 --> BS3
    BS3 --> BS1
    BS1 --> BS2

    %% HTTP Transport to Server
    HT1 --> HS1
    HS1 --> HS2
    HS1 --> HS3
    HS1 --> HS4

    %% Server to Services
    BS2 --> S1
    HS2 --> S1
    BS1 --> S2
    HS1 --> S2

    style HP1 fill:#e1f5fe
    style HP2 fill:#e1f5fe
    style HT1 fill:#e1f5fe
    style HS1 fill:#e1f5fe
    style HM1 fill:#fff3e0
    style BP4 fill:#f3e5f5
    style BP5 fill:#f3e5f5
```

### Transport Comparison

| Feature | Binary (WS/TCP/Unix) | HTTP |
|---------|---------------------|------|
| **Connection** | Persistent | Stateless (per-request) |
| **Protocol** | Binary Packets + MessagePack | Native JSON (v1.0) |
| **Bidirectional** | ✅ Yes | ❌ No (request-response) |
| **True Streaming** | ✅ NetronReadableStream/WritableStream | ⚠️ SSE/Chunked (pseudo-streaming) |
| **Auto-Reconnection** | ✅ TCP/Unix (configurable) | ❌ Stateless |
| **Remote Peer Class** | `RemotePeer` | `HttpRemotePeer` |
| **Property Get/Set** | ✅ Supported | ❌ Not supported (stateless) |
| **Built-in Caching** | ❌ | ✅ HttpCacheManager |
| **Request Batching** | ❌ | ✅ RequestBatcher |
| **Rate Limiting** | Via middleware | ✅ Built-in SlidingWindowRateLimiter |
| **Retry Logic** | Manual | ✅ RetryManager with circuit breaker |

### HTTP Protocol v1.0 Message Format

HTTP transport uses native JSON messages instead of binary packets:

```typescript
// Request Message
interface HttpRequestMessage {
  id: string;              // Unique request ID for correlation
  version: '1.0';          // Protocol version
  timestamp: number;       // Client timestamp
  service: string;         // Service name (e.g., 'calculator@1.0.0')
  method: string;          // Method name
  input: any;              // Method arguments
  context?: {              // Optional distributed tracing
    traceId?: string;
    spanId?: string;
    userId?: string;
    tenantId?: string;
  };
  hints?: {                // Client optimization hints
    cache?: { maxAge?, staleWhileRevalidate?, tags? };
    retry?: { attempts?, backoff?, maxDelay? };
    priority?: 'high' | 'normal' | 'low';
    timeout?: number;
  };
}

// Response Message
interface HttpResponseMessage {
  id: string;              // Matching request ID
  version: '1.0';          // Protocol version
  timestamp: number;       // Server timestamp
  success: boolean;        // Operation result
  data?: any;              // Success result
  error?: {                // Error information
    code: string;
    message: string;
    details?: any;
  };
  hints?: {                // Server optimization hints
    cache?: { etag?, maxAge?, tags? };
    metrics?: { serverTime?, dbQueries?, cacheHit? };
    rateLimit?: { remaining?, limit?, resetAt? };
  };
}
```

### Important Notes

⚠️ **HTTP Transport Differences**:
- HTTP transport does **NOT** use the Packet System or MessagePack serialization
- `HttpRemotePeer.get()` and `HttpRemotePeer.set()` throw `NotImplemented` errors (HTTP is stateless)
- Async generators are collected into arrays (max 10,000 items by default) rather than true streaming
- SSE (Server-Sent Events) provides pseudo-streaming for responses only

## Core Concepts

### Services

Services are TypeScript classes decorated with `@Service` that expose methods for remote invocation:

```typescript
import { Service, Public } from '@omnitron-dev/titan/netron';

@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    return a * b;
  }

  @Public()
  async *fibonacci(n: number): AsyncGenerator<number> {
    let [a, b] = [0, 1];
    for (let i = 0; i < n; i++) {
      yield a;
      [a, b] = [b, a + b];
    }
  }
}
```

### Peers

Peers represent nodes in the distributed system:

- **LocalPeer**: Represents the local node, exposes services
- **RemotePeer**: Represents a remote node, consumes services
- **HttpRemotePeer**: Special peer for HTTP-based communication

### Interfaces

Interfaces provide type-safe proxies to remote services:

```typescript
// Server exposes service
const calculator = new CalculatorService();
await netron.peer.expose(calculator);

// Client consumes service
const calc = await remotePeer.getInterface<CalculatorService>('calculator@1.0.0');
const result = await calc.add(10, 20); // Type-safe RPC call
```

### Tasks

Tasks represent asynchronous RPC operations with tracking:

```typescript
// Tasks are automatically created for RPC calls
const task = netron.peer.createTask('call', {
  service: 'calculator@1.0.0',
  method: 'add',
  args: [10, 20]
});

// Track task status
task.on('complete', (result) => {
  console.log('Result:', result);
});

task.on('error', (error) => {
  console.error('Task failed:', error);
});
```

### Streams

Native support for streaming data with async iterables:

```typescript
// Server-side streaming
@Public()
async *streamData(count: number): AsyncGenerator<Data> {
  for (let i = 0; i < count; i++) {
    yield { id: i, timestamp: Date.now() };
    await delay(100);
  }
}

// Client-side consumption
const stream = await service.streamData(100);
for await (const data of stream) {
  console.log('Received:', data);
}
```

## Quick Start

### Installation

```bash
npm install @omnitron-dev/titan
```

### Server Setup

```typescript
import { Netron, WebSocketTransport } from '@omnitron-dev/titan/netron';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { logger } from '@omnitron-dev/titan/module/logger';

// Define a service
@Service('greeting@1.0.0')
class GreetingService {
  @Public()
  async hello(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }
}

// Create Netron instance
const netron = new Netron(logger, { id: 'greeting-server' });

// Register transport
netron.registerTransport('ws', () => new WebSocketTransport());

// Register transport server
netron.registerTransportServer('ws', {
  name: 'ws',
  options: { host: 'localhost', port: 8080 }
});

// Expose service
const service = new GreetingService();
await netron.expose(service);

// Start server
await netron.start();
console.log('Server listening on ws://localhost:8080');
```

### Client Setup

```typescript
import { Netron, WebSocketTransport } from '@omnitron-dev/titan/netron';
import { logger } from '@omnitron-dev/titan/module/logger';

// Create Netron instance
const netron = new Netron(logger, { id: 'greeting-client' });

// Register transport
netron.registerTransport('ws', () => new WebSocketTransport());

// Start client (no server)
await netron.start();

// Connect to server
const peer = await netron.connect('ws://localhost:8080');

// Get service interface (type-safe)
const greeting = await peer.queryInterface<GreetingService>('greeting@1.0.0');

// Make RPC call
const message = await greeting.hello('World');
console.log(message); // "Hello, World!"
```

## API Reference

### Netron Class

The main class for managing distributed communication:

```typescript
class Netron extends EventEmitter {
  constructor(logger: ILogger, options?: NetronOptions);

  // Properties
  id: string;                    // Unique instance ID
  peer: LocalPeer;               // Local peer instance
  peers: Map<string, RemotePeer>; // Connected remote peers
  services: Map<string, ServiceStub>; // Exposed services
  transportServers: Map<string, ITransportServer>;  // Transport servers map
  taskManager: TaskManager;      // Task execution orchestrator
  connectionManager: ConnectionManager; // Connection pooling & health

  // Transport management
  registerTransport(name: string, factory: () => ITransport): void;
  registerTransportServer(name: string, config: TransportServerConfig): void;
  setTransportOptions(name: string, options: TransportOptions): void;

  // Lifecycle
  start(): Promise<void>;        // Start all transport servers
  stop(): Promise<void>;         // Gracefully shutdown

  // Connection management
  connect(address: string, reconnect?: boolean): Promise<RemotePeer>;
  disconnect(peerId: string): Promise<void>;

  // Service management
  expose(service: object): Promise<void>;
  unexpose(serviceName: string): Promise<void>;
  getServiceNames(): string[];

  // Task management
  addTask(fn: Task): void;
  runTask(peer: RemotePeer, name: string, ...args: any[]): Promise<any>;

  // Event handling
  on(event: 'peer:connect', handler: (peerId: string) => void): this;
  on(event: 'peer:disconnect', handler: (peerId: string) => void): this;
  on(event: 'service:expose', handler: (name: string) => void): this;
  on(event: 'service:unexpose', handler: (name: string) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
}
```

#### NetronOptions

```typescript
interface NetronOptions {
  // Server options
  transport?: 'websocket' | 'http' | 'tcp' | 'unix';
  listenHost?: string;
  listenPort?: number;
  listenPath?: string;  // For Unix sockets

  // Discovery options
  discoveryEnabled?: boolean;
  discoveryRedisUrl?: string;
  discoveryInterval?: number;
  discoveryTTL?: number;

  // Connection options
  reconnect?: boolean;
  reconnectDelay?: number;
  reconnectMaxAttempts?: number;
  connectTimeout?: number;

  // Protocol options
  compression?: boolean;
  maxPacketSize?: number;

  // Security
  auth?: {
    type: 'token' | 'certificate';
    credentials: any;
  };
}
```

### Service Decorators

Decorators for defining services and methods:

```typescript
// Mark class as a service
@Service(name: string, options?: ServiceOptions)

// Mark method as public (callable via RPC)
@Public(options?: MethodOptions)
```

#### ServiceOptions

```typescript
interface ServiceOptions {
  version?: string;        // Service version
  description?: string;    // Service description
  tags?: string[];        // Service tags for discovery
  timeout?: number;       // Default timeout for all methods
  middleware?: Middleware[]; // Service-level middleware
}
```

### Peer Types

#### LocalPeer

Represents the local node:

```typescript
class LocalPeer extends AbstractPeer {
  // Service management
  expose(service: object, name?: string): Promise<void>;
  unexpose(service: object | string): Promise<void>;
  getExposedServices(): ServiceInfo[];

  // Event subscription
  subscribe(event: string, handler: Function): void;
  unsubscribe(event: string, handler?: Function): void;
  emit(event: string, data: any): void;

  // Direct method calls (local)
  call(service: string, method: string, args: any[]): Promise<any>;
  get(service: string, property: string): Promise<any>;
  set(service: string, property: string, value: any): Promise<void>;
}
```

#### RemotePeer

Represents a remote node:

```typescript
class RemotePeer extends AbstractPeer {
  // Connection info
  readonly id: string;
  readonly netron: Netron;
  readonly socket: ITransportConnection;

  // Cached definitions (LRU with 5 minute TTL)
  readonly definitions: Map<string, Definition>;
  readonly services: Map<string, Definition>;

  // Stream management
  readonly writableStreams: Map<number, NetronWritableStream>;
  readonly readableStreams: Map<number, NetronReadableStream>;

  // Service discovery
  queryInterface<T>(serviceName: string): Promise<T>;  // Get typed service proxy
  queryInterfaceRemote(serviceName: string): Promise<Definition>;  // Query definition
  releaseInterface<T>(instance: T): void;  // Release interface reference
  invalidateDefinitionCache(pattern?: string): number;  // Clear cached definitions
  getDefinitionCacheStats(): { size: number; hitRate: number };

  // Remote calls
  call(defId: string, method: string, args: any[]): Promise<any>;
  get(defId: string, name: string): Promise<any>;
  set(defId: string, name: string, value: any): Promise<void>;

  // Event subscription
  subscribe(eventName: string, handler: Function): void;
  unsubscribe(eventName: string, handler: Function): void;

  // Task execution
  runTask(name: string, ...args: any[]): Promise<any>;

  // Connection
  init(isConnector: boolean, options?: TransportOptions): Promise<void>;
}
```

**Definition Caching:**
- Default max: 500 definitions
- Default TTL: 5 minutes
- Automatic cleanup every 1 minute
- Supports wildcard pattern invalidation

### Transport Layer

For detailed transport documentation, see [Transport Documentation](./transport/README.md).

Supported transports:

- **WebSocket**: Full-duplex, real-time communication
- **HTTP**: Request-response pattern, REST-compatible
- **TCP**: Raw TCP sockets for high performance
- **Unix**: Unix domain sockets for local IPC

### Middleware System

For detailed middleware documentation, see [Middleware Documentation](./middleware/README.md).

Middleware allows intercepting and modifying requests/responses:

```typescript
// Global middleware
netron.use((ctx, next) => {
  console.log(`Calling ${ctx.service}.${ctx.method}`);
  return next();
});

// Service-specific middleware
netron.useForService('calculator@1.0.0', authMiddleware);

// Method-specific middleware
netron.useForMethod('calculator@1.0.0', 'multiply', rateLimitMiddleware);
```

## Connection Management

### Connection Pooling

The `ConnectionManager` provides connection pooling and health monitoring:

```typescript
const netron = new Netron(logger, {
  // Connection pool settings
  maxConnectionsPerPeer: 10,      // Max connections per peer
  maxTotalConnections: 100,       // Global max connections
  connectionPoolSize: 3,          // Pool size per peer
  idleConnectionTimeout: 30000,   // Idle timeout (30s)

  // Health check settings
  healthCheckInterval: 15000,     // Check every 15s
  maxMissedHeartbeats: 3,         // Max missed before unhealthy
  heartbeatTimeout: 5000,         // Heartbeat timeout
  connectionCleanupInterval: 10000 // Cleanup every 10s
});
```

### Reconnection Strategy

Automatic reconnection with exponential backoff and jitter:

```typescript
const peer = await netron.connect('ws://server:8080', true); // Enable reconnection

// Reconnection strategy:
// Attempt 1: 1s delay (+ ±30% jitter)
// Attempt 2: 2s delay
// Attempt 3: 4s delay
// Attempt 4: 8s delay
// ... exponential up to 30s cap

// Handle reconnection events
netron.on('peer:connect', (peerId) => {
  console.log('Peer connected:', peerId);
});

netron.on('peer:disconnect', (peerId) => {
  console.log('Peer disconnected, will reconnect:', peerId);
});
```

### Interface Lifecycle

Manage service interface references:

```typescript
// Acquire interface
const calc = await peer.queryInterface<CalculatorService>('calculator@1.0.0');

// Use the interface
const result = await calc.add(10, 20);

// Release when done (decrements reference count)
await peer.releaseInterface(calc);

// Clear definition cache (useful after service updates)
const invalidated = peer.invalidateDefinitionCache('calculator@*');
console.log(`Invalidated ${invalidated} cached definitions`);

// Check cache performance
const stats = peer.getDefinitionCacheStats();
console.log(`Cache hit rate: ${stats.hitRate * 100}%`);
```

## Advanced Topics

### Service Discovery

Redis-based service discovery for dynamic environments:

```typescript
const netron = new Netron({
  discoveryEnabled: true,
  discoveryRedisUrl: 'redis://localhost:6379',
  discoveryInterval: 5000,  // Heartbeat interval
  discoveryTTL: 15000       // Service TTL
});

// Services are automatically registered
await netron.peer.expose(service);

// Discover services
const services = await netron.discoverServices('calculator@*');
```

### Load Balancing

Client-side load balancing strategies:

```typescript
// Round-robin
const pool = new PeerPool(peers, 'round-robin');

// Least connections
const pool = new PeerPool(peers, 'least-connections');

// Random
const pool = new PeerPool(peers, 'random');

// Custom strategy
const pool = new PeerPool(peers, (peers) => {
  // Custom selection logic
  return peers[0];
});
```

### Error Handling

Comprehensive error handling with typed errors:

```typescript
import { NetronError, TimeoutError, ServiceNotFoundError } from '@omnitron-dev/titan/netron';

try {
  const result = await service.method();
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error('Request timed out');
  } else if (error instanceof ServiceNotFoundError) {
    console.error('Service not available');
  } else if (error instanceof NetronError) {
    console.error('Netron error:', error.code, error.message);
  }
}
```

### Security

Built-in security features:

```typescript
// Token-based authentication
const netron = new Netron({
  auth: {
    type: 'token',
    credentials: {
      token: process.env.AUTH_TOKEN
    }
  }
});

// Certificate-based authentication
const netron = new Netron({
  auth: {
    type: 'certificate',
    credentials: {
      cert: fs.readFileSync('client.crt'),
      key: fs.readFileSync('client.key'),
      ca: fs.readFileSync('ca.crt')
    }
  }
});

// Method-level authorization
@Service('secure@1.0.0')
class SecureService {
  @Public()
  @Authorize('admin')
  async deleteUser(id: string): Promise<void> {
    // Only admins can call this
  }
}
```

## Configuration

### Environment Variables

```bash
# Server configuration
NETRON_HOST=0.0.0.0
NETRON_PORT=8080
NETRON_TRANSPORT=websocket

# Discovery
NETRON_DISCOVERY_ENABLED=true
NETRON_DISCOVERY_REDIS=redis://localhost:6379

# Security
NETRON_AUTH_TOKEN=secret-token
NETRON_TLS_ENABLED=true
NETRON_TLS_CERT=./server.crt
NETRON_TLS_KEY=./server.key
```

### Configuration File

```typescript
// netron.config.ts
export default {
  transport: 'websocket',
  server: {
    host: '0.0.0.0',
    port: 8080
  },
  discovery: {
    enabled: true,
    redis: {
      host: 'localhost',
      port: 6379
    }
  },
  security: {
    tls: {
      enabled: true,
      cert: './certs/server.crt',
      key: './certs/server.key'
    }
  },
  middleware: [
    loggingMiddleware,
    authMiddleware,
    rateLimitMiddleware
  ]
};
```

## Examples

### Microservice Communication

```typescript
// User Service
@Service('users@1.0.0')
class UserService {
  @Public()
  async getUser(id: string): Promise<User> {
    return db.users.findById(id);
  }
}

// Order Service
@Service('orders@1.0.0')
class OrderService {
  constructor(
    private users: UserServiceInterface
  ) {}

  @Public()
  async getOrderWithUser(orderId: string): Promise<OrderWithUser> {
    const order = await db.orders.findById(orderId);
    const user = await this.users.getUser(order.userId);
    return { ...order, user };
  }
}
```

### Real-time Updates

```typescript
// Server: Stream updates
@Service('updates@1.0.0')
class UpdateService {
  @Public()
  async *subscribe(topic: string): AsyncGenerator<Update> {
    const subscription = pubsub.subscribe(topic);
    try {
      for await (const message of subscription) {
        yield message;
      }
    } finally {
      subscription.unsubscribe();
    }
  }
}

// Client: Consume updates
const updates = await updateService.subscribe('user-events');
for await (const update of updates) {
  console.log('Update received:', update);
  updateUI(update);
}
```

### File Transfer

```typescript
// Server: Stream file chunks
@Service('files@1.0.0')
class FileService {
  @Public()
  async *download(path: string): AsyncGenerator<Buffer> {
    const stream = fs.createReadStream(path);
    for await (const chunk of stream) {
      yield chunk;
    }
  }

  @Public()
  async upload(filename: string, chunks: AsyncIterable<Buffer>): Promise<void> {
    const stream = fs.createWriteStream(filename);
    for await (const chunk of chunks) {
      stream.write(chunk);
    }
    stream.end();
  }
}
```

## Best Practices

### 1. Service Versioning

Always version your services to ensure compatibility:

```typescript
@Service('api@2.0.0')  // Semantic versioning
class ApiServiceV2 {
  // Breaking changes from v1
}
```

### 2. Error Handling

Implement proper error handling at all levels:

```typescript
@Service('resilient@1.0.0')
class ResilientService {
  @Public()
  async riskyOperation(): Promise<Result> {
    try {
      return await externalApi.call();
    } catch (error) {
      // Log error
      logger.error('Operation failed', error);

      // Transform to Netron error
      throw new NetronError('EXTERNAL_API_ERROR', 'External API failed', error);
    }
  }
}
```

### 3. Connection Management

Use connection pools for better performance:

```typescript
class ServiceClient {
  private pool: PeerPool;

  constructor() {
    this.pool = new PeerPool({
      min: 2,
      max: 10,
      idleTimeout: 30000
    });
  }

  async call(method: string, ...args: any[]) {
    const peer = await this.pool.acquire();
    try {
      return await peer.call('service', method, args);
    } finally {
      this.pool.release(peer);
    }
  }
}
```

### 4. Monitoring

Implement comprehensive monitoring:

```typescript
netron.on('task:start', (task) => {
  metrics.increment('rpc.calls.started');
});

netron.on('task:complete', (task) => {
  metrics.increment('rpc.calls.completed');
  metrics.histogram('rpc.duration', task.duration);
});

netron.on('task:error', (task, error) => {
  metrics.increment('rpc.calls.failed');
  alerting.notify('RPC call failed', error);
});
```

### 5. Testing

Write comprehensive tests for services:

```typescript
describe('CalculatorService', () => {
  let netron: Netron;
  let service: CalculatorService;

  beforeEach(async () => {
    netron = new Netron({ transport: 'memory' });
    service = new CalculatorService();
    await netron.peer.expose(service);
  });

  it('should add numbers correctly', async () => {
    const calc = await netron.peer.getInterface<CalculatorService>('calculator@1.0.0');
    const result = await calc.add(2, 3);
    expect(result).toBe(5);
  });
});
```

## Related Documentation

### Core Documentation

- 📚 [Transport Layer Documentation](./transport/README.md) - Comprehensive transport implementation guide
  - Pluggable transport architecture with WebSocket, HTTP, TCP, Unix socket implementations
  - Creating custom transports with step-by-step examples
  - Connection management, pooling, and state transitions
  - Performance comparison and optimization strategies

- 🔌 [HTTP Transport Guide](./transport/http/README.md) - HTTP-specific features and configuration
  - REST API mapping with automatic route generation
  - Server-Sent Events (SSE) for real-time streaming
  - CORS, compression, and security configuration
  - Request/response handling with content negotiation

- 🚀 [HTTP Interface & Retry Manager Guide](./transport/http/HTTP-INTERFACE-GUIDE.md) - **Intelligent Client Features**
  - **RetryManager**: Exponential backoff, circuit breaker, jitter, custom retry logic
  - **HttpInterface**: Fluent API for queries, caching, retries, transformations
  - **TanStack Query-like** capabilities with type-safe builder pattern
  - Complete integration examples and best practices

- 🎯 [Middleware System](./middleware/README.md) - Request/response interception and modification
  - Multi-stage pipeline architecture (PRE_PROCESS, PRE_INVOKE, POST_INVOKE, POST_PROCESS, ERROR)
  - Built-in middleware: authentication, rate limiting, caching, validation
  - Creating custom middleware with examples
  - Transport-specific middleware adapters

- 🔐 [Authentication & Authorization](./auth/README.md) - Security features
  - AuthenticationManager with token validation and caching
  - AuthorizationManager with ACL-based access control
  - PolicyEngine for RBAC, ABAC, PBAC patterns
  - RateLimiter, SessionManager, and AuditLogger
  - 21 built-in authorization policies

- 📦 [Packet Protocol](./packet/README.md) - Binary protocol specification
  - Detailed packet structure with header and payload formats
  - MessagePack serialization with custom type extensions
  - Streaming protocol implementation
  - Error handling and recovery mechanisms

- 🌊 [Streams](./streams/README.md) - Stream-based communication
  - NetronReadableStream and NetronWritableStream classes
  - Ordered delivery with reordering buffer
  - Backpressure handling and flow control
  - Live vs batch streaming modes

- 🔧 [Core Tasks](./core-tasks/README.md) - Fundamental Netron operations
  - Authentication and service discovery tasks
  - Service lifecycle management (expose/unexpose)
  - Event system implementation (subscribe/emit)
  - Cache invalidation and reference management

## Performance Characteristics

### Latency

- **Local calls**: < 0.1ms
- **WebSocket RPC**: 1-5ms (LAN)
- **HTTP RPC**: 5-20ms (LAN)
- **TCP RPC**: 0.5-2ms (LAN)

### Throughput

- **Small messages** (< 1KB): 10,000+ msg/sec
- **Medium messages** (1-10KB): 5,000+ msg/sec
- **Large messages** (> 100KB): 500+ msg/sec
- **Streaming**: Limited by network bandwidth

### Memory Usage

- **Base overhead**: ~10MB per Netron instance
- **Per connection**: ~100KB
- **Per service**: ~50KB
- **Message buffering**: Configurable (default 10MB)

## Troubleshooting

### Common Issues

#### Connection Refused

```typescript
// Check if server is running
netron.on('error', (error) => {
  if (error.code === 'ECONNREFUSED') {
    console.error('Server is not running on', address);
  }
});
```

#### Service Not Found

```typescript
// Verify service is exposed
const services = netron.peer.getExposedServices();
console.log('Available services:', services);

// Check service name and version
const service = await peer.getInterface('calculator@1.0.0'); // Exact match required
```

#### Timeout Errors

```typescript
// Increase timeout for long operations
const netron = new Netron({
  connectTimeout: 30000,  // 30 seconds
  defaultTimeout: 60000   // 60 seconds for RPC calls
});

// Per-call timeout
const result = await service.longOperation({ timeout: 120000 });
```

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
// Enable debug mode
const netron = new Netron(logger, {
  debug: true,
  logLevel: 'trace'
});

// Custom logger
const logger = {
  trace: (...args) => console.log('[TRACE]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};
```

## License

MIT - See LICENSE file for details