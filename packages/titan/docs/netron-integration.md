# Netron Integration in Titan

## Overview

Netron is integrated as a core service in Titan applications, providing:
- WebSocket-based peer-to-peer communication
- Type-safe RPC capabilities
- Service discovery (with Redis)
- Event-driven messaging
- Stream support for large data transfers

## Architecture

Netron is registered as a **lazy-loaded singleton** in the Titan DI container:

1. **Initialization**: Netron is registered during `initializeCoreModules()` after Logger and Config modules
2. **Lazy Loading**: The actual Netron instance is created only when first accessed
3. **Lifecycle Management**: Netron starts/stops automatically with the application
4. **Configuration**: Configured through the application's config under the `netron` key

## Basic Usage

### 1. Accessing Netron from Application

```typescript
import { Application } from '@omnitron-dev/titan';

const app = await Application.create(MyModule, {
  config: {
    netron: {
      id: 'my-node',
      port: 9000
    }
  }
});

await app.start();

// Access Netron directly
const netron = app.netron;
if (netron) {
  console.log('Netron ID:', netron.id);
}
```

### 2. Injecting Netron into Services

```typescript
import { Injectable, Inject, NETRON_TOKEN } from '@omnitron-dev/titan';
import type { Netron } from '@omnitron-dev/netron';

@Injectable()
class MyService {
  constructor(
    @Inject(NETRON_TOKEN) private netron: Netron
  ) {}

  async connectToPeer(address: string) {
    const peer = await this.netron.connect(address);
    console.log('Connected to:', peer.id);
  }
}
```

### 3. Exposing RPC Services

```typescript
import { Service, Public } from '@omnitron-dev/netron';
import { Injectable } from '@omnitron-dev/titan';

@Service('calculator@1.0.0')
@Injectable()
class CalculatorService {
  @Public()
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  @Public()
  async multiply(a: number, b: number): Promise<number> {
    return a * b;
  }
}
```

## Configuration Options

Netron can be configured through the application's config:

```typescript
{
  netron: {
    // Node identifier
    id: 'my-node',
    
    // WebSocket server port
    port: 9000,
    
    // Enable WebSocket server
    server: true,
    
    // Discovery configuration
    discovery: {
      enabled: true,
      redis: {
        host: 'localhost',
        port: 6379
      }
    },
    
    // Custom logger (uses app logger by default)
    logger: customLogger
  }
}
```

## Lifecycle Integration

### Startup Sequence
1. Logger module initializes
2. Config module initializes
3. **Netron registers** (lazy-loaded)
4. User modules register and start
5. **Netron starts** (if accessed)
6. Application ready

### Shutdown Sequence
1. User modules stop
2. **Netron stops**
3. Logger flushes and stops
4. Application shutdown complete

## Advanced Features

### Service Discovery

When Redis discovery is enabled, Netron automatically:
- Registers the node in Redis
- Discovers other nodes
- Maintains peer connections

```typescript
{
  netron: {
    discovery: {
      enabled: true,
      redis: {
        host: 'redis.example.com',
        port: 6379,
        password: 'secret'
      },
      interval: 5000, // Discovery interval in ms
      ttl: 10000      // Service TTL in Redis
    }
  }
}
```

### Event Handling

```typescript
class NetworkMonitor {
  constructor(@Inject(NETRON_TOKEN) private netron: Netron) {
    // Listen for peer events
    this.netron.on('peer:connected', this.onPeerConnected);
    this.netron.on('peer:disconnected', this.onPeerDisconnected);
    this.netron.on('service:discovered', this.onServiceDiscovered);
  }

  private onPeerConnected = (peer: RemotePeer) => {
    console.log(`Peer ${peer.id} connected`);
  };

  private onPeerDisconnected = (peerId: string) => {
    console.log(`Peer ${peerId} disconnected`);
  };

  private onServiceDiscovered = (service: ServiceInfo) => {
    console.log(`Service discovered: ${service.name}`);
  };
}
```

### Streaming Data

```typescript
class DataService {
  @Public()
  async *streamData(): AsyncGenerator<Buffer> {
    for (let i = 0; i < 1000; i++) {
      yield Buffer.from(`Chunk ${i}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

// Client side
const stream = await remoteService.streamData();
for await (const chunk of stream) {
  console.log('Received:', chunk.toString());
}
```

## Best Practices

1. **Use Lazy Loading**: Netron is only initialized when needed, saving resources
2. **Configure Properly**: Set appropriate IDs and ports for your deployment
3. **Handle Failures Gracefully**: Netron failures don't crash the application
4. **Use Type Safety**: Leverage TypeScript for RPC interfaces
5. **Monitor Events**: Subscribe to Netron events for debugging and monitoring

## Troubleshooting

### Netron Not Available

If `app.netron` returns `undefined`:
1. Check if Netron is installed: `yarn add @omnitron-dev/netron`
2. Verify configuration is valid
3. Check application logs for initialization errors

### Connection Issues

1. Verify firewall rules allow WebSocket connections
2. Check Redis connectivity if using discovery
3. Ensure unique node IDs across the network

### Performance

1. Use streaming for large data transfers
2. Implement pagination for large result sets
3. Consider message compression for bandwidth optimization

## Example Applications

See the `examples` directory for complete examples:
- `netron-example.ts` - Basic usage and configuration
- `netron-rpc-example.ts` - RPC service implementation
- `distributed-app.ts` - Multi-node distributed application
