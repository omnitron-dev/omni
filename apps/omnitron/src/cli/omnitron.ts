#!/usr/bin/env node

/**
 * Omnitron CLI — Production-grade Titan Application Supervisor
 *
 * Entry point. Uses commander for command parsing,
 * @xec-sh/kit for TUI rendering.
 */

import { Command } from 'commander';
import { CLI_VERSION } from '../config/defaults.js';
import { setEnvOverride } from '../shared/env-config.js';

const program = new Command();

program.name('omnitron').description('Production-grade Titan application supervisor').version(CLI_VERSION);

// Global --json flag toggles structured machine-readable output and
// suppresses spinners / styled prose. Also honors `OMNITRON_OUTPUT=json`
// for environments where flag plumbing is awkward (CI templates, hooks).
program.option('--json', 'Emit machine-readable JSON output (no spinners, no styling)');
program.hook('preAction', async (cmd, actionCommand) => {
  const opts = cmd.opts();
  if (opts['json'] || process.env['OMNITRON_OUTPUT'] === 'json') {
    // Update both the actual env (for child processes / subprocess
    // inheritance) and the cached snapshot in env-config so
    // subsequent getEnv() readers in this process see the flag.
    process.env['OMNITRON_OUTPUT'] = 'json';
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });

    // Most commands render tables regardless of this flag and say nothing
    // about it, so a caller asking for JSON silently receives a picture of a
    // table. The guard makes that refusal explicit and parseable.
    // The full path, not the leaf: `status` alone names four different
    // subcommands, so the message has to say which one refused.
    const path: string[] = [];
    for (let node: typeof actionCommand | null = actionCommand; node; node = node.parent) {
      if (node.parent) path.unshift(node.name());
    }

    const { installJsonModeGuard } = await import('../commands/output.js');
    installJsonModeGuard(path.join(' ') || actionCommand.name());
  }
});

// ============================================================================
// Daemon Lifecycle
// ============================================================================

program
  .command('up')
  .description('Start omnitron daemon (background by default)')
  .option('-c, --config <path>', 'Path to omnitron.config.ts (default: auto-detect)')
  .option('-p, --project <name>', 'Initial project (default: auto-detect from CWD)')
  .option('-f, --foreground', 'Run in foreground (block terminal)')
  .option('--no-infra', 'Skip Docker infrastructure provisioning')
  .option('--no-watch', 'Disable file watching daemon-wide')
  .option('--master', 'Configure as master node (first-run setup)')
  .option('--slave [address]', 'Configure as slave node (first-run setup). Optional: host:port of master')
  .option('--webapp', 'Enable Console UI (webapp) auto-start')
  .option('--no-webapp', 'Disable Console UI (webapp) auto-start')
  .action(async (opts) => {
    const { upCommand } = await import('../commands/up.js');
    await upCommand({
      configPath: opts.config,
      project: opts.project,
      foreground: opts.foreground,
      noInfra: opts.infra === false,
      noWatch: opts.watch === false,
      master: opts.master,
      slave: opts.slave,
      webapp: opts.webapp,
    });
  });

program
  .command('down')
  .description('Stop omnitron daemon — stops all projects, stacks, infrastructure')
  .action(async () => {
    const { downCommand } = await import('../commands/up.js');
    await downCommand();
  });

// ============================================================================
// OS Service (daemon supervision — launchd/systemd)
// ============================================================================

const service = program
  .command('service')
  .description('Supervise the daemon with the OS (launchd/systemd): auto-restart on crash, start at boot');

service
  .command('install')
  .description('Install + start the OS service (macOS launchd / Linux systemd)')
  .option(
    '--scope <scope>',
    'user (stops at logout) or system (starts at boot, needs root). Default: system for a slave, user otherwise',
  )
  .action(async (options: { scope?: string }) => {
    if (options.scope && options.scope !== 'user' && options.scope !== 'system') {
      const { log } = await import('@xec-sh/kit');
      log.error(`Unknown scope ${JSON.stringify(options.scope)}. Use 'user' or 'system'.`);
      process.exitCode = 1;
      return;
    }
    const { serviceInstall } = await import('../commands/service.js');
    await serviceInstall(options.scope ? { scope: options.scope as 'user' | 'system' } : {});
  });

service
  .command('uninstall')
  .description('Stop the supervised daemon and remove the OS service')
  .action(async () => {
    const { serviceUninstall } = await import('../commands/service.js');
    await serviceUninstall();
  });

service
  .command('status')
  .description('Show OS-service supervision state')
  .action(async () => {
    const { serviceStatus } = await import('../commands/service.js');
    await serviceStatus();
  });

// ============================================================================
// Project Management
// ============================================================================

const project = program.command('project').aliases(['proj']).description('Manage seed projects');

project
  .command('add <name> <path>')
  .description('Register a seed project (directory with omnitron.config.ts)')
  .action(async (name, projectPath) => {
    const { projectAddCommand } = await import('../commands/project.js');
    await projectAddCommand(name, projectPath);
  });

project
  .command('list')
  .description('List registered projects')
  .action(async () => {
    const { projectListCommand } = await import('../commands/project.js');
    await projectListCommand();
  });

project
  .command('remove <name>')
  .description('Remove a project from registry')
  .action(async (name) => {
    const { projectRemoveCommand } = await import('../commands/project.js');
    await projectRemoveCommand(name);
  });

