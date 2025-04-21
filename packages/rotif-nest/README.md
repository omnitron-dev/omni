# @devgrid/rotif-nest

A NestJS integration module for the `@devgrid/rotif` Redis-based notification system. This module provides seamless integration of rotif's messaging capabilities into NestJS applications with additional features like dependency injection, decorators, health checks, and automatic discovery of message handlers.

## Features

- **NestJS Integration**: Full integration with NestJS dependency injection system
- **Declarative Subscriptions**: Use decorators to define message handlers
- **Health Checks**: Built-in health check service compatible with `@nestjs/terminus`
- **Exception Handling**: Custom exception filters for message processing errors
- **Logging & Metrics**: Built-in interceptors for logging and metrics collection
- **Automatic Discovery**: Automatic registration of message handlers using reflection
- **Middleware Support**: NestJS-style middleware for message processing
- **Async Configuration**: Support for async module configuration

## Installation

```bash
npm install @devgrid/rotif @devgrid/rotif-nest
```

## Basic Usage

### Module Registration

```typescript
import { Module } from '@nestjs/common';
import { RotifModule } from '@devgrid/rotif-nest';

@Module({
  imports: [
    RotifModule.register({
      redis: 'redis://localhost:6379',
      // Additional rotif configuration options
    }),
  ],
})
export class AppModule {}
```

### Using Decorators

```typescript
import { Injectable } from '@nestjs/common';
import { RotifSubscribe } from '@devgrid/rotif-nest';

@Injectable()
export class OrdersService {
  @RotifSubscribe('orders.created', {
    group: 'orders-service',
    maxRetries: 3
  })
  async handleOrderCreated(message: RotifMessage) {
    const order = message.payload;
    await this.processOrder(order);
  }
}
```

### Using the Service

```typescript
import { Injectable } from '@nestjs/common';
import { RotifService } from '@devgrid/rotif-nest';

@Injectable()
export class NotificationService {
  constructor(private readonly rotifService: RotifService) {}

  async notifyOrderShipped(orderId: string) {
    await this.rotifService.publish('orders.shipped', {
      orderId,
      shippedAt: new Date()
    });
  }
}
```

## Advanced Configuration

### Async Configuration

```typescript
import { Module } from '@nestjs/common';
import { RotifModule } from '@devgrid/rotif-nest';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    RotifModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        redis: configService.get('REDIS_URL'),
        exactlyOnce: true,
        deduplication: {
          type: 'redis',
          ttlSeconds: 3600
        },
        middleware: [
          new LoggingMiddleware(),
          new MetricsMiddleware()
        ],
        globalExceptionFilters: [
          RotifExceptionFilter
        ],
        globalInterceptors: [
          RotifLoggingInterceptor,
          RotifMetricsInterceptor
        ]
      }),
      inject: [ConfigService]
    })
  ]
})
export class AppModule {}
```

### Health Checks

```typescript
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { RotifHealthService } from '@devgrid/rotif-nest';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private rotifHealth: RotifHealthService
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.rotifHealth.check()
    ]);
  }
}
```

## Exception Handling

### Custom Exception

```typescript
import { RotifException } from '@devgrid/rotif-nest';

throw new RotifException('Failed to process order', true); // true = move to DLQ
```

### Custom Exception Filter

```typescript
import { Catch } from '@nestjs/common';
import { RotifMessage } from '@devgrid/rotif';
import { RotifExceptionFilter } from '@devgrid/rotif-nest';

@Catch()
export class CustomRotifExceptionFilter extends RotifExceptionFilter {
  async catch(exception: Error, message: RotifMessage) {
    // Custom error handling logic
    await super.catch(exception, message);
  }
}
```

## Middleware

### Custom Middleware

```typescript
import { Injectable } from '@nestjs/common';
import { Middleware, RotifMessage } from '@devgrid/rotif';

@Injectable()
export class CustomMiddleware implements Middleware {
  async beforeProcess(msg: RotifMessage): Promise<void> {
    // Pre-processing logic
  }

  async afterProcess(msg: RotifMessage): Promise<void> {
    // Post-processing logic
  }

  async onError(msg: RotifMessage, error: Error): Promise<void> {
    // Error handling logic
  }
}
```

## Interceptors

### Custom Metrics Interceptor

```typescript
import { Injectable } from '@nestjs/common';
import { RotifMetricsInterceptor } from '@devgrid/rotif-nest';

@Injectable()
export class CustomMetricsInterceptor extends RotifMetricsInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    // Custom metrics collection logic
    return super.intercept(context, next);
  }
}
```

## API Reference

### RotifModule

The main module that provides rotif integration.

#### Static Methods

- `register(options: RotifModuleOptions)`: Registers the module with static options
- `registerAsync(options: RotifModuleAsyncOptions)`: Registers the module with async options

### RotifService

The main service for interacting with rotif.

#### Methods

- `publish(channel: string, payload: any, options?: PublishOptions)`: Publishes a message
- `subscribe(pattern: string, handler: Function, options?: SubscribeOptions)`: Subscribes to messages
- `subscribeToDLQ(handler: Function)`: Subscribes to the Dead Letter Queue
- `requeueFromDLQ(count?: number)`: Requeues messages from DLQ

### RotifHealthService

Service for health checks.

#### Methods

- `check()`: Performs a health check of the rotif connection

### Decorators

- `@RotifSubscribe(pattern: string, options?: SubscribeOptions)`: Marks a method as a message handler

### Interfaces

#### RotifModuleOptions

```typescript
interface RotifModuleOptions extends RotifConfig {
  middleware?: Middleware[];
  globalExceptionFilters?: Type<any>[];
  globalInterceptors?: Type<any>[];
  exactlyOnce?: boolean;
  deduplication?: {
    type: 'redis' | 'memory';
    ttlSeconds?: number;
  };
}
```

#### RotifModuleAsyncOptions

```typescript
interface RotifModuleAsyncOptions {
  useFactory?: (...args: any[]) => Promise<RotifModuleOptions> | RotifModuleOptions;
  inject?: any[];
  useClass?: Type<RotifModuleOptionsFactory>;
  useExisting?: Type<RotifModuleOptionsFactory>;
}
```

## Best Practices

1. **Error Handling**
   - Always use appropriate exception filters
   - Consider using custom RotifException for fine-grained control
   - Implement proper error recovery strategies

2. **Performance**
   - Use appropriate consumer group configurations
   - Implement proper message acknowledgment
   - Monitor message processing metrics

3. **Testing**
   - Mock RotifService in unit tests
   - Use TestingModule for integration tests
   - Implement proper cleanup in tests

4. **Security**
   - Use secure Redis connections
   - Implement proper message validation
   - Handle sensitive data appropriately

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT © [DevGrid](https://github.com/d-e-v-grid/dg-monorepo)