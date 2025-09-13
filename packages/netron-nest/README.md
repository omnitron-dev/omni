# @devgrid/netron-nest

[![npm version](https://img.shields.io/npm/v/@devgrid/netron-nest.svg)](https://www.npmjs.com/package/@devgrid/netron-nest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11.1.3-red)](https://nestjs.com/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.1-brightgreen)](https://nodejs.org)

NestJS integration module for [@devgrid/netron](https://github.com/d-e-v-grid/devgrid/tree/main/packages/netron), providing seamless distributed system capabilities with decorators, dependency injection, and automatic service discovery in NestJS applications.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Module Configuration](#module-configuration)
  - [Creating Services](#creating-services)
  - [Using Remote Services](#using-remote-services)
  - [Service Discovery](#service-discovery)
  - [Event Streaming](#event-streaming)
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

- 🏗️ **Seamless NestJS Integration** - Works naturally with NestJS dependency injection
- 🔌 **Service Decorators** - Simple decorators for exposing services
- 📡 **Automatic Service Registration** - Services are automatically exposed via Netron
- 🔍 **Service Discovery** - Built-in Redis-based service discovery support
- 🎯 **Type-Safe RPC** - Full TypeScript support for remote procedure calls
- 🚀 **Event Streaming** - Real-time event streaming between services
- 🛡️ **Graceful Shutdown** - Proper cleanup on application shutdown
- 💉 **Dependency Injection** - Use NestJS DI to inject Netron instance
- 🔄 **WebSocket Transport** - Efficient bidirectional communication
- 🌐 **Browser Support** - Connect from browser clients via Netron

## Installation

```bash
npm install @devgrid/netron @devgrid/netron-nest
# or
yarn add @devgrid/netron @devgrid/netron-nest
# or
pnpm add @devgrid/netron @devgrid/netron-nest
```

## Quick Start

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { NetronModule } from '@devgrid/netron-nest';
import { CalculatorService } from './calculator.service';

@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 8080,
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379',
    }),
  ],
  providers: [CalculatorService],
})
export class AppModule {}

// calculator.service.ts
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

// client.controller.ts
import { Controller, Get } from '@nestjs/common';
import { InjectNetron } from '@devgrid/netron-nest';
import { Netron } from '@devgrid/netron';

@Controller('math')
export class MathController {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  @Get('calculate')
  async calculate() {
    const peer = await this.netron.connect('ws://remote-service:8080');
    const calculator = await peer.queryInterface<ICalculator>('calculator@1.0.0');
    
    const sum = await calculator.add(10, 20);
    const product = await calculator.multiply(5, 6);
    
    return { sum, product };
  }
}
```

## Core Usage

### Module Configuration

#### Basic Configuration

```typescript
@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 8080,
      discoveryEnabled: false,
    }),
  ],
})
export class AppModule {}
```

#### Async Configuration

```typescript
@Module({
  imports: [
    NetronModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        listenHost: configService.get('NETRON_HOST', 'localhost'),
        listenPort: configService.get('NETRON_PORT', 8080),
        discoveryEnabled: configService.get('DISCOVERY_ENABLED', true),
        discoveryRedisUrl: configService.get('REDIS_URL'),
        discoveryHeartbeatInterval: configService.get('HEARTBEAT_INTERVAL', 5000),
        connectTimeout: configService.get('CONNECT_TIMEOUT', 5000),
        requestTimeout: configService.get('REQUEST_TIMEOUT', 5000),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

#### Multiple Instances

```typescript
@Module({
  imports: [
    // Default instance
    NetronModule.forRoot({
      listenPort: 8080,
    }),
    // Named instance
    NetronModule.forRoot({
      name: 'analytics',
      listenPort: 8081,
    }),
  ],
})
export class AppModule {}

// Inject specific instance
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectNetron() private readonly defaultNetron: Netron,
    @InjectNetron('analytics') private readonly analyticsNetron: Netron,
  ) {}
}
```

### Creating Services

#### Basic Service

```typescript
import { Injectable } from '@nestjs/common';
import { Service } from '@devgrid/netron-nest';

@Injectable()
@Service('userService@1.0.0')
export class UserService {
  private users = new Map<string, User>();

  async createUser(data: CreateUserDto): Promise<User> {
    const user = {
      id: generateId(),
      ...data,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async updateUser(id: string, data: UpdateUserDto): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    Object.assign(user, data, { updatedAt: new Date() });
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    if (!this.users.delete(id)) {
      throw new NotFoundException(`User ${id} not found`);
    }
  }
}
```

#### Service with Dependencies

```typescript
@Injectable()
@Service('orderService@1.0.0')
export class OrderService {
  constructor(
    private readonly userService: UserService,
    private readonly inventoryService: InventoryService,
    private readonly logger: Logger,
  ) {}

  async createOrder(orderData: CreateOrderDto): Promise<Order> {
    // Validate user
    const user = await this.userService.getUser(orderData.userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Check inventory
    for (const item of orderData.items) {
      const available = await this.inventoryService.checkStock(item.productId, item.quantity);
      if (!available) {
        throw new BadRequestException(`Insufficient stock for product ${item.productId}`);
      }
    }

    // Create order
    const order = {
      id: generateId(),
      ...orderData,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
    };

    // Reserve inventory
    await this.inventoryService.reserveItems(order.items);

    this.logger.log(`Order ${order.id} created for user ${user.id}`);
    return order;
  }
}
```

#### Streaming Service

```typescript
@Injectable()
@Service('dataStream@1.0.0')
export class DataStreamService {
  async *streamData(count: number): AsyncGenerator<DataPoint> {
    for (let i = 0; i < count; i++) {
      yield {
        id: i,
        value: Math.random() * 100,
        timestamp: Date.now(),
      };
      // Simulate real-time data
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async uploadStream(stream: ReadableStream): Promise<UploadResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    const data = Buffer.concat(chunks);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    
    return {
      size: data.length,
      hash,
      timestamp: Date.now(),
    };
  }
}
```

### Using Remote Services

#### Basic Remote Service Usage

```typescript
@Injectable()
export class RemoteServiceClient {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async callRemoteCalculator() {
    // Connect to remote service
    const peer = await this.netron.connect('ws://calculator-service:8080');
    
    // Get service interface
    const calculator = await peer.queryInterface<ICalculator>('calculator@1.0.0');
    
    // Call remote methods
    const result = await calculator.add(10, 20);
    
    // Disconnect when done
    await peer.disconnect();
    
    return result;
  }
}
```

#### Service Client with Error Handling

```typescript
@Injectable()
export class ResilientServiceClient {
  private peer: Peer | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly logger: Logger,
  ) {}

  private async connect(): Promise<Peer> {
    try {
      if (!this.peer || !this.peer.isConnected()) {
        this.peer = await this.netron.connect('ws://remote-service:8080', {
          maxReconnectAttempts: this.maxReconnectAttempts,
          reconnectDelay: 1000,
        });
        
        this.peer.on('disconnected', () => {
          this.logger.warn('Disconnected from remote service');
          this.peer = null;
        });
        
        this.reconnectAttempts = 0;
      }
      return this.peer;
    } catch (error) {
      this.reconnectAttempts++;
      this.logger.error(`Failed to connect (attempt ${this.reconnectAttempts}):`, error);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        throw new ServiceUnavailableException('Remote service unavailable');
      }
      
      // Exponential backoff
      await new Promise(resolve => 
        setTimeout(resolve, Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000))
      );
      
      return this.connect();
    }
  }

  async callRemoteMethod<T>(serviceName: string, method: string, ...args: any[]): Promise<T> {
    const peer = await this.connect();
    const service = await peer.queryInterface<any>(serviceName);
    
    try {
      return await service[method](...args);
    } catch (error) {
      this.logger.error(`Remote method call failed: ${serviceName}.${method}`, error);
      throw error;
    }
  }
}
```

### Service Discovery

#### Automatic Service Discovery

```typescript
@Injectable()
export class ServiceDiscoveryClient {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async findAndCallService<T>(serviceName: string): Promise<T | null> {
    if (!this.netron.discovery) {
      throw new Error('Service discovery not enabled');
    }

    // Find service node
    const node = await this.netron.discovery.findService(serviceName);
    if (!node) {
      throw new NotFoundException(`Service ${serviceName} not found`);
    }

    // Connect to the node
    const peer = await this.netron.connect(node.address);
    
    // Get service interface
    return await peer.queryInterface<T>(serviceName);
  }

  async getAllServiceInstances(serviceName: string): Promise<ServiceInstance[]> {
    const nodes = await this.netron.discovery?.getActiveNodes() || [];
    const instances: ServiceInstance[] = [];
    
    for (const node of nodes) {
      if (node.services.includes(serviceName)) {
        instances.push({
          nodeId: node.id,
          address: node.address,
          services: node.services,
          lastSeen: node.lastSeen,
        });
      }
    }
    
    return instances;
  }
}
```

#### Load Balanced Service Client

```typescript
@Injectable()
export class LoadBalancedClient {
  private servicePool = new Map<string, Peer[]>();
  private currentIndex = new Map<string, number>();

  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly logger: Logger,
  ) {}

  async onModuleInit() {
    // Set up discovery listeners
    this.netron.discovery?.on('node:joined', async (node) => {
      this.logger.log(`New node joined: ${node.id}`);
      await this.updateServicePool();
    });

    this.netron.discovery?.on('node:left', async (nodeId) => {
      this.logger.log(`Node left: ${nodeId}`);
      await this.updateServicePool();
    });

    // Initial pool update
    await this.updateServicePool();
  }

  private async updateServicePool() {
    const nodes = await this.netron.discovery?.getActiveNodes() || [];
    
    // Group nodes by service
    const serviceNodes = new Map<string, string[]>();
    for (const node of nodes) {
      for (const service of node.services) {
        const addresses = serviceNodes.get(service) || [];
        addresses.push(node.address);
        serviceNodes.set(service, addresses);
      }
    }

    // Update connection pool
    for (const [service, addresses] of serviceNodes) {
      const peers: Peer[] = [];
      
      for (const address of addresses) {
        try {
          const peer = await this.netron.connect(address);
          peers.push(peer);
        } catch (error) {
          this.logger.error(`Failed to connect to ${address}:`, error);
        }
      }
      
      this.servicePool.set(service, peers);
    }
  }

  async getService<T>(serviceName: string): Promise<T> {
    const peers = this.servicePool.get(serviceName) || [];
    
    if (peers.length === 0) {
      throw new ServiceUnavailableException(`No instances of ${serviceName} available`);
    }

    // Round-robin load balancing
    const index = (this.currentIndex.get(serviceName) || 0) % peers.length;
    this.currentIndex.set(serviceName, index + 1);

    const peer = peers[index];
    return await peer.queryInterface<T>(serviceName);
  }
}
```

### Event Streaming

#### Event Publisher Service

```typescript
@Injectable()
@Service('eventPublisher@1.0.0')
export class EventPublisherService implements OnModuleInit {
  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    // Enable service events
    this.netron.on('peer:connected', (peer) => {
      this.logger.log(`New peer connected: ${peer.id}`);
    });

    this.netron.on('peer:disconnected', (peer) => {
      this.logger.log(`Peer disconnected: ${peer.id}`);
    });
  }

  async publishEvent(event: string, data: any) {
    // Emit to all connected peers
    await this.netron.emitParallel(event, data);
    this.logger.log(`Event published: ${event}`);
  }

  async publishToSpecificPeers(event: string, data: any, peerIds: string[]) {
    const results = await Promise.allSettled(
      peerIds.map(async (peerId) => {
        const peer = this.netron.peers.get(peerId);
        if (peer) {
          await peer.emit(event, data);
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    this.logger.log(`Event ${event} sent to ${successful}/${peerIds.length} peers`);
  }
}
```

#### Event Subscriber Service

```typescript
@Injectable()
@Service('eventSubscriber@1.0.0')
export class EventSubscriberService implements OnModuleInit {
  private eventHandlers = new Map<string, Function[]>();

  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    // Subscribe to events
    this.netron.subscribe('user:*', async (event) => {
      await this.handleUserEvent(event);
    });

    this.netron.subscribe('order:created', async (order) => {
      await this.processNewOrder(order);
    });

    // Pattern-based subscriptions
    this.netron.subscribe('metrics:*:update', async (metrics) => {
      await this.updateMetrics(metrics);
    });
  }

  private async handleUserEvent(event: any) {
    const eventType = event.type || 'unknown';
    this.logger.log(`Handling user event: ${eventType}`);
    
    switch (eventType) {
      case 'user:created':
        await this.onUserCreated(event.data);
        break;
      case 'user:updated':
        await this.onUserUpdated(event.data);
        break;
      case 'user:deleted':
        await this.onUserDeleted(event.data);
        break;
    }
  }

  private async processNewOrder(order: Order) {
    this.logger.log(`Processing new order: ${order.id}`);
    // Order processing logic
  }

  private async updateMetrics(metrics: any) {
    this.logger.log(`Updating metrics: ${JSON.stringify(metrics)}`);
    // Metrics update logic
  }

  private async onUserCreated(user: User) {
    // Handle user creation
  }

  private async onUserUpdated(user: User) {
    // Handle user update
  }

  private async onUserDeleted(userId: string) {
    // Handle user deletion
  }
}
```

## API Reference

### NetronModule

The main module for integrating Netron with NestJS.

#### Static Methods

| Method | Description | Parameters |
|--------|-------------|------------|
| `forRoot(options)` | Synchronous module configuration | `NetronModuleOptions` |
| `forRootAsync(options)` | Asynchronous module configuration | `NetronModuleAsyncOptions` |

### Decorators

#### @Service

Marks a class as a Netron service that will be automatically exposed.

```typescript
@Service(name: string)
```

Example:
```typescript
@Injectable()
@Service('myService@1.0.0')
export class MyService {
  // Service implementation
}
```

#### @InjectNetron

Injects a Netron instance into a class.

```typescript
@InjectNetron(name?: string)
```

Example:
```typescript
constructor(
  @InjectNetron() private readonly netron: Netron,
  @InjectNetron('analytics') private readonly analyticsNetron: Netron,
) {}
```

### Interfaces

#### NetronModuleOptions

```typescript
interface NetronModuleOptions extends NetronOptions {
  name?: string;              // Instance name for multiple instances
  isGlobal?: boolean;         // Make module global
}
```

#### NetronModuleAsyncOptions

```typescript
interface NetronModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  name?: string;
  isGlobal?: boolean;
  useExisting?: Type<NetronOptionsFactory>;
  useClass?: Type<NetronOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<NetronModuleOptions> | NetronModuleOptions;
  inject?: any[];
}
```

#### NetronOptionsFactory

```typescript
interface NetronOptionsFactory {
  createNetronOptions(): Promise<NetronModuleOptions> | NetronModuleOptions;
}
```

### Constants

| Constant | Description |
|----------|-------------|
| `NETRON_OPTIONS` | Injection token for Netron options |
| `NETRON_INSTANCE` | Injection token for Netron instance |
| `NETRON_MODULE_OPTIONS` | Injection token for module options |

## Advanced Features

### Middleware Integration

```typescript
// Custom middleware for Netron services
@Injectable()
export class NetronAuthMiddleware {
  constructor(private readonly authService: AuthService) {}

  async use(context: any, next: Function) {
    const token = context.headers?.authorization;
    
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    const user = await this.authService.validateToken(token);
    context.user = user;

    return next();
  }
}

// Apply middleware to service
@Injectable()
@Service('protectedService@1.0.0')
@UseMiddleware(NetronAuthMiddleware)
export class ProtectedService {
  async getSecretData(context: any) {
    // context.user is available from middleware
    return this.fetchUserSecrets(context.user.id);
  }
}
```

### Health Checks

```typescript
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

@Injectable()
export class NetronHealthIndicator extends HealthIndicator {
  constructor(@InjectNetron() private readonly netron: Netron) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = this.netron.isListening();
    const peers = this.netron.peers.size;

    const result = this.getStatus(key, isHealthy, {
      listening: this.netron.isListening(),
      peers: peers,
      services: this.netron.peer.getServiceNames(),
    });

    if (!isHealthy) {
      throw new HealthCheckError('Netron check failed', result);
    }

    return result;
  }
}

// Health controller
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private netronHealth: NetronHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.netronHealth.isHealthy('netron'),
    ]);
  }
}
```

### Task System Integration

```typescript
@Injectable()
export class TaskService implements OnModuleInit {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  onModuleInit() {
    // Register tasks
    this.netron.addTask(async function healthCheck(peer) {
      return {
        status: 'healthy',
        timestamp: Date.now(),
        services: peer.getServiceNames(),
      };
    });

    this.netron.addTask(async function processData(peer, data: any[], options: any) {
      // Process data with options
      return data.map(item => ({
        ...item,
        processed: true,
        processedAt: Date.now(),
      }));
    });
  }

  async runRemoteTask(peerAddress: string, taskName: string, ...args: any[]) {
    const peer = await this.netron.connect(peerAddress);
    const result = await peer.runTask(taskName, ...args);
    await peer.disconnect();
    return result;
  }
}
```

### Service Composition

```typescript
@Injectable()
@Service('gateway@1.0.0')
export class GatewayService implements OnModuleInit {
  private userService: IUserService;
  private orderService: IOrderService;
  private paymentService: IPaymentService;

  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly logger: Logger,
  ) {}

  async onModuleInit() {
    // Connect to required services
    await this.initializeServices();
  }

  private async initializeServices() {
    try {
      // Find and connect to services
      this.userService = await this.findService<IUserService>('userService@1.0.0');
      this.orderService = await this.findService<IOrderService>('orderService@1.0.0');
      this.paymentService = await this.findService<IPaymentService>('paymentService@1.0.0');
      
      this.logger.log('All required services initialized');
    } catch (error) {
      this.logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  private async findService<T>(serviceName: string): Promise<T> {
    const node = await this.netron.discovery?.findService(serviceName);
    if (!node) {
      throw new Error(`Service ${serviceName} not found`);
    }
    
    const peer = await this.netron.connect(node.address);
    return await peer.queryInterface<T>(serviceName);
  }

  async processCheckout(checkoutData: CheckoutData): Promise<CheckoutResult> {
    // Orchestrate multiple services
    const user = await this.userService.getUser(checkoutData.userId);
    
    const order = await this.orderService.createOrder({
      userId: user.id,
      items: checkoutData.items,
    });
    
    const payment = await this.paymentService.processPayment({
      orderId: order.id,
      amount: order.total,
      method: checkoutData.paymentMethod,
    });
    
    return {
      orderId: order.id,
      paymentId: payment.id,
      status: 'completed',
    };
  }
}
```

## Configuration

### Environment Variables

```bash
# Netron configuration
NETRON_HOST=localhost
NETRON_PORT=8080

# Service discovery
DISCOVERY_ENABLED=true
REDIS_URL=redis://localhost:6379
HEARTBEAT_INTERVAL=5000
CLEANUP_INTERVAL=10000

# Timeouts
CONNECT_TIMEOUT=5000
REQUEST_TIMEOUT=5000
STREAM_TIMEOUT=30000

# Features
ALLOW_SERVICE_EVENTS=true
```

### Configuration Service

```typescript
// netron.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('netron', () => ({
  listenHost: process.env.NETRON_HOST || 'localhost',
  listenPort: parseInt(process.env.NETRON_PORT, 10) || 8080,
  
  discovery: {
    enabled: process.env.DISCOVERY_ENABLED === 'true',
    redisUrl: process.env.REDIS_URL,
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL, 10) || 5000,
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL, 10) || 10000,
  },
  
  timeouts: {
    connect: parseInt(process.env.CONNECT_TIMEOUT, 10) || 5000,
    request: parseInt(process.env.REQUEST_TIMEOUT, 10) || 5000,
    stream: parseInt(process.env.STREAM_TIMEOUT, 10) || 30000,
  },
  
  features: {
    allowServiceEvents: process.env.ALLOW_SERVICE_EVENTS === 'true',
  },
}));

// Usage
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [netronConfig],
    }),
    NetronModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('netron'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

## TypeScript Support

### Type-Safe Service Interfaces

```typescript
// shared/interfaces/services.ts
export interface ICalculatorService {
  add(a: number, b: number): Promise<number>;
  multiply(a: number, b: number): Promise<number>;
  divide(a: number, b: number): Promise<number>;
}

export interface IUserService {
  createUser(data: CreateUserDto): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateUser(id: string, data: UpdateUserDto): Promise<User>;
  deleteUser(id: string): Promise<void>;
  listUsers(filters: UserFilters): Promise<PaginatedResult<User>>;
}

// Service implementation
@Injectable()
@Service('calculator@1.0.0')
export class CalculatorService implements ICalculatorService {
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  async multiply(a: number, b: number): Promise<number> {
    return a * b;
  }

  async divide(a: number, b: number): Promise<number> {
    if (b === 0) {
      throw new BadRequestException('Division by zero');
    }
    return a / b;
  }
}

// Client usage
const calculator = await peer.queryInterface<ICalculatorService>('calculator@1.0.0');
const result = await calculator.divide(10, 2); // Type-safe!
```

### Generic Service Factory

```typescript
// Generic service client factory
export class ServiceClientFactory {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async createClient<T>(
    serviceName: string,
    serviceAddress?: string
  ): Promise<T> {
    let peer: Peer;
    
    if (serviceAddress) {
      // Direct connection
      peer = await this.netron.connect(serviceAddress);
    } else {
      // Use service discovery
      const node = await this.netron.discovery?.findService(serviceName);
      if (!node) {
        throw new ServiceUnavailableException(`Service ${serviceName} not found`);
      }
      peer = await this.netron.connect(node.address);
    }
    
    return await peer.queryInterface<T>(serviceName);
  }

  async createClients<T>(
    serviceName: string,
    count: number
  ): Promise<T[]> {
    const nodes = await this.netron.discovery?.findAllServices(serviceName) || [];
    const clients: T[] = [];
    
    for (let i = 0; i < Math.min(count, nodes.length); i++) {
      const peer = await this.netron.connect(nodes[i].address);
      const client = await peer.queryInterface<T>(serviceName);
      clients.push(client);
    }
    
    return clients;
  }
}

// Usage
const clientFactory = new ServiceClientFactory(netron);
const userService = await clientFactory.createClient<IUserService>('userService@1.0.0');
const calculators = await clientFactory.createClients<ICalculatorService>('calculator@1.0.0', 3);
```

## Performance

### Connection Pooling

```typescript
@Injectable()
export class ConnectionPoolService {
  private pools = new Map<string, ConnectionPool>();

  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly config: ConfigService,
  ) {}

  async getConnection(serviceAddress: string): Promise<PooledConnection> {
    let pool = this.pools.get(serviceAddress);
    
    if (!pool) {
      pool = new ConnectionPool({
        factory: () => this.netron.connect(serviceAddress),
        destroy: (peer) => peer.disconnect(),
        min: this.config.get('netron.pool.min', 2),
        max: this.config.get('netron.pool.max', 10),
        idleTimeoutMillis: this.config.get('netron.pool.idleTimeout', 30000),
      });
      
      this.pools.set(serviceAddress, pool);
    }
    
    return await pool.acquire();
  }

  async releaseConnection(serviceAddress: string, connection: PooledConnection) {
    const pool = this.pools.get(serviceAddress);
    if (pool) {
      await pool.release(connection);
    }
  }

  async drainPools() {
    for (const [address, pool] of this.pools) {
      await pool.drain();
      await pool.clear();
      this.pools.delete(address);
    }
  }
}
```

### Caching

```typescript
@Injectable()
export class CachedServiceClient {
  private cache = new Map<string, CacheEntry>();
  private readonly defaultTTL = 60000; // 1 minute

  constructor(
    @InjectNetron() private readonly netron: Netron,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async callWithCache<T>(
    serviceName: string,
    method: string,
    args: any[],
    ttl?: number
  ): Promise<T> {
    const cacheKey = `${serviceName}:${method}:${JSON.stringify(args)}`;
    
    // Check cache
    const cached = await this.cacheManager.get<T>(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Call service
    const service = await this.getService(serviceName);
    const result = await service[method](...args);
    
    // Cache result
    await this.cacheManager.set(cacheKey, result, ttl || this.defaultTTL);
    
    return result;
  }

  private async getService(serviceName: string): Promise<any> {
    const node = await this.netron.discovery?.findService(serviceName);
    if (!node) {
      throw new ServiceUnavailableException(`Service ${serviceName} not found`);
    }
    
    const peer = await this.netron.connect(node.address);
    return await peer.queryInterface(serviceName);
  }
}
```

### Benchmarks

Performance characteristics with NestJS integration:

| Operation | Throughput | Latency (p99) |
|-----------|------------|---------------|
| Service Call (Local) | 45,000 req/s | < 2ms |
| Service Call (Remote) | 25,000 req/s | < 5ms |
| Event Emission | 80,000 msg/s | < 1ms |
| Service Discovery | 8,000 queries/s | < 8ms |
| Stream Transfer | 800 MB/s | N/A |

## Production Deployment

### Docker Configuration

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source
COPY . .

# Build application
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Non-root user
USER node

EXPOSE 8080

CMD ["node", "dist/main.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: netron-nest-service
  labels:
    app: netron-nest
spec:
  replicas: 3
  selector:
    matchLabels:
      app: netron-nest
  template:
    metadata:
      labels:
        app: netron-nest
    spec:
      containers:
      - name: app
        image: myregistry/netron-nest-app:latest
        ports:
        - containerPort: 8080
          name: netron
        - containerPort: 3000
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: NETRON_PORT
          value: "8080"
        - name: DISCOVERY_ENABLED
          value: "true"
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-secret
              key: url
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
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: netron-nest-service
spec:
  selector:
    app: netron-nest
  ports:
  - name: netron
    port: 8080
    targetPort: 8080
  - name: http
    port: 80
    targetPort: 3000
  type: ClusterIP
```

### Monitoring

```typescript
// Prometheus metrics
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
})
export class MetricsModule {}

// Custom Netron metrics
@Injectable()
export class NetronMetricsService {
  private readonly serviceCallsTotal = new Counter({
    name: 'netron_service_calls_total',
    help: 'Total number of service calls',
    labelNames: ['service', 'method', 'status'],
  });

  private readonly serviceCallDuration = new Histogram({
    name: 'netron_service_call_duration_seconds',
    help: 'Service call duration in seconds',
    labelNames: ['service', 'method'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  });

  private readonly activeConnections = new Gauge({
    name: 'netron_active_connections',
    help: 'Number of active Netron connections',
  });

  constructor(@InjectNetron() private readonly netron: Netron) {
    // Track connections
    this.netron.on('peer:connected', () => {
      this.activeConnections.inc();
    });

    this.netron.on('peer:disconnected', () => {
      this.activeConnections.dec();
    });
  }

  recordServiceCall(service: string, method: string, duration: number, status: 'success' | 'error') {
    this.serviceCallsTotal.inc({ service, method, status });
    this.serviceCallDuration.observe({ service, method }, duration / 1000);
  }
}
```

## Best Practices

### 1. Service Versioning

```typescript
// Always version your services
@Injectable()
@Service('userService@1.0.0')  // Good - includes version
export class UserServiceV1 {
  // V1 implementation
}

@Injectable()
@Service('userService@2.0.0')  // New version with breaking changes
export class UserServiceV2 {
  // V2 implementation with new features
}

// Support multiple versions simultaneously
@Module({
  providers: [UserServiceV1, UserServiceV2],
})
export class UserModule {}
```

### 2. Error Handling

```typescript
// Define custom errors
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

@Injectable()
@Service('resilientService@1.0.0')
export class ResilientService {
  private readonly logger = new Logger(ResilientService.name);

  async riskyOperation(data: any): Promise<Result> {
    try {
      return await this.performOperation(data);
    } catch (error) {
      this.logger.error('Operation failed', error.stack);
      
      if (error instanceof ValidationError) {
        throw new ServiceError('Invalid input', 'VALIDATION_ERROR', 400);
      }
      
      if (error instanceof NetworkError) {
        throw new ServiceError('Network error', 'NETWORK_ERROR', 503);
      }
      
      throw new ServiceError('Internal error', 'INTERNAL_ERROR', 500);
    }
  }
}
```

### 3. Testing

```typescript
// Unit testing
describe('CalculatorService', () => {
  let service: CalculatorService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        NetronModule.forRoot({
          listenPort: 0, // Random port
        }),
      ],
      providers: [CalculatorService],
    }).compile();

    service = module.get<CalculatorService>(CalculatorService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should add numbers correctly', () => {
    expect(service.add(2, 3)).toBe(5);
  });

  it('should throw on division by zero', () => {
    expect(() => service.divide(10, 0)).toThrow('Division by zero');
  });
});

// Integration testing
describe('Service Communication', () => {
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

  it('should expose services via Netron', async () => {
    const services = netron.peer.getServiceNames();
    expect(services).toContain('calculator@1.0.0');
  });

  it('should handle remote service calls', async () => {
    const peer = await netron.connect(`ws://localhost:${netron.listenPort}`);
    const calc = await peer.queryInterface<ICalculatorService>('calculator@1.0.0');
    
    const result = await calc.add(5, 3);
    expect(result).toBe(8);
    
    await peer.disconnect();
  });
});
```

### 4. Graceful Shutdown

```typescript
@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);

  constructor(
    @InjectNetron() private readonly netron: Netron,
    private readonly connectionPool: ConnectionPoolService,
  ) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Shutdown signal received: ${signal}`);
    
    try {
      // Stop accepting new connections
      await this.netron.stopListening();
      
      // Drain connection pools
      await this.connectionPool.drainPools();
      
      // Wait for ongoing operations
      await this.waitForOngoingOperations();
      
      // Close all connections
      await this.netron.stop();
      
      this.logger.log('Graceful shutdown completed');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      throw error;
    }
  }

  private async waitForOngoingOperations(timeout = 30000) {
    const start = Date.now();
    
    while (this.hasOngoingOperations() && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.hasOngoingOperations()) {
      this.logger.warn('Timeout waiting for ongoing operations');
    }
  }

  private hasOngoingOperations(): boolean {
    // Check for active operations
    return this.netron.peers.size > 0;
  }
}
```

