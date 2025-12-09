# Titan Process Manager Module

## Core Philosophy

The Titan Process Manager (PM) is a **minimalist orchestration layer** that provides:
- Process lifecycle management (spawn, monitor, shutdown)
- Inter-process communication via Netron RPC
- Process pools and load balancing
- Health monitoring and metrics
- **Nothing more, nothing less**

## Architectural Principles

### 1. Separation of Concerns

**PM Layer (Infrastructure)**
- Process spawning and lifecycle
- IPC transport (ipc, unix, tcp, http)
- Process isolation (none, worker, child)
- Health checks and metrics
- Process pools and scaling

**Process Layer (Business Logic)**
- Your actual application code
- Can be a simple service
- Can be a full Titan application
- Can integrate any modules (Redis, Discovery, etc.)
- Complete freedom of implementation

### 2. No Built-in Discovery

The PM does **NOT** include service discovery. Why?
- Discovery is a business concern, not infrastructure
- Different apps need different discovery strategies
- Keeps PM focused and minimal

For discovery, processes should:
- Use the Titan Discovery module themselves
- Or implement custom discovery
- Or use external discovery services

### 3. Process Independence

Each process is completely independent:
- Has its own memory space
- Can use any libraries/frameworks
- Can be a full Titan application
- Can have its own DI container
- Can integrate with any services

## Installation

```typescript
import { Application } from '@omnitron-dev/titan';
import { ProcessManagerModule } from '@omnitron-dev/titan/module/pm';

const app = await Application.create({
  imports: [
    ProcessManagerModule.forRoot({
      // Minimal, focused configuration
      isolation: 'worker',    // or 'child', 'none'
      transport: 'ipc',      // or 'unix', 'tcp', 'http'
      monitoring: {
        healthCheck: true,
        metrics: true
      }
    })
  ]
});
```

## Process Definition

### File Structure

Each process MUST be in its own file with default export:

```typescript
// calculator.process.ts
import { Process, Public } from '@omnitron-dev/titan/pm';

@Process({
  name: 'calculator',
  version: '1.0.0'
})
export default class CalculatorProcess {
  @Public()
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }
}
```

### Spawning Processes

```typescript
const calculator = await pm.spawn<CalculatorProcess>(
  '/path/to/calculator.process.js',  // Compiled JS file
  {
    name: 'calculator',
    version: '1.0.0'
  }
);

// Type-safe RPC calls
const result = await calculator.add(5, 3);  // Returns 8
```

## Architectural Patterns

### Pattern 1: Simple Service

```typescript
@Process({ name: 'simple-service' })
export default class SimpleService {
  @Public()
  async doWork(data: any) {
    return processData(data);
  }
}
```

### Pattern 2: Service with Dependencies

```typescript
@Process({ name: 'database-service' })
export default class DatabaseService {
  private db: Database;

  async init(config: DatabaseConfig) {
    this.db = new Database(config);
    await this.db.connect();
  }

  @Public()
  async query(sql: string) {
    return this.db.execute(sql);
  }
}

// Spawn with dependencies
const dbService = await pm.spawn<DatabaseService>(
  '/path/to/database.process.js',
  {
    dependencies: {
      config: { host: 'localhost', port: 5432 }
    }
  }
);
```

### Pattern 3: Process as Full Titan Application

```typescript
@Process({ name: 'microservice' })
export default class MicroserviceProcess {
  private app: Application;

  async init(config: any) {
    // Create a complete Titan application
    this.app = await Application.create({
      imports: [
        LoggerModule.forRoot(),
        ConfigModule.forRoot(),
        DiscoveryModule.forRoot({  // Process handles its own discovery
          serviceName: 'my-microservice'
        }),
        RedisModule.forRoot(),
        BusinessModule  // Your business logic module
      ]
    });

    await this.app.start();
  }

  @Public()
  async handleBusinessLogic(data: any) {
    const service = this.app.get(BusinessService);
    return service.process(data);
  }

  @OnShutdown()
  async cleanup() {
    await this.app.stop();
  }
}
```

## Process Pools

For CPU-intensive or high-load scenarios:

```typescript
const pool = await pm.pool<ImageProcessor>(
  '/path/to/image-processor.process.js',
  {
    size: 4,                // Number of workers
    strategy: 'least-loaded' // Load balancing strategy
  }
);

// Requests are automatically load-balanced
const result = await pool['processImage'](imageData);
```

## Health Monitoring

```typescript
// Each process can define health checks
@Process({ name: 'service' })
export default class Service {
  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      checks: [
        { name: 'database', status: 'pass' },
        { name: 'memory', status: 'pass' }
      ],
      timestamp: Date.now()
    };
  }
}

// PM aggregates health
const health = await pm.getHealth(processId);
```

## Metrics Collection

```typescript
const metrics = await pm.getMetrics(processId);
// {
//   cpu: 23.5,
//   memory: 104857600,
//   requests: 1523,
//   errors: 2,
//   latency: { p50: 12, p95: 45, p99: 102 }
// }
```

## Configuration Reference

