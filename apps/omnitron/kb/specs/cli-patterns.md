---
module: omnitron
title: "CLI Patterns"
tags: [cli, commands, commander, tui, daemon-client, rpc]
summary: "How CLI commands work: commander.js structure, lazy imports, DaemonClient RPC communication, @xec-sh/kit for TUI rendering, and patterns for adding new commands."
depends_on: [architecture]
---

# CLI Patterns

## Entry Point

`src/cli/omnitron.ts` is the CLI entry point (shebang `#!/usr/bin/env node`). It uses **commander.js** for command parsing and registers all commands in a single file.

```typescript
import { Command } from 'commander';
import { CLI_VERSION } from '../config/defaults.js';

const program = new Command();
program.name('omnitron').description('Production-grade Titan application supervisor').version(CLI_VERSION);

// Commands registered here...
program.parse();
```

## Lazy Import Pattern

Every command handler uses **lazy dynamic import** to minimize CLI startup time. The command definition is inline, but the implementation is loaded only when that command is invoked:

```typescript
program
  .command('list')
  .aliases(['ls'])
  .description('List all managed processes')
  .action(async () => {
    const { listCommand } = await import('../commands/list.js');
    await listCommand();
  });
```

This means the CLI binary loads only commander.js and config/defaults.ts at startup. The actual command logic, DaemonClient, TUI libraries, etc. are imported on demand.

**Convention**: Each command's implementation lives in `src/commands/{command-name}.ts` and exports one or more named functions (e.g., `listCommand`, `startCommand`).

## DaemonClient Communication

Almost every command follows this pattern:

1. Create a `DaemonClient` (connects to daemon via Unix socket)
2. Check if daemon is reachable
3. Call RPC methods
4. Render output
5. Disconnect

```typescript
// src/commands/list.ts
import { createDaemonClient } from '../daemon/daemon-client.js';
import { table, log, prism } from '@xec-sh/kit';

export async function listCommand(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const apps = await client.list();  // RPC call to DaemonRpcService

    if (apps.length === 0) {
      log.info('No apps registered');
      await client.disconnect();
      return;
    }

    // Render table...
    table({
      data: rows,
      columns: [
        { key: 'name', header: 'NAME', width: 'content' },
        { key: 'status', header: 'STATUS', width: 'content' },
        // ...
      ],
    });
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}
```

### DaemonClient API

The client implements `IDaemonService` directly -- methods delegate to a Netron proxy:

```typescript
// IDaemonService methods (directly on client):
await client.list();              // ProcessInfoDto[]
await client.status();            // DaemonStatusDto
await client.startApp({ name });  // Start a specific app
await client.stopApp({ name });   // Stop a specific app
await client.restartApp({ name });
await client.scaleApp({ name, count });
await client.metrics();           // AggregatedMetricsDto
await client.health();            // AggregatedHealthDto
await client.logs({ app, lines, level });
await client.inspect({ app });    // AppDiagnosticsDto
```

For non-daemon services, use the typed proxy pattern:

```typescript
// Other services via typed proxy:
const project = await client.service<IProjectRpcService>('OmnitronProject');
const stacks = await project.listStacks({ project: 'omni' });

const systemInfo = await client.service<ISystemInfoRpcService>('OmnitronSystemInfo');
const info = await systemInfo.getSystemInfo();
```

### Connection Details

```typescript
const CLI_REQUEST_TIMEOUT = 60_000;  // 60s per RPC call

class DaemonClient {
  constructor(socketPath = DEFAULT_SOCKET_PATH) {
    this.netron = new Netron(createNullLogger(), { id: `omnitron-${process.pid}` });
    this.netron.registerTransport('unix', () => new UnixSocketTransport());
    this.netron.setTransportOptions('unix', { requestTimeout: CLI_REQUEST_TIMEOUT });
  }
}
```

Default socket: `~/.omnitron/daemon.sock`.

## TUI Rendering (@xec-sh/kit)

The CLI uses `@xec-sh/kit` for terminal UI rendering:

### Available Primitives

```typescript
import { table, log, spinner, prism } from '@xec-sh/kit';

// Colored text
prism.green('online')
prism.red('crashed')
prism.yellow('starting')
prism.cyan('4')
prism.dim('(worker)')

// Structured logging
log.info('No apps registered');
log.warn('Daemon is not running');
log.error('Connection failed');

// Spinner (for long-running operations)
const s = spinner('Starting daemon...');
s.succeed('Daemon started');
s.fail('Daemon failed to start');

// Table rendering
table({
  data: [{ name: 'main', status: 'online', pid: '1234' }],
  columns: [
    { key: 'name', header: 'NAME', width: 'content' },
    { key: 'status', header: 'STATUS', width: 'content' },
    { key: 'pid', header: 'PID', align: 'right' },
  ],
});
```

### Format Helpers

`src/shared/format.ts` provides reusable formatters:

```typescript
formatStatus(status)          // Colored status badge
formatMemoryColored(bytes)    // Human-readable memory with color thresholds
formatUptime(ms)              // "2d 4h 15m" format
formatCpu(percent)            // Colored CPU percentage
formatRestarts(count)         // Yellow if > 0
formatPort(port)              // Port or '-'
```

