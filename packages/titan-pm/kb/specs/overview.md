---
module: titan-pm
title: "ProcessManagerModule - Process Management"
tags: [process-manager, spawner, pool, supervisor, ipc, netron, worker-threads]
summary: "Process management module with Netron-backed IPC, type-safe service proxies, worker pools with load balancing, Erlang-style supervisors, and health monitoring."
depends_on: ["@omnitron-dev/titan/nexus", "@omnitron-dev/eventemitter", "netron"]
---

# ProcessManagerModule

Package: `@omnitron-dev/titan-pm`
Import: `@omnitron-dev/titan-pm`

Treats every spawned process as a Netron service with full type safety and transparent RPC. Supports child process fork and worker threads, process pools with multiple load-balancing strategies, and Erlang-style supervision trees.

## Module Setup

```typescript
import { ProcessManagerModule, PM_MANAGER_TOKEN } from '@omnitron-dev/titan-pm';

@Module({
  imports: [
    ProcessManagerModule.forRoot({
      isolation: 'worker',     // 'worker' (threads) or 'process' (fork)
      transport: 'unix',       // 'unix' | 'tcp' | 'websocket' | 'http'
      restartPolicy: {
        enabled: true,
        maxRestarts: 3,
        window: 60000,
        delay: 1000,
        backoff: { type: 'exponential', initial: 1000, max: 30000, factor: 2 },
      },
      resources: {
        maxMemory: '512MB',
        maxCpu: 1.0,
        timeout: 30000,
      },
      monitoring: {
        healthCheck: { interval: 30000, timeout: 5000 },
        metrics: true,
      },
    }),
  ],
})
export class AppModule {}
```

## DI Tokens

```typescript
import {
  PM_MANAGER_TOKEN,   // ProcessManager
  PM_CONFIG_TOKEN,     // IProcessManagerConfig
  PM_REGISTRY_TOKEN,   // ProcessRegistry
  PM_SPAWNER_TOKEN,    // ProcessSpawnerFactory
  PM_METRICS_TOKEN,    // ProcessMetricsCollector
  PM_HEALTH_TOKEN,     // ProcessHealthChecker
} from '@omnitron-dev/titan-pm';
```

## ProcessManager

Core class managing process lifecycle. Extends EventEmitter.

### Spawning Processes

```typescript
@Injectable()
class OrchestratorService {
  constructor(
    @Inject(PM_MANAGER_TOKEN)
    private readonly pm: ProcessManager
  ) {}

  async startWorker() {
    // Spawn from file path -- returns type-safe ServiceProxy
    const proxy = await this.pm.spawn<MyWorker>('./worker-process.js', {
      name: 'my-worker',
      startupTimeout: 30000,
      execArgv: ['--import', 'tsx/esm'],  // Forces child process mode
      dependencies: { configPath: '/path/to/config' },
      env: { NODE_ENV: 'production' },
      health: { enabled: true, interval: 30000 },
    });

    // Call methods with full type safety
    const result = await proxy.someMethod(arg1, arg2);

    // Control methods
    const metrics = await proxy.__getMetrics();
    const health = await proxy.__getHealth();
    await proxy.__destroy();
  }
}
```

### ServiceProxy<T>

All spawned processes return a `ServiceProxy<T>` -- a typed proxy that converts all methods to async.

```typescript
type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
} & IServiceProxyControl;

interface IServiceProxyControl {
  __processId: string;
  __destroy(): Promise<void>;
  __getMetrics(): Promise<IProcessMetrics>;
  __getHealth(): Promise<IHealthStatus>;
}
```

## ProcessSpawner

Factory-created spawner with automatic mode detection.

**Critical rule**: If `options.execArgv` is set (e.g., `['--import', 'tsx/esm']`), the spawner automatically forces child process mode. Worker threads do NOT support `execArgv`.

```typescript
// Auto-detect: worker threads if no execArgv, child process otherwise
const spawner = ProcessSpawnerFactory.create(logger, config);
```

## Process Pools

Worker pools with load balancing and auto-scaling.

```typescript
const pool = await pm.pool<MyWorker>('./worker-process.js', {
  size: 4,                              // Or 'auto' for CPU count
  strategy: PoolStrategy.POWER_OF_TWO,  // Recommended for high throughput
  warmup: true,                         // Pre-spawn all workers
  maxQueueSize: 1000,
  requestTimeout: 30000,
  memoryLimit: '512MB',
  memoryWarningThreshold: 0.8,
  replaceUnhealthy: true,

  // Static options for all workers
  spawnOptions: {
    health: { enabled: true },
    execArgv: ['--import', 'tsx/esm'],
  },

  // Per-worker dynamic options
  spawnOptionsFactory: (index) => ({
    name: `api-server-${index}`,
    dependencies: { portOffset: index },
  }),

  // Heartbeat for fast failure detection
  heartbeat: {
    enabled: true,
    interval: 10000,
    timeout: 5000,
    maxMissed: 3,
  },

  // Auto-scaling
  autoScale: {
    enabled: true,
    min: 2,
    max: 16,
    targetCPU: 0.7,
    checkInterval: 30000,
    cooldownPeriod: 60000,
  },
});

// Use pool like a single service -- load balanced automatically
const result = await pool.someMethod(arg1);

// Pool management
await pool.scale(8);      // Manual scale
console.log(pool.size);   // Current pool size
console.log(pool.active); // Active workers
await pool.drain();       // Graceful drain
await pool.destroy();     // Shutdown
```

### Pool Strategies (PoolStrategy)

