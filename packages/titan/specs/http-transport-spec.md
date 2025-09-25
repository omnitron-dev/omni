# HTTP Transport Specification for Netron

## Overview

This specification defines a HTTP transport implementation for Netron that preserves the core Netron paradigm: services are exposed through `exposeService()` and consumed through `queryInterface()` as if they were local objects. The HTTP transport layer operates transparently beneath this abstraction, handling the conversion between method calls and HTTP requests/responses.

## Core Principles

1. **Transparent Integration**: HTTP transport works seamlessly with existing Netron APIs
2. **Zero API Changes**: Existing `peer.exposeService()` and `peer.queryInterface()` work unchanged
3. **Contract Extension**: HTTP-specific metadata is optional in existing contracts
4. **Full Compatibility**: HTTP services can be consumed by WebSocket clients and vice versa
5. **Runtime Agnostic**: Works in Node.js, Bun, and browsers

## Key Design Philosophy

The HTTP transport **must not** introduce any new APIs or paradigms. Instead:

- Services are exposed using the same `peer.exposeService(serviceInstance)` method
- Services are consumed using the same `peer.queryInterface<ServiceType>('serviceName@version')` method
- HTTP-specific configuration happens at the transport level, not at the service level
- The magic of HTTP request/response handling is completely hidden from the user

## Service Definition Examples

The `@Service` decorator now supports a `contract` field in its options for HTTP integration:

```typescript
// Basic service definition
@Service('UserService@1.0.0')
class BasicUserService { /* ... */ }

// Service with contract for HTTP integration
@Service({
  name: 'UserService@1.0.0',
  contract: userContract
})
class HttpUserService { /* ... */ }

// Service with contract and transport configuration
@Service({
  name: 'UserService@1.0.0',
  contract: userContract,
  transports: [httpTransport, wsTransport],
  transportConfig: {
    timeout: 10000,
    compression: true
  }
})
class AdvancedUserService { /* ... */ }
```

## Architecture

### 1. Extending MethodContract for HTTP

The existing `MethodContract` is extended with an optional `http` field that provides HTTP-specific metadata without affecting non-HTTP usage:

```typescript
// Extension to existing MethodContract in src/validation/contract.ts
export interface MethodContract {
  input?: z.ZodSchema<any>;
  output?: z.ZodSchema<any>;
  errors?: Record<number, z.ZodSchema<any>>;
  stream?: boolean;
  options?: ValidationOptions;

  // New optional HTTP extension
  http?: HttpMethodOptions;
}

// HTTP-specific options (completely optional)
interface HttpMethodOptions {
  // HTTP method (defaults to POST for RPC-style calls)
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

  // Path pattern with parameters (defaults to /rpc/{methodName})
  path?: string; // e.g., '/users/:id' or '/api/v1/users/{id}'

  // Request parsing
  query?: z.ZodSchema<any>;     // URL query parameters
  params?: z.ZodSchema<any>;    // URL path parameters
  headers?: z.ZodSchema<any>;   // Request headers validation
  cookies?: z.ZodSchema<any>;   // Cookie validation

  // Response configuration
  responseHeaders?: Record<string, string>;
  contentType?: string;
  status?: number; // HTTP status code for success (default 200)

  // OpenAPI documentation metadata
  openapi?: {
    summary?: string;
    description?: string;
    tags?: string[];
    deprecated?: boolean;
    examples?: Record<string, any>;
  };
}
```

**Key Point**: This extension doesn't break existing contracts or require API changes. Services without HTTP metadata work perfectly with WebSocket transport, and services with HTTP metadata work with both transports.

### 2. HTTP Transport Implementation

The HTTP transport implements the `ITransport` interface, making it a drop-in replacement for WebSocket transport:

```typescript
import type { ITransport, ITransportServer, ITransportConnection } from './transport/types.js';

class HttpTransport implements ITransport {
  readonly name = 'http';
  readonly capabilities: TransportCapabilities = {
    streaming: true,      // Via SSE or chunked encoding
    bidirectional: false, // HTTP is request-response
    binary: true,         // Can handle binary data
    reconnection: false,  // Stateless protocol
    multiplexing: true,   // Multiple requests over same connection
    server: true         // Can create servers
  };

  // Client: Creates HTTP client that speaks Netron protocol over HTTP
  async connect(address: string, options?: TransportOptions): Promise<ITransportConnection> {
    return new HttpClientConnection(address, options);
  }

  // Server: Creates HTTP server that understands Netron services
  async createServer(options?: TransportOptions): Promise<ITransportServer> {
    return new HttpServer(options);
  }

  isValidAddress(address: string): boolean {
    return /^https?:\/\//.test(address);
  }

  parseAddress(address: string): TransportAddress {
    const url = new URL(address);
    return {
      protocol: url.protocol.slice(0, -1),
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      params: Object.fromEntries(url.searchParams)
    };
  }
}
```