project
  .command('scan')
  .description('Scan app bootstraps and show infrastructure requirements')
  .action(async () => {
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const { scanRequirements, formatRequirements } = await import('../project/requirements-scanner.js');
    const config = await loadEcosystemConfig();
    const reqs = await scanRequirements(config.apps, process.cwd());
    process.stdout.write(formatRequirements(reqs) + '\n');
  });


// ============================================================================
// Stack Management
// ============================================================================

const stack = program.command('stack').aliases(['stacks']).description('Manage deployment stacks across projects');

stack
  .command('list')
  .description('List all stacks across all projects')
  .option('-p, --project <name>', 'Filter to specific project')
  .action(async (opts) => {
    const { stackListCommand } = await import('../commands/stack.js');
    await stackListCommand({ project: opts.project });
  });

stack
  .command('create <project> <stack>')
  .description('Create a new stack')
  .option('-t, --type <type>', 'Stack type: local, remote, cluster', 'local')
  .option('-a, --apps <apps>', 'Comma-separated app names, or "all"', 'all')
  .action(async (projectName, stackName, opts) => {
    const { stackCreateCommand } = await import('../commands/stack.js');
    await stackCreateCommand(projectName, stackName, opts);
  });

stack
  .command('delete <project> <stack>')
  .description('Delete a stack (must be stopped first)')
  .action(async (projectName, stackName) => {
    const { stackDeleteCommand } = await import('../commands/stack.js');
    await stackDeleteCommand(projectName, stackName);
  });

stack
  .command('status <project> <stack>')
  .description('Show stack detail (apps, nodes, infrastructure, sync)')
  .action(async (projectName, stackName) => {
    const { stackStatusCommand } = await import('../commands/stack.js');
    await stackStatusCommand(projectName, stackName);
  });

stack
  .command('start <project> <stack>')
  .description('Start a stack — provision infra + deploy + start apps')
  // A remote deployment ships the working tree, so it refuses one that is
  // not its commit. This is how you say you meant it — and it is a FLAG
  // rather than a setting because the path that caused the damage, a
  // master restart resuming its stacks, cannot pass one.
  .option('--allow-dirty', 'Deploy a working tree that differs from HEAD')
  // A release instead of the working tree: built by `omnitron release build`
  // from two commits in clean clones, every gate run. A stack whose config
  // says `release: { mode: 'required' }` takes nothing else.
  .option('--release <id>', 'Deploy this release (see `omnitron release build`) instead of the working tree')
  // For an operator who doubts a node's record of what an app runs: every
  // artifact is shipped and every app restarted, whatever the record says.
  .option('--reinstall', "Ship and restart every app, whatever the node's record says it runs")
  .action(async (projectName, stackName, options) => {
    const { stackStartCommand } = await import('../commands/stack.js');
    await stackStartCommand(projectName, stackName, {
      allowDirty: options.allowDirty === true,
      ...(typeof options.release === 'string' ? { release: options.release } : {}),
      ...(options.reinstall === true ? { reinstall: true } : {}),
    });
  });

stack
  .command('stop <project> <stack>')
  .description('Stop a stack — stop apps + disconnect slaves + teardown infra')
  .action(async (projectName, stackName) => {
    const { stackStopCommand } = await import('../commands/stack.js');
    await stackStopCommand(projectName, stackName);
  });

stack
  .command('account <project> <stack>')
  .description(
    "Accounts on a remote stack's stand: make one (its password goes to this daemon's vault), show one, or take one away",
  )
  .option('--username <name>', "Make an account with this name")
  .option('--role <role>', "Its platform role — which exist, and the default, are the project's tool's to say")
  .option('--display-name <text>', 'Its display name (default: the username)')
  .option('--show <name>', 'What the stand holds under this name — id, role, when made, last active; never a secret')
  .option('--census', 'Count the accounts — by role, status and MFA form, and whether the seeded admin opens with its published password')
  .option('--remove <name>', 'Take the account with this name away — with --id, and its password from the vault')
  .option('--id <uuid>', 'The id of the account --remove takes away (as --show prints it)')
  .option('--vault-key <key>', 'Where the password is kept (default: <project>.<stack>.account.<username>.password)')
  .action(
    async (
      projectName: string,
      stackName: string,
      options: {
        username?: string;
        show?: string;
        remove?: string;
        census?: boolean;
        id?: string;
        role?: string;
        displayName?: string;
        vaultKey?: string;
      },
    ) => {
      const { stackAccountCommand } = await import('../commands/stack.js');
      await stackAccountCommand(projectName, stackName, options);
    },
  );

stack
  .command('runtime <project> <stack>')
  .description('Show stack runtime status as JSON')
  .action(async (projectName, stackName) => {
    const { stackRuntimeCommand } = await import('../commands/stack.js');
    await stackRuntimeCommand(projectName, stackName);
  });

// ============================================================================
// App Management
// ============================================================================

program
  .command('start [app]')
  .description('Start app(s), auto-starts daemon if needed')
  .action(async (app) => {
    const { startCommand } = await import('../commands/start.js');
    await startCommand(app);
  });

