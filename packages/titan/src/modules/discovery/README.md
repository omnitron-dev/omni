# Titan Discovery Module - Complete Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Installation & Setup](#installation--setup)
5. [Configuration Options](#configuration-options)
6. [Service Registration](#service-registration)
7. [Service Discovery](#service-discovery)
8. [Heartbeat Mechanism](#heartbeat-mechanism)
9. [Event System](#event-system)
10. [Client Mode](#client-mode)
11. [Redis Integration](#redis-integration)
12. [Lua Scripts](#lua-scripts)
13. [Module Integration](#module-integration)
14. [API Reference](#api-reference)
15. [Type Definitions](#type-definitions)
16. [Error Handling](#error-handling)
17. [Monitoring & Health](#monitoring--health)
18. [Performance Considerations](#performance-considerations)
19. [Best Practices](#best-practices)
20. [Migration Guide](#migration-guide)
21. [Troubleshooting](#troubleshooting)

## Introduction

The Titan Discovery Module provides distributed service discovery capabilities for Titan applications using Redis as a coordination backend. It enables automatic service registration, health monitoring through heartbeats, and real-time notifications of service state changes.

### Key Features

- **Automatic Service Registration**: Services automatically register themselves on startup
- **Heartbeat-Based Health Monitoring**: Continuous health monitoring with configurable intervals
- **Service Discovery**: Find services by name and version across the network
- **Real-Time Event Notifications**: PubSub-based notifications for service state changes
- **Client Mode**: Discovery-only mode for clients that don't provide services
- **Atomic Operations**: Lua scripts ensure atomic updates to prevent race conditions
- **Graceful Shutdown**: Automatic deregistration on service shutdown
- **Retry Logic**: Built-in retry mechanism with exponential backoff
- **Multiple Service Support**: Single node can register multiple services
- **Version-Aware Discovery**: Support for service versioning

### Use Cases

1. **Microservices Architecture**: Service discovery in distributed systems
2. **Load Balancing**: Find all instances of a service for load distribution
3. **Service Mesh**: Foundation for building service mesh architectures
4. **Health Monitoring**: Track service availability across the network
5. **Dynamic Routing**: Route requests to available service instances
6. **Auto-Scaling**: Discover new instances as they come online

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Application Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Service A  │  │   Service B  │  │   Service C  │          │
│  │  (Provider)  │  │  (Provider)  │  │   (Client)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
├─────────┼──────────────────┼──────────────────┼──────────────────┤
│         │         Discovery Service Layer     │                  │
│         └──────────────────┬──────────────────┘                  │
│                            │                                     │
│                    DiscoveryService                             │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  • Node Registration    • Service Discovery         │       │
│  │  • Heartbeat Management • Event Publishing          │       │
│  │  • Health Monitoring    • Node Deregistration       │       │
│  └──────────────────────┬───────────────────────────────┘       │
│                         │                                        │
│                    Redis Backend                                │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  • Node Data Storage    • Heartbeat Keys            │       │
│  │  • Service Index        • PubSub Channels           │       │
│  │  • Atomic Operations    • TTL Management            │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Service Start
    ↓
Node Registration → Redis Storage → Event Publication
    ↓                    ↓               ↓
Heartbeat Loop    Service Index    Event Subscribers
    ↓                    ↓               ↓
TTL Refresh      Discovery Queries   State Updates
    ↓                    ↓               ↓
Health Status     Load Balancing    Monitoring
```

### Redis Key Structure

```
titan:discovery:
├── nodes:{nodeId}          # Hash: Node information
│   ├── address             # Network address
│   ├── services            # JSON: Service array
│   └── timestamp           # Last update timestamp
├── heartbeat:{nodeId}      # String: Heartbeat indicator (TTL)
├── index:nodes             # Set: All node IDs
└── index:services:{name}   # Set: Node IDs providing service
```

## Core Components

### 1. DiscoveryService

The main service class that handles all discovery operations.

**Key Responsibilities:**
- Node registration and deregistration
- Heartbeat management
- Service discovery queries
- Event publishing and subscription
- Redis connection management
- Graceful shutdown handling

**Internal State:**
```typescript
class DiscoveryService implements IDiscoveryService {
  private redis: Redis;                    // Redis client instance
  private logger: ILogger;                 // Logger instance
  private nodeId: string;                  // Unique node identifier
  private address: string;                 // Network address
  private services: ServiceInfo[];         // Services provided by this node
  private heartbeatTimer?: NodeJS.Timeout; // Heartbeat interval timer
  private options: Required<DiscoveryOptions>; // Configuration options
  private subscriber?: Redis;               // PubSub subscriber client
  private eventEmitter: EventEmitter;      // Internal event emitter
  private stopped: boolean = false;        // Shutdown flag
  private registered: boolean = false;     // Registration status
  private shutdownPromise?: Promise<void>; // Graceful shutdown promise
}
```

**Node ID Generation:**
```typescript
private generateNodeId(): string {
  // Format: titan-{pid}-{timestamp}-{random}
  // Example: titan-12345-1234567890123-a7b8c9
  return `titan-${process.pid}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
```

**Address Detection:**
```typescript
private detectAddress(): string {
  // Uses environment variables or defaults
  // In production, should detect actual network interface
  return `${process.env['HOST'] || 'localhost'}:${process.env['PORT'] || '3000'}`;
}
```

**State Transitions:**
```
Created → Started → Registered → Stopping → Stopped
         ↓         ↓                      ↓
    (start())  (heartbeat)           (stop())
```

**Shutdown Promise Pattern:**
```typescript
async stop(): Promise<void> {
  if (this.stopped) {
    return this.shutdownPromise;  // Return existing promise if already stopping
  }

  this.stopped = true;
  this.shutdownPromise = (async () => {
    // Graceful shutdown logic
    // 1. Stop heartbeat timer
    // 2. Deregister node
    // 3. Unsubscribe from PubSub
    // 4. Log completion
  })();

  return this.shutdownPromise;
}
```

### 2. DiscoveryModule

The Titan module wrapper for the Discovery service.

**Features:**
- Module lifecycle management
- Dependency injection setup
- Redis client management
- Configuration handling
- Integration with Titan application

**Module Structure:**
```typescript
@Injectable()
@Module({
  name: 'discovery',
  providers: [
    DiscoveryService,
    {
      provide: DISCOVERY_SERVICE_TOKEN,
      useExisting: DiscoveryService
    }
  ],
  exports: [DISCOVERY_SERVICE_TOKEN]
})
export class DiscoveryModule implements IModule {
  name = 'discovery';
  version = '1.0.0';

  // Lifecycle hooks
  async onRegister(app: IApplication): Promise<void>;
  async onStart(app: IApplication): Promise<void>;
  async onStop(app: IApplication): Promise<void>;
  async onDestroy(): Promise<void>;
}
```

## Installation & Setup

### Basic Installation

```bash
# Install Titan (includes discovery module)
npm install @omnitron-dev/titan
npm install ioredis  # Redis client dependency
```

### Basic Setup

```typescript
import { Application } from '@omnitron-dev/titan';
import { DiscoveryModule } from '@omnitron-dev/titan/module/discovery';

const app = await Application.create({
  imports: [
    DiscoveryModule.forRoot({
      redisUrl: 'redis://localhost:6379',
      heartbeatInterval: 5000,
      heartbeatTTL: 15000
    })
  ]
});

await app.start();
```

### Advanced Setup

```typescript
import { Application } from '@omnitron-dev/titan';
import { DiscoveryModule } from '@omnitron-dev/titan/module/discovery';
import Redis from 'ioredis';

// Create Redis client with custom configuration
const redis = new Redis({
  host: 'redis.example.com',
  port: 6379,
  password: 'secret',
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3
});

const app = await Application.create({
  providers: [
    { provide: REDIS_TOKEN, useValue: redis }
  ],
  imports: [
    DiscoveryModule.forRoot({
      heartbeatInterval: 5000,
      heartbeatTTL: 15000,
      pubSubEnabled: true,
      pubSubChannel: 'discovery:events',
      redisPrefix: 'myapp:discovery',
      maxRetries: 3,
      retryDelay: 1000
    })
  ]
});

await app.start();
```

### Module Factory Function

```typescript
import { createDiscoveryModule } from '@omnitron-dev/titan/module/discovery';

const discoveryModule = createDiscoveryModule({
  redisUrl: 'redis://localhost:6379',
  heartbeatInterval: 5000,
  heartbeatTTL: 15000,
  clientMode: false
});

const app = await Application.create({
  imports: [discoveryModule]
});
```

## Configuration Options

### Complete Configuration Interface

```typescript
interface DiscoveryOptions {
  /**
   * Time interval in milliseconds between consecutive heartbeat messages.
   * Lower values increase network traffic but improve failure detection speed.
   * @default 5000
   */
  heartbeatInterval?: number;

  /**
   * Time-to-live in milliseconds for heartbeat records in the discovery system.
   * Should be greater than heartbeatInterval to allow for network delays.
   * @default 15000
   */
  heartbeatTTL?: number;

  /**
   * Enables or disables Redis Pub/Sub event broadcasting functionality.
   * When enabled, the system will publish node registration, update, and deregistration events.
   * @default false
   */
  pubSubEnabled?: boolean;

  /**
   * Redis Pub/Sub channel name for service discovery events.
   * All nodes in the network should use the same channel for proper event propagation.
   * @default 'titan:discovery:events'
   */
  pubSubChannel?: string;

  /**
   * Client mode flag - when true, disables heartbeat and node registration.
   * Useful for clients that only need to discover services without registering.
   * @default false
   */
  clientMode?: boolean;

  /**
   * Redis key prefix for all discovery-related keys.
   * @default 'titan:discovery'
   */
  redisPrefix?: string;

  /**
   * Maximum retry attempts for critical operations like heartbeat.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial retry delay in milliseconds for exponential backoff.
   * @default 1000
   */
  retryDelay?: number;
}

interface DiscoveryModuleOptions extends DiscoveryOptions {
  /**
   * Redis connection URL (alternative to providing Redis instance)
   */
  redisUrl?: string;

  /**
   * Redis client options (alternative to redisUrl)
   */
  redisOptions?: any;
}
```

### Configuration Examples

#### Minimal Configuration
```typescript
DiscoveryModule.forRoot({
  redisUrl: 'redis://localhost:6379'
})
```

#### Production Configuration
```typescript
DiscoveryModule.forRoot({
  redisUrl: process.env.REDIS_URL,
  heartbeatInterval: 10000,        // 10 seconds
  heartbeatTTL: 30000,            // 30 seconds
  pubSubEnabled: true,
  pubSubChannel: 'prod:discovery:events',
  redisPrefix: 'prod:discovery',
  maxRetries: 5,
  retryDelay: 2000
})
```

#### High-Availability Configuration
```typescript
DiscoveryModule.forRoot({
  redisOptions: {
    sentinels: [
      { host: 'sentinel1', port: 26379 },
      { host: 'sentinel2', port: 26379 },
      { host: 'sentinel3', port: 26379 }
    ],
    name: 'mymaster'
  },
  heartbeatInterval: 3000,         // 3 seconds for quick detection
  heartbeatTTL: 10000,            // 10 seconds
  pubSubEnabled: true,
  maxRetries: 10,
  retryDelay: 500
})
```

#### Client-Only Configuration
```typescript
DiscoveryModule.forRoot({
  redisUrl: 'redis://localhost:6379',
  clientMode: true,               // No registration or heartbeat
  pubSubEnabled: true            // Still receive events
})
```

## Service Registration

### Automatic Registration

Services are automatically registered when the Discovery module starts:

```typescript
@Injectable()
class MyService {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {}

  async onStart() {
    // Service is automatically registered with a unique node ID
    // and the address detected from the network interface
  }
}
```

### Manual Registration

```typescript
const discovery = app.get(DISCOVERY_SERVICE_TOKEN);

// Register a node with services
await discovery.registerNode(
  'custom-node-id',
  'localhost:3000',
  [
    { name: 'user-service', version: '1.0.0' },
    { name: 'auth-service', version: '2.1.0' }
  ]
);
```

### Dynamic Service Registration

```typescript
// Add a service to the current node dynamically
await discovery.registerService({
  name: 'new-service',
  version: '1.0.0'
});

// Remove a service from the current node
await discovery.unregisterService('old-service');

// Replace all services for the current node
await discovery.updateServices([
  { name: 'service-a', version: '2.0.0' },
  { name: 'service-b', version: '1.5.0' }
]);
```

### Node Information Access

```typescript
// Get current node information
const nodeId = discovery.getNodeId();        // e.g., "titan-12345-1234567890-abc123"
const address = discovery.getAddress();      // e.g., "localhost:3000"
const services = discovery.getServices();    // Array of ServiceInfo
const isRegistered = discovery.isRegistered(); // true if heartbeat active

console.log(`Node ${nodeId} at ${address} is ${isRegistered ? 'registered' : 'not registered'}`);
console.log('Providing services:', services);
```

### Updating Services

```typescript
// Update the services provided by a node
await discovery.updateNodeServices('node-id', [
  { name: 'user-service', version: '1.0.1' },
  { name: 'auth-service', version: '2.1.0' },
  { name: 'profile-service', version: '1.0.0' }  // New service
]);
```

### Updating Address

```typescript
// Update node address (e.g., after network change)
await discovery.updateNodeAddress('node-id', 'new-host:3001');
```

## Service Discovery

### Finding Services by Name

```typescript
const discovery = app.get(DISCOVERY_SERVICE_TOKEN);

// Find all nodes providing a service
const nodes = await discovery.findNodesByService('user-service');
console.log('User service nodes:', nodes);
// [
//   {
//     nodeId: 'node-abc-123',
//     address: 'server1:3000',
//     services: [{ name: 'user-service', version: '1.0.0' }],
//     timestamp: 1234567890
//   },
//   {
//     nodeId: 'node-def-456',
//     address: 'server2:3000',
//     services: [{ name: 'user-service', version: '1.0.0' }],
//     timestamp: 1234567891
//   }
// ]
```

### Finding Services by Version

```typescript
// Find nodes with specific service version
const nodes = await discovery.findNodesByService('user-service', '1.0.0');
```

### Getting All Active Nodes

```typescript
// Get all active nodes in the network
const activeNodes = await discovery.getActiveNodes();
console.log(`Found ${activeNodes.length} active nodes`);

activeNodes.forEach(node => {
  console.log(`Node ${node.nodeId} at ${node.address}`);
  console.log('Services:', node.services.map(s => `${s.name}@${s.version}`));
});

// Alternative method (same result)
const nodes = await discovery.findNodes();
```

### Getting All Nodes (Including Inactive)

```typescript
// Get all nodes regardless of heartbeat status
const allNodes = await discovery.getAllNodes();
console.log(`Total nodes in registry: ${allNodes.length}`);

// Check which nodes are inactive
for (const node of allNodes) {
  const isActive = await discovery.isNodeActive(node.nodeId);
  if (!isActive) {
    console.log(`Inactive node detected: ${node.nodeId}`);
  }
}
```

### Getting Specific Node Information

```typescript
// Get information about a specific node
const nodeInfo = await discovery.getNodeInfo('titan-12345-1234567890-abc');

if (nodeInfo) {
  console.log('Node found:', nodeInfo);
  console.log('Last update:', new Date(nodeInfo.timestamp));
} else {
  console.log('Node not found');
}

// Check if node exists (may be inactive)
const exists = await discovery.nodeExists('titan-12345-1234567890-abc');
console.log(`Node exists: ${exists}`);
```

### Checking Node Status

```typescript
// Check if a specific node is active
const isActive = await discovery.isNodeActive('node-abc-123');
console.log(`Node is ${isActive ? 'active' : 'inactive'}`);
```

### Load Balancing Example

```typescript
class LoadBalancer {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {}

  async getServiceEndpoint(serviceName: string): Promise<string> {
    const nodes = await this.discovery.findNodesByService(serviceName);

    if (nodes.length === 0) {
      throw new Error(`No nodes found for service: ${serviceName}`);
    }

    // Simple round-robin selection
    const index = Math.floor(Math.random() * nodes.length);
    return nodes[index].address;
  }
}
```

## Heartbeat Mechanism

### How Heartbeat Works

The heartbeat mechanism ensures service availability through periodic Redis updates:

1. **Initial Registration**: Node registers with Redis on startup
2. **Periodic Heartbeat**: Timer sends heartbeat at configured intervals
3. **TTL Refresh**: Each heartbeat refreshes the TTL on Redis keys
4. **Failure Detection**: Expired TTL indicates node failure
5. **Automatic Cleanup**: Inactive nodes are removed from the index

### Heartbeat Flow

```
Start Service
    ↓
Register Node → Set Initial TTL
    ↓
Start Heartbeat Timer
    ↓
Every heartbeatInterval:
    ├── Update node:${nodeId} hash
    ├── Refresh heartbeat:${nodeId} TTL
    └── Publish NODE_UPDATED event (if enabled)

If heartbeat fails:
    ├── Retry with exponential backoff
    └── Log error after max retries
```

### Heartbeat Implementation Details

```typescript
private async publishHeartbeat(): Promise<void> {
  if (this.stopped || this.options.clientMode) {
    return;
  }

  const prefix = this.options.redisPrefix;
  const nodeKey = `${prefix}:nodes:${this.nodeId}`;
  const heartbeatKey = `${prefix}:heartbeat:${this.nodeId}`;
  const nodesIndexKey = `${prefix}:index:nodes`;

  // Retry logic with exponential backoff
  const maxRetries = this.options.maxRetries;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Execute Lua script atomically
      await this.redis.eval(
        REGISTER_HEARTBEAT_SCRIPT,
        3,
        nodeKey,
        heartbeatKey,
        nodesIndexKey,
        this.nodeId,
        this.address,
        JSON.stringify(this.services),
        Date.now().toString(),
        Math.ceil(this.options.heartbeatTTL / 1000).toString(),
        this.options.heartbeatTTL.toString()
      );

      // Determine event type based on registration status
      const eventType = this.registered ? 'NODE_UPDATED' : 'NODE_REGISTERED';

      // Update registration status
      if (!this.registered) {
        this.registered = true;
      }

      // Log retry success if not first attempt
      if (attempt > 1) {
        this.logger.info(`Heartbeat succeeded after ${attempt} attempts`);
      }

      // Publish event if enabled
      if (this.options.pubSubEnabled) {
        await this.publishEvent(eventType);
      }

      return;
    } catch (error) {
      lastError = error as Error;
      this.logger.warn({ error, attempt }, 'Heartbeat attempt failed');

      if (attempt < maxRetries) {
        // Exponential backoff: delay = retryDelay * 2^(attempt-1)
        // Example: 1000ms, 2000ms, 4000ms for retryDelay=1000
        await new Promise((resolve) =>
          setTimeout(resolve, this.options.retryDelay * Math.pow(2, attempt - 1))
        );
      }
    }
  }

  // All retries failed
  this.logger.error({ error: lastError }, `All ${maxRetries} heartbeat attempts failed`);
}
```

### Retry Backoff Pattern

```typescript
// Exponential backoff calculation
// Attempt 1: 1000ms * 2^0 = 1000ms
// Attempt 2: 1000ms * 2^1 = 2000ms
// Attempt 3: 1000ms * 2^2 = 4000ms
// Attempt 4: 1000ms * 2^3 = 8000ms
// Attempt 5: 1000ms * 2^4 = 16000ms

DiscoveryModule.forRoot({
  maxRetries: 5,      // Maximum 5 attempts
  retryDelay: 1000    // Base delay of 1 second
})
```

### Configuring Heartbeat

```typescript
// Fast heartbeat for critical services
DiscoveryModule.forRoot({
  heartbeatInterval: 2000,  // 2 seconds
  heartbeatTTL: 6000        // 6 seconds (3x interval)
})

// Slower heartbeat for less critical services
DiscoveryModule.forRoot({
  heartbeatInterval: 30000,  // 30 seconds
  heartbeatTTL: 90000        // 90 seconds (3x interval)
})
```

### Best Practices

1. **TTL should be 2-3x the heartbeat interval** to account for network delays
2. **Balance frequency with network load** - more frequent = better detection but higher load
3. **Monitor heartbeat failures** - persistent failures indicate network issues
4. **Use retry logic** for transient network failures

## Event System

### Event Types

```typescript
type DiscoveryEvent = {
  type: 'NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED';
  nodeId: string;
  address: string;
  services: ServiceInfo[];
  timestamp: number;
}
```

### Subscribing to Events

```typescript
const discovery = app.get(DISCOVERY_SERVICE_TOKEN);

// Subscribe to all discovery events
discovery.onEvent((event: DiscoveryEvent) => {
  switch (event.type) {
    case 'NODE_REGISTERED':
      console.log(`New node joined: ${event.nodeId} at ${event.address}`);
      break;
    case 'NODE_UPDATED':
      console.log(`Node updated: ${event.nodeId}`);
      break;
    case 'NODE_DEREGISTERED':
      console.log(`Node left: ${event.nodeId}`);
      break;
  }
});

// Unsubscribe later
const handler = (event: DiscoveryEvent) => { /* ... */ };
discovery.onEvent(handler);
// Later...
discovery.offEvent(handler);
```

### PubSub Configuration

```typescript
DiscoveryModule.forRoot({
  pubSubEnabled: true,
  pubSubChannel: 'myapp:discovery:events'
})
```

### Event Publishing

Events are automatically published when:
- A node registers (`NODE_REGISTERED`)
- A node updates its services or address (`NODE_UPDATED`)
- A node deregisters (`NODE_DEREGISTERED`)
- A node's heartbeat expires (detected during cleanup)

### Custom Event Handling

```typescript
@Injectable()
class ServiceMonitor {
  private nodeStatus = new Map<string, boolean>();

  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {}

  async onStart() {
    this.discovery.onEvent((event) => {
      switch (event.type) {
        case 'NODE_REGISTERED':
        case 'NODE_UPDATED':
          this.nodeStatus.set(event.nodeId, true);
          this.checkServiceHealth(event.nodeId, event.services);
          break;
        case 'NODE_DEREGISTERED':
          this.nodeStatus.set(event.nodeId, false);
          this.handleNodeFailure(event.nodeId);
          break;
      }
    });
  }

  private async checkServiceHealth(nodeId: string, services: ServiceInfo[]) {
    // Custom health checking logic
  }

  private async handleNodeFailure(nodeId: string) {
    // Handle node failure (e.g., redirect traffic)
  }
}
```

## Client Mode

### What is Client Mode?

Client mode allows applications to discover services without registering themselves. This is useful for:
- API gateways that don't provide services
- CLI tools that need to find services
- Monitoring applications
- Load balancers

### Enabling Client Mode

```typescript
DiscoveryModule.forRoot({
  redisUrl: 'redis://localhost:6379',
  clientMode: true,           // No registration or heartbeat
  pubSubEnabled: true         // Can still receive events
})
```

### Client Mode Features

In client mode, the Discovery service:
- ✅ Can discover services
- ✅ Can check node status
- ✅ Can subscribe to events
- ❌ Does NOT register as a node
- ❌ Does NOT send heartbeats
- ❌ Does NOT appear in service listings

### Client Mode Example

```typescript
// API Gateway in client mode
@Injectable()
class ApiGateway {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {}

  async routeRequest(serviceName: string, request: Request) {
    // Find available service instances
    const nodes = await this.discovery.findNodesByService(serviceName);

    if (nodes.length === 0) {
      throw new Error('Service unavailable');
    }

    // Route to selected node
    const node = this.selectNode(nodes);
    return this.forwardRequest(node.address, request);
  }
}
```

## Redis Integration

### Redis Key Structure

```
titan:discovery:nodes:{nodeId}       # Hash with node information
  ├── address: "host:port"
  ├── services: "[{...}]"            # JSON array of services
  └── timestamp: "1234567890"

titan:discovery:heartbeat:{nodeId}   # String with TTL (heartbeat indicator)

titan:discovery:index:nodes          # Set of all node IDs

titan:discovery:index:services:{name} # Set of node IDs providing service (optional)
```

### Redis Operations

#### Node Registration
```redis
HMSET titan:discovery:nodes:node-123 address "localhost:3000" services "[...]" timestamp "1234567890"
EXPIRE titan:discovery:nodes:node-123 15
PSETEX titan:discovery:heartbeat:node-123 15000 "1"
SADD titan:discovery:index:nodes "node-123"
```

#### Heartbeat Update
```redis
# Atomic update via Lua script
EVAL <register-heartbeat.lua> 3 <keys> <args>
```

#### Node Discovery
```redis
SMEMBERS titan:discovery:index:nodes
HGETALL titan:discovery:nodes:node-123
EXISTS titan:discovery:heartbeat:node-123
```

### Custom Redis Configuration

```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: 'redis.example.com',
  port: 6379,
  password: 'secret',
  db: 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true; // Reconnect on READONLY error
    }
    return false;
  }
});

// Provide custom Redis instance
const app = await Application.create({
  providers: [
    { provide: REDIS_TOKEN, useValue: redis }
  ],
  imports: [DiscoveryModule.forRoot({})]
});
```

### Redis Cluster Support

```typescript
import Redis from 'ioredis';

const redis = new Redis.Cluster([
  { host: 'node1', port: 6379 },
  { host: 'node2', port: 6379 },
  { host: 'node3', port: 6379 }
], {
  redisOptions: {
    password: 'secret'
  }
});

const app = await Application.create({
  providers: [
    { provide: REDIS_TOKEN, useValue: redis }
  ],
  imports: [DiscoveryModule.forRoot({})]
});
```

## Lua Scripts

### register-heartbeat.lua

The atomic heartbeat registration script ensures consistency:

```lua
-- KEYS[1] - node key (hash)
-- KEYS[2] - heartbeat key (string)
-- KEYS[3] - nodes index set

-- ARGV[1] - node id
-- ARGV[2] - address
-- ARGV[3] - services (JSON)
-- ARGV[4] - timestamp
-- ARGV[5] - node TTL (seconds)
-- ARGV[6] - heartbeat TTL (milliseconds)

redis.call('HMSET', KEYS[1],
  'address', ARGV[2],
  'services', ARGV[3],
  'timestamp', ARGV[4]
)

redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('PSETEX', KEYS[2], ARGV[6], '1')
redis.call('SADD', KEYS[3], ARGV[1])

return 1
```

### Why Use Lua Scripts?

1. **Atomicity**: All operations execute as a single unit
2. **Performance**: Reduces network round trips
3. **Consistency**: Prevents race conditions
4. **Transactional**: Either all operations succeed or none

### Custom Lua Scripts

You can extend the Discovery module with custom Lua scripts:

```typescript
const customScript = `
  -- Custom discovery logic
  local nodes = redis.call('SMEMBERS', KEYS[1])
  local results = {}
  for i, nodeId in ipairs(nodes) do
    local services = redis.call('HGET', 'titan:discovery:nodes:' .. nodeId, 'services')
    if services and string.find(services, ARGV[1]) then
      table.insert(results, nodeId)
    end
  end
  return results
`;

// Execute custom script
const nodeIds = await redis.eval(
  customScript,
  1,
  'titan:discovery:index:nodes',
  'user-service'
);
```

## Module Integration

### With Dependency Injection

```typescript
@Injectable()
class MyService {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService,
    @Inject(LOGGER_TOKEN) private logger: ILogger
  ) {}

  async onStart() {
    const nodes = await this.discovery.getActiveNodes();
    this.logger.info(`Connected to network with ${nodes.length} nodes`);
  }
}
```

### With Other Modules

```typescript
import { Application } from '@omnitron-dev/titan';
import { DiscoveryModule } from '@omnitron-dev/titan/module/discovery';
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';

const app = await Application.create({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule.forRoot(),
    DiscoveryModule.forRoot({
      redisUrl: process.env.REDIS_URL
    })
  ]
});
```

### Module Dependencies

The Discovery module can share dependencies:

```typescript
// Shared Redis instance
const redis = new Redis();

const app = await Application.create({
  providers: [
    { provide: REDIS_TOKEN, useValue: redis }
  ],
  imports: [
    CacheModule.forRoot(),       // Uses same Redis
    SessionModule.forRoot(),     // Uses same Redis
    DiscoveryModule.forRoot()    // Uses same Redis
  ]
});
```

### Module Lifecycle

```typescript
class DiscoveryModule {
  // Called when module is registered
  async onRegister(app: IApplication): Promise<void> {
    // Setup Redis client
    // Register providers
  }

  // Called when application starts
  async onStart(app: IApplication): Promise<void> {
    // Start discovery service
    // Begin heartbeat
  }

  // Called when application stops
  async onStop(app: IApplication): Promise<void> {
    // Stop heartbeat
    // Deregister node
  }

  // Called when module is destroyed
  async onDestroy(): Promise<void> {
    // Cleanup resources
    // Close connections
  }
}
```

## API Reference

### IDiscoveryService Interface

```typescript
interface IDiscoveryService {
  /**
   * Start the discovery service
   */
  start(): Promise<void>;

  /**
   * Stop the discovery service
   */
  stop(): Promise<void>;

  /**
   * Register a node with given services
   * @param nodeId - Unique identifier for the node
   * @param address - Network address (host:port)
   * @param services - Array of services provided by the node
   */
  registerNode(
    nodeId: string,
    address: string,
    services: ServiceInfo[]
  ): Promise<void>;

  /**
   * Deregister a node
   * @param nodeId - Node identifier to deregister
   */
  deregisterNode(nodeId: string): Promise<void>;

  /**
   * Get all active nodes
   * @returns Array of active nodes
   */
  getActiveNodes(): Promise<NodeInfo[]>;

  /**
   * Find nodes by service name
   * @param serviceName - Name of the service
   * @param version - Optional version filter
   * @returns Array of nodes providing the service
   */
  findNodesByService(
    serviceName: string,
    version?: string
  ): Promise<NodeInfo[]>;

  /**
   * Check if a node is active
   * @param nodeId - Node identifier to check
   * @returns True if node is active
   */
  isNodeActive(nodeId: string): Promise<boolean>;

  /**
   * Update node address
   * @param nodeId - Node identifier
   * @param address - New network address
   */
  updateNodeAddress(nodeId: string, address: string): Promise<void>;

  /**
   * Update node services
   * @param nodeId - Node identifier
   * @param services - New services array
   */
  updateNodeServices(
    nodeId: string,
    services: ServiceInfo[]
  ): Promise<void>;

  /**
   * Subscribe to discovery events
   * @param handler - Event handler function
   */
  onEvent(handler: (event: DiscoveryEvent) => void): void;

  /**
   * Unsubscribe from discovery events
   * @param handler - Event handler function to remove
   */
  offEvent(handler: (event: DiscoveryEvent) => void): void;
}
```

### DiscoveryService Extended API

The DiscoveryService implementation provides additional methods beyond the interface:

```typescript
class DiscoveryService implements IDiscoveryService {
  /**
   * Get the current node ID
   * @returns The unique node identifier for this instance
   */
  getNodeId(): string;

  /**
   * Get the current node address
   * @returns The network address of this node
   */
  getAddress(): string;

  /**
   * Get the current node's services
   * @returns Array of services provided by this node (defensive copy)
   */
  getServices(): ServiceInfo[];

  /**
   * Check if the service is registered
   * @returns True if node has completed registration
   */
  isRegistered(): boolean;

  /**
   * Find all active nodes (alias for getActiveNodes)
   * @returns Array of active nodes with heartbeat validation
   */
  async findNodes(): Promise<NodeInfo[]>;

  /**
   * Get all nodes (active and inactive)
   * @returns Array of all nodes without heartbeat validation
   */
  async getAllNodes(): Promise<NodeInfo[]>;

  /**
   * Get information about a specific node
   * @param nodeId - Node identifier to query
   * @returns Node information or null if not found
   */
  async getNodeInfo(nodeId: string): Promise<NodeInfo | null>;

  /**
   * Check if a node exists in the registry
   * @param nodeId - Node identifier to check
   * @returns True if node exists (may be inactive)
   */
  async nodeExists(nodeId: string): Promise<boolean>;

  /**
   * Register a single service to current node
   * @param service - Service to add to this node
   */
  async registerService(service: ServiceInfo): Promise<void>;

  /**
   * Unregister a service by name from current node
   * @param serviceName - Name of service to remove
   */
  async unregisterService(serviceName: string): Promise<void>;

  /**
   * Update all services for current node (replace all)
   * @param services - New complete list of services
   */
  async updateServices(services: ServiceInfo[]): Promise<void>;

  /**
   * Update the current node's address
   * @param address - New network address
   */
  async updateAddress(address: string): Promise<void>;
}
```

### DiscoveryModule API

```typescript
class DiscoveryModule {
  /**
   * Create a configured module instance
   * @param options - Module configuration options
   */
  static forRoot(options: DiscoveryModuleOptions): DiscoveryModule;

  /**
   * Get the discovery service instance
   */
  getService(): IDiscoveryService | undefined;
}

/**
 * Factory function for creating a discovery module
 */
function createDiscoveryModule(
  options: DiscoveryModuleOptions = {}
): DiscoveryModule;
```

## Type Definitions

### Core Types

```typescript
/**
 * Represents information about a network node
 */
interface NodeInfo {
  /** Unique identifier of the node */
  nodeId: string;
  /** Network address (e.g., "host:port") */
  address: string;
  /** Array of services available on this node */
  services: ServiceInfo[];
  /** Unix timestamp of last update */
  timestamp: number;
}

/**
 * Describes a service available in the network
 */
interface ServiceInfo {
  /** Unique name of the service */
  name: string;
  /** Optional version identifier */
  version?: string;
}

/**
 * Discovery system event
 */
interface DiscoveryEvent {
  /** Event type */
  type: 'NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED';
  /** Node identifier */
  nodeId: string;
  /** Node network address */
  address: string;
  /** Node services */
  services: ServiceInfo[];
  /** Event timestamp */
  timestamp: number;
}
```

### Configuration Types

```typescript
/**
 * Discovery service configuration options
 */
interface DiscoveryOptions {
  heartbeatInterval?: number;  // Default: 5000
  heartbeatTTL?: number;       // Default: 15000
  pubSubEnabled?: boolean;     // Default: false
  pubSubChannel?: string;      // Default: 'titan:discovery:events'
  clientMode?: boolean;        // Default: false
  redisPrefix?: string;        // Default: 'titan:discovery'
  maxRetries?: number;         // Default: 3
  retryDelay?: number;         // Default: 1000
}

/**
 * Discovery module configuration options
 */
interface DiscoveryModuleOptions extends DiscoveryOptions {
  redisUrl?: string;
  redisOptions?: any;
}
```

### Dependency Injection Tokens

```typescript
// Token for Discovery Service
const DISCOVERY_SERVICE_TOKEN: Token<IDiscoveryService>;

// Token for Redis client
const REDIS_TOKEN: Token<Redis>;

// Token for Logger
const LOGGER_TOKEN: Token<ILogger>;

// Token for Discovery options
const DISCOVERY_OPTIONS_TOKEN: Token<DiscoveryOptions>;

// Token for Discovery Module
const DiscoveryModuleToken: Token<DiscoveryModule>;
```

## Error Handling

### Common Errors

#### Redis Connection Error
```typescript
try {
  await discovery.start();
} catch (error) {
  if (error.message.includes('ECONNREFUSED')) {
    console.error('Redis connection failed. Is Redis running?');
  }
}
```

#### Registration Failure
```typescript
try {
  await discovery.registerNode(nodeId, address, services);
} catch (error) {
  if (error.message.includes('Failed to publish heartbeat')) {
    console.error('Node registration failed after retries');
  }
}
```

### Error Recovery

The Discovery service implements automatic error recovery:

1. **Retry Logic**: Critical operations retry with exponential backoff
2. **Graceful Degradation**: Service continues operating despite failures
3. **Automatic Cleanup**: Stale nodes are automatically removed
4. **Connection Recovery**: Redis client automatically reconnects

### Custom Error Handling

```typescript
@Injectable()
class ResilientDiscovery {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService,
    @Inject(LOGGER_TOKEN) private logger: ILogger
  ) {}

  async findServiceWithFallback(
    serviceName: string,
    fallbackAddress?: string
  ): Promise<string> {
    try {
      const nodes = await this.discovery.findNodesByService(serviceName);

      if (nodes.length === 0 && fallbackAddress) {
        this.logger.warn(`No nodes found for ${serviceName}, using fallback`);
        return fallbackAddress;
      }

      if (nodes.length === 0) {
        throw new Error(`Service ${serviceName} not available`);
      }

      return nodes[0].address;
    } catch (error) {
      this.logger.error({ error }, 'Service discovery failed');

      if (fallbackAddress) {
        return fallbackAddress;
      }

      throw error;
    }
  }
}
```

## Monitoring & Health

### Health Check Implementation

```typescript
@Injectable()
class HealthMonitor {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {}

  async checkHealth(): Promise<HealthStatus> {
    try {
      const nodes = await this.discovery.getActiveNodes();
      const isHealthy = nodes.length > 0;

      return {
        status: isHealthy ? 'healthy' : 'degraded',
        checks: {
          discovery: {
            status: 'up',
            activeNodes: nodes.length,
            services: this.countServices(nodes)
          }
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        checks: {
          discovery: {
            status: 'down',
            error: error.message
          }
        }
      };
    }
  }

  private countServices(nodes: NodeInfo[]): number {
    const services = new Set<string>();
    nodes.forEach(node => {
      node.services.forEach(service => {
        services.add(service.name);
      });
    });
    return services.size;
  }
}
```

### Metrics Collection

```typescript
@Injectable()
class DiscoveryMetrics {
  private metrics = {
    nodesRegistered: 0,
    nodesDeregistered: 0,
    heartbeatsSent: 0,
    heartbeatsFailed: 0,
    discoveryCalls: 0
  };

  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.discovery.onEvent((event) => {
      switch (event.type) {
        case 'NODE_REGISTERED':
          this.metrics.nodesRegistered++;
          break;
        case 'NODE_DEREGISTERED':
          this.metrics.nodesDeregistered++;
          break;
      }
    });
  }

  getMetrics() {
    return { ...this.metrics };
  }
}
```

### Monitoring Dashboard

```typescript
@Injectable()
class DiscoveryDashboard {
  constructor(
    @Inject(DISCOVERY_SERVICE_TOKEN) private discovery: IDiscoveryService
  ) {}

  async getStatus(): Promise<DashboardData> {
    const nodes = await this.discovery.getActiveNodes();
    const serviceMap = new Map<string, number>();

    nodes.forEach(node => {
      node.services.forEach(service => {
        const key = `${service.name}@${service.version || 'latest'}`;
        serviceMap.set(key, (serviceMap.get(key) || 0) + 1);
      });
    });

    return {
      totalNodes: nodes.length,
      totalServices: serviceMap.size,
      services: Array.from(serviceMap.entries()).map(([name, count]) => ({
        name,
        instances: count
      })),
      nodes: nodes.map(node => ({
        id: node.nodeId,
        address: node.address,
        serviceCount: node.services.length,
        uptime: Date.now() - node.timestamp
      }))
    };
  }
}
```

## Performance Considerations

### Heartbeat Frequency

The heartbeat frequency affects both failure detection speed and system load:

| Interval | TTL | Detection Time | Network Load | Use Case |
|----------|-----|----------------|--------------|----------|
| 1s | 3s | 3-4s | Very High | Critical services |
| 5s | 15s | 15-20s | Moderate | Default setting |
| 30s | 90s | 90-120s | Low | Stable environments |
| 60s | 180s | 3-4min | Very Low | Development/testing |

### Redis Performance

#### Key Optimization
- Use appropriate key prefixes to avoid collisions
- Set reasonable TTLs to prevent memory bloat
- Use pipelining for batch operations

#### Memory Usage
```
Per Node:
- Node hash: ~200-500 bytes (depending on services)
- Heartbeat key: ~50 bytes
- Index entry: ~50 bytes
Total: ~300-600 bytes per node

For 1000 nodes: ~300-600 KB
For 10000 nodes: ~3-6 MB
```

#### Network Optimization
```typescript
// Batch operations with pipelining
const pipeline = redis.pipeline();
nodeIds.forEach(id => {
  pipeline.hgetall(`${prefix}:nodes:${id}`);
  pipeline.exists(`${prefix}:heartbeat:${id}`);
});
const results = await pipeline.exec();
```

### Scaling Considerations

#### Horizontal Scaling
```typescript
// Multiple Discovery instances can run simultaneously
// Each maintains its own heartbeat but shares Redis state
```

#### Redis Cluster
```typescript
// Discovery module works with Redis Cluster
// Keys are automatically sharded across nodes
const redis = new Redis.Cluster([
  { host: 'node1', port: 6379 },
  { host: 'node2', port: 6379 },
  { host: 'node3', port: 6379 }
]);
```

#### High Availability
```typescript
// Use Redis Sentinel for automatic failover
const redis = new Redis({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 }
  ],
  name: 'mymaster'
});
```

## Best Practices

### 1. Heartbeat Configuration

```typescript
// ✅ Good: TTL is 3x the interval
DiscoveryModule.forRoot({
  heartbeatInterval: 5000,
  heartbeatTTL: 15000
})

// ❌ Bad: TTL too close to interval
DiscoveryModule.forRoot({
  heartbeatInterval: 5000,
  heartbeatTTL: 5500  // Risk of false positives
})
```

### 2. Service Naming

```typescript
// ✅ Good: Descriptive, versioned services
const services = [
  { name: 'user-service', version: '1.0.0' },
  { name: 'auth-service', version: '2.1.0' }
];

// ❌ Bad: Generic names without versions
const services = [
  { name: 'service1' },
  { name: 'api' }
];
```

### 3. Error Handling

```typescript
// ✅ Good: Handle discovery failures gracefully
async function getService(name: string): Promise<string | null> {
  try {
    const nodes = await discovery.findNodesByService(name);
    return nodes.length > 0 ? nodes[0].address : null;
  } catch (error) {
    logger.error('Discovery failed', error);
    return null;  // Fallback behavior
  }
}

// ❌ Bad: Let errors propagate
async function getService(name: string): Promise<string> {
  const nodes = await discovery.findNodesByService(name);
  return nodes[0].address;  // May throw if no nodes
}
```

### 4. Resource Cleanup

```typescript
// ✅ Good: Clean shutdown
class MyService {
  async onStop() {
    await this.discovery.stop();
    this.redis.disconnect();
  }
}

// ❌ Bad: No cleanup
class MyService {
  // Missing cleanup logic
}
```

### 5. Client vs Provider Mode

```typescript
// ✅ Good: Use client mode for non-service applications
// API Gateway
DiscoveryModule.forRoot({
  clientMode: true,  // No heartbeat needed
  pubSubEnabled: true
})

// Service Provider
DiscoveryModule.forRoot({
  clientMode: false,  // Register and heartbeat
  pubSubEnabled: true
})
```

### 6. Load Balancing

```typescript
// ✅ Good: Implement proper load balancing
class SmartLoadBalancer {
  private roundRobinIndex = 0;

  async getEndpoint(service: string): Promise<string> {
    const nodes = await this.discovery.findNodesByService(service);

    if (nodes.length === 0) {
      throw new ServiceUnavailableError(service);
    }

    // Round-robin selection
    const node = nodes[this.roundRobinIndex % nodes.length];
    this.roundRobinIndex++;

    return node.address;
  }
}
```

## Migration Guide

### From Consul

```typescript
// Consul configuration
const consul = require('consul')();
consul.agent.service.register({
  name: 'user-service',
  address: '127.0.0.1',
  port: 3000,
  check: {
    ttl: '10s',
    deregister_critical_service_after: '1m'
  }
});

// Titan Discovery equivalent
const discovery = app.get(DISCOVERY_SERVICE_TOKEN);
await discovery.registerNode(
  'user-service-node',
  '127.0.0.1:3000',
  [{ name: 'user-service', version: '1.0.0' }]
);
```

### From Eureka

```typescript
// Eureka configuration
const Eureka = require('eureka-js-client').Eureka;
const client = new Eureka({
  instance: {
    app: 'user-service',
    hostName: 'localhost',
    ipAddr: '127.0.0.1',
    port: { '$': 3000, '@enabled': 'true' },
    vipAddress: 'user-service',
    dataCenterInfo: { '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo', name: 'MyOwn' }
  }
});

// Titan Discovery equivalent
DiscoveryModule.forRoot({
  redisUrl: 'redis://localhost:6379',
  heartbeatInterval: 30000,  // Eureka default
  heartbeatTTL: 90000
})
```

### From etcd

```typescript
// etcd configuration
const { Etcd3 } = require('etcd3');
const client = new Etcd3();
await client.put('services/user-service/node1').value(JSON.stringify({
  address: '127.0.0.1:3000',
  metadata: { version: '1.0.0' }
})).exec();

// Titan Discovery equivalent
await discovery.registerNode(
  'node1',
  '127.0.0.1:3000',
  [{ name: 'user-service', version: '1.0.0' }]
);
```

## Troubleshooting

### Node Not Appearing in Discovery

**Symptoms**: Service starts but doesn't appear in `getActiveNodes()`

**Possible Causes**:
1. Redis connection failed
2. Client mode enabled
3. Registration failed

**Solutions**:
```typescript
// Check Redis connection
const redis = app.get(REDIS_TOKEN);
await redis.ping();  // Should return 'PONG'

// Verify client mode is disabled
DiscoveryModule.forRoot({
  clientMode: false  // Must be false to register
})

// Check registration logs
// Look for "Node registered" or error messages
```

### Heartbeat Failures

**Symptoms**: "Failed to publish heartbeat" errors in logs

**Possible Causes**:
1. Network issues
2. Redis overloaded
3. Incorrect TTL configuration

**Solutions**:
```typescript
// Increase retry attempts
DiscoveryModule.forRoot({
  maxRetries: 5,
  retryDelay: 2000
})

// Increase heartbeat TTL
DiscoveryModule.forRoot({
  heartbeatInterval: 5000,
  heartbeatTTL: 20000  // Increase buffer
})
```

### Services Not Found

**Symptoms**: `findNodesByService()` returns empty array

**Possible Causes**:
1. Service not registered
2. Node heartbeat expired
3. Version mismatch

**Solutions**:
```typescript
// Check if nodes are active
const allNodes = await discovery.getActiveNodes();
console.log('Active nodes:', allNodes);

// Check service names match exactly
const services = allNodes.flatMap(n => n.services);
console.log('Available services:', services);

// Try without version filter
const nodes = await discovery.findNodesByService('user-service');
// Instead of
const nodes = await discovery.findNodesByService('user-service', '1.0.0');
```

### PubSub Events Not Received

**Symptoms**: Event handlers not triggered

**Possible Causes**:
1. PubSub not enabled
2. Channel mismatch
3. Subscriber not started

**Solutions**:
```typescript
// Enable PubSub
DiscoveryModule.forRoot({
  pubSubEnabled: true,
  pubSubChannel: 'discovery:events'  // Must match across all nodes
})

// Verify event handler is registered
discovery.onEvent((event) => {
  console.log('Received event:', event);
});
```

### Memory Leaks

**Symptoms**: Redis memory usage grows continuously

**Possible Causes**:
1. Nodes not deregistering properly
2. TTL not working
3. Index not cleaned up

**Solutions**:
```typescript
// Implement proper cleanup
class Service {
  async onStop() {
    await this.discovery.stop();  // Deregisters node
  }
}

// Manual cleanup of stale nodes
const staleNodes = await redis.smembers('titan:discovery:index:nodes');
for (const nodeId of staleNodes) {
  const exists = await redis.exists(`titan:discovery:heartbeat:${nodeId}`);
  if (!exists) {
    await discovery.deregisterNode(nodeId);
  }
}
```

## Implementation Guarantees

### Thread Safety

- All Redis operations are atomic (via Lua script or pipeline)
- Event emitter is synchronous (no race conditions)
- State updates are sequential (no concurrent modifications)
- Shutdown promise ensures single cleanup execution

### Error Boundaries

```typescript
// Service continues operating despite:
// - Heartbeat failures (retries continue)
// - Event publishing failures (logged, not thrown)
// - PubSub message parsing errors (logged, ignored)
// - Node cleanup failures (best-effort)

// Service stops operating on:
// - Redis connection loss (constructor throws)
// - Start after stop (throws error)
// - Critical shutdown errors (logged)
```

### Memory Management

```typescript
// Resources properly managed:
// - Heartbeat timer cleared on stop
// - PubSub subscriber disconnected on stop
// - Redis connection closed if created by module
// - Event listeners removed on stop
// - Services array defensively copied (getServices())
```

### Network Reliability

```typescript
// Built-in resilience:
// - Exponential backoff for retries
// - Separate Redis connections for PubSub
// - Graceful handling of network partitions
// - Automatic reconnection (Redis client feature)
// - TTL-based failure detection
```

## Module Export Structure

The module exports are organized as follows:

```typescript
// From index.ts
export type {
  NodeInfo,
  ServiceInfo,
  DiscoveryOptions,
  DiscoveryEvent,
  IDiscoveryService
} from './types.js';

export {
  DISCOVERY_SERVICE_TOKEN,
  REDIS_TOKEN,
  LOGGER_TOKEN,
  DISCOVERY_OPTIONS_TOKEN
} from './types.js';

export { DiscoveryService } from './discovery.service.js';

export {
  DiscoveryModule,
  DiscoveryModuleToken,
  createDiscoveryModule,
  type DiscoveryModuleOptions
} from './discovery.module.js';
```

## Complete Option Defaults

```typescript
// All options with their default values:
const defaultOptions: Required<DiscoveryOptions> = {
  heartbeatInterval: 5000,              // 5 seconds
  heartbeatTTL: 15000,                 // 15 seconds
  pubSubEnabled: false,                // Disabled by default
  pubSubChannel: 'titan:discovery:events',
  clientMode: false,                   // Provider mode by default
  redisPrefix: 'titan:discovery',
  maxRetries: 3,                       // 3 retry attempts
  retryDelay: 1000                     // 1 second base delay
};
```

## DiscoveryModule Resource Management

The module manages Redis connections based on ownership:

```typescript
class DiscoveryModule {
  private redis?: Redis;  // Only set if module created the connection

  async onRegister(app: IApplication): Promise<void> {
    if (!app.hasProvider(REDIS_TOKEN)) {
      // Module creates and owns the Redis connection
      this.redis = new Redis(this.options.redisUrl || this.options.redisOptions || {});
      app.register(REDIS_TOKEN, { useValue: this.redis });
    } else {
      // Module uses existing Redis connection (doesn't own it)
      // this.redis remains undefined
    }
  }

  async onStop(app: IApplication): Promise<void> {
    // Only close Redis if we created it
    if (this.redis && this.options.redisUrl) {
      this.redis.disconnect();
      this.logger?.info('Redis connection closed');
    }
  }

  async onDestroy(): Promise<void> {
    // Clean up owned resources
    if (this.redis && this.options.redisUrl) {
      this.redis.disconnect();
    }
  }
}
```

Ownership rules:
- Module creates Redis only if `REDIS_TOKEN` not already registered
- Module closes Redis only if it created it (checks `this.redis` and `this.options.redisUrl`)
- External Redis instances are never closed by the module

## Summary

The Titan Discovery Module provides a robust, production-ready service discovery solution with:

### Core Capabilities
- **Automatic service registration** with unique node identification
- **Heartbeat-based health monitoring** with configurable intervals
- **Service discovery** by name and version
- **Real-time event notifications** via Redis PubSub
- **Client mode** for discovery-only applications
- **Atomic operations** using Lua scripts
- **Graceful shutdown** with automatic deregistration

### Technical Features
- **Redis backend** for distributed coordination
- **Exponential backoff** retry logic
- **TTL-based** failure detection
- **Event-driven** architecture
- **TypeScript** type safety
- **Dependency injection** integration

### Production Readiness
- **High availability** support with Redis Sentinel
- **Horizontal scaling** with Redis Cluster
- **Performance optimized** with pipelining
- **Error recovery** with automatic retry
- **Resource cleanup** on shutdown
- **Monitoring** and health check support

### Complete Feature Matrix

| Feature | Provider Mode | Client Mode |
|---------|--------------|-------------|
| Node Registration | ✅ | ❌ |
| Heartbeat | ✅ | ❌ |
| Service Discovery | ✅ | ✅ |
| Event Subscription | ✅ | ✅ |
| Event Publishing | ✅ | ❌ |
| Node Status Check | ✅ | ✅ |
| Service Updates | ✅ | ❌ |
| Graceful Shutdown | ✅ | ✅ |

### Redis Key Lifecycle

```
Node Start:
  → Create nodes:{nodeId} hash (TTL: heartbeatTTL/1000)
  → Create heartbeat:{nodeId} key (TTL: heartbeatTTL ms)
  → Add nodeId to index:nodes set

Heartbeat:
  → Refresh nodes:{nodeId} TTL
  → Refresh heartbeat:{nodeId} TTL
  → Update nodes:{nodeId} timestamp

Node Stop:
  → Delete nodes:{nodeId}
  → Delete heartbeat:{nodeId}
  → Remove nodeId from index:nodes

TTL Expiry (node crash):
  → nodes:{nodeId} expires after heartbeatTTL/1000 seconds
  → heartbeat:{nodeId} expires after heartbeatTTL milliseconds
  → Cleanup removes from index:nodes on next query
```

The module seamlessly integrates with the Titan framework and provides a simple yet powerful API for service discovery in distributed systems, with every implementation detail carefully designed for production reliability.

## Advanced Implementation Details

### Constructor Validation

The DiscoveryService constructor enforces Redis availability:

```typescript
constructor(
  @Inject(REDIS_TOKEN) redis: Redis,
  @Inject(LOGGER_TOKEN) logger: ILogger,
  @Optional() @Inject(DISCOVERY_OPTIONS_TOKEN) options?: DiscoveryOptions
) {
  if (!redis) {
    throw new Error('Redis instance must be provided for DiscoveryService');
  }

  this.redis = redis;
  this.logger = logger;

  // Generate unique node ID
  this.nodeId = this.generateNodeId();
  this.address = this.detectAddress();
  this.services = [];

  // Merge with default options
  this.options = {
    heartbeatInterval: options?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
    heartbeatTTL: options?.heartbeatTTL ?? DEFAULT_HEARTBEAT_TTL,
    pubSubEnabled: options?.pubSubEnabled ?? false,
    pubSubChannel: options?.pubSubChannel ?? DEFAULT_PUBSUB_CHANNEL,
    clientMode: options?.clientMode ?? false,
    redisPrefix: options?.redisPrefix ?? DEFAULT_REDIS_PREFIX,
    maxRetries: options?.maxRetries ?? 3,
    retryDelay: options?.retryDelay ?? 1000,
  };

  // Log mode information
  if (this.options.clientMode) {
    this.logger.info('DiscoveryService started in client mode (no heartbeat or node registration)');
  } else {
    this.logger.info({
      nodeId: this.nodeId,
      address: this.address,
      services: this.services,
    }, 'DiscoveryService initialized');
  }
}
```

### Default Constants

```typescript
// Default configuration values used when not provided
const DEFAULT_HEARTBEAT_INTERVAL = 5000;     // 5 seconds
const DEFAULT_HEARTBEAT_TTL = 15000;        // 15 seconds
const DEFAULT_REDIS_PREFIX = 'titan:discovery';
const DEFAULT_PUBSUB_CHANNEL = 'titan:discovery:events';
```

### Service Deduplication

The `registerService` method ensures no duplicate services:

```typescript
async registerService(service: ServiceInfo): Promise<void> {
  // Check if service already exists
  const exists = this.services.some(
    s => s.name === service.name && s.version === service.version
  );

  if (!exists) {
    this.services.push(service);

    // Trigger immediate heartbeat to update Redis
    if (this.registered && !this.options.clientMode) {
      await this.publishHeartbeat();
    }
  }
}
```

### Cleanup Inactive Nodes Algorithm

The cleanup process runs during `getActiveNodes()`:

```typescript
private async cleanupInactiveNodes(nodeIds: string[]): Promise<void> {
  const prefix = this.options.redisPrefix;
  const pipeline = this.redis.pipeline();

  nodeIds.forEach((id) => {
    pipeline.del(`${prefix}:nodes:${id}`);      // Remove node data
    pipeline.del(`${prefix}:heartbeat:${id}`);  // Remove heartbeat
    pipeline.srem(`${prefix}:index:nodes`, id); // Remove from index
  });

  await pipeline.exec();
  this.logger.debug({ nodeIds }, 'Cleaned up inactive nodes');
}
```

### PubSub Connection Management

The module uses a separate Redis connection for subscriptions:

```typescript
private async setupPubSub(): Promise<void> {
  // Clone Redis connection for subscriber
  this.subscriber = this.redis.duplicate();

  // Subscribe to discovery channel
  await this.subscriber.subscribe(this.options.pubSubChannel);

  // Handle incoming messages
  this.subscriber.on('message', (channel: string, message: string) => {
    if (channel === this.options.pubSubChannel) {
      try {
        const event = JSON.parse(message) as DiscoveryEvent;

        // Don't process our own events
        if (event.nodeId !== this.nodeId) {
          this.eventEmitter.emit('discovery:event', event);
          this.logger.debug({ event }, 'Received discovery event');
        }
      } catch (error) {
        this.logger.error({ error, message }, 'Failed to parse discovery event');
      }
    }
  });

  this.logger.debug('PubSub setup completed');
}

private async unsubscribeFromEvents(): Promise<void> {
  if (this.subscriber) {
    await this.subscriber.unsubscribe(this.options.pubSubChannel);
    this.subscriber.disconnect();
    this.subscriber = undefined;
    this.logger.debug('Unsubscribed from PubSub events');
  }
}
```

### Registration Update Flow

```typescript
// When services or address change:
// 1. Update internal state
// 2. Trigger immediate heartbeat (if registered)
// 3. Publish update event (if PubSub enabled)

async updateAddress(address: string): Promise<void> {
  this.address = address;

  // Trigger immediate heartbeat to update Redis
  if (this.registered && !this.options.clientMode) {
    await this.publishHeartbeat();
  }
}
```

### RegisterNode Method Behavior

```typescript
async registerNode(nodeId: string, address: string, services: ServiceInfo[]): Promise<void> {
  // Updates internal state with provided or existing values
  this.nodeId = nodeId || this.nodeId;
  this.address = address || this.address;
  this.services = services || this.services;

  // Publishes heartbeat immediately if not in client mode
  if (!this.options.clientMode) {
    await this.publishHeartbeat();
  }
}
```

Note: This method updates the current node's identity, not registering a different node.

### Error State Recovery

The service maintains operation despite transient failures:

```typescript
// Heartbeat continues even after failures
// Timer is not cancelled on error
// Each heartbeat attempt is independent
// Service remains "registered" even if heartbeat fails
// Next successful heartbeat will restore state in Redis
```

### StartHeartbeat Implementation

```typescript
private async startHeartbeat(): Promise<void> {
  if (this.options.clientMode) {
    this.logger.debug('Heartbeat disabled in client mode');
    return;
  }

  // Publish initial heartbeat and wait for it
  await this.publishHeartbeat();

  // Set up periodic heartbeat
  this.heartbeatTimer = setInterval(
    () => this.publishHeartbeat(),
    this.options.heartbeatInterval
  );
}
```

Key points:
- Initial heartbeat is sent immediately and synchronously
- Periodic timer starts after initial heartbeat completes
- Timer callbacks don't await the promise (fire-and-forget)

### Module Lifecycle Complete Flow

```typescript
// Full lifecycle with all state transitions:

// 1. Construction
const discovery = new DiscoveryService(redis, logger, options);
// State: stopped=false, registered=false

// 2. Start
await discovery.start();
// - Setup PubSub if enabled
// - Start heartbeat timer
// - First heartbeat sent immediately
// State: stopped=false, registered=false→true (after first heartbeat)

// 3. Operation
// - Heartbeat runs every interval
// - Services can be added/removed dynamically
// - Events are published on changes
// State: stopped=false, registered=true

// 4. Stop
await discovery.stop();
// - Set stopped=true
// - Clear heartbeat timer
// - Deregister from Redis
// - Unsubscribe from PubSub
// - Return shutdownPromise
// State: stopped=true, registered=false

// 5. Idempotent stop
await discovery.stop();
// Returns existing shutdownPromise
```

### Event Publishing Implementation

The `publishEvent` method handles event broadcasting:

```typescript
private async publishEvent(
  type: DiscoveryEvent['type'],
  nodeId?: string
): Promise<void> {
  if (!this.options.pubSubEnabled || !this.redis) {
    return;  // Silent return if PubSub disabled
  }

  const event: DiscoveryEvent = {
    type,
    nodeId: nodeId || this.nodeId,
    address: this.address,
    services: this.services,
    timestamp: Date.now(),
  };

  try {
    await this.redis.publish(this.options.pubSubChannel, JSON.stringify(event));
    this.logger.debug({ event }, 'Published discovery event');
  } catch (error) {
    this.logger.error({ error, event }, 'Failed to publish discovery event');
    // Error is logged but not thrown - events are best-effort
  }
}
```

### Pipeline Result Processing

The `getActiveNodes` method processes pipeline results safely:

```typescript
// Process pipeline results with type safety
for (let i = 0; i < nodeIds.length; i++) {
  const nodeId = nodeIds[i];
  if (!nodeId) continue;

  const nodeDataResult = results[i * 2];      // Hash data
  const heartbeatResult = results[i * 2 + 1]; // Exists check

  if (!nodeDataResult || !heartbeatResult) {
    nodesToDeregister.push(nodeId);
    continue;
  }

  const [nodeDataErr, nodeData] = nodeDataResult;
  const [heartbeatErr, heartbeatExists] = heartbeatResult;

  // Comprehensive error checking
  if (nodeDataErr || heartbeatErr || !heartbeatExists || !nodeData || typeof nodeData !== 'object') {
    nodesToDeregister.push(nodeId);
    continue;
  }

  // Type assertion for Redis hash result
  const nodeDataTyped = nodeData as Record<string, unknown>;
  const address = typeof nodeDataTyped['address'] === 'string' ? nodeDataTyped['address'] : null;
  const servicesRaw = typeof nodeDataTyped['services'] === 'string' ? nodeDataTyped['services'] : null;
  const timestampRaw = typeof nodeDataTyped['timestamp'] === 'string' ? nodeDataTyped['timestamp'] : null;

  // Validate all required fields
  if (!address || !servicesRaw || !timestampRaw) {
    nodesToDeregister.push(nodeId);
    continue;
  }

  // Parse services with error handling
  let services: ServiceInfo[];
  try {
    services = JSON.parse(servicesRaw);
  } catch {
    nodesToDeregister.push(nodeId);
    continue;
  }

  activeNodes.push({
    nodeId,
    address,
    services,
    timestamp: Number(timestampRaw),
  });
}
```

### Lua Script Loading

The Lua script is loaded at module initialization:

```typescript
// Load Lua script for atomic heartbeat registration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REGISTER_HEARTBEAT_SCRIPT = readFileSync(
  join(__dirname, '..', '..', '..', 'lua', 'discovery', 'register-heartbeat.lua'),
  'utf-8'
);
```

Script path resolution:
- From: `src/modules/discovery/discovery.service.ts`
- To: `lua/discovery/register-heartbeat.lua`
- Path traversal: `../../../lua/discovery/register-heartbeat.lua`

### Module Registration Details

The DiscoveryModule handles conditional provider registration:

```typescript
async onRegister(app: IApplication): Promise<void> {
  // Get or create logger with fallback
  try {
    this.logger = app.resolve(createToken<ILogger>('Logger'));
  } catch {
    // Use console as fallback if no logger available
    this.logger = {
      info: (msg: any, ...args: any[]) => console.log('[Discovery]', msg, ...args),
      error: (msg: any, ...args: any[]) => console.error('[Discovery]', msg, ...args),
      warn: (msg: any, ...args: any[]) => console.warn('[Discovery]', msg, ...args),
      debug: (msg: any, ...args: any[]) => console.debug('[Discovery]', msg, ...args),
    } as ILogger;
  }

  // Create or get Redis instance
  if (!app.hasProvider(REDIS_TOKEN)) {
    // Create new Redis instance if not provided
    this.redis = new Redis(this.options.redisUrl || this.options.redisOptions || {});
    app.register(REDIS_TOKEN, { useValue: this.redis });
    this.logger.info('Redis client created for Discovery module');
  } else {
    // Use existing Redis instance
    this.redis = app.resolve(REDIS_TOKEN);
    this.logger.info('Using existing Redis client');
  }

  // Register logger if not already registered
  if (!app.hasProvider(LOGGER_TOKEN)) {
    app.register(LOGGER_TOKEN, { useValue: this.logger });
  }

  // Register options
  app.register(DISCOVERY_OPTIONS_TOKEN, { useValue: this.options });

  // Register DiscoveryService if not already registered
  if (!app.hasProvider(DISCOVERY_SERVICE_TOKEN)) {
    app.register(DISCOVERY_SERVICE_TOKEN, { useClass: DiscoveryService });
  }

  this.logger.info('DiscoveryModule registered');
}
```

### Start Method Safety

The start method prevents re-initialization:

```typescript
async start(): Promise<void> {
  if (this.stopped) {
    throw new Error('Cannot start a stopped DiscoveryService');
  }

  // Set up PubSub if enabled
  if (this.options.pubSubEnabled) {
    await this.setupPubSub();
  }

  // Start heartbeat if not in client mode
  if (!this.options.clientMode) {
    await this.startHeartbeat();
    this.logger.info('DiscoveryService started');
  }
}
```

### Deregistration Process

Node deregistration removes all traces:

```typescript
async deregisterNode(nodeId: string): Promise<void> {
  const prefix = this.options.redisPrefix;
  const nodeKey = `${prefix}:nodes:${nodeId}`;
  const heartbeatKey = `${prefix}:heartbeat:${nodeId}`;
  const nodesIndexKey = `${prefix}:index:nodes`;

  // Atomic removal of all node data
  const pipeline = this.redis.pipeline();
  pipeline.del(nodeKey);                        // Remove node hash
  pipeline.del(heartbeatKey);                   // Remove heartbeat key
  pipeline.srem(nodesIndexKey, nodeId);         // Remove from index

  await pipeline.exec();

  // Publish deregistration event
  if (this.options.pubSubEnabled) {
    await this.publishEvent('NODE_DEREGISTERED', nodeId);
  }
}
```

### Update Operations State Management

All update operations maintain internal state consistency:

```typescript
async updateNodeAddress(nodeId: string, address: string): Promise<void> {
  // Update internal state if it's our node
  if (nodeId === this.nodeId) {
    this.address = address;
  }

  const prefix = this.options.redisPrefix;
  const nodeKey = `${prefix}:nodes:${nodeId}`;

  // Update Redis state
  await this.redis.hset(nodeKey, 'address', address);

  // Publish update event
  if (this.options.pubSubEnabled) {
    await this.publishEvent('NODE_UPDATED', nodeId);
  }
}

async updateNodeServices(nodeId: string, services: ServiceInfo[]): Promise<void> {
  // Update internal state if it's our node
  if (nodeId === this.nodeId) {
    this.services = services;
  }

  const prefix = this.options.redisPrefix;
  const nodeKey = `${prefix}:nodes:${nodeId}`;

  // Update Redis state with JSON serialization
  await this.redis.hset(nodeKey, 'services', JSON.stringify(services));

  // Publish update event
  if (this.options.pubSubEnabled) {
    await this.publishEvent('NODE_UPDATED', nodeId);
  }
}
```