```typescript
interface IProcessManagerConfig {
  /**
   * Process isolation strategy
   * - 'none': In-process (testing only)
   * - 'worker': Worker threads (default, fast)
   * - 'child': Child processes (more isolation)
   */
  isolation?: 'none' | 'worker' | 'child';

  /**
   * IPC transport
   * - 'ipc': Native IPC (fastest)
   * - 'unix': Unix sockets
   * - 'tcp': TCP sockets
   * - 'http': HTTP/WebSocket
   */
  transport?: 'ipc' | 'unix' | 'tcp' | 'http';

  /** Restart policy */
  restartPolicy?: {
    enabled?: boolean;
    maxRestarts?: number;
    window?: number;
    backoff?: {
      type: 'linear' | 'exponential';
      initial?: number;
      max?: number;
    };
  };

  /** Resource limits */
  resources?: {
    maxMemory?: string;
    maxCpu?: number;
    timeout?: number;
  };

  /** Monitoring */
  monitoring?: {
    healthCheck?: boolean | { interval?: number; timeout?: number };
    metrics?: boolean;
    tracing?: boolean;
  };
}
```

## Why This Architecture?

### 1. Minimalism
PM does process management. Period. No feature creep.

### 2. Flexibility
Processes can be anything from simple functions to full microservices.

### 3. Scalability
Start simple, grow complex. PM scales with you.

### 4. Type Safety
Full TypeScript support across process boundaries.

### 5. Production Ready
Battle-tested patterns for real-world applications.

## Common Patterns

### Microservices Architecture

```typescript
// Each microservice is a process
const authService = await pm.spawn('/services/auth.js');
const userService = await pm.spawn('/services/users.js');
const orderService = await pm.spawn('/services/orders.js');

// They communicate via type-safe RPC
const user = await userService.createUser(data);
const token = await authService.generateToken(user);
const order = await orderService.createOrder(user.id, items);
```

### Worker Pool Pattern

```typescript
// CPU-intensive work distributed across workers
const workers = await pm.pool('/workers/processor.js', { size: 8 });

// Process in parallel
const results = await Promise.all(
  jobs.map(job => workers['process'](job))
);
```

### Sidecar Pattern

```typescript
// Main service with sidecar processes
const mainService = await pm.spawn('/services/main.js');
const loggingSidecar = await pm.spawn('/sidecars/logging.js');
const metricsSidecar = await pm.spawn('/sidecars/metrics.js');

// Sidecars handle cross-cutting concerns
await loggingSidecar.configure(mainService.__processId);
await metricsSidecar.monitor(mainService.__processId);
```

## Best Practices

1. **Keep PM Config Minimal**: Only configure what PM needs (isolation, transport)
2. **Business Logic in Processes**: Discovery, Redis, etc. belong in your process code
3. **One Process Per File**: Always use default export
4. **Type Imports Only**: Import types, not classes for type safety
5. **Use init() for Dependencies**: Pass config via dependencies option
6. **Implement Health Checks**: Use @HealthCheck for monitoring
7. **Handle Cleanup**: Use @OnShutdown for graceful shutdown

## Migration from Traditional PM

If migrating from PM2 or similar:

```typescript
// PM2 style
pm2.start({
  script: 'app.js',
  instances: 4,
  exec_mode: 'cluster'
});

// Titan PM equivalent
const pool = await pm.pool<AppProcess>(
  '/path/to/app.process.js',
  { size: 4 }
);
```

## Testing

```typescript
// Use in-process isolation for testing
const pm = createProcessManager({
  isolation: 'none',
  testing: { useMockSpawner: true }
});

// Processes run in same process for easy testing
const service = await pm.spawn('/path/to/service.js');
const result = await service.method();
expect(result).toBe(expected);
```

## Troubleshooting

### Process Not Found
Ensure you're using the compiled `.js` file, not `.ts`.

### No Default Export
Always use `export default class` in process files.

### Discovery Not Working
PM doesn't provide discovery. Use Discovery module in your process.

### Type Errors
Import types only: `import type ProcessClass from '...'`

## Decorators Reference

The Process Manager provides a rich set of decorators for defining processes, workflows, and advanced behaviors.

### Process Decorators

#### @Process(options)
Mark a class as a Process that can be spawned as a Netron service.

```typescript
@Process({
  name: 'data-processor',
  version: '1.0.0',
  description: 'Processes incoming data streams',
  scaling: {
    min: 2,
    max: 10,
    strategy: 'cpu'
  },
  health: {
    enabled: true,
    interval: 30000
  }
})
export default class DataProcessor {
  // ... implementation
}
```

**Options:**
- `name` - Process name for identification
- `version` - Service version for discovery
- `description` - Process description
- `dependencies` - Dependencies for initialization
- `scaling` - Auto-scaling configuration
- `health` - Health check configuration
- `memory` - Memory management options
- `security` - Security and isolation options
- `observability` - Metrics, tracing, and logging
- `cluster` - Clustering options
- `multiTenant` - Multi-tenancy support
- `mesh` - Service mesh features
- `geo` - Geographic distribution
- `cost` - Cost optimization
- `selfHealing` - Self-healing configuration

#### @Method() / @Public()
Expose a method for RPC access (both decorators are equivalent).

```typescript
@Process({ name: 'calculator' })
export default class Calculator {
  @Public()
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  @Method()
  async multiply(a: number, b: number): Promise<number> {
    return a * b;
  }
}
```

#### @RateLimit(options)
Apply rate limiting to a process method.

```typescript
@Process({ name: 'api' })
export default class APIProcess {
  @Public()
  @RateLimit({
    rps: 100,              // Requests per second
    burst: 150,            // Burst capacity
    strategy: 'token-bucket', // or 'sliding-window', 'fixed-window'
    key: 'userId'          // Rate limit key from request
  })
  async handleRequest(userId: string, data: any) {
    // Process request
  }
}
```

#### @Cache(options)
Enable caching for a process method.