program
  .command('stop [app]')
  .description('Stop app(s) gracefully')
  .option('-f, --force', 'Force kill')
  .action(async (app, opts) => {
    const { stopCommand } = await import('../commands/stop.js');
    await stopCommand(app, opts);
  });

program
  .command('restart [app]')
  .description('Restart app(s)')
  .action(async (app) => {
    const { restartCommand } = await import('../commands/restart.js');
    await restartCommand(app);
  });

program
  .command('reload [app]')
  .description('Zero-downtime reload')
  .action(async (app) => {
    const { reloadCommand } = await import('../commands/reload.js');
    await reloadCommand(app);
  });

// ============================================================================
// Information
// ============================================================================

program
  .command('list')
  .aliases(['ls'])
  .description('List all managed processes')
  .action(async () => {
    const { listCommand } = await import('../commands/list.js');
    await listCommand();
  });

program
  .command('status')
  .description('Show daemon status overview')
  .action(async () => {
    const { statusCommand } = await import('../commands/status.js');
    await statusCommand();
  });

// ============================================================================
// Monitoring
// ============================================================================

program
  .command('logs [app]')
  .description('View logs (omit app for daemon log, specify app name for app log)')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <N>', 'Number of lines', '50')
  .option('-l, --level <level>', 'Minimum log level (trace|debug|info|warn|error|fatal)')
  .option('-g, --grep <pattern>', 'Filter by message pattern (regex)')
  .option('--file', 'Read from log files instead of daemon (auto when daemon offline)')
  .action(async (app, opts) => {
    const { logsCommand } = await import('../commands/logs.js');
    await logsCommand(app, {
      lines: parseInt(opts.lines, 10),
      follow: opts.follow,
      file: opts.file,
      level: opts.level,
      grep: opts.grep,
    });
  });

program
  .command('monit')
  .description('Live TUI dashboard')
  .action(async () => {
    const { monitCommand } = await import('../commands/monit.js');
    await monitCommand();
  });

program
  .command('doctor')
  .description('Diagnose why the platform is unhealthy — findings, evidence, and what to do')
  .action(async () => {
    const { doctorCommand } = await import('../commands/doctor.js');
    await doctorCommand();
  });

program
  .command('health [app]')
  .description('Health check report')
  .action(async (app) => {
    const { healthCommand } = await import('../commands/health.js');
    await healthCommand(app);
  });

program
  .command('metrics [app]')
  .description('Show CPU/memory/latency metrics')
  .action(async (app) => {
    const { metricsCommand } = await import('../commands/metrics.js');
    await metricsCommand(app);
  });

// ============================================================================
// Scaling
// ============================================================================

program
  .command('scale <app> <count>')
  .description('Scale app instances')
  .action(async (app, count) => {
    const { scaleCommand } = await import('../commands/scale.js');
    await scaleCommand(app, count);
  });

// ============================================================================
// Diagnostics
// ============================================================================

program
  .command('inspect <app>')
  .description('Deep diagnostics for an app')
  .option('--graph', 'Render the live DI dependency graph instead of memory/services info')
  .option('--format <format>', 'Graph format: mermaid (default), dot, or json', 'mermaid')
  .option('--focus <token>', 'Restrict the graph to a token + its closure (use with --graph)')
  .option(
    '--direction <dir>',
    'Closure direction when --focus is set: ancestors, descendants, or both (default)',
    'both',
  )
  .action(async (app, opts) => {
    if (opts.graph) {
      const { inspectGraphCommand } = await import('../commands/inspect-graph.js');
      await inspectGraphCommand(app, {
        format: opts.format,
        focus: opts.focus,
        direction: opts.direction,
      });
      return;
    }
    const { inspectCommand } = await import('../commands/inspect.js');
    await inspectCommand(app);
  });

program
  .command('exec <app> <service> <method> [args...]')
  .description('Invoke an RPC method on a managed app')
  .action(async (app, serviceName, method, args) => {
    const { execCommand } = await import('../commands/exec.js');
    await execCommand(app, serviceName, method, args);
  });

program
  .command('env <app>')
  .description('Show resolved environment variables, secrets replaced')
  .option('--reveal', 'Show secrets in clear (admin only; recorded in the audit trail)')
  .action(async (app, options: { reveal?: boolean }) => {
    const { envCommand } = await import('../commands/env.js');
    await envCommand(app, options);
  });

// ============================================================================
// Infrastructure
// ============================================================================

const remote = program.command('remote').description('Manage remote daemon servers');

remote
  .command('add <alias> <host>')
  .description('Register a remote daemon server')
  .option('-p, --port <port>', 'Daemon port', '9700')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action(async (alias, host, opts) => {
    const { remoteAddCommand } = await import('../commands/remote.js');
    await remoteAddCommand(alias, host, opts);
  });

remote
  .command('remove <alias>')
  .description('Remove a remote server')
  .action(async (alias) => {
    const { remoteRemoveCommand } = await import('../commands/remote.js');
    await remoteRemoveCommand(alias);
  });

remote
  .command('list')
  .description('List registered remote servers')
  .action(async () => {
    const { remoteListCommand } = await import('../commands/remote.js');
    await remoteListCommand();
  });

remote
  .command('restart <alias> <app>')
  .description('Restart an app on a registered remote daemon')
  .action(async (alias, app) => {
    const { remoteRestartCommand } = await import('../commands/remote.js');
    await remoteRestartCommand(alias, app);
  });