**Key Integration Points**:

1. **Transport Registration**: HTTP transport is registered in Netron's transport registry alongside WebSocket
2. **Service Discovery**: HTTP endpoints are discoverable through the same service discovery mechanism
3. **Protocol Bridging**: WebSocket clients can call HTTP services and vice versa through the peer abstraction

### 3. Service Exposure & Consumption (Core Netron APIs)

The beauty of this design is that **no new APIs are introduced**. Services are exposed and consumed exactly as with WebSocket transport:

```typescript
// === SERVER SIDE ===
// 1. Define a service with optional HTTP metadata in contract
const userContract = contract({
  getUser: {
    input: z.object({ id: z.string() }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }),
    // Optional HTTP metadata for REST-style access
    http: {
      method: 'GET',
      path: '/api/users/{id}',
      params: z.object({ id: z.string() })
    }
  },
  createUser: {
    input: z.object({
      name: z.string(),
      email: z.string().email()
    }),
    output: z.object({ id: z.string() }),
    // No HTTP metadata = defaults to POST /rpc/createUser
  }
});

// 2. Implement the service (same as always)
@Service({ name: 'UserService@1.0.0', contract: userContract })
class UserService {
  async getUser(input: { id: string }) {
    return { id: input.id, name: 'John', email: 'john@example.com' };
  }

  async createUser(input: { name: string; email: string }) {
    return { id: generateId() };
  }
}

// 3. Create Netron with HTTP transport
const netron = new Netron(logger, {
  listenHost: 'localhost',
  listenPort: 3000
});

// Register HTTP transport alongside WebSocket
netron.registerTransport('http', () => new HttpTransport());

// 4. Expose service using standard Netron API
const userService = new UserService();
await netron.peer.exposeService(userService);

await netron.start();

// === CLIENT SIDE ===
// 1. Connect to server using HTTP transport
const httpPeer = await netron.connect('http://localhost:3000');

// 2. Query interface using standard Netron API
const userService = await httpPeer.queryInterface<UserService>('UserService@1.0.0');

// 3. Call methods as if they were local (same as WebSocket!)
const user = await userService.getUser({ id: '123' });
const newUser = await userService.createUser({ name: 'Alice', email: 'alice@example.com' });
```

**Under the hood**, the HTTP transport automatically:

1. **Server-side**: Converts `getUser({ id: '123' })` to `GET /api/users/123`
2. **Client-side**: Converts `GET /api/users/123` responses back to method call results
3. **Fallback**: Methods without HTTP metadata use `POST /rpc/{methodName}` with JSON body

### 4. HTTP Server Implementation (Internal)

The HTTP server integrates with Netron's peer system to handle service calls transparently:

```typescript
class HttpServer implements ITransportServer {
  readonly connections = new Map<string, ITransportConnection>();
  private server?: any;
  private routes = new Map<string, ServiceRoute>();
  private netronPeer?: LocalPeer;

  constructor(private options: TransportOptions) {}

  async listen(): Promise<void> {
    // Runtime-specific server creation
    if (typeof Bun !== 'undefined') {
      this.server = Bun.serve({
        port: this.options.port,
        fetch: this.handleRequest.bind(this)
      });
    } else {
      // Node.js implementation
      const { createServer } = await import('http');
      this.server = createServer(this.handleNodeRequest.bind(this));
      this.server.listen(this.options.port);
    }
  }

  // Called by RemotePeer when services are exposed
  registerService(serviceName: string, definition: Definition): void {
    const contract = definition.contract;
    if (!contract) return;

    // Generate routes from contract methods
    for (const [methodName, methodContract] of Object.entries(contract.definition)) {
      const http = methodContract.http;

      if (http?.path && http?.method) {
        // REST-style endpoint
        const routeKey = `${http.method}:${http.path}`;
        this.routes.set(routeKey, {
          serviceName,
          methodName,
          pattern: http.path,
          method: http.method,
          contract: methodContract
        });
      }

      // Always register RPC-style endpoint as fallback
      const rpcKey = `POST:/rpc/${methodName}`;
      this.routes.set(rpcKey, {
        serviceName,
        methodName,
        pattern: `/rpc/${methodName}`,
        method: 'POST',
        contract: methodContract
      });
    }
  }

  // Main request handler
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const routeKey = `${request.method}:${url.pathname}`;

    const route = this.findRoute(routeKey, url.pathname);
    if (!route) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      // Extract input from HTTP request based on route configuration
      const input = await this.extractInput(request, route, url);

      // Call the service method through Netron's peer system
      const result = await this.netronPeer!.callServiceMethod(
        route.serviceName,
        route.methodName,
        input
      );

      // Convert result to HTTP response
      return this.createResponse(result, route);
    } catch (error) {
      return this.handleError(error);
    }
  }

  private async extractInput(request: Request, route: ServiceRoute, url: URL): Promise<any> {
    const http = route.contract.http;
    let input: any = {};

    // Extract path parameters
    if (http?.params) {
      const params = this.extractPathParams(route.pattern, url.pathname);
      Object.assign(input, params);
    }

    // Extract query parameters
    if (http?.query) {
      const query = Object.fromEntries(url.searchParams);
      Object.assign(input, query);
    }

    // Extract body for non-GET requests
    if (request.method !== 'GET' && request.body) {
      const body = await request.json();
      Object.assign(input, body);
    }

    return input;
  }
}

interface ServiceRoute {
  serviceName: string;
  methodName: string;
  pattern: string;
  method: string;
  contract: MethodContract;
}
```

### 5. HTTP Client Implementation (Internal)

The HTTP client implements `ITransportConnection` to make HTTP requests appear as Netron method calls:

```typescript
class HttpClientConnection implements ITransportConnection {
  readonly id: string = generateId();
  state: ConnectionState = ConnectionState.CONNECTED;
  private serviceRoutes = new Map<string, Map<string, ServiceRoute>>();

  constructor(
    private baseUrl: string,
    private options?: TransportOptions
  ) {}

  // Called when client discovers a service
  registerService(serviceName: string, definition: Definition): void {
    const routes = new Map<string, ServiceRoute>();
    const contract = definition.contract;

    if (contract) {
      for (const [methodName, methodContract] of Object.entries(contract.definition)) {
        const http = methodContract.http;

        routes.set(methodName, {
          serviceName,
          methodName,
          pattern: http?.path || `/rpc/${methodName}`,
          method: http?.method || 'POST',
          contract: methodContract
        });
      }
    }

    this.serviceRoutes.set(serviceName, routes);
  }

  // Core method: convert Netron call to HTTP request
  async callServiceMethod(serviceName: string, methodName: string, args: any[]): Promise<any> {
    const serviceRoutes = this.serviceRoutes.get(serviceName);
    const route = serviceRoutes?.get(methodName);

    if (!route) {
      throw new Error(`Method ${methodName} not found in service ${serviceName}`);
    }

    const input = args[0]; // Netron passes single input object
    const http = route.contract.http;

    // Build URL and request based on HTTP metadata
    let url = this.baseUrl + route.pattern;
    let body: any = undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.options?.headers
    };

    if (http?.params && input) {
      // Replace path parameters: /users/{id} -> /users/123
      for (const [key, value] of Object.entries(input)) {
        url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    if (route.method === 'GET') {
      // Add query parameters for GET requests
      const urlObj = new URL(url);
      if (input && typeof input === 'object') {
        for (const [key, value] of Object.entries(input)) {
          urlObj.searchParams.set(key, String(value));
        }
      }
      url = urlObj.toString();
    } else {
      // Send input as JSON body for non-GET requests
      body = JSON.stringify(input);
    }

    const response = await fetch(url, {
      method: route.method,
      headers,
      body
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `HTTP ${response.status} ${response.statusText}`
      }));
      throw new Error(error.message || 'HTTP request failed');
    }

    return response.json();
  }

  // Implement required ITransportConnection methods
  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    // Convert Netron packet to HTTP request
    // This is called by Netron's internal systems
    const packet = decodePacket(data);

    if (packet.type === 'call') {
      const result = await this.callServiceMethod(
        packet.service,
        packet.method,
        packet.args
      );
      this.emit('packet', { ...packet, result });
    }
  }

  async sendPacket(packet: Packet): Promise<void> {
    const data = encodePacket(packet);
    await this.send(data);
  }

  async close(): Promise<void> {
    this.state = ConnectionState.DISCONNECTED;
    this.emit('disconnect');
  }
}
```

