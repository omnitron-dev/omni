---
module: titan
title: "Netron RPC System"
tags: [netron, rpc, services, transport, networking, distributed]
summary: "Architecture and usage of the Netron distributed RPC and service communication framework"
depends_on: [philosophy, nexus-di, decorators]
---

# Netron RPC System

Netron is Titan's distributed RPC and service communication framework. It handles service exposure, remote method invocation, peer-to-peer communication, and transport abstraction.

## Architecture Overview

```
Netron (central hub)
  ├── LocalPeer (this process's services)
  │     └── ServiceStub[] (wrapped service instances + metadata)
  │           └── Definition (service metadata + interface spec)
  ├── RemotePeer[] (connected remote peers)
  │     └── Interface[] (proxy objects for remote services)
  ├── TransportRegistry (pluggable transports)
  │     ├── HttpTransport (HTTP/REST + JSON-RPC)
  │     ├── WebSocketTransport (persistent bidirectional)
  │     ├── TcpTransport (raw TCP)
  │     └── UnixTransport (Unix domain sockets)
  ├── ConnectionManager (reconnection, health, pooling)
  └── TaskManager (async operation tracking)
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Netron** | Central hub that manages peers, transports, and services |
| **LocalPeer** | Represents this process. Holds locally exposed services |
| **RemotePeer** | Represents a connected remote process |
| **ServiceStub** | Wraps a service instance with its metadata and definition |
| **Definition** | Service metadata (name, version, methods, properties) |
| **Interface** | Client-side proxy that forwards calls to a remote ServiceStub |
| **Transport** | Wire protocol (HTTP, WS, TCP, Unix) |

## Creating a Netron Instance

Netron is typically created by the Application class, but can be used standalone:

```typescript
import { Netron } from '@omnitron-dev/titan/netron';

const netron = new Netron(logger, {
  id: 'my-instance',           // Auto-generated UUID if omitted
  taskTimeout: 10000,           // Default timeout for RPC calls
  allowServiceEvents: true,     // Enable service event pub/sub
});

// Start transport server(s)
await netron.start({
  ws: { port: 8080 },          // WebSocket on port 8080
  http: { port: 3000 },        // HTTP on port 3000
});
```

### Netron via Application

When using the Application class, Netron is auto-configured and available via DI:

```typescript
import { NetronToken } from '@omnitron-dev/titan';

@Injectable()
class MyService {
  constructor(@Inject(NetronToken) private netron: Netron) {}
}
```

## Exposing Services

### Basic Service Exposure

```typescript
@Service({ name: 'Auth' })
class AuthRpcService {
  @Public({ auth: { allowAnonymous: true } })
  async signIn(username: string, password: string): Promise<AuthResponse> {
    // ...
  }

  @Public({ auth: { roles: ['user'] } })
  async signOut(sessionId: string): Promise<void> {
    // ...
  }
}

// Expose to Netron
await netron.expose(new AuthRpcService());
```

### Service Name Rules

- Names use latin letters, numbers, and dots: `Auth`, `api.Users`, `storage.Buckets`
- Dot notation enables namespacing: `payments.Stripe`, `payments.Crypto`
- **No version suffixes** in the `@Service` name: use `@Service({ name: 'Auth' })`, not `@Service({ name: 'Auth@1.0.0' })`
- Version is tracked separately in metadata if needed

### How Exposure Works

1. `@Service` decorator processes the class, extracts metadata about `@Public` methods/properties
2. `netron.expose(instance)` creates a `ServiceStub` wrapping the instance with its `Definition`
3. The `LocalPeer` registers the stub, making it available for remote invocation
4. Connected `RemotePeer`s are notified of the new service via the interface protocol

## Transports

### Available Transports

| Transport | Use Case | Module Path |
|-----------|----------|-------------|
| HTTP | REST-compatible, request/response, browser clients | `@omnitron-dev/titan/netron/transport/http` |
| WebSocket | Persistent bidirectional, streaming, real-time | `@omnitron-dev/titan/netron/transport/websocket` |
| TCP | High-performance binary, inter-service | `@omnitron-dev/titan/netron/transport/tcp` |
| Unix Socket | Same-host IPC, zero network overhead | `@omnitron-dev/titan/netron/transport/unix` |

### Transport Configuration

```typescript
// Start with multiple transports
await netron.start({
  http: { port: 3000 },
  ws: { port: 8080 },
  tcp: { port: 9000 },
  unix: { path: '/tmp/my-service.sock' },
});

// Or configure per-service
@Service({
  name: 'HighFreqData',
  transports: [new WebSocketTransport({ port: 8080 })],
  transportConfig: {
    timeout: 30000,
    compression: true,
    maxMessageSize: 1024 * 1024, // 1MB
  },
})
class HighFreqDataService { ... }
```

### HTTP Transport Details

The HTTP transport provides:

- JSON-RPC style method invocation
- OpenAPI spec auto-generation from service metadata
- Built-in middleware pipeline (auth, rate limiting, CORS, compression)
- Request batching support
- Health check endpoints

```typescript
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';

const http = new HttpTransport({
  port: 3000,
  cors: true,
  middleware: [authMiddleware, rateLimitMiddleware],
});
```

### WebSocket Transport Details

- Persistent bidirectional connections with keep-alive
- Authentication handshake on connect
- Automatic reconnection with exponential backoff
- Streaming support for async generators

```typescript
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';