remote
  .command('status <alias>')
  .description('Check remote server status')
  .action(async (alias) => {
    const { remoteStatusCommand } = await import('../commands/remote.js');
    await remoteStatusCommand(alias);
  });

// ============================================================================
// Fleet
// ============================================================================

const fleet = program.command('fleet').description('Fleet-wide operations across remote servers');

fleet
  .command('status')
  .description('Aggregated fleet status')
  .action(async () => {
    const { fleetStatusCommand } = await import('../commands/fleet.js');
    await fleetStatusCommand();
  });

fleet
  .command('health')
  .description('Fleet-wide health report')
  .action(async () => {
    const { fleetHealthCommand } = await import('../commands/fleet.js');
    await fleetHealthCommand();
  });

fleet
  .command('metrics')
  .description('Fleet-wide metrics')
  .action(async () => {
    const { fleetMetricsCommand } = await import('../commands/fleet.js');
    await fleetMetricsCommand();
  });

fleet
  .command('upgrade [nodes...]')
  .description('Install the omnitron built from this working tree on registered nodes')
  .option('--dry-run', 'Print the plan and ship nothing')
  .option('--keep <n>', 'Versions to keep on each node (default: 3)', (v: string) => Number(v))
  .option('--allow-dirty', 'Ship a working tree with uncommitted changes, deliberately')
  .action(async (nodes: string[], options: { dryRun?: boolean; keep?: number; allowDirty?: boolean }) => {
    const { fleetUpgradeCommand } = await import('../commands/fleet.js');
    await fleetUpgradeCommand(nodes ?? [], options);
  });

// ============================================================================
// Release — two commits, clean clones, every gate, the artifacts
// ============================================================================

const release = program
  .command('release')
  .description('Build a release: a named commit of the project AND omni, in clean clones, gated and packed');

release
  .command('build <project>')
  .description('Clone both commits, install, run every gate, pack the artifacts, write the manifest')
  .option('--project-commit <sha>', "The project commit to build (default: the project checkout's HEAD)")
  .option('--omni-commit <sha>', "The omni commit to build (default: the omni checkout's HEAD)")
  .option('--keep-source', 'Keep the clones after a successful build')
  .option('--skip-gates', 'Record every gate as not-run instead of running them — a look, never a release for a stack')
  .option('--for <stack>', "Also build the static bundle this stack's gateway serves, with its environment")
  .action(
    async (
      projectName: string,
      options: { projectCommit?: string; omniCommit?: string; keepSource?: boolean; skipGates?: boolean; for?: string },
    ) => {
      const { releaseBuildCommand } = await import('../commands/release.js');
      await releaseBuildCommand(projectName, { ...options, ...(options.for ? { forStack: options.for } : {}) });
    },
  );

release
  .command('list')
  .description('Every release built on this machine, newest first')
  .action(async () => {
    const { releaseListCommand } = await import('../commands/release.js');
    await releaseListCommand();
  });

release
  .command('show <id>')
  .description('One release in full: its commits, its gates, its artifacts')
  .action(async (id: string) => {
    const { releaseShowCommand } = await import('../commands/release.js');
    await releaseShowCommand(id);
  });

release
  .command('attest <id>')
  .description('Store what a stack measured about this release — production asks for it by name')
  .requiredOption('--stack <name>', 'Which stack ran the probes')
  .option('--from <file>', 'Where the producer printed it; `-` or absent reads standard input')
  .option('--on-node', "Have the daemon run the release's probes on the stack's node, over its own transport")
  .action(async (id: string, options: { stack?: string; from?: string; onNode?: boolean }) => {
    const { releaseAttestCommand } = await import('../commands/release.js');
    await releaseAttestCommand(id, options);
  });

release
  .command('push <id>')
  .description("Put a release in the artifact store (`releaseStore` in ~/.omnitron/config.json, its key in the daemon's vault)")
  .option('--root <dir>', 'Where the release is read from (default: ~/.omnitron/releases)')
  .option('--repair', "Write every object again even where the store's index matches — for a store a pull found damaged")
  .action(async (id: string, options: { root?: string; repair?: boolean }) => {
    const { releasePushCommand } = await import('../commands/release-store.js');
    await releasePushCommand(id, options);
  });

release
  .command('pull <id>')
  .description('Take a release from the artifact store and check it as a deployment would, before it appears here')
  .option('--root <dir>', 'Where the release is written (default: ~/.omnitron/releases)')
  .action(async (id: string, options: { root?: string }) => {
    const { releasePullCommand } = await import('../commands/release-store.js');
    await releasePullCommand(id, options);
  });

release
  .command('prune')
  .description('Remove all but the newest releases, never one a stack runs')
  .option('--keep <n>', 'How many to keep (default: 5)', (v: string) => Number(v))
  .option('--yes', 'Remove them; without this it only says what it would remove')
  .option(
    '--allow-unprotected',
    'Remove even when the daemon cannot say which releases the stacks run (stopped daemon, no audit trail)',
  )
  .action(async (options: { keep?: number; yes?: boolean; allowUnprotected?: boolean }) => {
    const { releasePruneCommand } = await import('../commands/release.js');
    await releasePruneCommand(options);
  });

// ============================================================================
// Cluster
// ============================================================================

