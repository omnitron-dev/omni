#!/usr/bin/env node

/**
 * Omnitron CLI — Production-grade Titan Application Supervisor
 *
 * Entry point. Uses commander for command parsing,
 * @xec-sh/kit for TUI rendering.
 */

import { OutputCommand, prepareCommandOutput } from './output-command.js';
import { CLI_VERSION } from '../config/defaults.js';
import { exitAfterOutput } from './exit-after-output.js';

const program = new OutputCommand();
let foregroundDaemonRunning = false;

program.command('migrate [action]')
  .description('Inspect or execute application migrations (default: status)')
  .option('-c, --config <path>', 'Migration config (default: omnitron.migrations.ts)')
  .option('--daemon', 'Use the local daemon database and built-in registry')
  .option('--steps <count>', 'Number of migrations to roll back with down')
  .option('--to <name>', 'Apply through this migration, inclusive')
  .option('--dry-run', 'Preview up/down without writing to the database')
  .structuredAction(async (action = 'status', options) => {
    const { migrateCommand } = await import('../commands/migrate.js');
    await migrateCommand(action, options);
  });

program.name('omnitron').description('Production-grade Titan application supervisor').version(CLI_VERSION);

// Global --json flag toggles structured machine-readable output and
// suppresses spinners / styled prose. Also honors `OMNITRON_OUTPUT=json`
// for environments where flag plumbing is awkward (CI templates, hooks).
program.option('--json', 'Emit machine-readable JSON output (no spinners, no styling)');
program.hook('preAction', (_root, actionCommand) => prepareCommandOutput(actionCommand));
const sdk = program.command('sdk').description('Select the framework SDK for local development');
sdk.command('init').description('Install the pnpm bridge without resolving registry dependencies')
  .option('--project-dir <path>', 'Consumer workspace directory', process.cwd())
  .action(async ({ projectDir }) => (await import('../../bin/sdk.js')).sdkCommand(['init', '--project-dir', projectDir]));
sdk.command('dev [checkout]').description('Select a local SDK and rebuild when it changes')
  .option('--project-dir <path>', 'Consumer workspace directory', process.cwd())
  .option('--stack <name>', 'Refresh watched applications in this local source stack')
  .option('--no-watch', 'Install the SDK without starting a watch session')
  .action(async (checkout, options) => (await import('../../bin/sdk.js')).sdkCommand([
    'dev', ...(checkout ? [checkout] : []), '--project-dir', options.projectDir,
    ...(options.stack ? ['--stack', options.stack] : []), ...(options.watch === false ? ['--no-watch'] : []),
  ]));
sdk.command('registry').description('Restore dependencies from the frozen distribution lock')
  .option('--project-dir <path>', 'Consumer workspace directory', process.cwd())
  .action(async ({ projectDir }) => (await import('../../bin/sdk.js')).sdkCommand(['registry', '--project-dir', projectDir]));
sdk.command('status').description('Verify the workspace imports and report their SDK origin')
  .option('--project-dir <path>', 'Consumer workspace directory', process.cwd())
  .structuredAction(async ({ projectDir }) => {
    const { inspectSdk } = await import('../../bin/sdk.js');
    const { emitJson, emitInfo } = await import('../commands/output.js');
    const status = await inspectSdk(projectDir);
    if (!emitJson(status)) {
      emitInfo([status.mode, status.source, status.verifiedImports + ' verified imports',
        ...(status.distributionLock === 'absent' ? ['no distribution lock'] : []),
        ...(status.distributionLock === 'manager-only' ? ['package-manager metadata only'] : []),
        ...(status.distributionLockChanged ? ['distribution lock changed'] : [])].filter(Boolean).join(' · '));
    }
  });

// ============================================================================
// Daemon Lifecycle
// ============================================================================

const backend = program.command('backend').description('Inspect and replace the control plane without restarting resident applications');
const ownerRecovery = backend.command('owner-reconcile').description('Explicit offline recovery after an execution-owner crash; never stops applications');
ownerRecovery.command('prepare <worker-pids>').description('Seal native recovery evidence on macOS/Linux; pass every recorded application/worker/descendant PID, comma-separated')
  .structuredAction(async (pids: string) => { const { ownerReconciliationCommand } = await import('../daemon/owner-reconciliation.js'); await ownerReconciliationCommand('prepare', pids); });
ownerRecovery.command('acknowledge <plan>').description('Certify quiescent native ownership groups after a separately approved drain, preserving the crash receipt')
  .structuredAction(async (file: string) => { const { ownerReconciliationCommand } = await import('../daemon/owner-reconciliation.js'); await ownerReconciliationCommand('acknowledge', file); });
const schema = backend.command('schema').description('Prepare and apply reviewed compatible schema expansions');
schema.command('prepare <runtime>').description('Inspect the current schema and save an exact expansion plan without database writes')
  .option('--from-plan <plan>', 'Bind an already applied expansion to a corrected candidate after rollback')
  .structuredAction(async (runtime: string, options: { fromPlan?: string }) => {
    const { backendSchemaPrepareCommand } = await import('../commands/backend.js');
    await backendSchemaPrepareCommand(runtime, options);
  });
schema.command('apply <plan>').description('Apply or resume a reviewed expansion under the shared migration lock')
  .structuredAction(async (plan: string) => {
    const { backendSchemaApplyCommand } = await import('../commands/backend.js');
    await backendSchemaApplyCommand(plan);
  });