```typescript
@Process({ name: 'data-service' })
export default class DataService {
  @Public()
  @Cache({
    ttl: 60000,            // Time to live in milliseconds
    key: (args) => args[0], // Cache key function
    condition: (result) => result !== null // Cache condition
  })
  async fetchData(id: string) {
    // Expensive operation
    return await this.database.query(id);
  }
}
```

#### @Validate(options)
Add input validation to a process method.

```typescript
import * as yup from 'yup';

@Process({ name: 'user-service' })
export default class UserService {
  @Public()
  @Validate({
    schema: yup.object({
      email: yup.string().email().required(),
      age: yup.number().min(18).required()
    })
  })
  async createUser(data: any) {
    // Data is validated before reaching here
  }
}
```

#### @Trace()
Enable distributed tracing for a process method.

```typescript
@Process({ name: 'order-service' })
export default class OrderService {
  @Public()
  @Trace()
  async processOrder(orderId: string) {
    // Method execution is automatically traced
    const user = await this.userService.getUser(userId);
    const payment = await this.paymentService.charge(amount);
    return this.createOrder(orderId, user, payment);
  }
}
```

#### @Metric(name?)
Enable custom metrics collection for a process method.

```typescript
@Process({ name: 'analytics' })
export default class AnalyticsService {
  @Public()
  @Metric('event_processing')
  async processEvent(event: any) {
    // Metrics automatically collected: count, latency, errors
  }
}
```

### Resilience Decorators

#### @CircuitBreaker(options)
Add circuit breaker pattern to a method for fault tolerance.

```typescript
@Process({ name: 'external-api' })
export default class ExternalAPIService {
  @Public()
  @CircuitBreaker({
    threshold: 5,          // Failures before opening
    timeout: 60000,        // Time before half-open (ms)
    fallback: 'getCachedData' // Fallback method name
  })
  async fetchFromAPI(url: string) {
    return await fetch(url);
  }

  async getCachedData(url: string) {
    return this.cache.get(url);
  }
}
```

**Circuit Breaker States:**
- **CLOSED** - Normal operation, requests pass through
- **OPEN** - Too many failures, requests fail immediately (or use fallback)
- **HALF_OPEN** - Testing if service recovered, limited requests allowed

#### @Idempotent(options)
Make a method idempotent by caching results based on a key.

```typescript
@Process({ name: 'payment' })
export default class PaymentService {
  @Public()
  @Idempotent({
    key: 'transactionId',  // Key field in request
    ttl: '1h'              // Cache duration (s, m, h, d)
  })
  async processPayment(request: { transactionId: string; amount: number }) {
    // Duplicate requests with same transactionId return cached result
    return await this.chargeCard(request);
  }
}
```

#### @SelfHeal(options)
Define self-healing behavior for a method.

```typescript
@Process({ name: 'database' })
export default class DatabaseService {
  @SelfHeal({
    symptoms: ['connection_error', 'timeout'],
    action: 'restart',
    cooldown: '5m'
  })
  async query(sql: string) {
    return await this.db.execute(sql);
  }
}
```

### Supervisor Decorators

#### @Supervisor(options)
Mark a class as a Supervisor that manages child processes.

```typescript
@Supervisor({
  strategy: SupervisionStrategy.ONE_FOR_ONE,
  maxRestarts: 3,
  window: 60000,
  backoff: {
    type: 'exponential',
    initial: 1000,
    max: 30000
  }
})
export default class ApplicationSupervisor {
  @Child({ critical: true })
  database = DatabaseService;

  @Child({ pool: { size: 4 } })
  worker = WorkerService;

  @Child({ optional: true })
  analytics = AnalyticsService;
}
```

**Supervision Strategies:**
- `ONE_FOR_ONE` - Restart only failed child
- `ONE_FOR_ALL` - Restart all children if one fails
- `REST_FOR_ONE` - Restart failed child and all started after it
- `SIMPLE_ONE_FOR_ONE` - Dynamically managed identical children

#### @Child(options)
Define a child process in a supervisor.

```typescript
@Supervisor()
export default class MicroserviceSupervisor {
  @Child({
    critical: true,        // Supervisor fails if this child fails repeatedly
    pool: {                // Optional: spawn as a pool
      size: 4,
      strategy: 'least-loaded'
    },
    optional: false        // If true, supervisor continues if child fails
  })
  authService = AuthService;
}
```

### Workflow Decorators

#### @Workflow()
Mark a class as a DAG-based workflow.

```typescript
@Workflow()
export default class OrderWorkflow {
  // Stages defined with @Stage decorator
}
```

#### @Stage(options)
Define a workflow stage.

```typescript
@Workflow()
export default class OrderWorkflow {
  @Stage({ name: 'validate' })
  async validateOrder(order: any) {
    // Validation logic
    return { valid: true, order };
  }

  @Stage({
    name: 'charge',
    dependsOn: 'validate',  // Runs after validate
    timeout: 30000,         // 30 second timeout
    retries: 3              // Retry up to 3 times
  })
  async chargePayment(input: any) {
    const { order } = input.validate;
    return await this.paymentService.charge(order.amount);
  }

  @Stage({
    name: 'fulfill',
    dependsOn: ['validate', 'charge'], // Multiple dependencies
    parallel: false
  })
  async fulfillOrder(input: any) {
    const { order } = input.validate;
    return await this.warehouse.ship(order);
  }
}

// Execute workflow
const workflow = await pm.workflow(OrderWorkflow);
const result = await workflow.run(orderData);
```

**Parallel Execution:**
Stages with no dependencies or satisfied dependencies run in parallel automatically.

