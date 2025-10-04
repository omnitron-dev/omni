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

## Summary

The Titan Process Manager is intentionally minimal:
- **PM handles**: Process lifecycle, IPC, monitoring
- **You handle**: Business logic, discovery, databases, etc.
- **Result**: Clean architecture, unlimited flexibility

This separation ensures PM remains focused, fast, and reliable while giving you complete freedom to build your application architecture.