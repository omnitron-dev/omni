# WebSocket Transport for Netron Browser

Browser-compatible WebSocket transport implementation for real-time RPC communication with Titan's Netron server.

## Features

- **Full Packet Protocol Support**: Uses the same binary packet encoding/decoding as the server
- **Automatic Reconnection**: Exponential backoff with configurable retry attempts
- **Message Queueing**: Queues messages during disconnection and sends them when reconnected
- **Keep-Alive**: Automatic ping/pong mechanism to detect dead connections
- **Event Subscriptions**: Full support for server-side event subscriptions
- **Service Discovery**: Query service definitions from the server
- **Connection Metrics**: Track bytes sent/received, reconnection attempts, etc.

## Installation

The WebSocket transport is included in the `@omnitron-dev/netron-browser` package:

```bash
npm install @omnitron-dev/netron-browser
```

## Basic Usage

### Using WebSocketPeer (Recommended)

```typescript
import { WebSocketPeer } from '@omnitron-dev/netron-browser';

// Create WebSocket peer
const peer = new WebSocketPeer('ws://localhost:8080/netron', {
  reconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 10,
  keepAliveInterval: 30000,
});

// Connect to server
await peer.connect();

// Query interface for a service
const userService = await peer.queryInterface('UserService@1.0.0');

// Call methods
const user = await userService.getUser('user-123');
const users = await userService.listUsers({ page: 1, limit: 10 });

// Close connection
await peer.close();
```

### Using WebSocketConnection (Low-level)

```typescript
import { WebSocketConnection, Packet, TYPE_CALL } from '@omnitron-dev/netron-browser';

// Create WebSocket connection
const connection = new WebSocketConnection('ws://localhost:8080/netron', {
  reconnect: true,
  keepAliveInterval: 30000,
  queueMessages: true,
});

// Handle events
connection.on('connect', () => {
  console.log('Connected!');
});

connection.on('packet', (packet: Packet) => {
  console.log('Received packet:', packet);
});

connection.on('disconnect', ({ code, reason }) => {
  console.log('Disconnected:', code, reason);
});

// Connect
await connection.connect();

// Send packets
const packet = new Packet(Packet.nextId());
packet.setImpulse(1); // Request
packet.setType(TYPE_CALL);
packet.data = { method: 'test', args: [] };

await connection.send(packet);

// Close
await connection.close();
```

## Configuration Options

### WebSocketPeerOptions

```typescript
interface WebSocketPeerOptions {
  /** WebSocket protocols */
  protocols?: string | string[];

  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;

  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;

  /** Initial reconnection delay in milliseconds (default: 1000) */
  reconnectDelay?: number;

  /** Maximum reconnection delay in milliseconds (default: 30000) */
  maxReconnectDelay?: number;

  /** Reconnection backoff multiplier (default: 1.5) */
  reconnectBackoffMultiplier?: number;

  /** Maximum reconnection attempts (default: Infinity) */
  maxReconnectAttempts?: number;

  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;

  /** Keep-alive ping interval in milliseconds (default: 30000) */
  keepAliveInterval?: number;

  /** Keep-alive pong timeout in milliseconds (default: 5000) */
  keepAliveTimeout?: number;

  /** Queue messages during disconnection (default: true) */
  queueMessages?: boolean;

  /** Maximum queue size (default: 100) */
  maxQueueSize?: number;
}
```

## Connection States

```typescript
enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}
```

## Event Handling

### Connection Events

```typescript
connection.on('connect', () => {
  // Connection established
});

connection.on('disconnect', ({ code, reason }) => {
  // Connection closed
});

connection.on('error', (error) => {
  // Connection error
});

connection.on('reconnecting', ({ attempt, delay }) => {
  // Reconnection attempt
});

connection.on('reconnect', (attempts) => {
  // Successfully reconnected
});

connection.on('reconnect-failed', (attempts) => {
  // Reconnection failed after max attempts
});

connection.on('packet', (packet) => {
  // Received packet from server
});
```

## Reconnection Strategy

The WebSocket transport implements exponential backoff for reconnection:

1. Initial delay: `reconnectDelay` (default: 1000ms)
2. Each attempt multiplies delay by `reconnectBackoffMultiplier` (default: 1.5)
3. Maximum delay capped at `maxReconnectDelay` (default: 30000ms)
4. Stops after `maxReconnectAttempts` (default: Infinity)

Example delays with defaults:
- Attempt 1: 1000ms
- Attempt 2: 1500ms
- Attempt 3: 2250ms
- Attempt 4: 3375ms
- ...
- Capped at: 30000ms

## Message Queueing

When `queueMessages` is enabled (default), the transport will:

1. Queue outgoing messages during disconnection
2. Automatically send queued messages when reconnected
3. Reject queued messages if queue exceeds `maxQueueSize`

```typescript
const peer = new WebSocketPeer('ws://localhost:8080/netron', {
  queueMessages: true,
  maxQueueSize: 100,
});
```

## Keep-Alive Mechanism

The keep-alive mechanism prevents idle connections from timing out:

1. Sends ping packet every `keepAliveInterval` milliseconds
2. Expects pong response within `keepAliveTimeout` milliseconds
3. Closes connection if no pong received

```typescript
const peer = new WebSocketPeer('ws://localhost:8080/netron', {
  keepAliveInterval: 30000, // Send ping every 30 seconds
  keepAliveTimeout: 5000,   // Wait 5 seconds for pong
});
```

