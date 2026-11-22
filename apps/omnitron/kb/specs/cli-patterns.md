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
- `omnitron stack account <project> <stack> --username <name> [--role <role>] [--display-name <text>] [--vault-key <key>]` -- Make a named account with a platform role on a remote stack's node (the project's `scripts/operator-account.mjs` at its HEAD commit, under the node's deploy lease). The password comes back sealed to a key made for the run (the SSH layer masks anything that looks like a password) and goes to the daemon's vault only — read it with `omnitron secret get <key>`
- `omnitron stack account <project> <stack> --show <name>` -- What the stand holds under a name: id, role, status, when made, last active; never a secret
- `omnitron stack account <project> <stack> --remove <name> --id <uuid> [--vault-key <key>]` -- Take the account with that name AND id away, then its password from the vault

### Infrastructure
- `omnitron tor [project] [stack] --json` inspects public onion hostname files on the current host. Each item includes the physical Docker ID, container status and hostname observation. A running container with a successful empty search returns `observation: "read"` and an empty `services` list. A stopped container returns `"not-running"`. Failed reads return a nonzero exit code with the observations available. Check the portal through Tor separately to verify reachability.
- For a restricted onion service, supply each server-side public client entry in `hiddenServices[].authorizedClients` as `descriptor:x25519:<base32-public-key>`. Omnitron validates the 32-byte key before installing the single-line authorization file. Keep each client's private credential on that client. [Tor client authorization](https://community.torproject.org/onion-services/advanced/client-auth/)
- `omnitron infra up` -- Provision the current standalone ecosystem’s declared containers
- `omnitron infra down` -- Remove its declared containers and retain volumes
- `omnitron infra status` -- Container status
- `omnitron infra logs [service]` -- Container logs
- `omnitron infra psql [db]` -- Open psql shell
- `omnitron infra redis-cli` -- Open redis-cli
- `omnitron infra migrate [app] --stack <project>/<stack> --dry-run` asks the registered owner to review declared migrations. A bare stack name is accepted only from one matching registered configuration directory. The owner uses the admitted declarations, allocated ports, vault and application environment used by startup; the CLI does not reconstruct connection strings or import application code. After a native restart, a disabled stack retains its durable stop and captured declarations. The owner can inspect its connection bindings through the canonical resolver and complete native preservation checks without provisioning or adopting containers. New migration files are read from the current application source. If the captured bootstrap itself changed, run `omnitron topology refresh <project> <stack>` before a fresh review.
- After a confirmed `stack stop <project> <stack> --keep-infrastructure`, repeat the review. Execute with `infra migrate [app] --stack <project>/<stack> --review <digest> --request-id <uuid>`. Review, execution and receipt access require an administrator. Online review has no executable digest. The digest binds the stop receipt, execution owner, application sources, installed dependency graph, SDK selection and database destinations. Changes require another review.
- `omnitron infra migrate --stack <project>/<stack> --status <uuid>` reads the recorded outcome. Reusing an execution ID returns its receipt; it never repeats SQL. Repeating the execution command with the same `--review` and `--request-id` completes interrupted terminal cleanup of that operation's exact SDK holds; `--status` remains read-only. A failure after execution begins is `unknown` because some migrations may already have committed. That state retains lifecycle, database and SDK source claims. Inspect the database's existing migration ledger and the operation before planning recovery; neither `sdk recover` nor another request ID clears uncertainty. This command does not run down migrations, restore data or reconcile an unknown child automatically.
- Migration execution holds the existing SDK consumer/source SQLite locks and records a typed source hold referencing the execution journal before starting a child. Stop SDK watchers before taking the maintenance window. Supported SDK writers, including recovery, refuse retained holds. This requires runtime resolution capability v2 and a coordinated native runtime upgrade; an older online SDK client refuses the capability. Arbitrarily invoking a retained old SDK recovery tool offline bypasses that protocol and is unsupported during a migration or uncertain recovery window. Direct package-manager or filesystem writes are also outside this protection.
- Without `--stack`, package-script migration is available only when the workspace declares no stacks and no database migration ownership. A missing owner, an invalid declaration or an RPC error never falls back to a local script.
- The owner measures the source and installed production dependencies again before migration configuration validation, the database readiness probe and SQL execution. Each check includes untracked application files and the dependencies actually resolved from the application. A review reads up to four physical package trees concurrently and reuses each result within its working-tree or sealed scope. Each tree has ten minutes from the start of its verification. Sixty seconds without observing a directory entry, reading file bytes or verifying an entry stops the review earlier. The verifier reads up to twelve adjacent files concurrently and hashes their full contents in sorted path order. It checks the open file against the final pathname and rejects unexpected ownership, group or world write permissions, or changes during the read. Each tree admits up to 400,000 directory entries and 200,000 files, with limits of 256 MiB per file and 2 GiB in total. A failed check identifies the package and its location. Changes during a maintenance window can invalidate the review.
- A package inside the development SDK may contain another workspace with its own dependencies. For a pnpm `node_modules/.bin` symlink, migration review resolves the importer's named dependency and checks that its `package.json` declares that command at the observed file. A framework package must resolve to the selected SDK directory. The review fingerprints the providing package and its production dependencies and rechecks the links after reading them. Packed releases require a self-contained payload.
- `omnitron infra reset --yes` -- Recreate this standalone ecosystem’s declared containers using existing volumes

### Fleet & Remote
- `omnitron remote add/remove/list/status` -- Manage remote servers
- `omnitron fleet status/health/metrics` -- Fleet-wide operations
- `omnitron cluster status/step-down` -- Cluster management
- `omnitron node add/list/update/remove/check/ssh-keys` -- Node management
- `omnitron node ssh-key <node>` shows the observed and approved SSH fingerprints. Verify the fingerprint against independent inventory, then run `omnitron node ssh-key <node> --trust <SHA256:fingerprint>`. The Console terminal requires this approval. Mesh tunnels, remote commands, uploads, health checks and pipelines use the same approved fingerprint. Without a pin, automation requires a matching entry in the daemon account’s OpenSSH `~/.ssh/known_hosts`.
- Approvals bind to the registered host, SSH port and user. When changing any of them, submit the replacement credential or explicitly clear the previous one. If the vault write is interrupted, the new address remains registered with SSH credentials detached. Repeat the credential update for that address, then verify its SSH fingerprint. A stack overriding the SSH account or port uses its own credentials. Key rotation refreshes the mesh connection and closes existing terminal sessions. Multiple registrations for the same daemon endpoint suspend that mesh connection until one registration remains.

### Deployment
- `omnitron deploy app <app>` -- Deploy with strategy
- `omnitron deploy build <app>` -- Build artifact
- `omnitron rollback <app>` -- Rollback to previous

### Other
- `omnitron secret set/get/list/delete` -- Secrets management
- `omnitron secret generate <key> [--bytes 32] [--encoding base64|base64url|hex]` -- Random bytes made and kept by the daemon; prints the key name only; refuses a key the vault already holds
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