```typescript
@Workflow()
export default class ParallelWorkflow {
  @Stage({ name: 'fetch-user' })
  async fetchUser(id: string) { /* ... */ }

  @Stage({ name: 'fetch-orders' })
  async fetchOrders(id: string) { /* ... */ }

  @Stage({ name: 'fetch-payments' })
  async fetchPayments(id: string) { /* ... */ }

  // All three stages run in parallel
  @Stage({
    name: 'aggregate',
    dependsOn: ['fetch-user', 'fetch-orders', 'fetch-payments']
  })
  async aggregate(input: any) {
    return {
      user: input['fetch-user'],
      orders: input['fetch-orders'],
      payments: input['fetch-payments']
    };
  }
}
```

#### @Compensate(stageName)
Define a compensation handler for a workflow stage (saga pattern).

```typescript
@Workflow()
export default class SagaWorkflow {
  @Stage({ name: 'reserve-inventory' })
  async reserveInventory(order: any) {
    return await this.inventory.reserve(order.items);
  }

  @Compensate('reserve-inventory')
  async unreserveInventory(result: any) {
    await this.inventory.release(result.reservationId);
  }

  @Stage({ name: 'charge-payment', dependsOn: 'reserve-inventory' })
  async chargePayment(input: any) {
    return await this.payment.charge(input.amount);
  }

  @Compensate('charge-payment')
  async refundPayment(result: any) {
    await this.payment.refund(result.transactionId);
  }
}

// If any stage fails, compensations run in reverse order
```

### Utility Decorators

#### @HealthCheck(options)
Define a custom health check method.

```typescript
@Process({ name: 'database-service' })
export default class DatabaseService {
  @HealthCheck({ interval: 30000 })
  async checkHealth(): Promise<IHealthStatus> {
    const dbConnected = await this.db.ping();
    const diskSpace = await this.checkDiskSpace();

    return {
      status: dbConnected && diskSpace > 10 ? 'healthy' : 'unhealthy',
      checks: [
        { name: 'database', status: dbConnected ? 'pass' : 'fail' },
        { name: 'disk', status: diskSpace > 10 ? 'pass' : 'warn' }
      ],
      timestamp: Date.now()
    };
  }
}
```

#### @OnShutdown()
Handle graceful shutdown.

```typescript
@Process({ name: 'service' })
export default class Service {
  @OnShutdown()
  async cleanup() {
    await this.closeConnections();
    await this.flushBuffers();
    await this.saveState();
  }
}
```

#### @InjectProcess(ProcessClass)
Inject a process dependency (parameter decorator).

```typescript
@Process({ name: 'order-service' })
export default class OrderService {
  constructor(
    @InjectProcess(UserService) private userService: UserService,
    @InjectProcess(PaymentService) private paymentService: PaymentService
  ) {}
}
```

#### @SharedState()
Mark a property as shared state across process instances.

```typescript
@Process({ name: 'counter' })
export default class CounterService {
  @SharedState()
  count = 0;

  @Public()
  async increment() {
    this.count++; // Shared across all instances
    return this.count;
  }
}
```

## Load Balancing Strategies

The Process Manager supports 11 different load balancing strategies for process pools:

### Basic Strategies

#### ROUND_ROBIN
Sequential distribution across workers. Simple and fair.

```typescript
const pool = await pm.pool(WorkerProcess, {
  size: 4,
  strategy: PoolStrategy.ROUND_ROBIN
});
// Requests distributed: W1 → W2 → W3 → W4 → W1 → ...
```

#### RANDOM
Random worker selection. Good for simple load distribution.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.RANDOM
});
```

#### LEAST_LOADED
Selects worker with lowest current load (CPU/memory).

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.LEAST_LOADED
});
// Best for CPU/memory-intensive tasks
```

#### LEAST_CONNECTIONS
Selects worker with fewest active connections.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.LEAST_CONNECTIONS
});
// Best for long-running requests
```

### Advanced Strategies

#### WEIGHTED_ROUND_ROBIN
Round-robin with worker weights.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.WEIGHTED_ROUND_ROBIN
});
// Workers with higher capacity get more requests
```

#### LEAST_RESPONSE_TIME
Selects worker with lowest average response time.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.LEAST_RESPONSE_TIME
});
// Best for optimizing latency
```

#### LATENCY
Alias for LEAST_RESPONSE_TIME, selects by average latency.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.LATENCY
});
```

#### IP_HASH
Sticky sessions based on client IP (or custom key).

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.IP_HASH
});
// Same client always routes to same worker
```

#### CONSISTENT_HASH
Consistent hashing for stable distribution.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.CONSISTENT_HASH
});
// Minimizes redistribution when pool size changes
```

#### WEIGHTED
Probability-based selection using worker capacity.

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.WEIGHTED
});
// More capable workers receive proportionally more requests
```

#### ADAPTIVE
ML-like multi-factor scoring (load, latency, errors, connections).

```typescript
const pool = await pm.pool(WorkerProcess, {
  strategy: PoolStrategy.ADAPTIVE
});
// Considers: currentLoad (30%) + avgResponseTime (30%) + errorRate (20%) + connections (20%)
// Best for production with varying workloads
```

## Process Workflows

The Process Manager includes a powerful DAG (Directed Acyclic Graph) workflow orchestrator for complex multi-stage processes.

### Creating Workflows

```typescript
import { Workflow, Stage, Compensate } from '@omnitron-dev/titan/pm';

@Workflow()
export default class DataPipeline {
  @Stage({ name: 'extract' })
  async extractData(source: string) {
    return await this.dataSource.fetch(source);
  }