const cluster = program.command('cluster').description('Cluster management — leader election, state');

cluster
  .command('status')
  .description('Show cluster state: leader, followers, election term')
  .action(async () => {
    const { clusterStatusCommand } = await import('../commands/cluster.js');
    await clusterStatusCommand();
  });

cluster
  .command('step-down')
  .description('Force the current leader to step down (triggers new election)')
  .action(async () => {
    const { clusterStepDownCommand } = await import('../commands/cluster.js');
    await clusterStepDownCommand();
  });

// ============================================================================
// Secrets
// ============================================================================

const secret = program.command('secret').description('Encrypted secrets management');

secret
  .command('set <key> <value>')
  .description('Set a secret (encrypted at rest)')
  .action(async (key: string, value: string) => {
    const { secretSetCommand } = await import('../commands/secret.js');
    await secretSetCommand(key, value);
  });

secret
  .command('get <key>')
  .description('Get a secret value')
  .action(async (key: string) => {
    const { secretGetCommand } = await import('../commands/secret.js');
    await secretGetCommand(key);
  });

secret
  .command('list')
  .description('List all secret keys (values hidden)')
  .action(async () => {
    const { secretListCommand } = await import('../commands/secret.js');
    await secretListCommand();
  });

secret
  .command('generate <key>')
  .description('Make a random secret where it is kept — nothing printed but its name')
  .option('--bytes <n>', 'How many random bytes (16–1024)', '32')
  .option('--encoding <enc>', 'base64, base64url or hex', 'base64')
  .action(async (key: string, opts: { bytes?: string; encoding?: string }) => {
    const { secretGenerateCommand } = await import('../commands/secret.js');
    await secretGenerateCommand(key, opts);
  });

secret
  .command('rotate-rpcauth <passwordKey>')
  .description('A new RPC password and its bitcoind rpcauth value, as a pair — nothing printed but key names')
  .requiredOption('--user-key <key>', 'The secret holding the RPC user')
  .requiredOption('--auth-key <key>', 'The secret to hold the rpcauth value')
  .action(async (passwordKey: string, opts: { userKey: string; authKey: string }) => {
    const { secretRotateRpcauthCommand } = await import('../commands/secret.js');
    await secretRotateRpcauthCommand(passwordKey, opts);
  });

secret
  .command('delete <key>')
  .description('Delete a secret')
  .action(async (key: string) => {
    const { secretDeleteCommand } = await import('../commands/secret.js');
    await secretDeleteCommand(key);
  });

// ============================================================================
// Discovery & Health Check
// ============================================================================

program
  .command('discover')
  .description('Scan Docker + SSH for Omnitron-managed targets')
  .action(async () => {
    const { discoverCommand } = await import('../commands/discover.js');
    await discoverCommand();
  });

program
  .command('health-check [app]')
  .description('Detailed composable health report (HTTP/TCP probes)')
  .action(async (app) => {
    const { healthCheckCommand } = await import('../commands/health-check.js');
    await healthCheckCommand(app);
  });

// ============================================================================
// Deployment
// ============================================================================

const deploy = program.command('deploy').description('Deployment management');

// `--strategy rolling|blue-green|canary` and `--version` used to be declared
// here, accepted by the parser, and read by nothing on the way to a command
// that only restarted an app. An accepted flag is a promise — `--help`
// advertised four deploy strategies this system has never implemented — so
// they are gone rather than left decorating a refusal.
//
// `-t, --target` went the same way: it named the alias in an
// `omnitron remote restart` line the message no longer prints (a restart is
// not a deployment, and that registry was empty), and nothing else read it.
deploy
  .command('app <app>')
  .description('Not implemented — prints where deployment is: `omnitron stack start`')
  .action(async (app) => {
    const { deployCommand } = await import('../commands/deploy.js');
    await deployCommand(app);
  });

deploy
  .command('build <app>')
  .description('Build deployment artifact (tarball of app + workspace deps)')
  .action(async (app) => {
    const { projectBuildCommand } = await import('../commands/deploy.js');
    await projectBuildCommand(app);
  });

// `-t, --target` was accepted here and read by nothing (`_opts`).
program
  .command('rollback <app>')
  .description('Not implemented — prints the way back: deploy the previous release')
  .action(async (app) => {
    const { rollbackCommand } = await import('../commands/deploy.js');
    await rollbackCommand(app);
  });

// ============================================================================
// Infrastructure Management
// ============================================================================

// Top-level `tor` command — quick access to onion addresses.
program
  .command('tor [project] [stack]')
  .description('Show Tor hidden service onion addresses (every tor container on this machine, or one stack\'s)')
  .action(async (project?: string, stack?: string) => {
    const { torCommand } = await import('../commands/tor.js');
    await torCommand(project, stack);
  });

const infra = program.command('infra').description('Manage infrastructure containers (PostgreSQL, Redis, MinIO, etc.)');

infra
  .command('up')
  .description('Provision and start all infrastructure services')
  .action(async () => {
    const { infraUpCommand } = await import('../commands/infra.js');
    await infraUpCommand();
  });

infra
  .command('down')
  .description('Stop all infrastructure containers')
  .option('--volumes', 'Remove data volumes (DESTRUCTIVE)')
  .action(async (opts) => {
    const { infraDownCommand } = await import('../commands/infra.js');
    await infraDownCommand(opts);
  });