### 6. Protocol Bridging & Cross-Transport Compatibility

One of the most powerful features of this design is **protocol bridging**. Services exposed via one transport can be consumed via another:

```typescript
// === SCENARIO 1: HTTP service consumed via WebSocket ===
// Server exposes service via HTTP transport
const httpNetron = new Netron(logger, {
  listenHost: 'localhost',
  listenPort: 3000
});
httpNetron.registerTransport('http', () => new HttpTransport());

await httpNetron.peer.exposeService(new UserService());
await httpNetron.start();

// Client connects via WebSocket transport but can still access HTTP services
const wsNetron = new Netron(logger);
const wsPeer = await wsNetron.connect('ws://localhost:3000'); // WebSocket connection

// This works! WebSocket client calling HTTP service
const userService = await wsPeer.queryInterface<UserService>('UserService@1.0.0');
const user = await userService.getUser({ id: '123' });

// === SCENARIO 2: WebSocket service consumed via HTTP ===
// Server exposes service via WebSocket
const wsNetron = new Netron(logger, {
  listenHost: 'localhost',
  listenPort: 3001
});

await wsNetron.peer.exposeService(new ChatService());
await wsNetron.start();

// Client can access WebSocket service via HTTP REST calls
// GET http://localhost:3001/api/chat/messages?roomId=123
// POST http://localhost:3001/rpc/sendMessage
```

This is possible because:

1. **Service Discovery**: All services are registered in the same discovery system regardless of transport
2. **Peer Abstraction**: `RemotePeer` handles protocol translation transparently
3. **Unified Interface**: All services implement the same `Interface` proxy pattern

### 7. Real-World Usage Examples

#### Example 1: Simple RPC Service (Zero HTTP Configuration)

```typescript
// Define contract (no HTTP metadata needed)
const calculatorContract = contract({
  add: {
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() })
  },
  divide: {
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ result: z.number() }),
    errors: {
      400: z.object({ message: z.string() })
    }
  }
});

@Service('Calculator@1.0.0', calculatorContract)
class Calculator {
  async add({ a, b }: { a: number; b: number }) {
    return { result: a + b };
  }

  async divide({ a, b }: { a: number; b: number }) {
    if (b === 0) {
      throw new TitanError({
        code: ErrorCode.INVALID_INPUT,
        message: 'Division by zero'
      });
    }
    return { result: a / b };
  }
}

// Server setup (unchanged from WebSocket)
const netron = new Netron(logger, {
  listenHost: 'localhost',
  listenPort: 3000
});

await netron.peer.exposeService(new Calculator());
await netron.start();

// Client usage (unchanged from WebSocket)
const peer = await netron.connect('http://localhost:3000');
const calc = await peer.queryInterface<Calculator>('Calculator@1.0.0');

const result = await calc.add({ a: 5, b: 3 }); // HTTP POST /rpc/add
console.log(result); // { result: 8 }
```

**Generated HTTP Endpoints** (automatic):
- `POST /rpc/add` - accepts `{ a: number, b: number }`
- `POST /rpc/divide` - accepts `{ a: number, b: number }`

#### Example 2: RESTful API with HTTP Metadata

