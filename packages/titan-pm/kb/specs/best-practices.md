---
module: titan-pm
title: "Process Management Best Practices"
tags: [pm, process, supervision, workers, best-practices]
summary: "Best practices for process management, supervision strategies, worker pools, and debugging"
depends_on: [overview]
---

# Process Management Best Practices

## Process Type Selection

| Need | Use | Why |
|------|-----|-----|
| TypeScript app with tsx | `child_process.fork()` | Workers don't support execArgv |
| CPU-intensive isolated task | Worker thread | Better memory sharing |
| Long-running service | Fork + supervisor | Restart on crash |
| Parallel batch processing | Worker pool | Load balancing |

### Critical Rule
If `options.execArgv` contains `--import tsx/esm`, **MUST use fork, not worker threads**:
```typescript
// ProcessSpawner auto-detects this
useWorkerThreads = isolation === 'worker'
  && (!options.execArgv || options.execArgv.length === 0);
```

## Supervision Strategy

### DO: Configure restart policies per process type
```typescript
{
  processes: [
    {
      name: 'api',
      module: './src/api.ts',
      supervision: {
        strategy: 'one-for-one',  // Only restart the failed process
        maxRestarts: 5,
        maxRestartsWindow: 60_000, // Within 60 seconds
        backoff: {
          type: 'exponential',
          initialDelay: 1000,
          maxDelay: 30_000,
        },
      },
    },
  ],
}
```

### Supervision Strategies
| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `one-for-one` | Restart only crashed process | Independent processes |
| `one-for-all` | Restart ALL when one crashes | Tightly coupled processes |
| `rest-for-one` | Restart crashed + all started after it | Dependency chain |
| `simple-one-for-one` | Like one-for-one for dynamic pools | Worker pools |

## Startup Timeout

### DO: Set appropriate startup timeouts
```typescript
{
  startupTimeout: 30_000,  // Default: 30s for simple apps
  // Worker pools may need more time (WebSocket connections, etc.)
  pools: [{
    startupTimeout: 60_000,  // 60s for pools
  }],
}
```

### DON'T: Infinite startup timeout
An app that never becomes "ready" should be killed and reported, not left hanging.

## Process Communication

### DO: Use IPC for control, Netron RPC for data
```
Control plane: process.send/on('message') → PM messages (ready/error/shutdown)
Data plane:    Netron over Unix sockets → actual RPC calls
```

### DON'T: Mix control and data channels
```typescript
// WRONG — business data over IPC
process.send({ type: 'user-data', payload: bigObject });

// CORRECT — IPC for signals only
process.send({ type: 'ready' });
process.send({ type: 'error', message: 'DB unavailable' });
```

## Worker Pool Configuration

### DO: Size pools to available CPUs
```typescript
{
  pool: {
    min: 1,
    max: require('os').cpus().length,
    strategy: 'round-robin',  // or 'least-connections', 'random'
  },
}
```

## Process Leak Prevention

### DO: Always use PM.kill() for cleanup
```typescript
// ProcessSupervisor.stopChild() and ProcessPool.shutdownWorker()
// MUST call WorkerHandle.terminate() which sends SIGTERM then SIGKILL
// Previously they only called proxy.__destroy() (RPC disconnect)
// leaving OS processes alive — this was fixed
```

## handle.supervisor Setup Order

```typescript
// CRITICAL: Set supervisor BEFORE start()
handle.supervisor = supervisor;  // Must be set first
await supervisor.start();        // attachLogCapture needs supervisor during child:started
```

## Debugging Process Issues

```bash
# Check running processes
omnitron list

# Inspect specific app (DI state, connections, memory)
omnitron inspect <app-name>

# Follow logs with filtering
omnitron logs <app-name> -f -l error

# Check health of all processes
omnitron health
```