  @Stage({
    name: 'transform',
    dependsOn: 'extract',
    timeout: 60000,
    retries: 2
  })
  async transformData(input: any) {
    const data = input.extract;
    return this.processData(data);
  }

  @Stage({
    name: 'load',
    dependsOn: 'transform'
  })
  async loadData(input: any) {
    const transformed = input.transform;
    return await this.database.insert(transformed);
  }

  @Compensate('load')
  async rollbackLoad(result: any) {
    await this.database.delete(result.id);
  }
}

// Execute workflow
const pipeline = await pm.workflow(DataPipeline);
const result = await pipeline.run('/data/source');
```

### Dependency Management

Stages can depend on one or multiple stages:

```typescript
@Workflow()
export default class ComplexWorkflow {
  @Stage({ name: 'A' })
  async stageA() { /* ... */ }

  @Stage({ name: 'B' })
  async stageB() { /* ... */ }

  @Stage({ name: 'C', dependsOn: 'A' })
  async stageC() { /* ... */ }

  @Stage({ name: 'D', dependsOn: ['A', 'B'] })
  async stageD() { /* ... */ }

  @Stage({ name: 'E', dependsOn: ['C', 'D'] })
  async stageE() { /* ... */ }
}

// Execution plan:
// Level 0: A, B (parallel)
// Level 1: C, D (parallel, after A and B)
// Level 2: E (after C and D)
```

### Parallel Execution

Stages with satisfied dependencies run in parallel automatically:

```typescript
@Workflow()
export default class ParallelPipeline {
  @Stage({ name: 'fetch-users' })
  async fetchUsers() { /* ... */ }

  @Stage({ name: 'fetch-orders' })
  async fetchOrders() { /* ... */ }

  @Stage({ name: 'fetch-products' })
  async fetchProducts() { /* ... */ }

  // All three run in parallel, then join
  @Stage({
    name: 'join',
    dependsOn: ['fetch-users', 'fetch-orders', 'fetch-products']
  })
  async joinData(input: any) {
    return {
      users: input['fetch-users'],
      orders: input['fetch-orders'],
      products: input['fetch-products']
    };
  }
}
```

### Compensation (Saga Pattern)

Workflows support automatic compensation (rollback) on failure:

```typescript
@Workflow()
export default class OrderSaga {
  @Stage({ name: 'create-order' })
  async createOrder(data: any) {
    return await this.orders.create(data);
  }

  @Compensate('create-order')
  async cancelOrder(result: any) {
    await this.orders.cancel(result.orderId);
  }

  @Stage({ name: 'reserve-inventory', dependsOn: 'create-order' })
  async reserveInventory(input: any) {
    const order = input['create-order'];
    return await this.inventory.reserve(order.items);
  }

  @Compensate('reserve-inventory')
  async releaseInventory(result: any) {
    await this.inventory.release(result.reservationId);
  }

  @Stage({ name: 'charge-payment', dependsOn: 'reserve-inventory' })
  async chargePayment(input: any) {
    const order = input['create-order'];
    return await this.payment.charge(order.amount);
  }

  @Compensate('charge-payment')
  async refundPayment(result: any) {
    await this.payment.refund(result.transactionId);
  }
}

// If any stage fails, compensations run in reverse order:
// charge-payment fails → refundPayment → releaseInventory → cancelOrder
```

### Error Handling

Workflows handle errors at multiple levels:

```typescript
@Workflow()
export default class ResilientWorkflow {
  @Stage({
    name: 'api-call',
    timeout: 5000,     // Timeout after 5 seconds
    retries: 3         // Retry up to 3 times with exponential backoff
  })
  async callExternalAPI(data: any) {
    return await fetch(this.apiUrl, { body: data });
  }

  @Stage({
    name: 'process',
    dependsOn: 'api-call'
  })
  async process(input: any) {
    try {
      return await this.processData(input['api-call']);
    } catch (error) {
      // Stage-level error handling
      return this.fallbackProcess(input);
    }
  }
}

// Usage with error handling
try {
  const result = await workflow.run(data);
} catch (error) {
  // All compensations have been executed
  console.error('Workflow failed:', error);
}
```

## Auto-Scaling

Process pools support sophisticated auto-scaling based on multiple metrics:

```typescript
const pool = await pm.pool(WorkerProcess, {
  autoScale: {
    enabled: true,
    min: 2,                    // Minimum workers
    max: 20,                   // Maximum workers
    targetCPU: 70,             // Target CPU utilization (%)
    targetMemory: 80,          // Target memory utilization (%)
    scaleUpThreshold: 0.8,     // Scale up when load > 80%
    scaleDownThreshold: 0.3,   // Scale down when load < 30%
    cooldownPeriod: 60000      // Wait 60s between scaling actions
  }
});
```

### Scaling Triggers

The auto-scaler monitors multiple metrics:

- **CPU** - Scale up when CPU > `targetCPU`
- **Memory** - Scale up when memory > `targetMemory`
- **Saturation** - Scale up when (active + queued) / capacity > `scaleUpThreshold`
- **Queue Size** - Scale up when too many requests are queued

### Scaling Behavior

```typescript
// Scale up gradually
if (cpu > targetCPU || memory > targetMemory || saturation > scaleUpThreshold) {
  newSize = Math.min(currentSize + 1, max);
}

// Scale down conservatively
if (cpu < 30 && memory < 40 && saturation < scaleDownThreshold) {
  newSize = Math.max(currentSize - 1, min);
}
```

### Manual Scaling

You can also scale manually:

```typescript
// Scale to specific size
await pool.scale(10);

