---
module: omnitron
title: "Omnitron Development Best Practices"
tags: [omnitron, daemon, cli, development, best-practices]
summary: "Best practices for extending Omnitron: CLI commands, daemon services, config, and debugging"
depends_on: [architecture, daemon-lifecycle, cli-patterns]
---

# Omnitron Development Best Practices

## Adding New CLI Commands

### DO: Follow the established pattern
```typescript
// 1. Register in cli/omnitron.ts with lazy import
program
  .command('my-feature <arg>')
  .description('Clear description of what it does')
  .option('-f, --flag <value>', 'Flag description')
  .action(async (arg, opts) => {
    const { myFeatureCommand } = await import('../commands/my-feature.js');
    await myFeatureCommand(arg, opts);
  });

// 2. Implement in commands/my-feature.ts
export async function myFeatureCommand(arg: string, opts: { flag?: string }): Promise<void> {
  const client = createDaemonClient();
  try {
    if (!(await client.isReachable())) {
      const { log } = await import('@xec-sh/kit');
      log.error('Daemon not running. Run `omnitron up` first.');
      process.exit(1);
    }
    const result = await client.myMethod(arg);
    // ... display result
  } finally {
    await client.disconnect();
  }
}
```

### DO: Always check daemon reachability
```typescript
if (!(await client.isReachable())) {
  // Some commands can auto-start the daemon
  await daemonStart();
  // Others should just report and exit
}
```

### DO: Use @xec-sh/kit for TUI
```typescript
import { log, spinner, table } from '@xec-sh/kit';

const s = spinner();
s.start('Deploying...');
const result = await client.deploy(app);
s.stop(`Deployed: ${result.version}`);

log.success('Deployment complete');
log.error('Failed to connect');
log.info(`Running on port ${port}`);
```

## Adding Daemon Services

### DO: Register as singleton in daemon.module.ts
```typescript
@Module({
  providers: [
    {
      provide: MY_SERVICE_TOKEN,
      useFactory: (orchestrator, logger) => new MyService(orchestrator, logger),
      inject: [ORCHESTRATOR_TOKEN, LOGGER_TOKEN],
      scope: Scope.Singleton,  // MANDATORY for daemon services
    },
  ],
})
```

### DO: Expose via RPC for CLI access
```typescript
@Service({ name: 'MyFeature' })
export class MyFeatureRpcService {
  constructor(private myService: MyService) {}

  @Public({ auth: { roles: ['admin'] } })
  async doSomething(params: Dto): Promise<ResultDto> {
    return this.myService.doSomething(params);
  }
}
```

## Configuration

### DO: Use defineEcosystem for app definitions
```typescript
// omnitron.config.ts — at monorepo root
import { defineEcosystem } from '@omnitron-dev/omnitron';

export default defineEcosystem({
  project: 'my-project',
  apps: [
    {
      name: 'main',
      bootstrap: './apps/main/src/bootstrap.ts',
      requires: { postgres: true, redis: true },
    },
  ],
  infrastructure: {
    postgres: { port: 5432 },
    redis: { port: 6379 },
  },
  supervision: {
    maxRestarts: 5,
    maxRestartsWindow: 60_000,
  },
});
```

### DON'T: Import Titan in omnitron.config.ts
```typescript
// WRONG — config is loaded at CLI level, before any framework
import { Application } from '@omnitron-dev/titan/application';

// CORRECT — plain exports, no framework imports
export default defineEcosystem({ /* ... */ });
```

## Debugging

### Process issues
```bash
omnitron list                    # PID, status, CPU, memory
omnitron inspect <app>           # Deep diagnostics
omnitron logs <app> -f -l error  # Follow errors
omnitron health <app>            # Health indicators
```

### Infrastructure issues
```bash
omnitron infra status            # Docker container health
omnitron infra logs postgres -f  # PostgreSQL logs
omnitron infra psql              # Interactive SQL
omnitron infra redis-cli         # Interactive Redis
```

### Startup failures
```bash
# Run in foreground to see all output
omnitron up --foreground

# Check daemon log
cat ~/.omnitron/logs/omnitron.log | tail -100
```

## State Management

### DO: Use StateStore for daemon state
```typescript
// State is persisted to ~/.omnitron/state.json
await this.stateStore.set('lastDeploy', { app, version, timestamp });
const lastDeploy = await this.stateStore.get('lastDeploy');
```

### DON'T: Use global variables for state
Daemon processes may restart — all state must survive restarts via StateStore.

## Process Leak Prevention

Every `fork()` must have a corresponding `terminate()`:
1. Normal shutdown: `SIGTERM` → wait 10s → `SIGKILL`
2. Emergency: `PM.kill()` → `WorkerHandle.terminate()`
3. Never leave orphan processes — Omnitron PID manager tracks all children