```typescript
// Define contract with HTTP metadata for REST endpoints
const userContract = contract({
  listUsers: {
    input: z.object({
      page: z.number().default(1),
      limit: z.number().default(10),
      search: z.string().optional()
    }),
    output: z.object({
      users: z.array(UserSchema),
      total: z.number(),
      page: z.number()
    }),
    http: {
      method: 'GET',
      path: '/api/users',
      query: z.object({
        page: z.string().transform(Number).optional(),
        limit: z.string().transform(Number).optional(),
        search: z.string().optional()
      })
    }
  },
  getUser: {
    input: z.object({ id: z.string() }),
    output: UserSchema,
    http: {
      method: 'GET',
      path: '/api/users/{id}',
      params: z.object({ id: z.string() })
    }
  },
  createUser: {
    input: CreateUserSchema,
    output: UserSchema,
    http: {
      method: 'POST',
      path: '/api/users',
      status: 201
    }
  },
  updateUser: {
    input: z.object({
      id: z.string(),
      updates: UpdateUserSchema
    }),
    output: UserSchema,
    http: {
      method: 'PUT',
      path: '/api/users/{id}',
      params: z.object({ id: z.string() })
    }
  }
});

@Service({ name: 'UserService@1.0.0', contract: userContract })
class UserService {
  async listUsers({ page, limit, search }: any) {
    // Implementation
    return { users: [], total: 0, page };
  }

  async getUser({ id }: { id: string }) {
    // Implementation
    return { id, name: 'John', email: 'john@example.com' };
  }

  // ... other methods
}

// Usage remains exactly the same!
const userService = await peer.queryInterface<UserService>('UserService@1.0.0');

// These calls automatically map to the correct HTTP endpoints:
const users = await userService.listUsers({ page: 1, limit: 10 }); // GET /api/users?page=1&limit=10
const user = await userService.getUser({ id: '123' }); // GET /api/users/123
```

**Generated HTTP Endpoints**:
- `GET /api/users?page=1&limit=10&search=term`
- `GET /api/users/{id}`
- `POST /api/users`
- `PUT /api/users/{id}`

### 8. Streaming Support

Streaming works through Netron's existing streaming mechanisms, with HTTP-specific adaptations:

```typescript
// Define streaming contract
const chatContract = contract({
  subscribeToRoom: {
    input: z.object({ roomId: z.string() }),
    output: z.object({
      type: z.string(),
      user: z.string(),
      message: z.string(),
      timestamp: z.number()
    }),
    stream: true, // Netron streaming flag
    http: {
      method: 'GET',
      path: '/api/chat/{roomId}/stream',
      params: z.object({ roomId: z.string() })
    }
  }
});

@Service('ChatService@1.0.0', chatContract)
class ChatService {
  async *subscribeToRoom({ roomId }: { roomId: string }) {
    // This is a Netron async generator
    while (true) {
      yield {
        type: 'message',
        user: 'system',
        message: `Message in room ${roomId}`,
        timestamp: Date.now()
      };
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Client usage (same as WebSocket!)
const chatService = await peer.queryInterface<ChatService>('ChatService@1.0.0');

for await (const message of chatService.subscribeToRoom({ roomId: '123' })) {
  console.log(message); // Receives messages via Server-Sent Events
}
```

**HTTP Streaming Implementation**:
- **Server**: Automatically converts async generators to Server-Sent Events (SSE)
- **Client**: Automatically handles SSE and converts back to async iterators
- **Fallback**: WebSocket upgrade for bidirectional streaming when needed

## Key Benefits of This Approach

### 1. **Zero Learning Curve**
Developers already familiar with Netron don't need to learn anything new. The same APIs work for both WebSocket and HTTP transports.

### 2. **Progressive Enhancement**
- Start with simple RPC calls (automatic `/rpc/methodName` endpoints)
- Add HTTP metadata only when you need REST-style endpoints
- Existing services work unchanged when adding HTTP transport

### 3. **Full Protocol Compatibility**
- WebSocket clients can call HTTP services
- HTTP clients can call WebSocket services
- Services can be accessed via both protocols simultaneously

### 4. **Type Safety Throughout**
- Same contract validation for both transports
- Same error handling and TitanError integration
- Same TypeScript types and IDE support

### 5. **Unified Architecture**
- Single service discovery system
- Unified logging and monitoring
- Same middleware and interceptor system
- Single configuration and deployment model

## Implementation Phases

### Phase 1: Core HTTP Transport
- [x] Basic `ITransport` implementation for HTTP
- [x] `HttpServer` and `HttpClientConnection` classes
- [x] Request/response mapping for RPC-style calls
- [x] Integration with existing Netron peer system

### Phase 2: REST Endpoint Support
- [x] HTTP metadata parsing from contracts
- [x] Path parameter extraction (`/users/{id}`)
- [x] Query parameter handling
- [x] HTTP method mapping (GET, POST, PUT, DELETE)

### Phase 3: Advanced Features
- [ ] Streaming via Server-Sent Events
- [ ] WebSocket fallback for bidirectional streams
- [ ] OpenAPI documentation generation
- [ ] Request/response middleware system