const ws = new WebSocketTransport({
  port: 8080,
  keepAlive: { interval: 30000, timeout: 10000 },
});
```

### Unix Socket Transport

Used for parent-child process communication in the Omnitron PM pipeline:

```typescript
import { UnixTransport } from '@omnitron-dev/titan/netron/transport/unix';

const unix = new UnixTransport({
  path: '/tmp/omnitron/my-app.sock',
});
```

## Connecting to Remote Services

### Client Connection

```typescript
// Connect to a remote Netron instance
const peer = await netron.connect('ws://remote-host:8080');

// Get a typed interface proxy for a remote service
const authService = peer.getInterface<IAuthService>('Auth');

// Call methods like local objects
const result = await authService.signIn('user', 'pass');
```

### Multi-Backend Client Routing

Frontend apps use `createMultiBackendClient` to route RPC calls to different backends:

```typescript
import { createMultiBackendClient } from '@omnitron-dev/prism/netron';

// Type-safe mapping of backend names to service schemas
const client = createMultiBackendClient<{
  main: { Auth: IAuthService; Users: IUsersService };
  storage: { Storage: IStorageService };
}>({
  main: 'ws://main-backend:8080',
  storage: 'ws://storage-backend:8081',
});

// Route calls to the correct backend
const user = await client.main.Users.getUser('123');
const files = await client.storage.Storage.listFiles('/');
```

### Typed RPC Helpers

For imperative use in stores (not React hooks):

```typescript
// Define typed RPC helper
export async function authRpc<M extends keyof IAuthService>(
  method: M,
  ...args: Parameters<IAuthService[M]>
): Promise<ReturnType<IAuthService[M]>> {
  return invokeWithRetry('main', 'Auth', method, ...args);
}

// Usage
const response = await authRpc('signIn', 'admin', 'password');
```

## Streaming

Netron supports async generator streaming for large data sets:

```typescript
@Service({ name: 'DataExport' })
class DataExportService {
  @Public()
  async *streamRecords(query: ExportQuery): AsyncGenerator<Record> {
    const cursor = await this.db.cursor(query);
    for await (const batch of cursor) {
      for (const record of batch) {
        yield record;
      }
    }
  }
}

// Client-side consumption
const stream = await dataExport.streamRecords({ table: 'events' });
for await (const record of stream) {
  process.stdout.write(JSON.stringify(record) + '\n');
}
```

Streaming uses `StreamReference` and `NetronWritableStream` internally for cross-transport stream forwarding.

## Service Events

When `allowServiceEvents: true`, services can emit events to subscribers:

```typescript
// Server-side: emit events
await netron.emit('auth:login', { userId: '123', timestamp: Date.now() });

// Client-side: subscribe to events
await netron.subscribe('auth:login', (event) => {
  console.log(`User ${event.userId} logged in`);
});
```

## Connection Management

Netron includes a `ConnectionManager` for:

- **Auto-reconnection** with exponential backoff (base delay, max delay, jitter)
- **Health monitoring** of peer connections
- **Connection pooling** for high-throughput scenarios

```typescript
// Reconnection constants (from netron/constants.ts)
CONNECT_TIMEOUT = 10000;          // 10s connection timeout
RECONNECT_BASE_DELAY = 1000;      // 1s initial retry delay
RECONNECT_MAX_DELAY = 30000;      // 30s max retry delay
RECONNECT_JITTER_FACTOR = 0.3;    // 30% random jitter
MAX_EVENT_QUEUE_SIZE = 1000;       // Max queued events during disconnect
```

## Peer Events

```typescript
// Peer connected
netron.on('peer:connect', (peer: RemotePeer) => {
  console.log(`Peer connected: ${peer.id}`);
});

// Peer disconnected
netron.on('peer:disconnect', (peer: RemotePeer) => {
  console.log(`Peer disconnected: ${peer.id}`);
});
```

## Authentication in Netron

Netron integrates with Titan's auth system for RPC-level authentication:

```typescript
// Server-side: set up authentication manager
netron.setAuthenticationManager(authManager);
netron.setAuthorizationManager(authzManager);

// Auth is enforced per-method via @Public({ auth: {...} })
// See decorators.md for auth configuration details
```

The `authenticate` core task handles the auth handshake during peer connection. JWT tokens are validated via `AuthenticationManager.validateToken()` in HTTP middleware and `invocationWrapper` bridges auth context to RLS for every RPC call.

## Unexposing Services

```typescript
// Remove a service from exposure
await netron.unexpose('Auth');

// Disconnect from a remote peer
await peer.disconnect();
```

## Gotchas

1. **Two Netron instances per child process**: In the Omnitron PM pipeline, each child has a management plane Netron (Unix socket) and a data plane Netron (HTTP/WS). Do not confuse them.

2. **Service name uniqueness**: Each service name must be unique per Netron instance. Exposing two services with the same name overwrites the first.

3. **Transport selection**: Use Unix sockets for same-host IPC (parent-child), WebSocket for persistent browser connections, HTTP for stateless REST-like calls, TCP for high-performance inter-service.

4. **Timeout defaults**: If no timeout is set, `taskTimeout` from Netron options applies. For long-running operations, set per-service or per-method timeouts.