infra
  .command('status')
  .aliases(['ps'])
  .description('Show infrastructure container status (this machine, or one stack\'s wherever it runs)')
  .option('--stack <project/stack>', 'One stack\'s containers; a remote stack is asked of its node')
  .action(async (opts: { stack?: string }) => {
    const { infraStatusCommand } = await import('../commands/infra.js');
    await infraStatusCommand(opts.stack ? { stack: opts.stack } : {});
  });

const collect = (value: string, previous: string[] = []) => [...previous, value];
infra
  .command('inspect <project/stack>')
  .description('What each node of a remote stack would find and do on its host — read, never changed')
  .option('--unit <name>', 'Also read this systemd unit (repeatable)', collect)
  .option('--path <path>', 'Also measure this path: owner, size, free space (repeatable)', collect)
  .option('--snap <name>', 'Also read this snap package (repeatable)', collect)
  .option('--config <file:key,key>', 'Also read these keys of a key=value file; credentials refused (repeatable)', collect)
  .action(async (target: string, opts: { unit?: string[]; path?: string[]; snap?: string[]; config?: string[] }) => {
    const { infraInspectCommand } = await import('../commands/infra.js');
    await infraInspectCommand(target, opts);
  });

infra
  .command('logs [service]')
  .description('View infrastructure service logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <N>', 'Number of lines', '50')
  .option('--stack <project/stack>', 'Only this stack\'s containers')
  .action(async (serviceName, opts) => {
    const { infraLogsCommand } = await import('../commands/infra.js');
    await infraLogsCommand(serviceName, opts);
  });

infra
  .command('psql [database]')
  .description('Open psql shell to PostgreSQL')
  .action(async (database) => {
    const { infraPsqlCommand } = await import('../commands/infra.js');
    await infraPsqlCommand(database);
  });

infra
  .command('redis-cli')
  .description('Open redis-cli shell')
  .action(async () => {
    const { infraRedisCliCommand } = await import('../commands/infra.js');
    await infraRedisCliCommand();
  });

infra
  .command('migrate [app]')
  .description('Run database migrations')
  .action(async (app) => {
    const { infraMigrateCommand } = await import('../commands/infra.js');
    await infraMigrateCommand(app);
  });

infra
  .command('reset')
  .description('Destroy all infrastructure data and recreate (DESTRUCTIVE)')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (opts) => {
    const { infraResetCommand } = await import('../commands/infra.js');
    await infraResetCommand(opts);
  });

// ============================================================================
// CI/CD Pipelines
// ============================================================================

const pipeline = program.command('pipeline').description('CI/CD pipeline management');

pipeline
  .command('list')
  .description('List all pipelines')
  .action(async () => {
    const { pipelineListCommand } = await import('../commands/pipeline.js');
    await pipelineListCommand();
  });

pipeline
  .command('run <id>')
  .description('Execute a pipeline')
  .action(async (id) => {
    const { pipelineRunCommand } = await import('../commands/pipeline.js');
    await pipelineRunCommand(id);
  });

pipeline
  .command('status <runId>')
  .description('Check pipeline run status')
  .action(async (runId) => {
    const { pipelineStatusCommand } = await import('../commands/pipeline.js');
    await pipelineStatusCommand(runId);
  });

// ============================================================================
// Backup/Restore
// ============================================================================

const backup = program.command('backup').description('Database backup and restore');

backup
  .command('create [database]')
  .description('Create a database backup')
  .action(async (database) => {
    const { backupCreateCommand } = await import('../commands/backup.js');
    await backupCreateCommand(database);
  });

backup
  .command('full')
  .description('Full backup: all stack DBs + minio storage + tor keys + daemon-state')
  .action(async () => {
    const { backupFullCommand } = await import('../commands/backup.js');
    await backupFullCommand();
  });

backup
  .command('list')
  .description('List available backups')
  .action(async () => {
    const { backupListCommand } = await import('../commands/backup.js');
    await backupListCommand();
  });

backup
  .command('restore <id>')
  .description('Restore from a backup')
  .action(async (id) => {
    const { backupRestoreCommand } = await import('../commands/backup.js');
    await backupRestoreCommand(id);
  });

backup
  .command('schedule <target> <cron>')
  .description(
    "Schedule recurring backups (target 'all' = every stack DB; " +
      'cron: "0 3 * * *" | hourly|daily|weekly | <ms>)'
  )
  .action(async (target, cron) => {
    const { backupScheduleCommand } = await import('../commands/backup.js');
    await backupScheduleCommand(target, cron);
  });

backup
  .command('schedules')
  .description('List configured backup schedules')
  .action(async () => {
    const { backupSchedulesCommand } = await import('../commands/backup.js');
    await backupSchedulesCommand();
  });

backup
  .command('unschedule <target>')
  .description('Remove a backup schedule')
  .action(async (target) => {
    const { backupUnscheduleCommand } = await import('../commands/backup.js');
    await backupUnscheduleCommand(target);
  });

// ============================================================================
// Kubernetes
// ============================================================================

const k8s = program.command('k8s').description('Kubernetes cluster management');

k8s
  .command('pods [namespace]')
  .description('List Kubernetes pods')
  .action(async (namespace) => {
    const { k8sPodsCommand } = await import('../commands/k8s.js');
    await k8sPodsCommand(namespace);
  });

