# @omnitron-dev/netron-browser

Browser-optimized Netron RPC client for seamless backend communication.

## Features

- **Dual Transport Support**: HTTP and WebSocket transports for flexible communication patterns
- **Type-Safe**: Full TypeScript support with type inference
- **Browser-Optimized**: Minimal bundle size with tree-shaking support
- **Auto-Reconnection**: Automatic reconnection for WebSocket connections
- **Request Retry**: Built-in retry mechanism for HTTP requests
- **Connection Metrics**: Monitor connection health and performance
- **Service Proxies**: Create type-safe service proxies for clean API usage

## 📚 Documentation

Complete documentation is available in the [`docs/`](./docs/) directory:

- **[Getting Started](./docs/01-getting-started/)** - Overview, setup, and quick start guide
- **[Architecture](./docs/02-architecture/)** - Component structure, transports, and design
- **[Features](./docs/03-features/)** - Authentication, caching, middleware, and more
- **[Compatibility](./docs/04-compatibility/)** - Full compatibility report with Titan
- **[Testing](./docs/05-testing/)** - Test infrastructure and guide

For a quick overview, see:
- **[Compatibility Summary](./docs/04-compatibility/01-compatibility-summary.md)** - Production readiness assessment
- **[Feature Matrix](./docs/03-features/03-feature-matrix.md)** - Feature comparison with Titan

## Installation

```bash
npm install @omnitron-dev/netron-browser
# or
yarn add @omnitron-dev/netron-browser
# or
pnpm add @omnitron-dev/netron-browser
```

## Quick Start

### HTTP Transport

```typescript
import { createClient } from '@omnitron-dev/netron-browser';

// Create client with HTTP transport
const client = createClient({
  url: 'http://localhost:3000',
  transport: 'http',
  timeout: 30000,
});

// Connect to server
await client.connect();

// Invoke a service method
const result = await client.invoke('calculator', 'add', [2, 3]);
console.log(result); // 5

// Or use type-safe service proxy
interface Calculator {
  add(a: number, b: number): Promise<number>;
  subtract(a: number, b: number): Promise<number>;
}

const calculator = client.service<Calculator>('calculator');
const sum = await calculator.add(2, 3);
console.log(sum); // 5
```

### WebSocket Transport

```typescript
import { createClient } from '@omnitron-dev/netron-browser';

// Create client with WebSocket transport
const client = createClient({
  url: 'http://localhost:3000', // Will be converted to ws://
  transport: 'websocket',
  websocket: {
    reconnect: true,
    reconnectInterval: 1000,
    maxReconnectAttempts: 5,
  },
});

// Connect to server
await client.connect();

// Invoke methods
const result = await client.invoke('users', 'create', [
  { name: 'John Doe', email: 'john@example.com' }
]);
```

## API Reference

### NetronClient

The main client class that provides a unified interface for both HTTP and WebSocket transports.

#### Constructor Options

```typescript
interface NetronClientOptions {
  // Base URL for the Netron server
  url: string;

  // Transport type (default: 'http')
  transport?: 'http' | 'websocket';

  // Request timeout in milliseconds (default: 30000)
  timeout?: number;

  // Custom headers for HTTP requests
  headers?: Record<string, string>;

  // WebSocket-specific options
  websocket?: {
    protocols?: string | string[];
    reconnect?: boolean;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
  };

  // HTTP-specific options
  http?: {
    batching?: boolean;
    caching?: boolean;
    cacheTTL?: number;
    retry?: boolean;
    maxRetries?: number;
  };
}
```

#### Methods

##### `connect(): Promise<void>`

Connect to the Netron server.

```typescript
await client.connect();
```

##### `disconnect(): Promise<void>`

Disconnect from the server.

```typescript
await client.disconnect();
```

##### `invoke<T>(service: string, method: string, args?: any[], options?): Promise<T>`

Invoke a service method.

```typescript
const result = await client.invoke('calculator', 'add', [2, 3]);
```

##### `service<T>(serviceName: string): T`

Create a type-safe service proxy.

```typescript
interface Calculator {
  add(a: number, b: number): Promise<number>;
}

const calculator = client.service<Calculator>('calculator');
const result = await calculator.add(2, 3);
```

##### `getServiceDescriptor(serviceName: string): Promise<ServiceDescriptor>`

Get metadata about a service and its methods.

```typescript
const descriptor = await client.getServiceDescriptor('calculator');
console.log(descriptor.methods);
```

##### `getMetrics(): ConnectionMetrics`

Get connection metrics and statistics.