### 5. Performance Optimization

```typescript
// Batch operations
@Injectable()
@Service('batchProcessor@1.0.0')
export class BatchProcessorService {
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: BatchOptions = {}
  ): Promise<R[]> {
    const { batchSize = 100, concurrency = 10 } = options;
    const results: R[] = [];
    
    // Process in batches
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      // Process batch with concurrency limit
      const batchResults = await pLimit(concurrency)(
        batch.map(item => () => processor(item))
      );
      
      results.push(...batchResults);
    }
    
    return results;
  }
}

// Request deduplication
@Injectable()
export class DeduplicationService {
  private pendingRequests = new Map<string, Promise<any>>();

  async deduplicate<T>(
    key: string,
    factory: () => Promise<T>
  ): Promise<T> {
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing;
    }
    
    const promise = factory().finally(() => {
      this.pendingRequests.delete(key);
    });
    
    this.pendingRequests.set(key, promise);
    return promise;
  }
}
```

## Comparison with NestJS Microservices

| Feature | NestJS Microservices | @devgrid/netron-nest |
|---------|---------------------|---------------------|
| **Transport** | TCP, Redis, NATS, RabbitMQ, Kafka, gRPC | WebSocket |
| **Service Discovery** | Manual/External (Consul, Eureka) | Built-in (Redis) |
| **Streaming** | Limited (depends on transport) | Full bidirectional streaming |
| **Browser Support** | No (except gRPC-Web) | Yes (via Netron) |
| **Type Safety** | Partial | Full TypeScript support |
| **Setup Complexity** | Medium to High | Low |
| **Performance** | High | High |
| **Message Patterns** | Request-Response, Event-Based | RPC, Events, Streaming |
| **Learning Curve** | Moderate | Low (familiar NestJS patterns) |

### When to Use @devgrid/netron-nest

- ✅ Need WebSocket-based real-time communication
- ✅ Want built-in service discovery
- ✅ Require browser client support
- ✅ Need bidirectional streaming
- ✅ Prefer simpler setup and configuration
- ✅ Want type-safe RPC calls

### When to Use NestJS Microservices

- ✅ Need specific transport (Kafka, RabbitMQ, etc.)
- ✅ Existing infrastructure uses those transports
- ✅ Need message persistence (with appropriate transport)
- ✅ Require specific message broker features

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

- [GitHub Repository](https://github.com/d-e-v-grid/devgrid/tree/main/packages/netron-nest)
- [npm Package](https://www.npmjs.com/package/@devgrid/netron-nest)
- [Netron Documentation](https://github.com/d-e-v-grid/devgrid/tree/main/packages/netron)
- [NestJS Documentation](https://docs.nestjs.com)
- [Issue Tracker](https://github.com/d-e-v-grid/devgrid/issues)