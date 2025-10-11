# Netron Browser Client Guide

> **Complete guide to using Netron RPC client in browser applications**
> **Version**: 2.1.0
> **Date**: 2025-10-11
> **Status**: Using external `@omnitron-dev/netron-browser` package

---

## Migration Notice

**Important**: As of October 2025, Aether now uses the external `@omnitron-dev/netron-browser` package instead of an embedded implementation. This provides:

- **Better separation of concerns**: Netron browser client is independently maintained
- **Shared across projects**: Can be used in any JavaScript/TypeScript project, not just Aether
- **Focused development**: Browser-specific features and optimizations
- **Cleaner dependencies**: Aether only imports what it needs

The API remains identical, and the migration is transparent to end users. For migration details, see [NETRON-MIGRATION-NOTICE.md](./NETRON-MIGRATION-NOTICE.md).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [WebSocket Client](#websocket-client)
5. [HTTP Client](#http-client)
6. [API Reference](#api-reference)
7. [Advanced Usage](#advanced-usage)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

Netron Browser Client is a high-performance RPC client for web applications that connects to Titan backend services. It supports both **WebSocket** (binary MessagePack protocol) and **HTTP REST** transports.

### Features

✅ **WebSocket Support** - Full-duplex binary communication with MessagePack
✅ **HTTP REST Support** - Standard REST API for simple use cases
✅ **Type Safety** - Full TypeScript support with generic interfaces
✅ **Auto-Reconnection** - Configurable automatic reconnection on disconnect
✅ **Event Subscriptions** - Real-time event handling
✅ **Custom Logger** - Pluggable logging system
✅ **Lightweight** - ~35 KB gzipped

### Architecture

```
┌─────────────────┐
│  Browser App    │
└────────┬────────┘
         │
    ┌────▼─────┐
    │  Netron  │  ← WebSocket/HTTP Client
    │  Client  │
    └────┬─────┘
         │
    ┌────▼─────┐
    │  Titan   │  ← Backend Server
    │  Server  │
    └──────────┘
```

---

## Installation

### Via Package Manager

```bash
# Install Aether (includes netron-browser as dependency)
# Using Yarn
yarn add @omnitron-dev/aether

# Using npm
npm install @omnitron-dev/aether

# Using pnpm
pnpm add @omnitron-dev/aether

# Or install netron-browser directly for standalone use
yarn add @omnitron-dev/netron-browser
```

### Import

Aether re-exports the Netron browser client for convenience:

```typescript
// WebSocket Client
import { NetronClient } from '@omnitron-dev/aether/netron';

// HTTP Client
import { HttpNetronClient } from '@omnitron-dev/aether/netron';

// Logger
import { BrowserLogger } from '@omnitron-dev/aether/netron';
```

Or import directly from the standalone package:

```typescript
// Direct import from netron-browser
import { NetronClient, HttpNetronClient, BrowserLogger } from '@omnitron-dev/netron-browser';
```

**Note**: Both import methods work identically. Use Aether's re-exports when building Aether apps, or import directly when using Netron in other projects.

---

## Quick Start

### WebSocket Client (Recommended)

```typescript
import { NetronClient } from '@omnitron-dev/aether/netron';

// Create client
const client = new NetronClient({
  url: 'ws://localhost:3000',
  reconnect: true,
});

// Connect
await client.connect();

// Query service interface
interface Calculator {
  add(a: number, b: number): Promise<number>;
  subtract(a: number, b: number): Promise<number>;
}

const calc = await client.queryInterface<Calculator>('Calculator@1.0.0');

// Call methods
const result = await calc.add(2, 3);
console.log(result); // 5

// Disconnect
await client.disconnect();
```

### HTTP Client

```typescript
import { HttpNetronClient } from '@omnitron-dev/aether/netron';

// Create client
const client = new HttpNetronClient({
  baseUrl: 'http://localhost:3000',
});

// Initialize
await client.initialize();

// Query service interface
const calc = await client.queryInterface<Calculator>('Calculator@1.0.0');

// Call methods
const result = await calc.add(2, 3);
console.log(result); // 5

// Close
await client.close();
```

---

## WebSocket Client

### Creating a Client

```typescript
import { NetronClient, type NetronClientOptions } from '@omnitron-dev/aether/netron';

const options: NetronClientOptions = {
  url: 'ws://localhost:3000',           // WebSocket URL
  timeout: 30000,                        // Request timeout (ms)
  reconnect: true,                       // Enable auto-reconnect
  reconnectInterval: 5000,               // Reconnect delay (ms)
  maxReconnectAttempts: 10,              // Max reconnect attempts
  binaryType: 'arraybuffer',             // WebSocket binary type
  logger: new BrowserLogger(),           // Custom logger
};

const client = new NetronClient(options);
```

### Connecting

```typescript
try {
  await client.connect();
  console.log('Connected to Netron server');
} catch (error) {
  console.error('Connection failed:', error);
}
```

### Querying Services

```typescript
// Type-safe service interface
interface UserService {
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

// Query service
const userService = await client.queryInterface<UserService>('UserService@1.0.0');

// Call methods
const user = await userService.getUser('123');
const newUser = await userService.createUser({ name: 'John', email: 'john@example.com' });
```

### Event Subscriptions

```typescript
// Subscribe to events
await client.subscribe('user.created', (data) => {
  console.log('New user created:', data);
});

await client.subscribe('user.updated', (data) => {
  console.log('User updated:', data);
});

// Unsubscribe
const handler = (data) => console.log(data);
await client.subscribe('user.deleted', handler);
await client.unsubscribe('user.deleted', handler);
```

### Connection State

```typescript
// Check connection
if (client.isConnected()) {
  console.log('Client is connected');
}

// Get peer
const peer = client.getPeer();
if (peer) {
  console.log('Peer ID:', peer.id);
}
```

### Disconnecting

```typescript
// Graceful disconnect
await client.disconnect();
```

### Auto-Reconnection

```typescript
const client = new NetronClient({
  url: 'ws://localhost:3000',
  reconnect: true,                  // Enable
  reconnectInterval: 3000,          // 3 seconds
  maxReconnectAttempts: 5,          // Max 5 attempts
});

await client.connect();

// Connection will auto-reconnect on disconnect
// Reconnection stops after maxReconnectAttempts
```

---

## HTTP Client

### Creating a Client

```typescript
import { HttpNetronClient, type HttpClientOptions } from '@omnitron-dev/aether/netron';

const options: HttpClientOptions = {
  baseUrl: 'http://localhost:3000',     // HTTP server URL
  timeout: 60000,                        // Request timeout (ms)
  headers: {                             // Custom headers
    'Authorization': 'Bearer token',
    'X-Custom-Header': 'value',
  },
  logger: new BrowserLogger(),           // Custom logger
};

const client = new HttpNetronClient(options);
```

### Initializing

```typescript
await client.initialize();
```

### Querying Services

```typescript
// Same API as WebSocket client
const userService = await client.queryInterface<UserService>('UserService@1.0.0');

// Call methods
const user = await userService.getUser('123');
```

### Direct Invocation

```typescript
// Low-level API for direct method invocation
const result = await client.invoke('Calculator@1.0.0', 'add', 2, 3);
console.log(result); // 5
```

### Metrics

```typescript
const metrics = client.getMetrics();
console.log(metrics);
// {
//   baseUrl: 'http://localhost:3000',
//   connected: true,
//   hasPeer: true,
//   connectionMetrics: { ... }
// }
```

### Closing

```typescript
await client.close();
```

---

## API Reference

### NetronClient

#### Constructor

```typescript
new NetronClient(options: NetronClientOptions)
```

#### Options

```typescript
interface NetronClientOptions {
  url: string;                      // Required: WebSocket URL
  timeout?: number;                 // Request timeout (default: 30000ms)
  reconnect?: boolean;              // Enable auto-reconnect (default: false)
  reconnectInterval?: number;       // Reconnect delay (default: 5000ms)
  maxReconnectAttempts?: number;    // Max attempts (default: Infinity)
  logger?: ILogger;                 // Custom logger
  binaryType?: 'blob' | 'arraybuffer'; // Binary type (default: 'arraybuffer')
}
```

#### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `connect()` | Connect to server | `Promise<void>` |
| `disconnect()` | Disconnect from server | `Promise<void>` |
| `queryInterface<T>(name)` | Query service interface | `Promise<T>` |
| `subscribe(event, handler)` | Subscribe to event | `Promise<void>` |
| `unsubscribe(event, handler)` | Unsubscribe from event | `Promise<void>` |
| `isConnected()` | Check connection state | `boolean` |
| `getPeer()` | Get RemotePeer instance | `RemotePeer \| null` |

### HttpNetronClient

#### Constructor

```typescript
new HttpNetronClient(options: HttpClientOptions)
```

#### Options

```typescript
interface HttpClientOptions {
  baseUrl: string;                  // Required: HTTP server URL
  timeout?: number;                 // Request timeout (default: 30000ms)
  headers?: Record<string, string>; // Custom HTTP headers
  logger?: ILogger;                 // Custom logger
}
```

#### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `initialize()` | Initialize client | `Promise<void>` |
| `close()` | Close client | `Promise<void>` |
| `queryInterface<T>(name)` | Query service interface | `Promise<T>` |
| `invoke(service, method, ...args)` | Direct method invocation | `Promise<any>` |
| `getMetrics()` | Get client metrics | `any` |

### BrowserLogger

```typescript
interface ILogger {
  debug(message: string): void;
  debug(obj: any, message?: string): void;
  info(message: string): void;
  info(obj: any, message?: string): void;
  warn(message: string): void;
  warn(obj: any, message?: string): void;
  error(message: string): void;
  error(obj: any, message?: string): void;
  child(context: any): ILogger;
}

const logger = new BrowserLogger({ app: 'my-app' });
```

---

## Advanced Usage

### Custom Logger

```typescript
import { BrowserLogger } from '@omnitron-dev/aether/netron';

// Create logger with context
const logger = new BrowserLogger({
  app: 'my-app',
  version: '1.0.0',
  environment: 'production',
});

// Use with client
const client = new NetronClient({
  url: 'ws://localhost:3000',
  logger,
});

// Child loggers
const requestLogger = logger.child({ requestId: '123' });
requestLogger.info('Processing request');
```

### Authentication

```typescript
// HTTP Client with auth headers
const client = new HttpNetronClient({
  baseUrl: 'http://localhost:3000',
  headers: {
    'Authorization': `Bearer ${authToken}`,
  },
});

// WebSocket Client - authenticate after connection
const wsClient = new NetronClient({ url: 'ws://localhost:3000' });
await wsClient.connect();

const peer = wsClient.getPeer();
if (peer) {
  // Use authenticate core-task
  await peer.runTask('authenticate', { token: authToken });
}
```

### Error Handling

```typescript
try {
  const service = await client.queryInterface('MyService@1.0.0');
  const result = await service.myMethod();
} catch (error) {
  if (error.code === 'NOT_FOUND') {
    console.error('Service not found');
  } else if (error.code === 'TIMEOUT') {
    console.error('Request timeout');
  } else if (error.code === 'UNAUTHORIZED') {
    console.error('Authentication required');
  } else {
    console.error('Unknown error:', error);
  }
}
```

### Streams

```typescript
// Netron supports streams for large data transfers
const service = await client.queryInterface<FileService>('FileService@1.0.0');

// Download file as stream
const readableStream = await service.downloadFile('large-file.zip');

// Read stream chunks
const reader = readableStream.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log('Chunk:', value);
}
```

### Timeouts

```typescript
// Global timeout
const client = new NetronClient({
  url: 'ws://localhost:3000',
  timeout: 60000, // 60 seconds
});

// Per-request timeout (using AbortController)
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

try {
  const service = await client.queryInterface('SlowService@1.0.0');
  // Service methods will use global timeout
  const result = await service.slowMethod();
} catch (error) {
  if (error.name === 'AbortError') {
    console.error('Request timeout');
  }
}
```

---

## Best Practices

### 1. Use TypeScript

Define service interfaces for type safety:

```typescript
interface UserService {
  getUser(id: string): Promise<User>;
  listUsers(filter?: UserFilter): Promise<User[]>;
}

const service = await client.queryInterface<UserService>('UserService@1.0.0');
```

### 2. Handle Connection Errors

```typescript
const client = new NetronClient({
  url: 'ws://localhost:3000',
  reconnect: true,
});

try {
  await client.connect();
} catch (error) {
  console.error('Failed to connect:', error);
  // Show user-friendly error message
}
```

### 3. Clean Up Connections

```typescript
// In React
useEffect(() => {
  const client = new NetronClient({ url: 'ws://localhost:3000' });
  client.connect();

  return () => {
    client.disconnect(); // Clean up on unmount
  };
}, []);
```

### 4. Use Event Subscriptions Wisely

```typescript
// Unsubscribe when no longer needed
const handler = (data) => console.log(data);

await client.subscribe('updates', handler);

// Later...
await client.unsubscribe('updates', handler);
```

### 5. Implement Retry Logic

```typescript
async function connectWithRetry(maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await client.connect();
      return;
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### 6. Use Connection Pooling

```typescript
// Singleton pattern for shared client
class NetronClientManager {
  private static instance: NetronClient | null = null;

  static async getClient(): Promise<NetronClient> {
    if (!this.instance) {
      this.instance = new NetronClient({ url: 'ws://localhost:3000' });
      await this.instance.connect();
    }
    return this.instance;
  }
}

// Usage
const client = await NetronClientManager.getClient();
```

---

## Troubleshooting

### Connection Refused

**Problem**: `WebSocket connection to 'ws://localhost:3000' failed`

**Solution**:
- Ensure Titan backend is running
- Check firewall settings
- Verify correct URL and port

### CORS Errors (HTTP Client)

**Problem**: `Access to fetch at 'http://localhost:3000' from origin 'http://localhost:5173' has been blocked by CORS`

**Solution**:
- Configure CORS on Titan backend
- Add allowed origins in Titan configuration

### Timeout Errors

**Problem**: `Request timeout exceeded`

**Solution**:
```typescript
// Increase timeout
const client = new NetronClient({
  url: 'ws://localhost:3000',
  timeout: 60000, // 60 seconds
});
```

### Service Not Found

**Problem**: `Service 'MyService@1.0.0' not found`

**Solution**:
- Verify service is registered on backend
- Check service name and version match exactly
- Ensure service is exposed with `@Public()` decorator

### MessagePack Decode Errors

**Problem**: `Failed to decode MessagePack data`

**Solution**:
- Ensure both client and server use same MessagePack version
- Check for binary data corruption
- Verify WebSocket binaryType is set to 'arraybuffer'

---

## Support

- **Documentation**: [packages/aether/docs/](../docs/)
- **Issues**: [GitHub Issues](https://github.com/omnitron-dev/omnitron/issues)
- **Discussions**: [GitHub Discussions](https://github.com/omnitron-dev/omnitron/discussions)

---

## License

MIT License - See [LICENSE](../../LICENSE) for details.
