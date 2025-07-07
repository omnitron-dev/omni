# @devgrid/netron

A powerful TypeScript library for building distributed systems with WebSocket-based communication, remote procedure calls (RPC), event bus capabilities, and service discovery. Designed for real-time bidirectional communication between Node.js services and browser clients.

## Features

- 🔄 **Bidirectional Communication** - Full-duplex WebSocket connections
- 📦 **Type-Safe RPC** - Remote object invocation with TypeScript support
- 🚀 **Event Bus** - Multiple emission patterns (parallel, serial, reduce)
- 💫 **Streaming Support** - Efficient handling of large data transfers
- 🛡️ **Decorators** - Simple service definition with TypeScript decorators
- 🔍 **Service Discovery** - Redis-based automatic service discovery
- ⚡ **MessagePack** - Efficient binary serialization
- 🔄 **Auto Reconnection** - Resilient connection handling
- 📡 **Service Versioning** - Version-aware service resolution
- 🌐 **Cross-Platform** - Works in Node.js and modern browsers

## Installation

```bash
npm install @devgrid/netron
# or
yarn add @devgrid/netron
# or
pnpm add @devgrid/netron
```

## Quick Start

### Creating a Service

```typescript
import { Netron, Service, Public } from '@devgrid/netron';

// Define a service with decorators
@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    return a * b;
  }

  @Public({ readonly: true })
  pi = 3.14159;
}

// Create server and expose service
const server = await Netron.create({
  listenHost: 'localhost',
  listenPort: 8080
});

await server.peer.exposeService(new CalculatorService());
console.log('Server running on ws://localhost:8080');
```

### Connecting from Client

```typescript
import { Netron } from '@devgrid/netron';

// Connect to server
const client = await Netron.create();
const peer = await client.connect('ws://localhost:8080');

// Query and use remote service
interface ICalculator {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
  pi: Promise<number>;
}

const calc = await peer.queryInterface<ICalculator>('calculator@1.0.0');

// Call remote methods
const sum = await calc.add(5, 3);        // 8
const product = await calc.multiply(4, 2); // 8
const piValue = await calc.pi;            // 3.14159
```

## Advanced Features

### Service Discovery with Redis

Enable automatic service discovery across your distributed system:

```typescript
const netron = await Netron.create({
  listenPort: 8080,
  discoveryEnabled: true,
  discoveryRedisUrl: 'redis://localhost:6379',
  discoveryHeartbeatInterval: 5000,
  discoveryCleanupInterval: 10000
});

// Services are automatically registered and discovered
// Query available nodes
const nodes = await netron.discovery.getActiveNodes();

// Find specific service
const serviceNode = await netron.discovery.findService('calculator@1.0.0');
if (serviceNode) {
  const peer = await netron.connect(serviceNode.address);
  const calc = await peer.queryInterface('calculator@1.0.0');
}
```

### Event Bus Patterns

Netron provides multiple event emission patterns:

```typescript
// Subscribe to events
peer.subscribe('user:login', async (data) => {
  console.log('User logged in:', data.userId);
});

// Emit events with different patterns
// Parallel - all handlers execute simultaneously
await netron.emitParallel('user:login', { userId: 123 });

// Serial - handlers execute one after another
await netron.emitSerial('process:step', { step: 1 });

// Reduce - accumulate results left-to-right
const result = await netron.emitReduce('calculate:sum', [1, 2, 3, 4]);

// ReduceRight - accumulate results right-to-left
const reversed = await netron.emitReduceRight('process:reverse', 'hello');
```

### Streaming Large Data

Handle large file transfers or continuous data streams:

```typescript
// Server-side streaming service
@Service('fileService@1.0.0')
class FileService {
  @Public()
  async downloadFile(filename: string): Promise<ReadableStream> {
    const stream = fs.createReadStream(filename);
    return stream;
  }

  @Public()
  async uploadFile(filename: string, stream: WritableStream): Promise<void> {
    const writeStream = fs.createWriteStream(filename);
    await pipeline(stream, writeStream);
  }
}

// Client-side usage
const fileService = await peer.queryInterface('fileService@1.0.0');

// Download
const readStream = await fileService.downloadFile('large-video.mp4');
for await (const chunk of readStream) {
  // Process chunks
}

// Upload
const uploadStream = await fileService.uploadFile('upload.zip');
await pipeline(fs.createReadStream('local.zip'), uploadStream);
```

### Task System

Define and execute tasks across peers:

```typescript
// Register a task
netron.addTask(async function healthCheck(peer) {
  return {
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now()
  };
});

// Execute task on remote peer
const health = await remotePeer.runTask('healthCheck');
console.log('Remote peer health:', health);

// Task with arguments
netron.addTask(async function processData(peer, data: any, options: any) {
  // Process data with options
  return processedResult;
});

const result = await remotePeer.runTask('processData', rawData, { mode: 'fast' });
```