```typescript
const metrics = client.getMetrics();
console.log(metrics.avgLatency); // Average request latency
console.log(metrics.requestsSent); // Total requests sent
```

##### `isConnected(): boolean`

Check if client is connected.

```typescript
if (client.isConnected()) {
  // Client is connected
}
```

##### `getState(): ConnectionState`

Get current connection state.

```typescript
const state = client.getState();
// 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
```

### HTTP Client

Direct HTTP transport client for advanced use cases.

```typescript
import { HttpClient } from '@omnitron-dev/netron-browser';

const httpClient = new HttpClient({
  url: 'http://localhost:3000',
  timeout: 30000,
  retry: true,
  maxRetries: 3,
});

await httpClient.connect();
const result = await httpClient.invoke('service', 'method', [args]);
```

### WebSocket Client

Direct WebSocket transport client for advanced use cases.

```typescript
import { WebSocketClient } from '@omnitron-dev/netron-browser';

const wsClient = new WebSocketClient({
  url: 'ws://localhost:3000',
  reconnect: true,
  reconnectInterval: 1000,
});

await wsClient.connect();
const result = await wsClient.invoke('service', 'method', [args]);

// Listen to events
wsClient.on('connect', () => console.log('Connected'));
wsClient.on('disconnect', () => console.log('Disconnected'));
wsClient.on('error', (error) => console.error('Error:', error));
```

## Error Handling

The library provides specific error types for different scenarios:

```typescript
import {
  NetronError,
  ConnectionError,
  TimeoutError,
  NetworkError,
  ProtocolError,
  ServiceError,
  MethodNotFoundError,
} from '@omnitron-dev/netron-browser';

try {
  await client.invoke('service', 'method', [args]);
} catch (error) {
  if (error instanceof ConnectionError) {
    // Handle connection errors
  } else if (error instanceof TimeoutError) {
    // Handle timeout errors
  } else if (error instanceof MethodNotFoundError) {
    // Handle method not found errors
  }
}
```

## Advanced Usage

### Request Context and Hints

```typescript
await client.invoke('users', 'create', [userData], {
  context: {
    userId: 'user-123',
    sessionId: 'session-456',
    metadata: { source: 'web' },
  },
  hints: {
    timeout: 10000, // Override default timeout
    cacheable: true, // Enable caching for this request
    priority: 10, // Request priority
  },
});
```

### Connection Monitoring

```typescript
// Get real-time metrics
const metrics = client.getMetrics();
console.log('Requests sent:', metrics.requestsSent);
console.log('Responses received:', metrics.responsesReceived);
console.log('Errors:', metrics.errors);
console.log('Average latency:', metrics.avgLatency, 'ms');
console.log('Connection state:', metrics.state);
```

### Event Handling (WebSocket)

```typescript
const client = createClient({
  url: 'http://localhost:3000',
  transport: 'websocket',
});

// Access the underlying WebSocket client
if (client.getTransportType() === 'websocket') {
  const wsTransport = client['transport'] as WebSocketClient;

  wsTransport.on('connect', () => {
    console.log('Connected to server');
  });

  wsTransport.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
  });

  wsTransport.on('reconnect', () => {
    console.log('Reconnected to server');
  });

  wsTransport.on('error', (error) => {
    console.error('Connection error:', error);
  });
}
```

## Browser Compatibility

This package is designed for modern browsers with support for:

- **ES2022** features
- **Fetch API** (for HTTP transport)
- **WebSocket API** (for WebSocket transport)
- **Promises** and **async/await**

Tested and compatible with:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern mobile browsers

## Bundle Size

The package is optimized for minimal bundle size:

- **Core**: ~6KB gzipped
- **HTTP Client**: ~2KB gzipped
- **WebSocket Client**: ~3KB gzipped

Tree-shaking is fully supported - only import what you need!

## TypeScript Support

Full TypeScript support with comprehensive type definitions. No additional `@types` packages required.

```typescript
// Automatic type inference
const result = await client.invoke<number>('calculator', 'add', [2, 3]);

// Type-safe service proxies
interface UserService {
  create(user: CreateUserDto): Promise<User>;
  findById(id: string): Promise<User | null>;
}

const users = client.service<UserService>('users');
const user = await users.findById('123'); // user is typed as User | null
```

## License

MIT

## Related Packages

- `@omnitron-dev/titan` - Backend framework with integrated Netron RPC
- `@omnitron-dev/aether` - Minimalist frontend framework with Netron integration
- `@omnitron-dev/msgpack` - High-performance MessagePack serialization
- `@omnitron-dev/eventemitter` - Universal event emitter used internally

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Support

For issues and questions, please open an issue on GitHub.