const guardian = backend.command('guardian').description('Update independent service supervision while preserving the execution owner');
guardian.command('prepare <runtime>').description('Install a sealed management runtime and save a private guardian transition plan')
  .option('--recovery-checkpoint <file>', 'Review current ownership after a failed activation whose previous backend has retired; never edit the original checkpoint')
  .structuredAction(async (runtime: string, options: { recoveryCheckpoint?: string }) => {
    const { backendSupervisorPrepareCommand } = await import('../commands/backend.js');
    await backendSupervisorPrepareCommand(runtime, options);
  });
guardian.command('apply <plan>').description('Apply or resume a prepared guardian transition; preserve execution ownership')
  .option('--check', 'Recheck a prepared transition against the current host before approval')
  .structuredAction(async (plan: string, options: { check?: boolean }) => {
    const { backendSupervisorApplyCommand } = await import('../commands/backend.js');
    await backendSupervisorApplyCommand(plan, options.check === true);
  });
backend.command('install <runtime>').description('Copy a sealed runtime into permanent storage without activation')
  .structuredAction(async (runtime: string) => {
    const { backendInstallCommand } = await import('../commands/backend.js');
    await backendInstallCommand(runtime);
  });
backend.command('installation').description('Inspect the cold-start selection and any unfinished activation')
  .option('--recovery', 'Trace an unconfirmed recovery to the durable controller grant and project certificate')
  .structuredAction(async (options: { recovery?: boolean }) => {
    const { backendInstallationCommand } = await import('../commands/backend.js');
    await backendInstallationCommand(options);
  });
backend.command('select <sha256>').description('Select an installed runtime while backend and execution owner are stopped')
  .option('--check', 'Verify runtime and migrations and preview the candidate against retained stack declarations and current Docker state')
  .structuredAction(async (sha256: string, options: { check?: boolean }) => {
    const { backendSelectCommand } = await import('../commands/backend.js');
    await backendSelectCommand(sha256, options.check);
  });
backend.command('abort <checkpoint>').description('Cancel preparation before backend retirement')
  .structuredAction(async (checkpoint: string) => {
    const { backendAbortCommand } = await import('../commands/backend.js');
    await backendAbortCommand(checkpoint);
  });
backend.command('status').description('Show backend and execution-owner capabilities').structuredAction(async () => {
  const { backendStatusCommand } = await import('../commands/backend.js');
  await backendStatusCommand();
});
backend.command('upgrade <dist>').description('Activate a built backend artifact; retain application processes')
  .option('--check', 'Validate compatibility without draining or activating')
  .option('--schema-plan <path>', 'Require the exact applied expansion plan for a schema-changing upgrade or rollback')
  .structuredAction(async (dist: string, options: { check?: boolean; schemaPlan?: string }) => {
    const { backendUpgradeCommand } = await import('../commands/backend.js');
    await backendUpgradeCommand(dist, options);
  });