### Service Lifecycle & Events

Monitor service lifecycle events:

```typescript
// Enable service events
const netron = await Netron.create({
  allowServiceEvents: true
});

// Listen for service events
netron.on('service:exposed', ({ service, peer }) => {
  console.log(`Service ${service} exposed by ${peer.id}`);
});

netron.on('service:concealed', ({ service, peer }) => {
  console.log(`Service ${service} concealed by ${peer.id}`);
});

netron.on('peer:connected', (peer) => {
  console.log(`Peer connected: ${peer.id}`);
});

netron.on('peer:disconnected', (peer) => {
  console.log(`Peer disconnected: ${peer.id}`);
});
```

### Advanced Service Definitions

```typescript
@Service('advanced@2.0.0')
class AdvancedService {
  // Readonly properties
  @Public({ readonly: true })
  version = '2.0.0';
  
  @Public({ readonly: true })
  startTime = Date.now();

  // Async methods with complex types
  @Public()
  async processUser(user: User): Promise<ProcessedUser> {
    // Complex processing
    return processedUser;
  }

  // Methods with multiple parameters
  @Public()
  async batchProcess(
    items: Item[],
    options: ProcessOptions = {}
  ): Promise<BatchResult> {
    // Batch processing logic
  }

  // Private methods are not exposed
  private validateUser(user: User): boolean {
    // Internal validation
  }
}
```

## Configuration

```typescript
interface NetronOptions {
  // Identification
  id?: string;                      // Unique instance ID
  
  // Server options
  listenHost?: string;              // Host to listen on
  listenPort?: number;              // Port to listen on
  
  // Timeouts (in milliseconds)
  taskTimeout?: number;             // Task execution timeout (default: 5000)
  connectTimeout?: number;          // Connection timeout (default: 5000)
  requestTimeout?: number;          // Request timeout (default: 5000)
  streamTimeout?: number;           // Stream timeout (default: 5000)
  
  // Task handling
  taskOverwriteStrategy?: 'replace' | 'skip' | 'throw';
  
  // Features
  allowServiceEvents?: boolean;     // Enable service lifecycle events
  
  // Reconnection
  maxReconnectAttempts?: number;    // Max reconnection attempts
  reconnectDelay?: number;          // Initial reconnect delay
  
  // Service Discovery (Redis)
  discoveryEnabled?: boolean;       // Enable service discovery
  discoveryRedisUrl?: string;       // Redis connection URL
  discoveryHeartbeatInterval?: number; // Heartbeat interval (ms)
  discoveryCleanupInterval?: number;   // Cleanup interval (ms)
  
  // Logging
  logger?: Logger;                  // Custom logger instance
}
```

## Best Practices

### 1. Service Versioning

Always version your services to ensure compatibility:

```typescript
@Service('api@1.0.0')  // Good - includes version
@Service('api')        // Bad - no version
```

### 2. Error Handling

Implement proper error handling in services:

```typescript
@Service('userService@1.0.0')
class UserService {
  @Public()
  async getUser(id: string): Promise<User> {
    try {
      const user = await db.findUser(id);
      if (!user) {
        throw new Error('User not found');
      }
      return user;
    } catch (error) {
      // Log error
      logger.error('Failed to get user:', error);
      throw error; // Re-throw for client handling
    }
  }
}
```

### 3. Resource Cleanup

Always clean up resources properly:

```typescript
const netron = await Netron.create({ listenPort: 8080 });

// Graceful shutdown
process.on('SIGINT', async () => {
  await netron.stop();
  process.exit(0);
});
```

### 4. Type Safety

Define interfaces for your services:

```typescript
// Shared types
interface IUserService {
  getUser(id: string): Promise<User>;
  createUser(data: CreateUserDto): Promise<User>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
}

// Client usage with full type safety
const userService = await peer.queryInterface<IUserService>('userService@1.0.0');
const user = await userService.getUser('123'); // Fully typed!
```

## Performance Tips

1. **Use MessagePack** - Netron uses MessagePack by default for efficient serialization
2. **Batch Operations** - Group multiple operations when possible
3. **Stream Large Data** - Use streaming for files or large datasets
4. **Connection Pooling** - Reuse connections instead of creating new ones
5. **Service Discovery Caching** - Cache discovered services to reduce Redis queries

## Troubleshooting

### Connection Issues

```typescript
// Enable debug logging
const netron = await Netron.create({
  logger: {
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error
  }
});

// Handle connection errors
try {
  const peer = await netron.connect('ws://localhost:8080');
} catch (error) {
  console.error('Connection failed:', error);
}
```

### Service Not Found

```typescript
// List available services
const services = peer.getServiceNames();
console.log('Available services:', services);

// Check service metadata
const metadata = await peer.getServiceMetadata('calculator@1.0.0');
console.log('Service metadata:', metadata);
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © DevGrid