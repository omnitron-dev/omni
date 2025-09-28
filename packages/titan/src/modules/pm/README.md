# Titan Process Manager Module

## Revolutionary Concept: Process as Service

The Titan Process Manager (PM) completely reimagines process management by treating **every process as a Netron service**. This eliminates the traditional boundaries between processes, making inter-process communication as simple as local method calls with full type safety.

## Key Features

- 🚀 **Zero Configuration**: Services are automatically exposed through TypeScript's structural typing
- 🔒 **Type-Safe by Default**: Full TypeScript inference across process boundaries
- 🌐 **Service-First Architecture**: Every process is a first-class service in the Netron mesh
- 🎯 **Transparent Distribution**: Local and remote calls are indistinguishable
- ⚡ **High Performance**: Minimal overhead with direct Netron integration
- 🛡️ **Fault Tolerance**: Built-in supervision trees and health monitoring
- 📊 **Observable**: Comprehensive metrics and tracing out of the box

## Installation

```typescript
import { Application } from '@omnitron-dev/titan';
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';

const app = await Application.create({
  imports: [
    ProcessManagerModule.forRoot({
      netron: { transport: 'tcp' },
      monitoring: { metrics: true }
    })
  ]
});
```

## Basic Usage

### 1. Define a Process

```typescript
import { Process, Public } from '@omnitron-dev/titan/module/pm';

@Process({
  name: 'user-service',
  version: '1.0.0'
})
class UserService {
  @Public()
  async createUser(data: UserData): Promise<User> {
    // Implementation
    return user;
  }

  @Public()
  async getUser(id: string): Promise<User | null> {
    // Implementation
    return user;
  }
}
```

### 2. Spawn the Process

```typescript
const pm = app.get(ProcessManager);
const userService = await pm.spawn(UserService);

// Type-safe calls with IntelliSense!
const user = await userService.createUser({ name: 'John' });
```

## Advanced Features

### Process Pools

Automatically distribute load across multiple process instances:

```typescript
const pool = await pm.pool(ComputeService, {
  size: 'auto', // Uses CPU core count
  strategy: 'least-loaded'
});

// Calls are automatically load-balanced
const results = await Promise.all(
  data.map(item => pool.process(item))
);
```

### Supervision Trees

Build fault-tolerant systems with supervisor hierarchies:

```typescript
@Supervisor({
  strategy: 'one-for-one',
  maxRestarts: 3
})
class AppSupervisor {
  @Child({ critical: true })
  database = DatabaseService;

  @Child({ pool: { size: 4 } })
  workers = WorkerService;
}

const supervisor = await pm.supervisor(AppSupervisor);
```

### Workflows

Orchestrate complex multi-stage processes:

```typescript
@Workflow()
class DataPipeline {
  @Stage({ parallel: true })
  async extract(): Promise<Data[]> {
    // Extract from multiple sources
  }

  @Stage({ dependsOn: 'extract' })
  async transform(data: Data[]): Promise<Transformed[]> {
    // Transform data
  }

  @Stage({ dependsOn: 'transform' })
  async load(data: Transformed[]): Promise<void> {
    // Load to destination
  }
}

const pipeline = await pm.workflow(DataPipeline);
await pipeline.run();
```

### Streaming

Handle large data streams efficiently:

```typescript
@Process()
class StreamProcessor {
  @Public()
  async *processStream(source: AsyncIterable<Data>): AsyncGenerator<Result> {
    for await (const item of source) {
      yield await this.transform(item);
    }
  }
}

const processor = await pm.spawn(StreamProcessor);
for await (const result of processor.processStream(dataStream)) {
  console.log(result);
}
```

### Health Monitoring

Built-in health checks and metrics:

```typescript
@Process({
  health: { enabled: true, interval: 30000 }
})
class MonitoredService {
  @HealthCheck()
  async checkHealth(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      checks: [/* health checks */]
    };
  }
}

// Get health status
const health = await pm.getHealth(processId);
const metrics = await pm.getMetrics(processId);
```

## Decorators Reference

### Process Decorators

- `@Process(options)` - Mark a class as a process
- `@Public()` - Expose method via RPC
- `@RateLimit(options)` - Apply rate limiting
- `@Cache(options)` - Enable caching
- `@Validate(schema)` - Add validation
- `@CircuitBreaker(options)` - Add circuit breaker
- `@HealthCheck()` - Define health check method

### Supervisor Decorators

- `@Supervisor(options)` - Define a supervisor
- `@Child(options)` - Define a child process

### Workflow Decorators