// Get current size
console.log(pool.size); // 10

// Monitor scaling events
pool.on('pool:scaled', ({ from, to }) => {
  console.log(`Scaled from ${from} to ${to} workers`);
});
```

## Circuit Breaker

The circuit breaker pattern prevents cascading failures by failing fast when a service is unavailable.

### Using Circuit Breaker

```typescript
@Process({ name: 'external-service' })
export default class ExternalService {
  @Public()
  @CircuitBreaker({
    threshold: 5,          // Open after 5 consecutive failures
    timeout: 60000,        // Try half-open after 60 seconds
    halfOpenRequests: 3,   // Test with 3 requests in half-open
    fallback: 'getFromCache' // Fallback method
  })
  async fetchData(url: string) {
    return await fetch(url);
  }

  async getFromCache(url: string) {
    return this.cache.get(url) || { cached: true, data: null };
  }
}
```

### Circuit Breaker States

#### CLOSED (Normal Operation)
- Requests pass through normally
- Failures are counted
- Opens when failures reach `threshold`

#### OPEN (Failing Fast)
- Requests fail immediately (or use fallback)
- No requests reach the actual service
- Transitions to HALF_OPEN after `timeout`

#### HALF_OPEN (Testing Recovery)
- Limited requests (`halfOpenRequests`) are allowed
- If successful → CLOSED
- If any fail → OPEN

### Flow Diagram

```
         Success
CLOSED ←---------- HALF_OPEN
  ↓                    ↑
  | threshold failures |
  ↓                    |
OPEN ---------------→  |
     timeout reached
```

### Example

```typescript
const service = await pm.spawn(ExternalService);

// First 5 requests fail → Circuit opens
for (let i = 0; i < 5; i++) {
  try { await service.fetchData('http://down.example.com'); }
  catch (e) { /* Failures counted */ }
}

// Circuit is now OPEN
await service.fetchData('...'); // Fails immediately with "Circuit breaker is open"

// After timeout, circuit enters HALF_OPEN
// Next 3 requests test if service recovered
// If successful → CLOSED, if any fail → OPEN again
```

### Pool-Level Circuit Breaker

Pools can also use circuit breakers:

```typescript
const pool = await pm.pool(WorkerProcess, {
  circuitBreaker: {
    enabled: true,
    threshold: 10,     // More failures tolerated for pools
    timeout: 30000,
    halfOpenRequests: 5
  }
});
```

## Enterprise Features

The Process Manager includes 16 enterprise-grade features for production systems. Each feature is modular and can be used independently.

### 1. CQRS (Command Query Responsibility Segregation)

Separate read and write models for scalability.

```typescript
import { CommandBus, QueryBus, Command, Query } from '@omnitron-dev/titan/pm/enterprise';

@Command()
class CreateUserCommand {
  constructor(public email: string, public name: string) {}
}

@Query()
class GetUserQuery {
  constructor(public userId: string) {}
}

// Separate command and query handlers
```

**Benefits:** Independent scaling, optimized data models, better performance

**Documentation:** See `packages/titan/src/modules/pm/enterprise/cqrs.ts`

### 2. Event Sourcing

Store state as a sequence of events instead of current state.

```typescript
import { EventSourcedAggregateRoot, EventHandler } from '@omnitron-dev/titan/pm/enterprise';

class UserAggregate extends EventSourcedAggregateRoot {
  @EventHandler('UserCreated')
  onUserCreated(event: any) {
    this.id = event.userId;
    this.email = event.email;
  }
}
```

**Benefits:** Complete audit trail, time-travel debugging, event replay

**Documentation:** See `packages/titan/src/modules/pm/enterprise/event-sourcing.ts`

### 3. Saga Pattern

Distributed transactions with compensation.

```typescript
import { SagaOrchestrator } from '@omnitron-dev/titan/pm/enterprise';

// Implemented via @Workflow and @Compensate decorators
// See "Process Workflows" section above
```

**Benefits:** Reliable distributed transactions, automatic rollback

**Documentation:** See `packages/titan/src/modules/pm/enterprise/saga.ts`

### 4. Actor Model

Lightweight, isolated concurrent entities.

```typescript
import { Actor, ActorSystem } from '@omnitron-dev/titan/pm/enterprise';

class UserActor extends Actor {
  async receive(message: any) {
    if (message.type === 'update') {
      this.state.name = message.name;
    }
  }
}

const system = createActorSystem();
const user = await system.spawn(UserActor);
await user.send({ type: 'update', name: 'Alice' });
```

**Benefits:** High concurrency, fault isolation, message-driven

**Documentation:** See `packages/titan/src/modules/pm/enterprise/actor-model.ts`

### 5. Multi-tenancy

Isolated environments for multiple tenants.

```typescript
import { MultiTenancyManager, TenantAware } from '@omnitron-dev/titan/pm/enterprise';

@TenantAware()
@Process({ name: 'tenant-service' })
export default class TenantService {
  @Public()
  async getData(tenantId: string) {
    // Data automatically isolated by tenant
  }
}
```

**Benefits:** Resource isolation, separate quotas, data segregation

**Documentation:** See `packages/titan/src/modules/pm/enterprise/multi-tenancy.ts`

### 6. Service Mesh

Traffic management, observability, and resilience.

```typescript
import { ServiceMeshProxy } from '@omnitron-dev/titan/pm/enterprise';

