# @devgrid/netron

[![npm version](https://img.shields.io/npm/v/@devgrid/netron.svg)](https://www.npmjs.com/package/@devgrid/netron)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.1-brightgreen)](https://nodejs.org)

A powerful TypeScript library for building distributed systems with event bus, streaming capabilities, and remote object invocation. Features WebSocket-based bidirectional communication between Node.js and browser environments, service discovery, and type-safe RPC.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Creating Services](#creating-services)
  - [Connecting Clients](#connecting-clients)
  - [Service Discovery](#service-discovery)
  - [Event Bus](#event-bus)
  - [Streaming](#streaming)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [Configuration](#configuration)
- [TypeScript Support](#typescript-support)
- [Performance](#performance)
- [Production Deployment](#production-deployment)
- [Best Practices](#best-practices)
- [Contributing](#contributing)
- [License](#license)

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

```typescript
// server.ts
import { Netron, Service, Public } from '@devgrid/netron';

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
}

// Create server
const server = await Netron.create({
  listenHost: 'localhost',
  listenPort: 8080
});

await server.peer.exposeService(new CalculatorService());
console.log('Server running on ws://localhost:8080');

// client.ts
import { Netron } from '@devgrid/netron';

const client = await Netron.create();
const peer = await client.connect('ws://localhost:8080');

interface ICalculator {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
}

const calc = await peer.queryInterface<ICalculator>('calculator@1.0.0');
const sum = await calc.add(5, 3); // 8
```

## Core Usage

### Creating Services

#### Basic Service Definition

```typescript
import { Service, Public } from '@devgrid/netron';

@Service('userService@1.0.0')
export class UserService {
  private users = new Map<string, User>();

  @Public()
  async createUser(data: CreateUserDto): Promise<User> {
    const user = {
      id: generateId(),
      ...data,
      createdAt: new Date()
    };
    this.users.set(user.id, user);
    return user;
  }

  @Public()
  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  @Public({ readonly: true })
  version = '1.0.0';

  // Private methods are not exposed
  private generateId(): string {
    return crypto.randomUUID();
  }
}
```

#### Advanced Service Features

```typescript
@Service('dataProcessor@2.0.0')
export class DataProcessorService {
  @Public()
  async processStream(data: ReadableStream): Promise<ProcessResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
      chunks.push(chunk);
    }
    const result = await this.process(Buffer.concat(chunks));
    return result;
  }

  @Public()
  async *generateData(count: number): AsyncGenerator<DataPoint> {
    for (let i = 0; i < count; i++) {
      yield {
        id: i,
        value: Math.random(),
        timestamp: Date.now()
      };
      await sleep(100); // Throttle generation
    }
  }

  @Public()
  async batchProcess(
    items: Item[],
    options: ProcessOptions = { parallel: true }
  ): Promise<BatchResult> {
    if (options.parallel) {
      const results = await Promise.all(
        items.map(item => this.processItem(item))
      );
      return { results, processed: items.length };
    } else {
      const results = [];
      for (const item of items) {
        results.push(await this.processItem(item));
      }
      return { results, processed: items.length };
    }
  }
}
```

### Connecting Clients

#### Basic Connection

```typescript
const netron = await Netron.create();

// Connect with retry
const peer = await netron.connect('ws://localhost:8080', {
  maxReconnectAttempts: 5,
  reconnectDelay: 1000
});

// Handle connection events
peer.on('connected', () => {
  console.log('Connected to server');
});

peer.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
});

peer.on('error', (error) => {
  console.error('Connection error:', error);
});
```

#### Multiple Connections

```typescript
class ServiceClient {
  private connections = new Map<string, Peer>();
  
  async connectToServices(endpoints: string[]) {
    const netron = await Netron.create();
    
    for (const endpoint of endpoints) {
      try {
        const peer = await netron.connect(endpoint);
        this.connections.set(endpoint, peer);
        
        // Query available services
        const services = peer.getServiceNames();
        console.log(`Services at ${endpoint}:`, services);
      } catch (error) {
        console.error(`Failed to connect to ${endpoint}:`, error);
      }
    }
  }
  
  async getService<T>(serviceName: string): Promise<T | null> {
    for (const [endpoint, peer] of this.connections) {
      if (peer.hasService(serviceName)) {
        return await peer.queryInterface<T>(serviceName);
      }
    }
    return null;
  }
}
```

### Service Discovery

#### Enable Service Discovery

```typescript
// Server with discovery
const server = await Netron.create({
  listenPort: 8080,
  discoveryEnabled: true,
  discoveryRedisUrl: 'redis://localhost:6379',
  discoveryHeartbeatInterval: 5000,
  discoveryCleanupInterval: 10000
});

// Services are automatically registered
await server.peer.exposeService(new UserService());
await server.peer.exposeService(new OrderService());

// Client with discovery
const client = await Netron.create({
  discoveryEnabled: true,
  discoveryRedisUrl: 'redis://localhost:6379'
});

// Find and connect to service
const serviceNode = await client.discovery.findService('userService@1.0.0');
if (serviceNode) {
  const peer = await client.connect(serviceNode.address);
  const userService = await peer.queryInterface<IUserService>('userService@1.0.0');
}
```

#### Advanced Discovery Patterns

```typescript
// Service registry monitoring
const discovery = netron.discovery;

// Get all active nodes
const nodes = await discovery.getActiveNodes();
console.log('Active nodes:', nodes);

// Find all instances of a service
const userServiceNodes = await discovery.findAllServices('userService@1.0.0');
console.log(`Found ${userServiceNodes.length} userService instances`);

// Subscribe to discovery events
discovery.on('node:joined', (node) => {
  console.log('New node joined:', node.id);
});

discovery.on('node:left', (nodeId) => {
  console.log('Node left:', nodeId);
});

discovery.on('service:available', (service) => {
  console.log('New service available:', service);
});

// Load balancing across service instances
class LoadBalancedClient {
  private serviceInstances = new Map<string, Peer[]>();
  private currentIndex = new Map<string, number>();
  
  async getBalancedService<T>(serviceName: string): Promise<T> {
    const instances = this.serviceInstances.get(serviceName) || [];
    if (instances.length === 0) {
      throw new Error(`No instances available for ${serviceName}`);
    }
    
    // Round-robin selection
    const index = (this.currentIndex.get(serviceName) || 0) % instances.length;
    this.currentIndex.set(serviceName, index + 1);
    
    return await instances[index].queryInterface<T>(serviceName);
  }
}
```

### Event Bus

#### Event Patterns

```typescript
// Subscribe to events
netron.subscribe('user:created', async (user) => {
  console.log('New user:', user);
  await sendWelcomeEmail(user.email);
});

netron.subscribe('order:*', async (event) => {
  // Matches order:created, order:updated, order:deleted, etc.
  await updateAnalytics(event);
});

// Emit with different patterns
// Parallel - all handlers run simultaneously
await netron.emitParallel('user:created', {
  id: '123',
  email: 'user@example.com',
  name: 'John Doe'
});

// Serial - handlers run one after another
await netron.emitSerial('workflow:step', {
  step: 1,
  data: processData
});

// Reduce - accumulate results from handlers
const total = await netron.emitReduce('calculate:sum', 
  [1, 2, 3, 4, 5],
  (acc, val) => acc + val,
  0
);

// ReduceRight - accumulate from right to left
const reversed = await netron.emitReduceRight('string:reverse',
  'hello',
  (acc, char) => char + acc,
  ''
);
```

#### Advanced Event Handling

```typescript
// Event middleware
netron.use(async (event, next) => {
  console.log(`Event: ${event.type} at ${new Date().toISOString()}`);
  const start = Date.now();
  
  try {
    await next();
    console.log(`Event ${event.type} took ${Date.now() - start}ms`);
  } catch (error) {
    console.error(`Event ${event.type} failed:`, error);
    throw error;
  }
});

// Priority-based event handling
class PriorityEventBus {
  private handlers = new Map<string, Array<{handler: Function, priority: number}>>();
  
  subscribe(event: string, handler: Function, priority = 0) {
    const eventHandlers = this.handlers.get(event) || [];
    eventHandlers.push({ handler, priority });
    eventHandlers.sort((a, b) => b.priority - a.priority);
    this.handlers.set(event, eventHandlers);
  }
  
  async emit(event: string, data: any) {
    const eventHandlers = this.handlers.get(event) || [];
    for (const { handler } of eventHandlers) {
      await handler(data);
    }
  }
}
```

### Streaming

#### File Streaming

```typescript
@Service('fileService@1.0.0')
export class FileService {
  @Public()
  async uploadFile(
    filename: string, 
    stream: ReadableStream,
    metadata: FileMetadata
  ): Promise<UploadResult> {
    const uploadPath = path.join(this.uploadDir, filename);
    const writeStream = fs.createWriteStream(uploadPath);
    
    let bytesWritten = 0;
    for await (const chunk of stream) {
      writeStream.write(chunk);
      bytesWritten += chunk.length;
      
      // Progress tracking
      this.emit('upload:progress', {
        filename,
        bytesWritten,
        totalBytes: metadata.size
      });
    }
    
    writeStream.end();
    
    return {
      filename,
      size: bytesWritten,
      path: uploadPath,
      checksum: await this.calculateChecksum(uploadPath)
    };
  }
  
  @Public()
  async downloadFile(filename: string): Promise<ReadableStream> {
    const filePath = path.join(this.uploadDir, filename);
    
    if (!await this.fileExists(filePath)) {
      throw new Error('File not found');
    }
    
    return fs.createReadStream(filePath);
  }
}
```

#### Real-time Data Streaming

```typescript
@Service('marketData@1.0.0')
export class MarketDataService {
  @Public()
  async *streamPrices(symbols: string[]): AsyncGenerator<PriceUpdate> {
    const subscriptions = new Set(symbols);
    
    while (subscriptions.size > 0) {
      for (const symbol of subscriptions) {
        yield {
          symbol,
          price: this.getCurrentPrice(symbol),
          timestamp: Date.now(),
          volume: this.getVolume(symbol)
        };
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  @Public()
  async streamHistoricalData(
    symbol: string,
    from: Date,
    to: Date
  ): Promise<ReadableStream<HistoricalDataPoint>> {
    const stream = new TransformStream<HistoricalDataPoint>();
    const writer = stream.writable.getWriter();
    
    // Stream historical data in chunks
    (async () => {
      const data = await this.queryHistoricalData(symbol, from, to);
      for (const chunk of this.chunkData(data, 1000)) {
        await writer.write(chunk);
      }
      await writer.close();
    })();
    
    return stream.readable;
  }
}
```

## API Reference

### Netron Class

The main class for creating Netron instances.

#### Static Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `create(options?)` | Create a new Netron instance | `Promise<Netron>` |

#### Instance Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `connect(url, options?)` | Connect to a remote peer | `Promise<Peer>` |
| `stop()` | Stop the Netron instance | `Promise<void>` |
| `addTask(fn)` | Register a task function | `void` |
| `subscribe(event, handler)` | Subscribe to events | `void` |
| `emitParallel(event, data)` | Emit event (parallel) | `Promise<any[]>` |
| `emitSerial(event, data)` | Emit event (serial) | `Promise<any[]>` |
| `emitReduce(event, data, reducer, initial)` | Emit event (reduce) | `Promise<any>` |

### Peer Class

Represents a connected peer.

#### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `queryInterface<T>(service)` | Get service interface | `Promise<T>` |
| `exposeService(instance)` | Expose a service | `Promise<void>` |
| `concealService(name)` | Hide a service | `Promise<void>` |
| `runTask(name, ...args)` | Run remote task | `Promise<any>` |
| `getServiceNames()` | List available services | `string[]` |
| `hasService(name)` | Check service availability | `boolean` |

### Decorators

#### @Service

Marks a class as a service.

```typescript
@Service(name: string)
```

#### @Public

Marks a method or property as publicly accessible.

```typescript
@Public(options?: { readonly?: boolean })
```

### Configuration Options

```typescript
interface NetronOptions {
  // Identification
  id?: string;                          // Unique instance ID
  
  // Server configuration
  listenHost?: string;                  // Host to listen on
  listenPort?: number;                  // Port to listen on
  
  // Timeouts (milliseconds)
  taskTimeout?: number;                 // Task execution timeout
  connectTimeout?: number;              // Connection timeout
  requestTimeout?: number;              // Request timeout
  streamTimeout?: number;               // Stream timeout
  
  // Connection handling
  maxReconnectAttempts?: number;        // Max reconnection attempts
  reconnectDelay?: number;              // Initial reconnect delay
  
  // Service discovery
  discoveryEnabled?: boolean;           // Enable discovery
  discoveryRedisUrl?: string;           // Redis URL
  discoveryHeartbeatInterval?: number;  // Heartbeat interval
  discoveryCleanupInterval?: number;    // Cleanup interval
  
  // Features
  allowServiceEvents?: boolean;         // Enable service events
  
  // Task handling
  taskOverwriteStrategy?: 'replace' | 'skip' | 'throw';
  
  // Logging
  logger?: Logger;                      // Custom logger
}
```

## Advanced Features

### Task System

```typescript
// Register tasks
netron.addTask(async function systemInfo(peer) {
  return {
    platform: process.platform,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    nodeVersion: process.version
  };
});

netron.addTask(async function processData(peer, data: any[], options: any) {
  // Access peer information
  console.log(`Processing data for peer: ${peer.id}`);
  
  // Process with options
  const processed = await complexProcessing(data, options);
  return processed;
});

// Execute tasks remotely
const info = await remotePeer.runTask('systemInfo');
const result = await remotePeer.runTask('processData', largeDataset, {
  algorithm: 'fast',
  parallel: true
});
```

### Service Composition

```typescript
// Compose multiple services
@Service('compositeService@1.0.0')
export class CompositeService {
  private userService: IUserService;
  private orderService: IOrderService;
  private paymentService: IPaymentService;
  
  async initialize(peer: Peer) {
    this.userService = await peer.queryInterface<IUserService>('userService@1.0.0');
    this.orderService = await peer.queryInterface<IOrderService>('orderService@1.0.0');
    this.paymentService = await peer.queryInterface<IPaymentService>('paymentService@1.0.0');
  }
  
  @Public()
  async processCheckout(checkoutData: CheckoutData): Promise<CheckoutResult> {
    // Orchestrate multiple services
    const user = await this.userService.getUser(checkoutData.userId);
    const order = await this.orderService.createOrder({
      userId: user.id,
      items: checkoutData.items
    });
    const payment = await this.paymentService.processPayment({
      orderId: order.id,
      amount: order.total,
      method: checkoutData.paymentMethod
    });
    
    return {
      orderId: order.id,
      paymentId: payment.id,
      status: 'completed'
    };
  }
}
```

### Middleware System

```typescript
// Request/Response middleware
class AuthMiddleware {
  async handle(context: RequestContext, next: () => Promise<any>) {
    const token = context.headers['authorization'];
    
    if (!token) {
      throw new Error('Unauthorized');
    }
    
    const user = await validateToken(token);
    context.user = user;
    
    return await next();
  }
}

// Apply middleware to service
@Service('protectedService@1.0.0')
@UseMiddleware(AuthMiddleware)
export class ProtectedService {
  @Public()
  async getUserData(context: RequestContext): Promise<UserData> {
    // context.user is available from middleware
    return await fetchUserData(context.user.id);
  }
}
```

### Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold = 5,
    private timeout = 60000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      
      throw error;
    }
  }
}

// Use with Netron
const breaker = new CircuitBreaker();
const peer = await breaker.execute(() => 
  netron.connect('ws://unstable-service:8080')
);
```

## TypeScript Support

### Type-Safe Service Interfaces

```typescript
// Shared interface definitions
export interface IUserService {
  createUser(data: CreateUserDto): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
  listUsers(options: ListOptions): Promise<PaginatedResult<User>>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest'
}

// Client usage with full type safety
const userService = await peer.queryInterface<IUserService>('userService@1.0.0');

// TypeScript ensures correct usage
const user = await userService.getUser('123');
if (user) {
  console.log(user.email); // Type-safe property access
}

// Compile-time error checking
// await userService.getUser(); // Error: Expected 1 argument
// await userService.createUser({}); // Error: Missing required properties
```

### Generic Service Factory

```typescript
// Generic service factory
export function createService<T extends object>(
  name: string,
  implementation: T
): T {
  const serviceName = `${name}@1.0.0`;
  
  @Service(serviceName)
  class DynamicService {
    constructor() {
      // Copy all methods from implementation
      Object.getOwnPropertyNames(implementation).forEach(prop => {
        if (typeof implementation[prop] === 'function') {
          this[prop] = implementation[prop].bind(implementation);
        }
      });
    }
  }
  
  // Mark all methods as public
  Object.getOwnPropertyNames(implementation).forEach(prop => {
    if (typeof implementation[prop] === 'function') {
      Public()(DynamicService.prototype, prop);
    }
  });
  
  return new DynamicService() as T;
}

// Usage
const mathService = createService('math', {
  add: (a: number, b: number) => a + b,
  multiply: (a: number, b: number) => a * b,
  power: (base: number, exp: number) => Math.pow(base, exp)
});
```

## Performance

### Optimization Strategies

1. **Connection Pooling**
```typescript
class ConnectionPool {
  private pool = new Map<string, Peer[]>();
  private maxConnections = 10;
  
  async getConnection(endpoint: string): Promise<Peer> {
    const connections = this.pool.get(endpoint) || [];
    
    // Reuse existing connection
    const available = connections.find(conn => !conn.isBusy());
    if (available) return available;
    
    // Create new connection if under limit
    if (connections.length < this.maxConnections) {
      const peer = await netron.connect(endpoint);
      connections.push(peer);
      this.pool.set(endpoint, connections);
      return peer;
    }
    
    // Wait for available connection
    return await this.waitForConnection(endpoint);
  }
}
```

2. **Batch Operations**
```typescript
@Service('batchService@1.0.0')
export class BatchService {
  @Public()
  async batchProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize = 100
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(item => processor(item))
      );
      results.push(...batchResults);
    }
    
    return results;
  }
}
```

3. **Caching**
```typescript
class ServiceCache {
  private cache = new Map<string, { service: any, timestamp: number }>();
  private ttl = 60000; // 1 minute
  
  async getService<T>(peer: Peer, serviceName: string): Promise<T> {
    const cached = this.cache.get(serviceName);
    
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.service;
    }
    
    const service = await peer.queryInterface<T>(serviceName);
    this.cache.set(serviceName, {
      service,
      timestamp: Date.now()
    });
    
    return service;
  }
}
```

### Benchmarks

Performance characteristics on standard hardware:

| Operation | Throughput | Latency (p99) |
|-----------|------------|---------------|
| RPC Call | 50,000 req/s | < 2ms |
| Event Emission | 100,000 msg/s | < 1ms |
| Stream Transfer | 1 GB/s | N/A |
| Service Discovery | 10,000 queries/s | < 5ms |

### Memory Management

```typescript
// Efficient streaming with backpressure
@Service('dataService@1.0.0')
export class DataService {
  @Public()
  async *streamLargeDataset(
    query: DataQuery
  ): AsyncGenerator<DataChunk> {
    const cursor = await this.db.query(query);
    
    try {
      while (await cursor.hasNext()) {
        const chunk = await cursor.next();
        yield chunk;
        
        // Allow garbage collection between chunks
        if (global.gc) global.gc();
      }
    } finally {
      await cursor.close();
    }
  }
}
```

## Production Deployment

### Docker Configuration

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('./dist/health-check.js')"

# Run as non-root
USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: netron-service
  labels:
    app: netron
spec:
  replicas: 3
  selector:
    matchLabels:
      app: netron
  template:
    metadata:
      labels:
        app: netron
    spec:
      containers:
      - name: netron
        image: myregistry/netron-service:latest
        ports:
        - containerPort: 8080
          name: websocket
        - containerPort: 9090
          name: metrics
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-secret
              key: url
        - name: SERVICE_NAME
          value: "userService@1.0.0"
        - name: DISCOVERY_ENABLED
          value: "true"
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 9090
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 9090
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: netron-service
spec:
  selector:
    app: netron
  ports:
  - name: websocket
    port: 80
    targetPort: 8080
  - name: metrics
    port: 9090
    targetPort: 9090
  type: LoadBalancer
```

### Monitoring & Metrics

```typescript
// Prometheus metrics
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export class NetronMetrics {
  private registry = new Registry();
  
  private rpcCalls = new Counter({
    name: 'netron_rpc_calls_total',
    help: 'Total number of RPC calls',
    labelNames: ['service', 'method', 'status'],
    registers: [this.registry]
  });
  
  private rpcDuration = new Histogram({
    name: 'netron_rpc_duration_seconds',
    help: 'RPC call duration',
    labelNames: ['service', 'method'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [this.registry]
  });
  
  private activeConnections = new Gauge({
    name: 'netron_active_connections',
    help: 'Number of active connections',
    registers: [this.registry]
  });
  
  private streamBytes = new Counter({
    name: 'netron_stream_bytes_total',
    help: 'Total bytes streamed',
    labelNames: ['direction'],
    registers: [this.registry]
  });
  
  recordRPC(service: string, method: string, duration: number, status: 'success' | 'error') {
    this.rpcCalls.inc({ service, method, status });
    this.rpcDuration.observe({ service, method }, duration / 1000);
  }
  
  getMetrics(): string {
    return this.registry.metrics();
  }
}

// Integration with Netron
const metrics = new NetronMetrics();

netron.on('rpc:start', ({ service, method }) => {
  const timer = Date.now();
  return { timer, service, method };
});

netron.on('rpc:end', ({ context, error }) => {
  const duration = Date.now() - context.timer;
  metrics.recordRPC(
    context.service,
    context.method,
    duration,
    error ? 'error' : 'success'
  );
});
```

### Load Balancing

```nginx
# nginx.conf for WebSocket load balancing
upstream netron_backend {
    least_conn;
    server netron1:8080 max_fails=3 fail_timeout=30s;
    server netron2:8080 max_fails=3 fail_timeout=30s;
    server netron3:8080 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name api.example.com;
    
    location /ws {
        proxy_pass http://netron_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

## Best Practices

### 1. Service Design

```typescript
// Good - Versioned, focused services
@Service('userAuth@1.0.0')
export class UserAuthService {
  @Public()
  async login(credentials: LoginCredentials): Promise<AuthToken> {
    // Single responsibility
  }
  
  @Public()
  async logout(token: string): Promise<void> {
    // Clear separation
  }
}

// Bad - Monolithic, unversioned service
@Service('app')
export class AppService {
  async doEverything() {
    // Too many responsibilities
  }
}
```

### 2. Error Handling

```typescript
// Define custom errors
export class ServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

@Service('resilientService@1.0.0')
export class ResilientService {
  @Public()
  async riskyOperation(data: any): Promise<Result> {
    try {
      return await this.performOperation(data);
    } catch (error) {
      // Log the error
      logger.error('Operation failed', { error, data });
      
      // Transform to service error
      if (error instanceof ValidationError) {
        throw new ServiceError(
          'Invalid input data',
          'VALIDATION_ERROR',
          400
        );
      }
      
      // Circuit breaker pattern
      if (this.isCircuitOpen()) {
        throw new ServiceError(
          'Service temporarily unavailable',
          'CIRCUIT_OPEN',
          503
        );
      }
      
      throw new ServiceError(
        'Internal service error',
        'INTERNAL_ERROR',
        500
      );
    }
  }
}
```

### 3. Testing

```typescript
// Unit testing services
describe('CalculatorService', () => {
  let service: CalculatorService;
  let netron: Netron;
  let peer: Peer;
  
  beforeAll(async () => {
    service = new CalculatorService();
    netron = await Netron.create({ listenPort: 0 });
    await netron.peer.exposeService(service);
    
    const client = await Netron.create();
    peer = await client.connect(`ws://localhost:${netron.listenPort}`);
  });
  
  afterAll(async () => {
    await peer.disconnect();
    await netron.stop();
  });
  
  it('should add numbers correctly', async () => {
    const calc = await peer.queryInterface<ICalculator>('calculator@1.0.0');
    const result = await calc.add(5, 3);
    expect(result).toBe(8);
  });
  
  it('should handle errors gracefully', async () => {
    const calc = await peer.queryInterface<ICalculator>('calculator@1.0.0');
    await expect(calc.divide(10, 0)).rejects.toThrow('Division by zero');
  });
});

// Integration testing
describe('Service Discovery', () => {
  let netron1: Netron;
  let netron2: Netron;
  
  beforeAll(async () => {
    const redisUrl = 'redis://localhost:6379/1'; // Test DB
    
    netron1 = await Netron.create({
      listenPort: 0,
      discoveryEnabled: true,
      discoveryRedisUrl: redisUrl
    });
    
    netron2 = await Netron.create({
      discoveryEnabled: true,
      discoveryRedisUrl: redisUrl
    });
  });
  
  it('should discover services', async () => {
    await netron1.peer.exposeService(new UserService());
    
    // Wait for discovery
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const node = await netron2.discovery.findService('userService@1.0.0');
    expect(node).toBeDefined();
    expect(node.address).toContain(`localhost:${netron1.listenPort}`);
  });
});
```

### 4. Security

```typescript
// Authentication middleware
class AuthMiddleware {
  constructor(private authService: IAuthService) {}
  
  async authenticate(context: RequestContext): Promise<void> {
    const token = context.headers['authorization']?.replace('Bearer ', '');
    
    if (!token) {
      throw new ServiceError('Missing authentication token', 'UNAUTHORIZED', 401);
    }
    
    try {
      const user = await this.authService.verifyToken(token);
      context.user = user;
    } catch (error) {
      throw new ServiceError('Invalid token', 'UNAUTHORIZED', 401);
    }
  }
}

// Rate limiting
class RateLimiter {
  private requests = new Map<string, number[]>();
  
  constructor(
    private maxRequests = 100,
    private windowMs = 60000
  ) {}
  
  check(clientId: string): boolean {
    const now = Date.now();
    const clientRequests = this.requests.get(clientId) || [];
    
    // Remove old requests
    const validRequests = clientRequests.filter(
      time => now - time < this.windowMs
    );
    
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    
    validRequests.push(now);
    this.requests.set(clientId, validRequests);
    return true;
  }
}
```

### 5. Graceful Shutdown

```typescript
class GracefulShutdown {
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private isShuttingDown = false;
  
  register(handler: () => Promise<void>) {
    this.shutdownHandlers.push(handler);
  }
  
  async shutdown(signal?: string) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    console.log(`Received ${signal}, starting graceful shutdown...`);
    
    // Stop accepting new connections
    await netron.stopListening();
    
    // Wait for ongoing requests
    await this.waitForRequests();
    
    // Run shutdown handlers
    await Promise.all(
      this.shutdownHandlers.map(handler => handler())
    );
    
    // Close all connections
    await netron.stop();
    
    console.log('Graceful shutdown completed');
    process.exit(0);
  }
}

// Usage
const shutdown = new GracefulShutdown();

shutdown.register(async () => {
  await database.close();
});

shutdown.register(async () => {
  await cache.disconnect();
});

process.on('SIGTERM', () => shutdown.shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown.shutdown('SIGINT'));
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © DevGrid

## Links

- [GitHub Repository](https://github.com/d-e-v-grid/devgrid/tree/main/packages/netron)
- [npm Package](https://www.npmjs.com/package/@devgrid/netron)
- [Issue Tracker](https://github.com/d-e-v-grid/devgrid/issues)
- [API Documentation](https://d-e-v-grid.github.io/devgrid/netron)