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
  .action(async (projectName, stackName, options) => {
    const { stackStartCommand } = await import('../commands/stack.js');
    await stackStartCommand(projectName, stackName, {
      allowDirty: options.allowDirty === true,
      ...(typeof options.release === 'string' ? { release: options.release } : {}),
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
  .description('Show resolved environment variables')
  .action(async (app) => {
    const { envCommand } = await import('../commands/env.js');
    await envCommand(app);
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
deploy
  .command('app <app>')
  .description('Refused — deployment is `omnitron stack start`; see the message')
  .option('-t, --target <server>', 'Server alias, used only to name the restart command in the message')
  .action(async (app, opts) => {
    const { deployCommand } = await import('../commands/deploy.js');
    await deployCommand(app, opts);
  });

deploy
  .command('build <app>')
  .description('Build deployment artifact (tarball of app + workspace deps)')
  .action(async (app) => {
    const { projectBuildCommand } = await import('../commands/deploy.js');
    await projectBuildCommand(app);
  });

program
  .command('rollback <app>')
  .description('Refused — this never restored a previous version; see the message')
  .option('-t, --target <server>', 'Target server alias or tag')
  .action(async (app, opts) => {
    const { rollbackCommand } = await import('../commands/deploy.js');
    await rollbackCommand(app, opts);
  });

// ============================================================================
// Infrastructure Management
// ============================================================================

// Top-level `tor` command — quick access to onion addresses.
program
  .command('tor')
  .description('Show Tor hidden service onion addresses')
  .action(async () => {
    const { torCommand } = await import('../commands/tor.js');
    await torCommand();
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
  .description('Show infrastructure container status')
  .action(async () => {
    const { infraStatusCommand } = await import('../commands/infra.js');
    await infraStatusCommand();
  });

infra
  .command('logs [service]')
  .description('View infrastructure service logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <N>', 'Number of lines', '50')
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
  .option('-n, --limit <N>', 'How many entries (newest first)', '50')
  .option('--action <action>', 'Only this action, e.g. stack.start')
  .option('--resource <type>', 'Only this resource type, e.g. node')
  .option('--actor <id>', 'Only this actor')
  .action(async (opts: any) => {
    const { auditListCommand } = await import('../commands/audit.js');
    await auditListCommand({
      limit: parseInt(opts.limit, 10),
      action: opts.action,
      resource: opts.resource,
      actor: opts.actor,
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