backend.command('recover [checkpoint]').description('Recover a dead backend from its certified state, or reconcile an explicit activation checkpoint')
  .option('--current-state', 'Resolve an unconfirmed activation from current local registrations after a clean shutdown')
  .option('--check', 'Inspect current-state recovery without changing the installation')
  .option('--review <sha256>', 'Accept the exact current-state review after clean shutdown')
  .structuredAction(async (checkpoint: string | undefined, options: { currentState?: boolean; check?: boolean; review?: string }) => {
    const { backendRecoverCommand } = await import('../commands/backend.js');
    await backendRecoverCommand(checkpoint, options);
  });

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
    const completion = await upCommand({
      configPath: opts.config,
      project: opts.project,
      foreground: opts.foreground,
      noInfra: opts.infra === false,
      noWatch: opts.watch === false,
      master: opts.master,
      slave: opts.slave,
      webapp: opts.webapp,
    });
    foregroundDaemonRunning = completion === 'foreground-running';
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
  .option('--prepare', 'Write an independent supervision plan without stopping processes or loading OS services')
  .option('--owner-runtime <sha256>', 'Use an already installed sealed owner runtime; defaults to the selected runtime')
  .action(async (options: { scope?: string; prepare?: boolean; ownerRuntime?: string }) => {
    if (options.scope && options.scope !== 'user' && options.scope !== 'system') {
      const { log } = await import('@xec-sh/kit');
      log.error(`Unknown scope ${JSON.stringify(options.scope)}. Use 'user' or 'system'.`);
      process.exitCode = 1;
      return;
    }
    const { serviceInstall } = await import('../commands/service.js');
    await serviceInstall({ ...(options.scope ? { scope: options.scope as 'user' | 'system' } : {}), ...(options.prepare ? { prepare: true } : {}), ...(options.ownerRuntime !== undefined ? { ownerRuntime: options.ownerRuntime } : {}) });
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
  .structuredAction(async () => {
    const { projectListCommand } = await import('../commands/project.js');
    await projectListCommand();
  });

project
  .command('topology [name]')
  .description('Inspect configured dependencies without exposing credentials')
  .option('--stack <name>', 'Limit to one stack')
  .structuredAction(async (name, options) => {
    const { projectTopologyCommand } = await import('../commands/project.js');
    await projectTopologyCommand(name, options);
  });

project
  .command('remove <name>')
  .description('Remove a project from registry')
  .action(async (name) => {
    const { projectRemoveCommand } = await import('../commands/project.js');
    await projectRemoveCommand(name);
  });

const configuration = project.command('configuration').description('Manage configuration sources inside one project');
configuration.command('list <project>').description('Show project stack sources and preserved runtime identities')
  .structuredAction(async name => {
    const { projectConfigurationCommand } = await import('../commands/project.js');
    await projectConfigurationCommand('list', name);
  });
configuration.command('import <project> <name> <path>').description('Import stack configuration without restarting applications')
  .option('--registration <name>', 'Preserve an existing registration and its execution/history namespace')
  .requiredOption('--stack <source=target...>', 'Map each source stack to its name inside the project')
  .structuredAction(async (projectName, name, directory, options) => {
    const { projectConfigurationCommand } = await import('../commands/project.js');
    await projectConfigurationCommand('import', projectName, name, directory, options);
  });
configuration.command('detach <project> <name>').description('Undo a configuration import; keep processes and history intact')
  .structuredAction(async (projectName, name) => {
    const { projectConfigurationCommand } = await import('../commands/project.js');
    await projectConfigurationCommand('detach', projectName, name);
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

const topology = program.command('topology').description('Inspect, edit and plan desired application placement');
topology.command('refresh <project> [stack]')
  .description('Read trusted bootstrap declarations in isolated processes; save metadata without restarting workloads (admin)')
  .structuredAction(async (projectName, stackName) => {
    const { topologyCommand } = await import('../commands/topology.js');
    await topologyCommand('refresh', projectName, stackName);
  });
for (const action of ['show', 'export', 'plan'] as const) {
  topology.command(`${action} <project> <stack>`)
    .description(action === 'export'
      ? 'Export portable topology JSON'
      : action === 'plan'
        ? 'Validate the saved draft and preview changes'
        : 'Show desired placement and observation gaps')
    .structuredAction(async (projectName, stackName) => {
      const { topologyCommand } = await import('../commands/topology.js');
      await topologyCommand(action, projectName, stackName);
    });
}
topology.command('draft <project> <stack> <file>')
  .description('Save a versioned draft from JSON; no workloads change')
  .structuredAction(async (projectName, stackName, file) => {
    const { topologyCommand } = await import('../commands/topology.js');
    await topologyCommand('draft', projectName, stackName, file);
  });
topology.command('apply <project> <stack> <plan>')
  .description('Accept a reviewed target; executable deployment configuration is unchanged')
  .structuredAction(async (projectName, stackName, plan) => {
    const { topologyCommand } = await import('../commands/topology.js');
    await topologyCommand('apply', projectName, stackName, plan);
  });

const stack = program.command('stack').aliases(['stacks']).description('Manage deployment stacks across projects');

stack
  .command('list')
  .description('List all stacks across all projects')
  .option('-p, --project <name>', 'Filter to specific project')
  .structuredAction(async (opts) => {
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
  .structuredAction(async (projectName, stackName) => {
    const { stackStatusCommand } = await import('../commands/stack.js');
    await stackStatusCommand(projectName, stackName);
  });

stack
  .command('progress <project> [stack]')
  .description('Inspect the latest remote transfer phases in a project or stack')
  .structuredAction(async (projectName, stackName) => {
    const { stackProgressCommand } = await import('../commands/stack.js');
    await stackProgressCommand(projectName, stackName);
  });

stack
  .command('diagnose <project> <stack>')
  .description('Inspect stack prerequisites without starting, provisioning or migrating')
  .structuredAction(async (projectName, stackName) => {
    const { stackDiagnoseCommand } = await import('../commands/stack.js');
    await stackDiagnoseCommand(projectName, stackName);
  });

stack
  .command('check-release <project> <stack> <release>')
  .description('Read the deployment admission decision for a local or remote stack')
  .structuredAction(async (projectName, stackName, release) => {
    const { stackReleaseAdmissionCommand } = await import('../commands/stack.js');
    await stackReleaseAdmissionCommand(projectName, stackName, release, false);
  });

stack
  .command('prepare-release <project> <stack> <release>')
  .description('Fetch a missing release from the configured store and verify it against the target stack')
  .structuredAction(async (projectName, stackName, release) => {
    const { stackReleaseAdmissionCommand } = await import('../commands/stack.js');
    await stackReleaseAdmissionCommand(projectName, stackName, release, true);
  });

stack
  .command('start <project> <stack>')
  .description('Start a stack with reconciled or reviewed existing infrastructure')
  // A remote deployment ships the working tree, so it refuses one that is
  // not its commit. This is how you say you meant it — and it is a FLAG
  // rather than a setting because the path that caused the damage, a
  // master restart resuming its stacks, cannot pass one.
  .option('--allow-dirty', 'Deploy a working tree that differs from HEAD')
  // A release instead of the working tree: built by `omnitron release build`
  // from two commits in clean clones, every gate run. A stack whose config
  // says `release: { mode: 'required' }` takes nothing else.
  .option('--release <id>', 'Start from a verified release; local stacks retain this choice across restarts')
  .option('--working-tree', 'Return a stopped local stack to its registered working tree')
  .option('--infrastructure <mode>', 'preserve: verify existing resources and forbid provisioning/setup/migrations; reconcile: explicitly authorize normal infrastructure deployment')
  .option('--dry-run', 'Review launch admission and existing native infrastructure without startup effects')
  .option('--review <digest>', 'Start in preserve mode only if launch and infrastructure still match this review')
  // For an operator who doubts a node's record of what an app runs: every
  // artifact is shipped and every app restarted, whatever the record says.
  .option('--reinstall', "Ship and restart every app, whatever the node's record says it runs")
  .structuredAction(async (projectName, stackName, options) => {
    const { stackStartCommand } = await import('../commands/stack.js');
    await stackStartCommand(projectName, stackName, {
      allowDirty: options.allowDirty === true,
      ...(typeof options.release === 'string' ? { release: options.release } : {}),
      ...(options.workingTree === true ? { workingTree: true } : {}),
      ...(typeof options.infrastructure === 'string' ? { infrastructure: options.infrastructure as 'preserve' | 'reconcile' } : {}),
      ...(options.dryRun === true ? { dryRun: true } : {}),
      ...(typeof options.review === 'string' ? { review: options.review } : {}),
      ...(options.reinstall === true ? { reinstall: true } : {}),
    });
  });

stack
  .command('resume <project> <stack>')
  .description('Resume installed applications after a recipient-confirmed HA stack stop')
  .structuredAction(async (projectName, stackName) => {
    const { stackResumeCommand } = await import('../commands/stack.js');
    await stackResumeCommand(projectName, stackName);
  });

stack
  .command('stop <project> <stack>')
  .description('Stop a stack and verify each target')
  .option('--keep-infrastructure', 'Stop applications and disable automatic resume while preserving infrastructure')
  .option('--dry-run', 'Inspect applications, containers and unresolved targets without creating a stop operation')
  .option('--review <digest>', 'Stop only if the inventory matches the inspected digest')
  .structuredAction(async (projectName, stackName, options) => {
    const { stackStopCommand } = await import('../commands/stack.js');
    await stackStopCommand(projectName, stackName, options);
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
  .option(
    '--leftovers [mode]',
    'What the probes left on the stand, by the project\'s tool: `census` (the default) — names and what holds each back; `rehearse` — the removal, measured and rolled back; `apply` — the removal, committed only where nothing of somebody who stays would go',
  )
  .option('--also <usernames>', 'With --leftovers: accounts no template matches, named after reading the census (comma-separated)')
  .option('--remove <name>', 'Take the account with this name away — with --id, and its password from the vault')
  .option('--id <uuid>', 'The id of the account --remove takes away (as --show prints it)')
  .option('--vault-key <key>', 'Where the password is kept (default: <project>.<stack>.account.<username>.password)')
  .structuredAction(
    async (
      projectName: string,
      stackName: string,
      options: {
        username?: string;
        show?: string;
        remove?: string;
        census?: boolean;
        leftovers?: boolean | string;
        also?: string;
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
  .command('maintenance <project> <stack> [action]')
  .description(
    "The stack's maintenance lock at its gateway: `status` (the default), `on` — hold the platform for --minutes and let go by itself — or `off`",
  )
  .option('--minutes <n>', 'With `on`: how long to hold, 1–60 (default 15)')
  .structuredAction(async (projectName: string, stackName: string, action: string | undefined, options: { minutes?: string }) => {
    const { stackMaintenanceCommand } = await import('../commands/stack.js');
    await stackMaintenanceCommand(projectName, stackName, action, options);
  });

stack
  .command('runtime <project> <stack>')
  .description('Show stack runtime status as JSON')
  .structuredAction(async (projectName, stackName) => {
    const { stackRuntimeCommand } = await import('../commands/stack.js');
    await stackRuntimeCommand(projectName, stackName);
  });

// ============================================================================
// App Management
// ============================================================================

program
  .command('start [app]')
  .description('Start a named app via RPC, or start all apps (can start the daemon)')
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
  .structuredAction(async () => {
    const { listCommand } = await import('../commands/list.js');
    await listCommand();
  });

program
  .command('status')
  .description('Show daemon status overview')
  .structuredAction(async () => {
    const { statusCommand } = await import('../commands/status.js');
    await statusCommand();
  });

// ============================================================================
// Monitoring
// ============================================================================

program
  .command('system')
  .description('Read the connected host or a registered node, including collection time and missing measurements')
  .option('--node <id>', 'Read this registered node over the mesh')
  .structuredAction(async (opts) => {
    const { systemCommand } = await import('../commands/system.js');
    await systemCommand(opts);
  });

program
  .command('logs [app]')
  .description('View logs (omit app for daemon log, specify app name for app log)')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <N>', 'Number of lines', '50')
  .option('-l, --level <level>', 'Minimum severity (trace|debug|info|warn|error|fatal), or an exact level such as unknown')
  .option('-g, --grep <pattern>', 'Filter by message pattern (regex)')
  .option('--node <node>', 'Read replicated logs from one registered node (name or ID)')
  .option('--file', 'Read from log files instead of daemon (auto when daemon offline)')
  .option('--status', 'Show local capture, durable queue and database commit status')
  .structuredAction(async (app, opts) => {
    const { logsCommand } = await import('../commands/logs.js');
    await logsCommand(app, {
      status: opts.status,
      lines: parseInt(opts.lines, 10),
      follow: opts.follow,
      file: opts.file,
      level: opts.level,
      grep: opts.grep,
      node: opts.node,
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
  .structuredAction(async () => {
    const { doctorCommand } = await import('../commands/doctor.js');
    await doctorCommand();
  });

program
  .command('health [app]')
  .description('Health check report')
  .structuredAction(async (app) => {
    const { healthCommand } = await import('../commands/health.js');
    await healthCommand(app);
  });

program
  .command('metrics [app]')
  .description('Show CPU/memory/latency metrics')
  .structuredAction(async (app) => {
    const { metricsCommand } = await import('../commands/metrics.js');
    await metricsCommand(app);
  });

// ============================================================================
// Scaling
// ============================================================================

program
  .command('scale <app> <count>')
  .description('Resize one declared process pool until restart (automatic policy remains active)')
  .requiredOption('--process <name>', 'Exact declared pool process name')
  .structuredAction(async (app, count, options) => {
    const { scaleCommand } = await import('../commands/scale.js');
    await scaleCommand(app, count, options.process);
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
  .structuredAction(async (app, opts) => {
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
  .structuredAction(async (app, options: { reveal?: boolean }) => {
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

const rollout = fleet.command('rollout').description('Distribute and activate managed backends across registered servers');
rollout.command('import <runtimes...>')
  .description('Admit qualified sealed builds into the local controller catalog for distribution')
  .structuredAction(async (runtimes: string[]) => {
    const { importFleetBuilds } = await import('../commands/fleet-rollout.js');
    await importFleetBuilds(runtimes);
  });
rollout.command('builds')
  .description('List the builds available for distribution by the controller')
  .structuredAction(async () => {
    const { listFleetBuilds } = await import('../commands/fleet-rollout.js');
    await listFleetBuilds();
  });
rollout.command('plan <commit> [nodes...]')
  .description('Review sealed backend updates in the requested node order; omit nodes to select all registered remotes')
  .option('--apply', 'Start the plan if all selected servers are eligible')
  .option('--stage', 'Distribute matching builds from the controller catalog before qualification')
  .option('--wait', 'Wait for qualification, and for activation if requested')
  .option('--request-id <uuid>', 'Reuse a plan ID when retrying the same request')
  .structuredAction(async (commit: string, nodes: string[], options: { apply?: boolean; wait?: boolean; stage?: boolean; requestId?: string }) => {
    const { fleetRolloutCommand } = await import('../commands/fleet-rollout.js');
    await fleetRolloutCommand({ kind: 'plan', commit, nodes, apply: options.apply === true, wait: options.wait === true,
      stage: options.stage === true, ...(options.requestId && { requestId: options.requestId }) });
  });
rollout.command('apply <id>')
  .description('Start the reviewed rollout and return its durable operation ID')
  .option('--wait', 'Follow the operation through completion')
  .structuredAction(async (id: string, options: { wait?: boolean }) => {
    const { fleetRolloutCommand } = await import('../commands/fleet-rollout.js');
    await fleetRolloutCommand({ kind: 'apply', id, wait: options.wait === true });
  });
rollout.command('reconcile <id>')
  .description('Observe an uncertain backend rollout without replaying activation or rolling it back')
  .structuredAction(async (id: string) => {
    const { fleetRolloutCommand } = await import('../commands/fleet-rollout.js');
    await fleetRolloutCommand({ kind: 'reconcile', id });
  });
rollout.command('status [id]')
  .description('Show a rollout or the most recent plan')
  .option('--wait', 'Follow the same operation until it finishes')
  .structuredAction(async (id: string | undefined, options: { wait?: boolean }) => {
    const { fleetRolloutCommand } = await import('../commands/fleet-rollout.js');
    await fleetRolloutCommand({ kind: 'status', id, wait: options.wait === true });
  });

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
  .command('recover <node> <receipt>')
  .description('Recover an interrupted host upgrade from its recorded receipt')
  .structuredAction(async (node: string, receipt: string) => {
    const { fleetRecoverCommand } = await import('../commands/fleet-recover.js');
    await fleetRecoverCommand(node, receipt);
  });

fleet
  .command('upgrade [nodes...]')
  .description('Install a source bundle from this workspace; use fleet rollout for sealed managed backend updates')
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
  .description('Build and inspect project releases with verified framework inputs');

release
  .command('build <project>')
  .description('Build a clean project revision with its locked framework, run gates and package the artifacts')
  .option('--detach', 'Submit to the controller and return a build ID for CLI or Console')
  .option('--publish', 'Build on the controller and publish verified artifacts to its configured release store')
  .option('--project-commit <sha>', "The project commit to build (default: the project checkout's HEAD)")
  .option('--omni-commit <sha>', "Linked checkout revision, or the exact full commit to require from registry packages")
  .option('--framework-repository <repository>', 'Override the committed SDK source repository for this build')
  .option('--framework-ref <ref>', 'Require a full refs/heads/... or refs/tags/... in the selected SDK repository')
  .option('--keep-source', 'Keep the clones after a successful build')
  .option('--skip-gates', 'Record every gate as not-run instead of running them — a look, never a release for a stack')
  .option('--for <stack>', "Also build the static bundle this stack's gateway serves, with its environment")
  .structuredAction(
    async (
      projectName: string,
      options: { detach?: boolean; publish?: boolean; projectCommit?: string; omniCommit?: string; frameworkRepository?: string; frameworkRef?: string; keepSource?: boolean; skipGates?: boolean; for?: string },
    ) => {
      const { releaseBuildCommand } = await import('../commands/release.js');
      const { parseFrameworkSource } = await import('../shared/framework-source.js');
      const { detach, frameworkRepository, frameworkRef, ...buildOptions } = options;
      if (frameworkRef && !frameworkRepository) throw new Error('--framework-ref requires --framework-repository; use omnitron.framework in package.json for project defaults');
      const frameworkSource = frameworkRepository ? parseFrameworkSource({ repository: frameworkRepository, ...(frameworkRef ? { ref: frameworkRef } : {}) }) : undefined;
      await releaseBuildCommand(projectName, { ...buildOptions, ...(frameworkSource ? { frameworkSource } : {}), ...(options.for ? { forStack: options.for } : {}) }, detach);
    },
  );

release.command('preflight').description('Inspect build tools, available job slots and publication support').structuredAction(async () => {
  const { releaseJobsCommand } = await import('../commands/release.js');
  await releaseJobsCommand('preflight');
});

release.command('builds [project]').description('List controller build jobs, optionally scoped to a project')
  .structuredAction(async projectName => {
    const { releaseJobsCommand } = await import('../commands/release.js');
    await releaseJobsCommand('list', projectName);
  });
release.command('job <id>').description('Read a build job, its gates, progress and last error')
  .option('--follow', 'Follow this job through completion')
  .structuredAction(async (id, options: { follow?: boolean }) => {
    const { releaseJobsCommand } = await import('../commands/release.js');
    await releaseJobsCommand('show', id, options.follow === true);
  });
release.command('stop-build <id>').description('Cancel one queued or running build')
  .structuredAction(async id => { const { releaseJobsCommand } = await import('../commands/release.js'); await releaseJobsCommand('stop', id); });

release
  .command('list')
  .description('Every release built on this machine, newest first')
  .structuredAction(async () => {
    const { releaseListCommand } = await import('../commands/release.js');
    await releaseListCommand();
  });

release
  .command('status <project>')
  .description('Observe stack placement and execution separately from deployment history')
  .option('--inspect-installed', 'Explicitly compare installed entry points with retained release archives (read-only)')
  .structuredAction(async (projectName: string, options: { inspectInstalled?: boolean }) => {
    const { releaseStatusCommand } = await import('../commands/release.js');
    await releaseStatusCommand(projectName, options);
  });

release
  .command('show <id>')
  .description('One release in full: its commits, its gates, its artifacts')
  .structuredAction(async (id: string) => {
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
  .structuredAction(async (id: string, options: { root?: string; repair?: boolean }) => {
    const { releasePushCommand } = await import('../commands/release-store.js');
    await releasePushCommand(id, options);
  });

release
  .command('pull <id>')
  .description('Take a release from the artifact store and check it as a deployment would, before it appears here')
  .option('--root <dir>', 'Where the release is written (default: ~/.omnitron/releases)')
  .structuredAction(async (id: string, options: { root?: string }) => {
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
  .description('Show cluster participation, supported controls and controller lease observations')
  .structuredAction(async () => {
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
  .command('set <key> [value]')
  .description('Set a secret using hidden terminal input or stdin (encrypted at rest)')
  .option('--stdin', 'Read the value from stdin instead of a positional argument')
  .action(async (key: string, value: string | undefined, opts: { stdin?: boolean }) => {
    const { secretSetCommand } = await import('../commands/secret.js');
    await secretSetCommand(key, value, opts);
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
  .command('copy <from> <to>')
  .description('A second key holding the same secret — nothing printed but key names')
  .action(async (from: string, to: string) => {
    const { secretCopyCommand } = await import('../commands/secret.js');
    await secretCopyCommand(from, to);
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
  .structuredAction(async (app) => {
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
  .structuredAction(async (projectName?: string, stackName?: string) => {
    const { torCommand } = await import('../commands/tor.js');
    await torCommand(projectName, stackName);
  });

const infra = program.command('infra').description('Manage infrastructure containers (PostgreSQL, Redis, MinIO, etc.)');

const ingress = infra.command('ingress').description('Manage host-owned public ingress independently of application stacks');
for (const operation of ['configure', 'check', 'validate', 'apply', 'restore', 'rollback-takeover', 'remove'] as const) {
  ingress.command(`${operation} <manifest>`)
    .description(`${operation} host ingress using a JSON manifest (host daemon, exact generation CAS)`)
    .structuredAction(async (manifest: string) => {
      const { hostIngressCommand } = await import('../commands/host-ingress.js');
      await hostIngressCommand(operation, manifest);
    });
}
for (const operation of ['status', 'recover'] as const) {
  ingress.command(operation)
    .description(operation === 'status' ? 'Read configured and observed ingress generation' : 'Recover an interrupted host ingress publication')
    .structuredAction(async () => {
      const { hostIngressCommand } = await import('../commands/host-ingress.js');
      await hostIngressCommand(operation);
    });
}

infra
  .command('up')
  .description('Provision and start all infrastructure services')
  .action(async () => {
    const { infraUpCommand } = await import('../commands/infra.js');
    await infraUpCommand();
  });

infra
  .command('down')
  .description('Remove this standalone ecosystem’s declared containers, preserving their volumes')
  .option('--volumes', 'Refuse teardown if volume deletion is required (unsupported)')
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
  .structuredAction(async (target: string, opts: { unit?: string[]; path?: string[]; snap?: string[]; config?: string[] }) => {
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
  .description('Open psql on this machine or run one SQL command')
  .option('--stack <project/stack>', 'Select the local stack that owns PostgreSQL')
  .option('-c, --command <sql>', 'Run SQL and return its exit status')
  .action(async (database, opts) => {
    const { infraPsqlCommand } = await import('../commands/infra.js');
    await infraPsqlCommand(database, opts);
  });

infra
  .command('redis-cli [arguments...]')
  .description('Open redis-cli on this machine or run one Redis command')
  .option('--stack <project/stack>', 'Select the local stack that owns Redis')
  .option('--db <index>', 'Select a Redis logical database')
  .action(async (args, opts) => {
    const { infraRedisCliCommand } = await import('../commands/infra.js');
    await infraRedisCliCommand(opts, args);
  });

infra
  .command('migrate [app]')
  .description('Run explicit database migration owners, or legacy workspace package scripts')
  .option('--stack <name>', 'Select the local infrastructure-owning stack')
  .option('--dry-run', 'Inspect migration ownership and programs without connecting to the database')
  .structuredAction(async (app, options) => {
    const { infraMigrateCommand } = await import('../commands/infra.js');
    await infraMigrateCommand(app, options);
  });

infra
  .command('reset')
  .description('Recreate this standalone ecosystem’s declared containers with their existing volumes')
  .option('--yes', 'Confirm container recreation')
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
  .structuredAction(async () => {
    const { pipelineListCommand } = await import('../commands/pipeline.js');
    await pipelineListCommand();
  });

pipeline
  .command('run <id>')
  .description('Execute a pipeline')
  .option('--params-file <file>', 'JSON parameters, supplied as data to the executor')
  .structuredAction(async (id, options) => {
    const { pipelineRunCommand } = await import('../commands/pipeline.js');
    await pipelineRunCommand(id, options);
  });

pipeline
  .command('status <runId>')
  .description('Check pipeline run status')
  .option('--output', 'Include retained stdout and stderr')
  .structuredAction(async (runId, options) => {
    const { pipelineStatusCommand } = await import('../commands/pipeline.js');
    await pipelineStatusCommand(runId, options);
  });

pipeline.command('save <file>').description('Create a pipeline from JSON, or update an existing definition')
  .option('--id <id>', 'Existing pipeline ID to update')
  .option('--expected-revision <sha256>', 'Reviewed revision, required with --id')
  .structuredAction(async (file, options) => {
    const { pipelineSaveCommand } = await import('../commands/pipeline.js');
    await pipelineSaveCommand(file, options);
  });
pipeline.command('cancel <runId>').description('Cancel a run and wait for its executor to stop')
  .structuredAction(async runId => {
    const { pipelineCancelCommand } = await import('../commands/pipeline.js');
    await pipelineCancelCommand(runId);
  });

// ============================================================================
// Backup/Restore
// ============================================================================

const backup = program.command('backup').description('Database backup and restore');

backup.command('artifact <kind>')
  .description('Back up storage-objects or tor-keys of an explicit provisioned stack')
  .requiredOption('--project <name>', 'Project registration')
  .requiredOption('--stack <name>', 'Stack owning this infrastructure')
  .option('--bucket <name>', 'Required for storage-objects')
  .structuredAction(async (kind, options) => {
    const { backupArtifactCommand } = await import('../commands/backup.js');
    await backupArtifactCommand(kind, options);
  });

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

node.command('reconcile <node>').description('Inspect historical metric receipts; explicitly restore missing retained payloads')
  .option('--restore', 'Restore missing samples and settle source evidence after the database commits')
  .option('--pages <count>', 'Maximum pages of 256 entries', '1')
  .option('--after <sequence>', 'Resume after this source sequence')
  .option('--through <sequence>', 'Fixed source frontier returned by a previous page')
  .option('--epoch <id>', 'Require the buffer epoch returned by a previous page')
  .structuredAction(async (name: string, options) => {
    const { nodeReconcileCommand } = await import('../commands/node-reconcile.js');
    await nodeReconcileCommand(name, options);
  });

node
  .command('list')
  .alias('ls')
  .description('List all registered nodes')
  .structuredAction(async () => {
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
  .option('--ssh-secret-stdin', 'Read an SSH secret: hidden prompt on a terminal (Enter), or pipe until EOF')
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
  .option('--ssh-secret-stdin', 'Read an SSH secret: hidden prompt on a terminal (Enter), or pipe until EOF')
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

const access = program.command('access').description('Console roles, effective RPC permissions and human accounts');
access.command('show').description('Show effective permissions from the running daemon').structuredAction(async () => {
  const { accessCommand } = await import('../commands/access.js'); await accessCommand('show');
});
access.command('users').description('List console accounts without secrets').option('--after <id>', 'Continue after this account ID').structuredAction(async (opts) => {
  const { accessCommand } = await import('../commands/access.js'); await accessCommand('users', opts);
});
access.command('create <username>').description('Create a human console account; password stays out of arguments and output')
  .option('--role <role>', 'viewer, operator or admin', 'viewer').option('--display-name <name>', 'Display name')
  .requiredOption('--password-stdin', 'Read password from a hidden terminal prompt or stdin until EOF').structuredAction(async (username, opts) => {
    const { accessCommand } = await import('../commands/access.js'); await accessCommand('create', { ...opts, username });
  });
access.command('role <id> <role>').description('Change an account role and revoke its sessions')
  .requiredOption('--expect <role>', 'The role you reviewed; refuse if it changed').structuredAction(async (id, role, opts) => {
    const { accessCommand } = await import('../commands/access.js'); await accessCommand('role', { id, role, expect: opts.expect });
  });
access.command('revoke <id>').description('Revoke all sessions for a console account').structuredAction(async (id) => {
  const { accessCommand } = await import('../commands/access.js'); await accessCommand('revoke', { id });
});

program
  .command('audit')
  .description('Who changed this control plane, and what they changed')
  .option('-n, --limit <N>', 'How many entries, newest first (1 to 500)', '50')
  .option('--action <action>', 'Only this action, e.g. stack.start or stack.start.failed')
  .option('--resource <type>', 'Only this resource type, e.g. node')
  .option('--actor <who>', 'Only this actor: user, service or system — or an id, e.g. omnitron-local')
  .option('--before <time>', 'Only entries older than this ISO time, e.g. 2026-09-22T21:20:37Z')
  .option('--before-id <id>', 'Continue after an audit entry without skipping timestamp ties')
  .structuredAction(async (opts: any) => {
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
      beforeId: opts.beforeId,
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

node.command('ssh <node>').description('Open an audited interactive SSH terminal (Ctrl+] disconnects)')
  .action(async (name: string) => { const { nodeSshCommand } = await import('../commands/terminal.js'); await nodeSshCommand(name); });
node.command('ssh-key <node>').description('Inspect SSH host fingerprint; trust only after independent verification')
  .option('--trust <fingerprint>', 'Store an independently verified SHA256 fingerprint')
  .structuredAction(async (name: string, options: { trust?: string }) => { const { nodeHostKeyCommand } = await import('../commands/terminal.js'); await nodeHostKeyCommand(name, options); });
const fileWorkspace = program.command('files').description('Audited multi-node file workspace');
for (const [name, signature, description] of [
  ['archive-formats', '', 'Probe archive formats on source and optional destination'],
  ['roots', '', 'List explicitly exported roots'], ['list', '[path]', 'List a directory page'],
  ['stat', '<path>', 'Inspect metadata and current version'], ['read', '<path>', 'Read a bounded UTF-8 document'],
  ['save', '<path>', 'Save UTF-8 input with an expected version'], ['mkdir', '<path>', 'Create a folder'],
  ['rename', '<path>', 'Rename without overwriting'], ['trash', '<path>', 'Move a versioned item to recoverable trash'],
  ['trash-list', '', 'List this identity’s retained trash'], ['restore', '<id>', 'Restore without overwriting'],
  ['copy', '<path>', 'Start a durable node-to-node copy'], ['transfers', '', 'Inspect this identity’s transfer queue'],
  ['pause', '<id>', 'Pause a transfer'], ['resume', '<id>', 'Reconcile and resume a transfer'], ['cancel', '<id>', 'Cancel uncommitted transfer work'],
  ['upload', '<path>', 'Upload a local file in bounded verified chunks'], ['download', '<path>', 'Download without overwriting a local file'],
  ['upload-status', '<id>', 'Inspect a durable upload receipt'], ['upload-finish', '<id>', 'Reconcile publication after a lost acknowledgement'], ['upload-abort', '<id>', 'Discard an unfinished upload'],
] as const) {
  fileWorkspace.command(`${name} ${signature}`.trim()).description(description)
    .option('--node <id>', 'Registered node ID or local', 'local').option('--root <id>', 'Exported root ID')
    .option('--version <version>', 'Expected version; save accepts new for creation')
    .option('--from <file>', 'Local input file').option('--to <path>', 'Rename destination or local download path')
    .option('--to-node <id>', 'Copy destination node').option('--to-root <id>', 'Copy destination root').option('--to-path <path>', 'Copy destination folder', '')
    .option('--archive-format <format>', 'Source-side archive format; inspect archive-formats')
    .option('--archive-output <mode>', 'Explicit result: archive or directory').option('--archive-name <name>', 'New archive filename or restored directory name')
    .option('--after <name>', 'Directory page cursor').option('--revision <version>', 'Directory revision from first page')
    .structuredAction(async (...args) => {
      const { filesCommand } = await import('../commands/files.js');
      await filesCommand(name, signature ? args[0] : undefined, signature ? args[1] : args[0]);
    });
}

const terminal = program.command('terminal').description('Manage SSH sessions owned by this local CLI identity');
terminal.command('list').description('List this caller’s SSH sessions')
  .structuredAction(async () => { const { terminalSessionsCommand } = await import('../commands/terminal.js'); await terminalSessionsCommand(); });
terminal.command('close <id>').description('Close this caller’s SSH session')
  .structuredAction(async (id: string) => { const { terminalSessionsCommand } = await import('../commands/terminal.js'); await terminalSessionsCommand(id); });

const webapp = program.command('webapp').description('Manage Omnitron Console webapp');

webapp
  .command('build')
  .description('Build webapp (vite build)')
  .structuredAction(async () => {
    const { webappBuildCommand } = await import('../commands/webapp.js');
    await webappBuildCommand();
  });

webapp
  .command('start')
  .description('Start webapp (nginx container serving static + API gateway)')
  .option('-f, --force', 'Force recreate container even if already running')
  .structuredAction(async (opts) => {
    const { webappStartCommand } = await import('../commands/webapp.js');
    await webappStartCommand({ force: opts.force });
  });

webapp
  .command('stop')
  .description('Stop webapp nginx container')
  .structuredAction(async () => {
    const { webappStopCommand } = await import('../commands/webapp.js');
    await webappStopCommand();
  });

webapp
  .command('status')
  .description('Show webapp status')
  .structuredAction(async () => {
    const { webappStatusCommand } = await import('../commands/webapp.js');
    await webappStatusCommand();
  });

webapp
  .command('open')
  .description('Open webapp in browser')
  .structuredAction(async () => {
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
  .structuredAction(async () => {
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const { emitJson } = await import('../commands/output.js');
    const config = await loadEcosystemConfig();
    if (!emitJson(config)) {
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

// Let the selected command parse its own options. In particular, a file
// version is a write precondition, even when the root also has --version.
// Group-level --json keeps structured output available on either side of
// the command name, including in groups with nested commands.
program.enablePositionalOptions();
const jsonOutputOption = program.options.find((option) => option.long === '--json')!;
for (const command of program.commands) {
  if (!command.options.some((option) => option.long === '--json')) command.addOption(jsonOutputOption);
}

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
 * A successful `up --foreground` finishes startup, but its daemon still owns
 * this process. Leave its handles and Titan shutdown lifecycle intact. An
 * already-running refusal or a completed forwarded runtime owns no daemon
 * here, so those calls retain the ordinary CLI completion path.
 */
program.parseAsync().then(
  async () => {
    const { finishJsonModeGuard } = await import('../commands/output.js');
    finishJsonModeGuard();
    if (!foregroundDaemonRunning) await exitAfterOutput(process.exitCode ?? 0);
  },
  async (err: unknown) => {
    // Commander prints its own errors and sets an exit code; anything else
    // reaching here is a bug in a command, and swallowing it would hide it.
    if ((err as { exitCode?: number })?.exitCode == null) {
      const { emitError, isJsonMode } = await import('../commands/output.js');
      if (isJsonMode()) emitError(err instanceof Error ? err.message : String(err), { code: 'COMMAND_FAILED', outcome: 'unknown' });
      else console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    }
    const { finishJsonModeGuard } = await import('../commands/output.js');
    finishJsonModeGuard();
    return exitAfterOutput(process.exitCode ?? 1);
  },
);