### Phase 4: Production Ready
- [ ] Performance optimizations (route compilation)
- [ ] Caching integration
- [ ] Rate limiting
- [ ] Authentication/authorization hooks
- [ ] Metrics and monitoring integration

## Summary

This HTTP transport specification maintains the core philosophy of Netron: **services are just objects that can be called remotely**. The HTTP transport layer is completely transparent to the developer, requiring no changes to existing service code or client code.

### Key Design Decisions

1. **No New APIs**: Everything works through existing `peer.exposeService()` and `peer.queryInterface()` methods
2. **Optional HTTP Metadata**: Services work without HTTP metadata (automatic RPC endpoints), HTTP metadata enables REST-style endpoints
3. **Protocol Bridging**: WebSocket and HTTP services can interoperate seamlessly
4. **Contract Extension**: `MethodContract` gets an optional `http` field that doesn't break existing code
5. **Transport Layer**: All HTTP complexity is hidden in the transport implementation

### Developer Experience

```typescript
// This is literally all a developer needs to know:

// 1. Define service (same as WebSocket)
@Service('MyService@1.0.0', myContract)
class MyService {
  async myMethod(input: any) {
    return { success: true };
  }
}

// 2. Expose service (same as WebSocket)
await netron.peer.exposeService(new MyService());

// 3. Consume service (same as WebSocket)
const service = await peer.queryInterface<MyService>('MyService@1.0.0');
const result = await service.myMethod({ data: 'test' });
```

The magic of HTTP endpoints, routing, parameter extraction, and protocol conversion happens completely behind the scenes. This is the true power of Netron's abstraction - the transport layer is pluggable without changing the programming model.

## Next Steps

1. **Extend `MethodContract`** in `src/validation/contract.ts` with optional `http` field
2. **Implement `HttpTransport`** class implementing `ITransport` interface
3. **Create `HttpServer`** and `HttpClientConnection`** classes
4. **Integration with existing Netron peer system**
5. **Test protocol bridging** between WebSocket and HTTP transports

This specification ensures that HTTP transport feels like a natural extension of Netron rather than a separate system, maintaining the elegance and simplicity that makes Netron powerful.

## Performance Optimizations

1. **Route Compilation**: Routes are compiled at startup into optimized matchers
2. **Validator Compilation**: Zod schemas are pre-compiled into fast validators
3. **Zero-Copy Streaming**: Direct streaming without intermediate buffers
4. **Object Pooling**: Reuse of Request/Response objects in high-load scenarios
5. **Static Analysis**: Contract analysis for dead code elimination
6. **JIT Optimization**: Handler functions are optimized by V8/JSC

## Benchmarks (Target)

```
Framework          Requests/sec    Latency (ms)
-------------------------------------------------
Titan HTTP         150,000         0.65
Fastify            140,000         0.71
Elysia (Bun)       180,000         0.55
Express            30,000          3.33
```

## Implementation Phases

### Phase 1: Core HTTP Transport
- Basic HTTP server/client implementation
- Contract compilation
- Route matching
- Error handling

### Phase 2: Advanced Features
- Streaming support
- Middleware system
- Rate limiting
- Caching

### Phase 3: Developer Experience
- OpenAPI generation
- Type-safe client generation
- Development UI
- Hot reload support

### Phase 4: Production Features
- Metrics collection
- Distributed tracing
- Circuit breaking
- Load balancing

## Security Considerations

1. **Input Validation**: All inputs validated against schemas
2. **Rate Limiting**: Built-in rate limiting support
3. **CORS**: Configurable CORS policies
4. **Authentication**: Pluggable auth system
5. **HTTPS**: Automatic HTTPS in production
6. **CSP**: Content Security Policy headers

## Compatibility

### Runtime Support
- **Node.js**: Full support via http/https modules
- **Bun**: Native support via Bun.serve
- **Deno**: Support via Deno.serve
- **Browser**: Client-only via fetch API

### Protocol Support
- **HTTP/1.1**: Full support
- **HTTP/2**: Automatic upgrade when available
- **HTTP/3**: Future support via QUIC

## Conclusion

This HTTP transport design provides a minimal yet powerful foundation for building high-performance HTTP APIs with Titan. By leveraging contract compilation, native APIs, and runtime optimizations, it achieves performance comparable to the fastest frameworks while maintaining the simplicity and type-safety of Titan's architecture.