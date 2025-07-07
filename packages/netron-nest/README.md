# @devgrid/netron-nest

NestJS integration module for [@devgrid/netron](../netron), providing seamless integration between the Netron distributed framework and NestJS applications. Build scalable microservices with WebSocket-based RPC, event streaming, and service discovery.

## Features

- 🏗️ **Seamless NestJS Integration** - Works naturally with NestJS dependency injection
- 🔌 **Service Decorators** - Simple decorators for exposing services
- 📡 **Automatic Service Registration** - Services are automatically exposed via Netron
- 🔍 **Service Discovery** - Built-in Redis-based service discovery support
- 🎯 **Type-Safe RPC** - Full TypeScript support for remote procedure calls
- 🚀 **Event Streaming** - Real-time event streaming between services
- 🛡️ **Graceful Shutdown** - Proper cleanup on application shutdown
- 💉 **Dependency Injection** - Use NestJS DI to inject Netron instance

## Installation

```bash
npm install @devgrid/netron @devgrid/netron-nest
# or
yarn add @devgrid/netron @devgrid/netron-nest
# or
pnpm add @devgrid/netron @devgrid/netron-nest
```

## Quick Start

### 1. Configure NetronModule

```typescript
import { Module } from '@nestjs/common';
import { NetronModule } from '@devgrid/netron-nest';

@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 8080,
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379',
    }),
  ],
})
export class AppModule {}
```

### 2. Create and Expose a Service

```typescript
import { Injectable } from '@nestjs/common';
import { Service } from '@devgrid/netron-nest';

@Injectable()
@Service('calculator@1.0.0')
export class CalculatorService {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
```

### 3. Use Remote Services

```typescript
import { Injectable } from '@nestjs/common';
import { InjectNetron } from '@devgrid/netron-nest';
import { Netron } from '@devgrid/netron';

@Injectable()
export class MathController {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async calculate() {
    // Connect to remote service
    const peer = await this.netron.connect('ws://remote-service:8080');
    
    // Query remote service interface
    const calculator = await peer.queryInterface<{
      add(a: number, b: number): Promise<number>;
      multiply(a: number, b: number): Promise<number>;
    }>('calculator@1.0.0');
    
    // Use remote methods
    const sum = await calculator.add(10, 20); // 30
    const product = await calculator.multiply(5, 6); // 30
    
    return { sum, product };
  }
}
```

## Advanced Configuration

### Module Configuration Options

```typescript
@Module({
  imports: [
    NetronModule.forRoot({
      // Server options
      listenHost: 'localhost',
      listenPort: 8080,
      
      // Service discovery
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379',
      discoveryHeartbeatInterval: 5000,
      discoveryCleanupInterval: 10000,
      
      // Timeouts
      connectTimeout: 5000,
      requestTimeout: 5000,
      streamTimeout: 30000,
      
      // Features
      allowServiceEvents: true,
      
      // Custom logger
      logger: new CustomLogger(),
    }),
  ],
})
export class AppModule {}
```

### Async Configuration

```typescript
@Module({
  imports: [
    NetronModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        listenPort: configService.get('NETRON_PORT'),
        discoveryRedisUrl: configService.get('REDIS_URL'),
        discoveryEnabled: configService.get('DISCOVERY_ENABLED'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

## Service Discovery

With Redis-based service discovery, services automatically register and can find each other:

```typescript
@Injectable()
export class ServiceDiscovery {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async findService(serviceName: string) {
    // Discovery is handled automatically when enabled
    const nodes = await this.netron.discovery?.getActiveNodes();
    
    for (const node of nodes || []) {
      if (node.services.includes(serviceName)) {
        const peer = await this.netron.connect(node.address);
        return peer.queryInterface(serviceName);
      }
    }
    
    throw new Error(`Service ${serviceName} not found`);
  }
}
```

## Event Streaming

Subscribe to and emit events between services:

```typescript
@Injectable()
@Service('events@1.0.0')
export class EventService {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async broadcastEvent(event: string, data: any) {
    // Emit to all connected peers
    await this.netron.emitParallel(event, data);
  }

  async onModuleInit() {
    // Subscribe to events
    this.netron.on('user:created', async (user) => {
      console.log('New user created:', user);
    });
  }
}
```

## Testing

### Unit Testing

```typescript
import { Test } from '@nestjs/testing';
import { NetronModule } from '@devgrid/netron-nest';

describe('CalculatorService', () => {
  let service: CalculatorService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        NetronModule.forRoot({
          listenPort: 0, // Random port for testing
        }),
      ],
      providers: [CalculatorService],
    }).compile();

    service = module.get<CalculatorService>(CalculatorService);
  });

  it('should add numbers', () => {
    expect(service.add(2, 3)).toBe(5);
  });
});
```

### Integration Testing

```typescript
describe('Service Integration', () => {
  let app: INestApplication;
  let netron: Netron;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    
    netron = module.get<Netron>(NETRON_INSTANCE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should expose service via Netron', async () => {
    const services = netron.peer.getServiceNames();
    expect(services).toContain('calculator@1.0.0');
  });
});
```

## Best Practices

### 1. Service Versioning

Always version your services for backward compatibility:

```typescript
@Service('users@1.0.0')  // Good - versioned
@Service('users')        // Bad - no version
```

### 2. Error Handling

Implement proper error handling in services:

```typescript
@Injectable()
@Service('users@1.0.0')
export class UserService {
  async getUser(id: string) {
    try {
      const user = await this.userRepository.findOne(id);
      if (!user) {
        throw new NotFoundException(`User ${id} not found`);
      }
      return user;
    } catch (error) {
      this.logger.error(`Failed to get user ${id}:`, error);
      throw error;
    }
  }
}
```

### 3. Graceful Shutdown

NetronModule handles graceful shutdown automatically, but you can add custom cleanup:

```typescript
@Injectable()
export class AppService implements OnModuleDestroy {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async onModuleDestroy() {
    // Custom cleanup logic
    await this.saveState();
    // Netron cleanup is handled automatically
  }
}
```

### 4. Type Safety

Define interfaces for your services:

```typescript
// shared/interfaces/calculator.interface.ts
export interface ICalculatorService {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
}

// Use in both service and client
@Service('calculator@1.0.0')
export class CalculatorService implements ICalculatorService {
  // Implementation
}

// Client
const calculator = await peer.queryInterface<ICalculatorService>('calculator@1.0.0');
```

## Comparison with NestJS Microservices

| Feature | NestJS Microservices | @devgrid/netron-nest |
|---------|---------------------|---------------------|
| Transport | TCP, Redis, NATS, etc. | WebSocket |
| Service Discovery | Manual/External | Built-in (Redis) |
| Streaming | Limited | Full WebSocket streaming |
| Browser Support | No | Yes (via Netron) |
| Type Safety | Partial | Full TypeScript support |
| Setup Complexity | Medium | Low |
| Performance | High | High |

## API Reference

### Decorators

- `@Service(name: string)` - Mark a class as a Netron service
- `@InjectNetron()` - Inject the Netron instance

### Module Methods

- `NetronModule.forRoot(options)` - Configure Netron synchronously
- `NetronModule.forRootAsync(options)` - Configure Netron asynchronously

### Constants

- `NETRON_OPTIONS` - Injection token for Netron options
- `NETRON_INSTANCE` - Injection token for Netron instance

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © DevGrid