- `@Workflow()` - Define a workflow
- `@Stage(options)` - Define a workflow stage
- `@Compensate(stage)` - Define compensation handler

## Configuration Options

```typescript
ProcessManagerModule.forRoot({
  // Netron configuration
  netron: {
    discovery: 'redis',
    transport: 'tcp',
    compression: true,
    encryption: true
  },

  // Process defaults
  process: {
    restartPolicy: {
      enabled: true,
      maxRestarts: 3,
      window: 60000
    },
    maxMemory: '512MB',
    timeout: 30000,
    isolation: 'none'
  },

  // Monitoring
  monitoring: {
    metrics: true,
    tracing: true,
    profiling: false,
    logs: 'console'
  }
});
```

## API Reference

### ProcessManager

```typescript
interface IProcessManager {
  // Spawn a process
  spawn<T>(ProcessClass: new () => T, options?: IProcessOptions): Promise<ServiceProxy<T>>;

  // Create a process pool
  pool<T>(ProcessClass: new () => T, options?: IProcessPoolOptions): Promise<IProcessPool<T>>;

  // Discover a service
  discover<T>(serviceName: string): Promise<ServiceProxy<T> | null>;

  // Create a workflow
  workflow<T>(WorkflowClass: new () => T): Promise<T>;

  // Create a supervisor
  supervisor(SupervisorClass: new () => any, options?: ISupervisorOptions): Promise<any>;

  // Process management
  getProcess(processId: string): IProcessInfo | undefined;
  listProcesses(): IProcessInfo[];
  kill(processId: string, signal?: string): Promise<boolean>;

  // Monitoring
  getMetrics(processId: string): Promise<IProcessMetrics | null>;
  getHealth(processId: string): Promise<IHealthStatus | null>;

  // Shutdown
  shutdown(options?: { timeout?: number; force?: boolean }): Promise<void>;
}
```

## Comparison with Traditional Approaches

### Traditional Worker Threads

```javascript
// ❌ Old way - manual message passing
const worker = new Worker('./worker.js');
worker.postMessage({ cmd: 'process', data });
worker.on('message', result => { });
```

### Titan PM

```typescript
// ✅ New way - type-safe service calls
const worker = await pm.spawn(Worker);
const result = await worker.process(data); // Type-safe!
```

## Real-World Use Cases

### Microservices Architecture

```typescript
@Process()
class PaymentService { /* ... */ }

@Process()
class OrderService {
  constructor(
    @InjectProcess(PaymentService) private payment: ServiceProxy<PaymentService>
  ) {}

  async createOrder(order: Order): Promise<OrderResult> {
    // Transparent cross-process call
    const payment = await this.payment.charge(order.payment);
    return { orderId: '...', payment };
  }
}
```

### Data Processing Pipeline

```typescript
const pool = await pm.pool(DataProcessor, { size: 10 });

// Process large dataset in parallel
const results = await Promise.all(
  largeDataset.map(chunk => pool.process(chunk))
);
```

### Real-time Communication

```typescript
@Process({ websocket: { maxConnections: 100000 } })
class RealtimeService {
  async *subscribeToUpdates(userId: string): AsyncGenerator<Update> {
    // Stream updates to client
    yield* this.updates.subscribe(userId);
  }
}
```

## Performance

The Titan PM achieves near-zero overhead for inter-process communication:

- **Latency**: < 1ms for local RPC calls
- **Throughput**: > 100k req/s per process
- **Memory**: < 10MB overhead per process
- **Startup**: < 100ms process spawn time

## Best Practices

1. **Use Process Pools for CPU-intensive tasks** - Distribute computation across cores
2. **Implement Health Checks** - Ensure observable and maintainable systems
3. **Use Supervisors for Critical Services** - Build fault-tolerant architectures
4. **Enable Metrics in Production** - Monitor performance and resource usage
5. **Design Idempotent Operations** - Support safe retries and recovery

## Migration Guide

### From PM2

```javascript
// PM2 configuration
module.exports = {
  apps: [{
    name: 'api',
    script: './api.js',
    instances: 4
  }]
};
```

```typescript
// Titan PM
@Process({ name: 'api' })
class ApiService { /* ... */ }

const pool = await pm.pool(ApiService, { size: 4 });
```

### From Worker Threads

```javascript
// Worker threads
const worker = new Worker('./worker.js');
worker.postMessage(data);
```

```typescript
// Titan PM
const worker = await pm.spawn(WorkerService);
await worker.process(data);
```

## License

MIT © Omnitron