# @omnitron-dev/titan

> A minimalist TypeScript framework for building distributed, runtime-agnostic applications with enterprise reliability.

## Overview

Titan is a lightweight yet powerful application framework that provides the essential building blocks for distributed systems without the bloat. Built on top of the [Nexus](../nexus) DI container and integrating seamlessly with [Netron](../netron) for RPC and [Rotif](../rotif) for reliable messaging, Titan offers a clean, modular architecture that works across Node.js and Bun runtimes.

## Key Features

- 🎯 **Minimalist Core** - Essential features without bloat
- 🔄 **Runtime Agnostic** - Full support for Node.js 22+ and Bun 1.2+
- 🏗️ **Modular Architecture** - Clean separation of concerns with dependency injection
- 🌐 **Distributed by Design** - Built-in WebSocket RPC and reliable messaging
- 🔒 **Enterprise Ready** - Graceful shutdown, health checks, lifecycle management
- ⚡ **High Performance** - Minimal overhead, efficient event system
- 🧪 **Testing First** - Comprehensive testing utilities included

## Installation

```bash
yarn add @omnitron-dev/titan
# or
npm install @omnitron-dev/titan
# or
bun add @omnitron-dev/titan
```

## Quick Start

### Simple Application

```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';

// Define a service
@Injectable()
class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

// Define a module
@Module({
  providers: [GreetingService],
  exports: [GreetingService]
})
class AppModule {
  constructor(private greetingService: GreetingService) {}

  async onStart() {
    console.log(this.greetingService.greet('Titan'));
  }
}

// Create and start application
async function bootstrap() {
  const app = await Application.create(AppModule);
  await app.start();
}

bootstrap().catch(console.error);
```

### With Event System

```typescript
import { OnEvent, Injectable } from '@omnitron-dev/titan';

@Injectable()
class NotificationService {
  @OnEvent('user.created')
  async handleUserCreated(user: User) {
    console.log('New user created:', user.name);
    // Send welcome email
  }
}
```

### With Configuration

```typescript
import { Config, Injectable } from '@omnitron-dev/titan';

@Injectable()
class DatabaseService {
  @Config('database.host')
  private host: string;

  @Config('database.port', 5432)
  private port: number;

  connect() {
    console.log(`Connecting to ${this.host}:${this.port}`);
  }
}
```

## Core Modules

### Application Lifecycle

```typescript
const app = await Application.create(AppModule, {
  name: 'my-service',
  version: '1.0.0',
  gracefulShutdown: true,
  shutdownTimeout: 30000
});

// Lifecycle hooks
app.onStart(() => console.log('Starting...'));
app.onStop(() => console.log('Stopping...'));

// Start the application
await app.start();

// Graceful shutdown on signals
process.on('SIGTERM', () => app.stop());
```

### Module System

```typescript
@Module({
  imports: [DatabaseModule, CacheModule],
  providers: [UserService, AuthService],
  exports: [UserService]
})
class UserModule {}

// Dynamic modules
@Module({})
class ConfigurableModule {
  static forRoot(options: ModuleOptions): DynamicModule {
    return {
      module: ConfigurableModule,
      providers: [
        { provide: OPTIONS_TOKEN, useValue: options },
        ConfigService
      ],
      exports: [ConfigService]
    };
  }
}
```

### Dependency Injection

```typescript
import { createToken, Inject } from '@omnitron-dev/titan';

// Define tokens
const LoggerToken = createToken<ILogger>('Logger');
const ConfigToken = createToken<IConfig>('Config');

@Injectable()
class UserService {
  constructor(
    @Inject(LoggerToken) private logger: ILogger,
    @Inject(ConfigToken) private config: IConfig
  ) {}
}

// Register providers
const app = await Application.create(AppModule, {
  providers: [
    { provide: LoggerToken, useClass: PinoLogger },
    { provide: ConfigToken, useValue: configObject }
  ]
});
```

## Distributed Features

### WebSocket RPC with Netron

```typescript
import { Service, Public } from '@omnitron-dev/titan/netron';

@Service('calculator@1.0.0')
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  async divide(a: number, b: number): Promise<number> {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  }
}
```

### Reliable Messaging with Rotif

```typescript
import { RotifSubscribe } from '@omnitron-dev/titan/rotif';

@Injectable()
class OrderProcessor {
  @RotifSubscribe('orders.created')
  async handleNewOrder(message: RotifMessage) {
    const order = message.payload;
    console.log('Processing order:', order.id);

    // Process the order
    await this.processOrder(order);

    // Acknowledge the message
    await message.ack();
  }
}
```

## Testing

```typescript
import { TestApplication } from '@omnitron-dev/titan/testing';

describe('UserModule', () => {
  let app: TestApplication;

  beforeEach(async () => {
    app = await TestApplication.create({
      modules: [UserModule],
      providers: [
        { provide: DatabaseService, useValue: mockDatabase }
      ]
    });
  });

  afterEach(async () => {
    await app.stop();
  });

  it('should create user', async () => {
    const userService = app.get(UserService);
    const user = await userService.create({ name: 'John' });
    expect(user.id).toBeDefined();
  });
});
```

## Performance

Titan is designed for minimal overhead and maximum performance:

- **Lightweight Core**: ~50KB minified core with tree-shakeable modules
- **Fast Startup**: Optimized module loading and initialization
- **Efficient Events**: High-performance event emitter with async support
- **Memory Efficient**: Careful memory management and cleanup

## Runtime Support

| Runtime | Version | Status |
|---------|---------|---------|
| Node.js | >=22.0.0 | ✅ Full Support |
| Bun | >=1.2.0 | ✅ Full Support |
| Deno | 2.0+ | 🧪 Experimental |

## Ecosystem

Titan is part of the Omnitron ecosystem:

- **[Nexus](../nexus)** - Powerful dependency injection container
- **[Netron](../netron)** - WebSocket RPC framework
- **[Rotif](../rotif)** - Redis-based reliable messaging
- **[Common](../common)** - Shared utilities and helpers
- **Tron** (Coming Soon) - Process manager for Titan applications

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Module System](./docs/modules.md)
- [Dependency Injection](./docs/dependency-injection.md)
- [Event System](./docs/events.md)
- [Configuration](./docs/configuration.md)
- [Testing](./docs/testing.md)
- [API Reference](./docs/api.md)

## Examples

Check out the [examples](./examples) directory for:
- Simple application
- Modular application
- Distributed services
- Testing patterns
- Configuration management

## Contributing

We welcome contributions! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

MIT © Omnitron Dev Team