const proxy = new ServiceMeshProxy({
  rateLimit: { rps: 1000 },
  circuitBreaker: { threshold: 5 },
  retry: { attempts: 3 },
  mtls: true,
  tracing: true
});
```

**Benefits:** Service-to-service security, traffic control, observability

**Documentation:** See `packages/titan/src/modules/pm/enterprise/service-mesh.ts`

### 7. Chaos Engineering

Test system resilience with controlled failures.

```typescript
import { ChaosMonkey, ChaosType } from '@omnitron-dev/titan/pm/enterprise';

const chaos = new ChaosMonkey({
  enabled: true,
  probability: 0.1 // 10% of requests
});

chaos.inject(ChaosType.LATENCY, { delay: 5000 });
chaos.inject(ChaosType.EXCEPTION, { error: 'Service unavailable' });
```

**Benefits:** Validate fault tolerance, find weaknesses, improve resilience

**Documentation:** See `packages/titan/src/modules/pm/enterprise/chaos-engineering.ts`

### 8. Time-Travel Debugging

Record and replay application state.

```typescript
import { TimeTravelDebugger, TimeTravel } from '@omnitron-dev/titan/pm/enterprise';

@Process({ name: 'debuggable' })
@TimeTravel()
export default class DebuggableService {
  @Public()
  async complexOperation(data: any) {
    // State changes automatically recorded
  }
}

// Travel back in time
await debugger.travelTo(snapshotId);
```

**Benefits:** Reproduce bugs, understand state changes, forensic debugging

**Documentation:** See `packages/titan/src/modules/pm/enterprise/time-travel.ts`

### 9. Feature Flags

Dynamic feature toggles and A/B testing.

```typescript
import { FeatureFlagManager, FeatureFlag } from '@omnitron-dev/titan/pm/enterprise';

@Process({ name: 'app' })
export default class App {
  @FeatureFlag('new-ui', { rollout: 0.5 }) // 50% rollout
  @Public()
  async getUI() {
    return this.newUI();
  }
}
```

**Benefits:** Gradual rollouts, A/B testing, instant rollback

**Documentation:** See `packages/titan/src/modules/pm/enterprise/feature-flags.ts`

### 10. Adaptive Scaling

ML-like predictive scaling based on patterns.

```typescript
import { AdaptiveScalingController } from '@omnitron-dev/titan/pm/enterprise';

const scaler = new AdaptiveScalingController({
  predictor: 'exponential-smoothing',
  horizon: 300000, // 5 minutes ahead
  aggressiveness: 'balanced'
});
```

**Benefits:** Proactive scaling, cost optimization, better performance

**Documentation:** See `packages/titan/src/modules/pm/enterprise/adaptive-scaling.ts`

### 11. Geo-Distribution

Global deployment with regional failover.

```typescript
import { GlobalLoadBalancer, GeoRoutingStrategy } from '@omnitron-dev/titan/pm/enterprise';

const glb = new GlobalLoadBalancer({
  regions: ['us-east', 'eu-west', 'ap-south'],
  routing: GeoRoutingStrategy.LATENCY,
  replication: 'active-active'
});
```

**Benefits:** Low latency, high availability, disaster recovery

**Documentation:** See `packages/titan/src/modules/pm/enterprise/geo-distribution.ts`

### 12. Compliance & Audit

GDPR, HIPAA, SOC2 compliance tooling.

```typescript
import { AuditLogger, ComplianceManager, ComplianceStandard } from '@omnitron-dev/titan/pm/enterprise';

const compliance = new ComplianceManager({
  standards: [ComplianceStandard.GDPR, ComplianceStandard.HIPAA]
});

// Automatic audit logging
auditLogger.log({
  action: 'data_access',
  actor: { id: 'user-123' },
  resource: { type: 'patient_record', id: 'record-456' }
});
```

**Benefits:** Regulatory compliance, audit trails, data governance

**Documentation:** See `packages/titan/src/modules/pm/enterprise/compliance.ts`

### 13. Data Streaming (CDC)

Change Data Capture and stream processing.

```typescript
import { CDCConnector, StreamProcessor } from '@omnitron-dev/titan/pm/enterprise';

const cdc = new CDCConnector({
  source: 'postgresql',
  tables: ['users', 'orders']
});

cdc.on('change', (event) => {
  console.log('Data changed:', event);
});
```

**Benefits:** Real-time data sync, event-driven architecture, ETL pipelines

**Documentation:** See `packages/titan/src/modules/pm/enterprise/data-streaming.ts`

### 14. GraphQL Federation

Distributed GraphQL with schema stitching.

```typescript
import { GraphQLService, GraphQLFederationGateway } from '@omnitron-dev/titan/pm/enterprise';

@GraphQLService({
  schema: `
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `
})
export default class UserService {
  @Query()
  async user(id: string) { /* ... */ }
}
```

**Benefits:** Unified GraphQL API, microservice architecture, schema management

**Documentation:** See `packages/titan/src/modules/pm/enterprise/graphql-federation.ts`

### 15. Cost Optimization

Resource efficiency and budget management.

```typescript
import { CostOptimizer } from '@omnitron-dev/titan/pm/enterprise';

const optimizer = new CostOptimizer({
  budget: { monthly: 10000, alert: 8000 },
  optimization: {
    spotInstances: true,
    autoScaleDown: 'aggressive',
    idleShutdown: '30m'
  }
});
```

**Benefits:** Lower costs, budget enforcement, resource efficiency

**Documentation:** See `packages/titan/src/modules/pm/enterprise/cost-optimization.ts`

### 16. Self-Healing

Automatic detection and recovery from failures.

```typescript
import { SelfHealingManager } from '@omnitron-dev/titan/pm/enterprise';