const k8sDeploy = k8s.command('deploy').description('Kubernetes deployment management');

k8sDeploy
  .command('scale <name> <replicas>')
  .description('Scale a deployment')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace')
  .action(async (name, replicas, opts) => {
    const { k8sDeployScaleCommand } = await import('../commands/k8s.js');
    await k8sDeployScaleCommand(name, replicas, opts.namespace);
  });

// ============================================================================
// Node Management (infrastructure machines)
// ============================================================================

const node = program.command('node').description('Manage infrastructure nodes (machines)');

node
  .command('list')
  .alias('ls')
  .description('List all registered nodes')
  .action(async () => {
    const { nodeListCommand } = await import('../commands/node.js');
    await nodeListCommand();
  });

node
  .command('add')
  .description('Add a remote node')
  .requiredOption('--name <name>', 'Node display name')
  .requiredOption('--host <host>', 'Node hostname or IP')
  .option('--ssh-port <port>', 'SSH port', '22')
  .option('--ssh-user <user>', 'SSH user', 'root')
  .option('--ssh-auth <method>', 'Auth method: password|key', 'key')
  .option('--ssh-key <path>', 'Path to SSH private key')
  .option('--ssh-secret-stdin', 'Read the SSH password (or key passphrase) from stdin')
  .option('--runtime <runtime>', 'Runtime: node|bun', 'node')
  .option('--daemon-port <port>', 'Omnitron daemon port', '9700')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (opts: any) => {
    const { nodeAddCommand } = await import('../commands/node.js');
    await nodeAddCommand({
      name: opts.name,
      host: opts.host,
      sshPort: parseInt(opts.sshPort, 10),
      sshUser: opts.sshUser,
      sshAuthMethod: opts.sshAuth,
      sshPrivateKey: opts.sshKey,
      runtime: opts.runtime,
      daemonPort: parseInt(opts.daemonPort, 10),
      tags: opts.tags?.split(',').map((t: string) => t.trim()) ?? [],
      secretFromStdin: Boolean(opts.sshSecretStdin),
    });
  });

node
  .command('update <id>')
  .description('Update a node')
  .option('--name <name>', 'Node display name')
  .option('--host <host>', 'Node hostname or IP')
  .option('--ssh-port <port>', 'SSH port')
  .option('--ssh-user <user>', 'SSH user')
  .option('--ssh-auth <method>', 'Auth method: password|key')
  .option('--ssh-key <path>', 'Path to SSH private key')
  .option('--ssh-secret-stdin', 'Read the SSH password (or key passphrase) from stdin')
  .option('--runtime <runtime>', 'Runtime: node|bun')
  .option('--daemon-port <port>', 'Omnitron daemon port')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (id: string, opts: any) => {
    const { nodeUpdateCommand } = await import('../commands/node.js');
    const input: Record<string, unknown> = {};
    if (opts.name) input['name'] = opts.name;
    if (opts.host) input['host'] = opts.host;
    if (opts.sshPort) input['sshPort'] = parseInt(opts.sshPort, 10);
    if (opts.sshUser) input['sshUser'] = opts.sshUser;
    if (opts.sshAuth) input['sshAuthMethod'] = opts.sshAuth;
    if (opts.sshKey) input['sshPrivateKey'] = opts.sshKey;
    if (opts.runtime) input['runtime'] = opts.runtime;
    if (opts.daemonPort) input['daemonPort'] = parseInt(opts.daemonPort, 10);
    if (opts.tags) input['tags'] = opts.tags.split(',').map((t: string) => t.trim());
    if (opts.sshSecretStdin) input['secretFromStdin'] = true;
    await nodeUpdateCommand(id, input as any);
  });

program
  .command('audit')
  .description('Who changed this control plane, and what they changed')
  .option('-n, --limit <N>', 'How many entries, newest first (1 to 500)', '50')
  .option('--action <action>', 'Only this action, e.g. stack.start or stack.start.failed')
  .option('--resource <type>', 'Only this resource type, e.g. node')
  .option('--actor <who>', 'Only this actor: user, service or system — or an id, e.g. omnitron-local')
  .option('--before <time>', 'Only entries older than this ISO time, e.g. 2026-09-22T21:20:37Z')
  .action(async (opts: any) => {
    const { auditListCommand } = await import('../commands/audit.js');
    // As typed. `parseInt` here turned `-n abc` into NaN, which reached
    // Postgres as `LIMIT NaN`, and `-n 0` into a request for one row; the
    // command checks them, and can refuse in JSON when --json was asked for.
    await auditListCommand({
      limit: opts.limit,
      action: opts.action,
      resource: opts.resource,
      actor: opts.actor,
      before: opts.before,
    });
  });

node
  .command('remove <id>')
  .alias('rm')
  .description('Remove a node')
  .action(async (id: string) => {
    const { nodeRemoveCommand } = await import('../commands/node.js');
    await nodeRemoveCommand(id);
  });

node
  .command('check [id]')
  .description('Check node connectivity (all nodes if id omitted)')
  .action(async (id?: string) => {
    const { nodeCheckCommand } = await import('../commands/node.js');
    await nodeCheckCommand(id);
  });