Set `keepAliveInterval: 0` to disable keep-alive.

## Service Discovery

```typescript
// Query interface with version
const service = await peer.queryInterface('UserService@1.0.0');

// Query latest version
const service = await peer.queryInterface('UserService');

// Query with wildcard
const service = await peer.queryInterface('UserService@*');
```

## Event Subscriptions

```typescript
// Subscribe to server events
await peer.subscribe('user.created', (data) => {
  console.log('User created:', data);
});

// Unsubscribe
await peer.unsubscribe('user.created', handler);
```

## Connection Metrics

```typescript
const metrics = peer.getMetrics();

console.log(metrics);
// {
//   id: 'ws-...',
//   url: 'ws://localhost:8080/netron',
//   state: 'connected',
//   bytesSent: 1234,
//   bytesReceived: 5678,
//   messagesSent: 10,
//   messagesReceived: 15,
//   reconnectCount: 2,
//   lastConnectTime: 1234567890,
//   lastDisconnectTime: 1234567800,
//   queuedMessages: 0,
// }
```

## Ping/Latency Measurement

```typescript
// Measure round-trip time
const rtt = await peer.ping();
console.log(`Latency: ${rtt}ms`);
```

## Error Handling

```typescript
try {
  const service = await peer.queryInterface('UnknownService');
} catch (error) {
  if (error.code === ErrorCode.NOT_FOUND) {
    console.log('Service not found');
  } else if (error.code === ErrorCode.REQUEST_TIMEOUT) {
    console.log('Request timed out');
  } else if (error.code === ErrorCode.CONNECTION_ERROR) {
    console.log('Connection error');
  }
}
```

## Comparison with HTTP Transport

| Feature | WebSocket | HTTP |
|---------|-----------|------|
| Real-time events | ✅ Yes | ❌ No |
| Server push | ✅ Yes | ❌ No |
| Connection overhead | Low (persistent) | High (per request) |
| Binary protocol | ✅ Yes | ❌ No (JSON) |
| Reconnection | ✅ Automatic | N/A |
| Caching | ❌ No | ✅ Yes |
| Request batching | ❌ No | ✅ Yes |
| Offline support | Via queueing | Via cache |

## Best Practices

1. **Enable Reconnection**: Always enable automatic reconnection for production
2. **Configure Keep-Alive**: Set appropriate keep-alive intervals based on your infrastructure
3. **Handle Events**: Always handle `disconnect` and `error` events
4. **Queue Messages**: Enable message queueing for better resilience
5. **Set Timeouts**: Configure appropriate timeouts based on your use case
6. **Monitor Metrics**: Use connection metrics for monitoring and debugging
7. **Graceful Shutdown**: Always call `close()` when done

## Browser Compatibility

The WebSocket transport uses native browser APIs:

- `WebSocket` - All modern browsers
- `EventTarget` - All modern browsers
- `TextEncoder/TextDecoder` - All modern browsers
- `setTimeout/clearTimeout` - All browsers
- `fetch` API - Not used by WebSocket transport

No polyfills required for modern browsers (Chrome 76+, Firefox 68+, Safari 13+, Edge 79+).

## Server-Side Setup

The WebSocket transport is compatible with Titan's WebSocket server:

```typescript
// Server (Titan)
import { Application } from '@omnitron-dev/titan';
import { NetronModule } from '@omnitron-dev/titan/netron';

const app = await Application.create({
  imports: [
    NetronModule.forRoot({
      transports: ['websocket'],
      websocket: {
        port: 8080,
        path: '/netron',
      },
    }),
  ],
});

await app.start();
```

## Advanced Usage

### Custom Error Handling

```typescript
peer.connection.on('error', (error) => {
  // Log to monitoring service
  logger.error('WebSocket error', error);

  // Notify user
  showNotification('Connection error', 'error');
});
```

### Connection State Monitoring

```typescript
peer.connection.on('connect', () => {
  updateConnectionIndicator('connected');
});

peer.connection.on('disconnect', () => {
  updateConnectionIndicator('disconnected');
});

peer.connection.on('reconnecting', ({ attempt }) => {
  updateConnectionIndicator(`reconnecting (${attempt})`);
});
```

### Custom Reconnection Logic

```typescript
const peer = new WebSocketPeer('ws://localhost:8080/netron', {
  reconnect: true,
  reconnectDelay: 2000,
  maxReconnectDelay: 60000,
  reconnectBackoffMultiplier: 2.0,
  maxReconnectAttempts: 5,
});

peer.connection.on('reconnect-failed', async () => {
  // Custom logic: try different endpoint
  await peer.close();

  const fallbackPeer = new WebSocketPeer('ws://fallback.example.com/netron');
  await fallbackPeer.connect();
});
```

## Troubleshooting

### Connection Timeouts

If connections are timing out, increase the `connectTimeout`:

```typescript
const peer = new WebSocketPeer('ws://localhost:8080/netron', {
  connectTimeout: 30000, // 30 seconds
});
```

### Frequent Disconnections

If connections are frequently dropping:

1. Check keep-alive settings
2. Verify network stability
3. Check server-side timeout settings
4. Review server logs

### High Latency

If experiencing high latency:

1. Measure with `peer.ping()`
2. Check network conditions
3. Verify server performance
4. Consider geographic proximity to server

## License

MIT