const healing = new SelfHealingManager({
  enabled: true,
  ml: true, // Machine learning-based detection
  playbooks: [
    {
      symptoms: ['high_error_rate', 'slow_response'],
      action: 'restart'
    }
  ]
});
```

**Benefits:** Automatic recovery, reduced downtime, intelligent remediation

**Documentation:** See `packages/titan/src/modules/pm/enterprise/self-healing.ts`

## Testing Utilities

The Process Manager includes specialized testing utilities for comprehensive test coverage.

### TestProcessManager

A specialized ProcessManager with additional testing capabilities:

```typescript
import { createTestProcessManager } from '@omnitron-dev/titan/pm/testing';

describe('My Process Tests', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({
      mock: true,              // Use mock spawner
      recordOperations: true   // Record all operations
    });
  });

  afterEach(async () => {
    await pm.cleanup();
  });
});
```

### API Reference

#### createTestProcessManager(config)

Create a test process manager with defaults for testing.

```typescript
const pm = createTestProcessManager({
  mock: true,              // Use in-process mock spawner (fast)
  controlTime: false,      // Enable time control
  recordOperations: true   // Record operations for verification
});
```

#### simulateCrash(processId)

Simulate a process crash for testing restart policies.

```typescript
const service = await pm.spawn(MyService);
await pm.simulateCrash(service.__processId);

// Wait for automatic restart
const recovered = await pm.waitForRecovery(service.__processId, 5000);
expect(recovered).toBe(true);
```

#### waitForRecovery(processId, timeout)

Wait for a crashed process to recover.

```typescript
await pm.simulateCrash(processId);
const recovered = await pm.waitForRecovery(processId, 5000);

if (recovered) {
  console.log('Process recovered successfully');
} else {
  console.log('Process did not recover in time');
}
```

#### setMetrics(processId, metrics)

Set simulated metrics for a process.

```typescript
pm.setMetrics(processId, {
  cpu: 85,
  memory: 1024 * 1024 * 512, // 512 MB
  requests: 1000,
  errors: 5,
  latency: { p50: 50, p95: 150, p99: 300 }
});

const metrics = await pm.getMetrics(processId);
expect(metrics.cpu).toBe(85);
```

#### setHealth(processId, health)

Set simulated health status.

```typescript
pm.setHealth(processId, {
  status: 'degraded',
  checks: [
    { name: 'database', status: 'pass' },
    { name: 'cache', status: 'warn' }
  ],
  timestamp: Date.now()
});

const health = await pm.getHealth(processId);
expect(health.status).toBe('degraded');
```

#### simulateFailure(operation, error)

Simulate a failure for the next operation.

```typescript
pm.simulateFailure('spawn:MyService', new Error('Out of memory'));

await expect(pm.spawn(MyService)).rejects.toThrow('Out of memory');

pm.clearFailures(); // Clear all simulated failures
```

#### advanceTime(ms)

Advance simulated time for testing time-based features.

```typescript
const startTime = pm.getCurrentTime();

pm.advanceTime(60000); // Advance 60 seconds

const endTime = pm.getCurrentTime();
expect(endTime - startTime).toBe(60000);

pm.resetTime(); // Reset to real time
```

#### getOperations()

Get recorded operations for verification.

```typescript
const service = await pm.spawn(MyService);
await service.doSomething();
await pm.kill(service.__processId);

const operations = pm.getOperations();
expect(operations).toContainEqual({
  type: 'spawn',
  processClass: 'MyService'
});
expect(operations).toContainEqual({
  type: 'kill',
  processId: service.__processId
});
```

#### verifyOperation(type, predicate)

Verify an operation occurred.

```typescript
const spawned = pm.verifyOperation('spawn', (op) =>
  op.processClass === 'MyService'
);

expect(spawned).toBe(true);
```

### Example Test Suite

```typescript
import { createTestProcessManager } from '@omnitron-dev/titan/pm/testing';
import { ProcessStatus } from '@omnitron-dev/titan/pm';

describe('Process Restart Tests', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager();
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should restart crashed process', async () => {
    const service = await pm.spawn(MyService, {
      restartPolicy: {
        enabled: true,
        maxRestarts: 3
      }
    });

    // Simulate crash
    await pm.simulateCrash(service.__processId);

    // Wait for recovery
    const recovered = await pm.waitForRecovery(service.__processId, 5000);
    expect(recovered).toBe(true);

    // Verify restart occurred
    const restartOp = pm.verifyOperation('restart', (op) =>
      op.processId === service.__processId
    );
    expect(restartOp).toBe(true);
  });

  it('should expose health metrics', async () => {
    const service = await pm.spawn(MyService);

    pm.setHealth(service.__processId, {
      status: 'healthy',
      checks: [{ name: 'ready', status: 'pass' }],
      timestamp: Date.now()
    });

    const health = await pm.getHealth(service.__processId);
    expect(health.status).toBe('healthy');
  });

  it('should track operations', async () => {
    await pm.spawn(MyService);
    await pm.spawn(MyService);

    const operations = pm.getOperations();
    const spawnOps = operations.filter(op => op.type === 'spawn');
    expect(spawnOps).toHaveLength(2);
  });
});
```

## Summary

The Titan Process Manager is intentionally minimal:
- **PM handles**: Process lifecycle, IPC, monitoring
- **You handle**: Business logic, discovery, databases, etc.
- **Result**: Clean architecture, unlimited flexibility

This separation ensures PM remains focused, fast, and reliable while giving you complete freedom to build your application architecture.