| Strategy | Description |
|---|---|
| `ROUND_ROBIN` | Sequential rotation |
| `LEAST_LOADED` | Pick worker with lowest CPU/memory |
| `LEAST_CONNECTIONS` | Pick worker with fewest active requests |
| `POWER_OF_TWO` | Pick 2 random, choose less loaded (recommended) |
| `RANDOM` | Random selection |
| `ADAPTIVE` | Adjusts strategy based on load patterns |
| `CONSISTENT_HASH` | Sticky routing by key |
| `LATENCY` | Pick lowest response time |

## Supervisors

Erlang-style supervision trees with restart strategies.

### Config-Based Supervisor

```typescript
import { SupervisionStrategy, PoolStrategy } from '@omnitron-dev/titan-pm';

const supervisor = await pm.supervisor({
  strategy: SupervisionStrategy.ONE_FOR_ONE,
  maxRestarts: 5,
  window: 60_000,
  children: [
    {
      name: 'api',
      process: './api-process.js',
      spawnOptions: {
        dependencies: { port: 3001 },
        health: { enabled: true },
        execArgv: ['--import', 'tsx/esm'],
      },
      critical: true,  // Supervisor shuts down if this crashes beyond limits
    },
    {
      name: 'workers',
      process: './worker-process.js',
      poolOptions: {
        size: 4,
        strategy: PoolStrategy.POWER_OF_TWO,
      },
    },
    {
      name: 'optional-service',
      process: './optional.js',
      optional: true,  // Failure does not affect other children
    },
  ],
  onChildCrash: async (child, error) => {
    if (error.message.includes('OOM')) return RestartDecision.SHUTDOWN;
    return RestartDecision.RESTART;
  },
});
```

### Decorator-Based Supervisor

```typescript
import { Supervisor, Child } from '@omnitron-dev/titan-pm';

@Supervisor({
  strategy: SupervisionStrategy.ONE_FOR_ONE,
  maxRestarts: 5,
  window: 60_000,
})
class AppSupervisor {
  @Child({ critical: true })
  api = ApiProcess;

  @Child({ pool: { size: 4 } })
  workers = WorkerProcess;
}
```

### Supervision Strategies

| Strategy | Behavior |
|---|---|
| `ONE_FOR_ONE` | Only restart the crashed child |
| `ONE_FOR_ALL` | Restart all children when one crashes |
| `REST_FOR_ONE` | Restart crashed child and all children started after it |
| `SIMPLE_ONE_FOR_ONE` | Simplified one-for-one for dynamic children |

### Restart Decisions

```typescript
enum RestartDecision {
  RESTART = 'restart',    // Restart the child
  IGNORE = 'ignore',      // Do nothing
  ESCALATE = 'escalate',  // Propagate to parent supervisor
  SHUTDOWN = 'shutdown',   // Shut down entire supervisor
}
```

## IProcessOptions Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | derived from path | Process identifier |
| `version` | `string` | - | Service version |
| `allMethodsPublic` | `boolean` | `false` | Expose all methods via RPC |
| `dependencies` | `Record<string, any>` | - | Injected into child |
| `env` | `Record<string, string>` | - | Environment variables |
| `cwd` | `string` | parent CWD | Working directory |
| `execArgv` | `string[]` | - | Node.js CLI flags (forces fork mode) |
| `startupTimeout` | `number` | `30000` | Max time to wait for 'ready' |
| `netron` | object | - | Port, transport, host config |
| `scaling` | object | - | Min/max, strategy, metrics |
| `health` | object | - | Enabled, interval, timeout, retries |
| `memory` | object | - | Limit, alert, GC config |
| `security` | object | - | Isolation, sandbox, permissions |
| `observability` | object | - | Metrics, tracing, logs |

## Resilience Decorators

```typescript
import { CircuitBreaker, RateLimit, Idempotent } from '@omnitron-dev/titan-pm';

class MyService {
  @CircuitBreaker({ threshold: 5, resetTimeMs: 30000 })
  async callExternalApi() { /* ... */ }

  @RateLimit({ points: 100, duration: 60000 })
  async handleRequest() { /* ... */ }

  @Idempotent()
  async processPayment(paymentId: string) { /* ... */ }
}
```

## Process Events

```typescript
pm.on('process:spawn', (info: IProcessInfo) => { /* ... */ });
pm.on('process:ready', (info: IProcessInfo) => { /* ... */ });
pm.on('process:crash', (info: IProcessInfo, error: Error) => { /* ... */ });
pm.on('process:restart', (info: IProcessInfo, attempt: number) => { /* ... */ });
pm.on('process:stop', (info: IProcessInfo) => { /* ... */ });
pm.on('pool:scale', (pool: string, oldSize: number, newSize: number) => { /* ... */ });
pm.on('health:change', (processId: string, health: IHealthStatus) => { /* ... */ });
```

## Process Status Lifecycle

```
PENDING -> STARTING -> RUNNING -> STOPPING -> STOPPED
                          |
                          +-> FAILED / CRASHED
```

```typescript
enum ProcessStatus {
  PENDING = 'pending',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  FAILED = 'failed',
  CRASHED = 'crashed',
}
```

## Omnitron Integration

In the Omnitron daemon, PM manages app processes:

- Each child has two Netron instances: management plane (Unix socket) + data plane (HTTP)
- Control plane uses IPC (`process.send`) for PM messages (ready/error/shutdown)
- Bootstrap files (.ts) loaded via `--import tsx/esm` in child's `execArgv`
- `WorkerHandle` captures child stdout/stderr for structured log forwarding
- `handle.supervisor` MUST be set on AppHandle BEFORE `supervisor.start()` -- `attachLogCapture` needs it during `child:started`