node
  .command('ssh-keys')
  .description('List available SSH private keys from ~/.ssh/')
  .action(async () => {
    const { nodeSshKeysCommand } = await import('../commands/node.js');
    await nodeSshKeysCommand();
  });

// ============================================================================
// Webapp Management
// ============================================================================

const webapp = program.command('webapp').description('Manage Omnitron Console webapp');

webapp
  .command('build')
  .description('Build webapp (vite build)')
  .action(async () => {
    const { webappBuildCommand } = await import('../commands/webapp.js');
    await webappBuildCommand();
  });

webapp
  .command('start')
  .description('Start webapp (nginx container serving static + API gateway)')
  .option('-f, --force', 'Force recreate container even if already running')
  .action(async (opts) => {
    const { webappStartCommand } = await import('../commands/webapp.js');
    await webappStartCommand({ force: opts.force });
  });

webapp
  .command('stop')
  .description('Stop webapp nginx container')
  .action(async () => {
    const { webappStopCommand } = await import('../commands/webapp.js');
    await webappStopCommand();
  });

webapp
  .command('status')
  .description('Show webapp status')
  .action(async () => {
    const { webappStatusCommand } = await import('../commands/webapp.js');
    await webappStatusCommand();
  });

webapp
  .command('open')
  .description('Open webapp in browser')
  .action(async () => {
    const { webappOpenCommand } = await import('../commands/webapp.js');
    await webappOpenCommand();
  });

// ============================================================================
// Utilities
// ============================================================================

program
  .command('ping')
  .description('Check if omnitron daemon is running')
  .action(async () => {
    const { daemonPing } = await import('../commands/daemon-cmd.js');
    await daemonPing();
  });

program
  .command('kill')
  .description('Force kill the daemon process')
  .action(async () => {
    const { daemonKill } = await import('../commands/daemon-cmd.js');
    await daemonKill();
  });

program
  .command('init')
  .description('Scaffold omnitron.config.ts in current directory')
  .action(async () => {
    const { initCommand } = await import('../commands/init.js');
    await initCommand();
  });

program
  .command('config')
  .description('Show resolved ecosystem configuration')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const config = await loadEcosystemConfig();
    if (opts.json) {
      process.stdout.write(JSON.stringify(config, null, 2) + '\n');
    } else {
      const { log } = await import('@xec-sh/kit');
      log.info(`Project: ${config.project ?? '(unnamed)'}`);
      log.info(`Apps: ${config.apps.map((a: any) => a.name).join(', ')}`);
      if (config.infrastructure) {
        const services = Object.keys(config.infrastructure).filter((k) => k !== 'containers');
        const custom = config.infrastructure.containers ? Object.keys(config.infrastructure.containers) : [];
        log.info(`Infrastructure: ${[...services, ...custom].join(', ')}`);
      }
    }
  });

// ============================================================================
// Knowledge Base
// ============================================================================

const kb = program.command('kb').description('Knowledge base management');

kb.command('mcp')
  .description('Start MCP server for AI assistants (stdio)')
  .action(async () => {
    const { kbMcpCommand } = await import('../commands/kb.js');
    await kbMcpCommand();
  });

kb.command('index')
  .description('Reindex the knowledge base')
  .option('--full', 'Full reindex (ignore manifest cache)')
  .option('--watch', 'Watch for file changes and reindex incrementally')
  .action(async (opts) => {
    const { kbIndexCommand } = await import('../commands/kb.js');
    await kbIndexCommand(opts);
  });

kb.command('status')
  .description('Show KB index health and statistics')
  .action(async () => {
    const { kbStatusCommand } = await import('../commands/kb.js');
    await kbStatusCommand();
  });

kb.command('query <question>')
  .description('Test a query against the knowledge base')
  .action(async (question) => {
    const { kbQueryCommand } = await import('../commands/kb.js');
    await kbQueryCommand(question);
  });

// ============================================================================
// Run
// ============================================================================

/**
 * Leave when the command is done, whatever the transport is still holding.
 *
 * A CLI process should end when its work ends. This one did not: after
 * talking to the daemon it was kept alive by unix-socket handles that
 * `netron.stop()` had not closed — and it cannot close them, because closing
 * a socket gracefully needs the other end, which is exactly what is missing
 * when the daemon is wedged or starved.
 *
 * Measured 2026-09-15 with the development daemon starved at a load average
 * of 107:
 *
 *     $ omnitron ping
 *     ▲  Daemon is running (PID 69597) but did not answer within 5s
 *     ●  It is most likely busy starting apps…
 *     (then nothing; killed by the shell's timeout at 2:00)
 *
 *     active resources after disconnect: ["PipeWrap","PipeWrap","PipeWrap"]
 *
 * The command had said everything it had to say and still could not return,
 * which is worse for a script than either the hang or the error alone: the
 * output arrived and the exit never did.
 *
 * `process.exitCode` is what the commands set to report failure, so it is
 * what is used — this changes when the process leaves, not what it says.
 *
 * Commands that run indefinitely by design — `monit`, `logs --follow` — hold
 * the loop with their own work and never reach here.
 */
program.parseAsync().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    // Commander prints its own errors and sets an exit code; anything else
    // reaching here is a bug in a command, and swallowing it would hide it.
    if ((err as { exitCode?: number })?.exitCode == null) {
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    }
    process.exit(process.exitCode ?? 1);
  },
);