## Command Categories

The CLI is organized into command groups:

### Daemon Lifecycle
- `omnitron up` -- Start daemon (background by default)
- `omnitron down` -- Stop daemon and all managed apps
- `omnitron ping` -- Check daemon connectivity
- `omnitron kill` -- Force kill daemon process

### App Management
- `omnitron start [app]` -- Start app(s)
- `omnitron stop [app]` -- Stop app(s)
- `omnitron restart [app]` -- Restart app(s)
- `omnitron reload [app]` -- Zero-downtime reload
- `omnitron scale <app> <count>` -- Scale instances

### Information
- `omnitron list` / `omnitron ls` -- Process table
- `omnitron status` -- Daemon status overview
- `omnitron inspect <app>` -- Deep diagnostics
- `omnitron env <app>` -- Resolved environment variables
- `omnitron config` -- Resolved ecosystem configuration

### Monitoring
- `omnitron logs [app]` -- View logs (follow, level filter, grep)
- `omnitron monit` -- Live TUI dashboard
- `omnitron health [app]` -- Health check report
- `omnitron metrics [app]` -- CPU/memory/latency metrics

### Project Management
- `omnitron project add <name> <path>` -- Register project
- `omnitron project list` -- List projects
- `omnitron project remove <name>` -- Remove project
- `omnitron project scan` -- Scan infrastructure requirements

### Stack Management
- `omnitron stack list` -- List stacks
- `omnitron stack create <project> <stack>` -- Create stack
- `omnitron stack delete <project> <stack>` -- Delete stack
- `omnitron stack start <project> <stack>` -- Start stack
- `omnitron stack stop <project> <stack>` -- Stop stack
- `omnitron stack status <project> <stack>` -- Stack detail
- `omnitron stack runtime <project> <stack>` -- Runtime status JSON

### Infrastructure
- `omnitron infra up` -- Provision Docker containers
- `omnitron infra down` -- Stop containers
- `omnitron infra status` -- Container status
- `omnitron infra logs [service]` -- Container logs
- `omnitron infra psql [db]` -- Open psql shell
- `omnitron infra redis-cli` -- Open redis-cli
- `omnitron infra migrate [app]` -- Run DB migrations
- `omnitron infra reset` -- Destroy and recreate (destructive)

### Fleet & Remote
- `omnitron remote add/remove/list/status` -- Manage remote servers
- `omnitron fleet status/health/metrics` -- Fleet-wide operations
- `omnitron cluster status/step-down` -- Cluster management
- `omnitron node add/list/update/remove/check/ssh-keys` -- Node management

### Deployment
- `omnitron deploy app <app>` -- Deploy with strategy
- `omnitron deploy build <app>` -- Build artifact
- `omnitron rollback <app>` -- Rollback to previous

### Other
- `omnitron secret set/get/list/delete` -- Secrets management
- `omnitron discover` -- Docker + SSH auto-discovery
- `omnitron health-check [app]` -- Composable health probes
- `omnitron pipeline list/run/status` -- CI/CD pipelines
- `omnitron backup create/list/restore` -- Database backups
- `omnitron k8s pods/deploy scale` -- Kubernetes
- `omnitron webapp build/start/stop/status/open` -- Console webapp
- `omnitron kb mcp/index/status/query` -- Knowledge base
- `omnitron init` -- Scaffold omnitron.config.ts
- `omnitron exec <app> <service> <method>` -- Direct RPC invocation

## Adding a New Command

Follow this pattern:

### 1. Create command handler

```typescript
// src/commands/my-command.ts
import { log, table, spinner } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function myCommand(arg: string, opts: { flag?: boolean }): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    // Call RPC methods
    const result = await client.someMethod({ arg });
    // Or use a typed service proxy
    const svc = await client.service<IMyRpcService>('OmnitronMyService');
    const data = await svc.doSomething();

    // Render output
    log.info(`Result: ${data}`);
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}
```

### 2. Register in CLI

```typescript
// src/cli/omnitron.ts
program
  .command('my-command <arg>')
  .description('Does something useful')
  .option('-f, --flag', 'Enable feature')
  .action(async (arg, opts) => {
    const { myCommand } = await import('../commands/my-command.js');
    await myCommand(arg, opts);
  });
```

### 3. Add RPC service (if needed)

If the command requires daemon-side logic:

1. Create service: `src/services/my.service.ts`
2. Create RPC service: `src/services/my.rpc-service.ts` (Netron `@Service`)
3. Add DI token: `src/shared/tokens.ts`
4. Register provider: `src/daemon/daemon.module.ts`
5. Expose in daemon: `src/daemon/daemon.ts` `exposeRpcServices()`
6. Add DTO types: `src/shared/dto/services.ts`

### Key Conventions

- **Always lazy import**: Command handlers must be dynamically imported in the `.action()` callback
- **Always disconnect**: Call `client.disconnect()` in all code paths (success, error, early return)
- **Check reachability**: Start with `client.isReachable()` and handle daemon-offline case
- **Use format helpers**: For consistent colored output across all commands
- **Subcommand groups**: Use `program.command('group').description(...)` then chain `.command()` on the group
