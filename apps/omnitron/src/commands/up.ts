/**
 * omnitron up
 *
 * Start the omnitron daemon — the unified control plane for this host.
 *
 * By default starts as a background daemon (detached from terminal).
 * Use --foreground to keep attached (useful for development/debugging).
 *
 * Usage:
 *   omnitron up                  # Start as background daemon
 *   omnitron up --foreground     # Start in foreground (blocks terminal)
 *   omnitron up --no-infra       # Skip Docker provisioning
 *   omnitron up --no-watch       # Disable file watching
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { log, select, isCancel } from '@xec-sh/kit';
import { spinner } from './spinner.js';
import { ProjectRegistry } from '../project/registry.js';
import { loadEcosystemConfig, loadEcosystemConfigFile } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { OmnitronDaemon } from '../daemon/daemon.js';
import { PidManager } from '../daemon/pid-manager.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { DaemonRole } from '../config/types.js';
import { expandPath } from '../shared/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Saved daemon config (~/.omnitron/config.json)
// =============================================================================

import { readSavedDaemonConfig, writeSavedDaemonConfig, savedDaemonOverrides } from '../config/saved.js';
import type { SavedDaemonConfig } from '../config/saved.js';
export { readSavedDaemonConfig, writeSavedDaemonConfig, savedDaemonOverrides, ensurePersistedJwtSecret } from '../config/saved.js';
export type { SavedDaemonConfig } from '../config/saved.js';

// =============================================================================
// First-run setup
// =============================================================================

export interface UpCommandOptions {
  configPath?: string;
  project?: string;
  noInfra?: boolean;
  noWatch?: boolean;
  foreground?: boolean;
  master?: boolean;
  slave?: boolean | string;
  /** Enable/disable webapp auto-start. Persisted to ~/.omnitron/config.json. */
  webapp?: boolean;
}

/**
 * First-run setup: reads or creates ~/.omnitron/config.json.
 * On first run, prompts interactively (or accepts --master/--slave flags).
 */
async function ensureDaemonConfig(options?: UpCommandOptions): Promise<SavedDaemonConfig> {
  const existing = readSavedDaemonConfig();
  if (existing) return existing;

  // --- First run ---
  log.info('Welcome to Omnitron! Running first-time setup.\n');

  let role: DaemonRole;
  let masterAddr: { host: string; port: number } | undefined;

  if (options?.master) {
    role = 'master';
  } else if (options?.slave) {
    role = 'slave';
  } else if (!process.stdin.isTTY) {
    // Nobody can answer a prompt here, and waiting for one is the worst of
    // the available failures: the command does not fail, it hangs, and
    // whatever is driving it — a provisioning run, a CI step, a `ssh host
    // omnitron up` — sits there until its own timeout and reports something
    // unrelated.
    //
    // Measured 2026-09-14, activating a new version on a remote node over
    // SSH: `omnitron up --no-infra` printed "Welcome to Omnitron! Running
    // first-time setup." and the role menu, then waited. The upgrade reported
    // a daemon that would not start; the daemon had never been asked to.
    log.error('This is omnitron\'s first run here and there is no terminal to ask which role it should take.');
    log.info('  Pass --master, or --slave <host:port>, and run it again.');
    process.exit(1);
  } else {
    // Interactive prompt
    const selected = await select<DaemonRole>({
      message: 'Select daemon role',
      options: [
        { value: 'master', label: 'master', hint: 'Primary control plane (manages apps, infra, metrics)' },
        { value: 'slave', label: 'slave', hint: 'Remote execution node (syncs to master)' },
      ],
      initialValue: 'master',
    });

    if (isCancel(selected)) {
      log.warn('Setup cancelled.');
      process.exit(0);
    }
    role = selected;
  }

  if (role === 'slave') {
    // Master address is optional — master initiates connections to slaves.
    // Slave just listens on TCP and waits for master to connect and pull data.
    if (typeof options?.slave === 'string' && options.slave.includes(':')) {
      const [host, portStr] = options.slave.split(':');
      masterAddr = { host: host!, port: Number(portStr) };
    }
  }

  const savedConfig: SavedDaemonConfig = {
    role,
    initialized: true,
    initializedAt: new Date().toISOString(),
    ...(masterAddr ? { master: masterAddr } : {}),
  };

  writeSavedDaemonConfig(savedConfig);
  log.success(`Role: ${role}`);

  log.success('Configuration saved to ~/.omnitron/config.json\n');
  return savedConfig;
}

/** A foreground daemon owns process shutdown after startup has completed. */
export async function upCommand(options?: UpCommandOptions): Promise<'foreground-running' | 'completed'> {
  const { selectedBackend } = await import('../daemon/runtime-installation.js');
  const installed = await selectedBackend();
  if (options?.foreground && installed && (installed.directory !== path.resolve(__dirname, '..') || installed.execPath !== fs.realpathSync(process.execPath))) {
    const { runRuntimeEntry } = await import('../daemon/runtime-launcher.js');
    const args = ['up', '--foreground'];
    if (options.configPath) args.push('--config', path.resolve(options.configPath));
    if (options.project) args.push('--project', options.project);
    if (options.noInfra) args.push('--no-infra');
    if (options.noWatch) args.push('--no-watch');
    if (options.master) args.push('--master');
    if (options.slave) args.push('--slave', ...(typeof options.slave === 'string' ? [options.slave] : []));
    if (options.webapp !== undefined) args.push(options.webapp ? '--webapp' : '--no-webapp');
    await runRuntimeEntry(installed, 'cli', args);
    return 'completed';
  }
  // 1. First-run setup — configure daemon role
  const savedConfig = await ensureDaemonConfig(options);

  // 1.1. Update webapp flag if explicitly provided
  if (options?.webapp !== undefined) {
    savedConfig.webapp = options.webapp;
    writeSavedDaemonConfig(savedConfig);
  }

  // 1.5. Resolve ecosystem config
  const registry = ProjectRegistry.open();
  let configPath: string | undefined;

  if (options?.configPath) {
    configPath = path.resolve(options.configPath);
  } else if (options?.project) {
    configPath = registry.getConfigPath(options.project) ?? undefined;
  } else {
    // Auto-detect from CWD or fall back to first registered project
    const detected = registry.autoDetect();
    if (detected) {
      configPath = registry.getConfigPath(detected.name) ?? undefined;
    } else {
      const projects = registry.list();
      if (projects.length > 0) {
        configPath = registry.getConfigPath(projects[0]!.name) ?? undefined;
      }
    }
  }

  let config;
  if (configPath && fs.existsSync(configPath)) {
    config = await loadEcosystemConfigFile(configPath);
  } else {
    try {
      config = await loadEcosystemConfig();
    } catch {
      // No config in CWD and no projects — start with defaults
      const { defineEcosystem } = await import('../config/define-ecosystem.js');
      config = defineEcosystem({ apps: [] });
    }
  }

  // 2. Check if already running
  const dc = {
    ...DEFAULT_DAEMON_CONFIG,
    ...savedDaemonOverrides(savedConfig),
  };
  const pidFile = expandPath(dc.pidFile);
  const socketPath = expandPath(dc.socketPath);
  const pidManager = new PidManager(pidFile);

  if (pidManager.cleanupStale(socketPath)) {
    log.info('Cleaned up stale daemon state');
  }

  if (pidManager.isRunning()) {
    const pid = pidManager.getPid();
    log.error(`Daemon already running (PID: ${pid}).`);
    log.info('Use `omnitron stack start/stop` to manage stacks.');
    log.info('Use `omnitron down` to stop.');
    return 'completed';
  }

  // 3. Foreground mode — blocks terminal
  if (options?.foreground) {
    const { withRuntimeStartup } = await import('../daemon/runtime-installation.js');
    await withRuntimeStartup(path.resolve(__dirname, '..'), () => startForeground(config, options, registry, dc));
    return 'foreground-running';
  }

  // 4. Background mode (default) — fork detached daemon
  await startBackground(socketPath, dc, options);
  return 'completed';
}

// =============================================================================
// Foreground (--foreground)
// =============================================================================

/**
 * What a slave should say about replication when it starts.
 *
 * This printed `Sync: slave → master at <host>:<port>`, and replication is
 * master-PULL: the master opens the connection, drains this node's buffer
 * and acknowledges what it holds. A slave dials nothing. The address is
 * real — `master-address.ts` resolves it carefully at provisioning time and
 * refuses rather than guess — but it is the address the unbuilt push path
 * would use, and printing it behind an arrow pointing the wrong way sends an
 * operator to check a connection this node never opens.
 *
 * It is the one thing that reads `master` at all, which is worth knowing
 * before anyone deletes the resolver for being unused.
 */
export function describeSlaveSync(master: { host: string; port: number } | undefined): string {
  return master
    ? `Sync: buffering locally; the master at ${master.host}:${master.port} connects here and pulls.`
    : 'Sync: buffering locally until a master connects and pulls.';
}

async function startForeground(
  config: import('../config/types.js').IEcosystemConfig,
  options: UpCommandOptions | undefined,
  registry: ProjectRegistry,
  dc: import('../config/types.js').IDaemonConfig,
): Promise<void> {
  const projects = registry.listRegistrations();

  log.info(`Starting omnitron daemon (role: ${dc.role}, foreground)`);
  log.info(`Projects: ${projects.length > 0 ? projects.map((p) => p.name).join(', ') : '(auto-detected)'}`);

  for (const p of projects) {
    if (p.enabledStacks?.length) {
      log.info(`  ${p.name}: stacks [${p.enabledStacks.join(', ')}]`);
    }
  }

  if (dc.role === 'slave') {
    log.info(describeSlaveSync(dc.master));
  }

  log.info('Press Ctrl+C to stop.\n');

  const daemon = new OmnitronDaemon();

  try {
    await daemon.start(config, {
      watch: !options?.noWatch,
      noInfra: options?.noInfra ?? false,
      noWatch: options?.noWatch ?? false,
    }, dc);
  } catch (err) {
    log.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}

// =============================================================================
// Background (default) — fork + detach
// =============================================================================

async function startBackground(
  socketPath: string,
  dc: import('../config/types.js').IDaemonConfig,
  options: UpCommandOptions | undefined,
): Promise<void> {
  const s = spinner();
  s.start('Starting Omnitron daemon...');

  // When the OS service is installed (`omnitron service install`), start the
  // daemon THROUGH the supervisor so it stays under crash-restart
  // supervision — a plain fork here would create an unsupervised daemon and
  // silently defeat the service. The one-shot debug flags (--no-infra /
  // --no-watch) are not part of the supervisor environment, so those runs
  // fall back to a direct fork.
  let viaService = false;
  if (!options?.noInfra && !options?.noWatch) {
    try {
      const { isServiceInstalled, serviceKickstart } = await import('./service.js');
      if (isServiceInstalled()) {
        serviceKickstart();
        viaService = true;
        s.message('Starting Omnitron daemon via OS service...');
      }
    } catch {
      viaService = false; // supervisor refused — fall through to fork
    }
  }

  let spawned: import('../daemon/spawn-daemon.js').SpawnedDaemon | null = null;
  if (!viaService) {
    const { spawnDaemon } = await import('../daemon/spawn-daemon.js');
    const { selectedBackend } = await import('../daemon/runtime-installation.js');
    const installed = await selectedBackend();
    spawned = spawnDaemon({
      entryPath: installed?.entry ?? path.resolve(__dirname, '../daemon/daemon-entry.js'),
      execPath: installed?.execPath,
      // Where `node_modules` is — see `spawn-daemon.ts`. This file used to
      // fork without it, and the child looked for `tsx` in the operator's
      // login directory.
      packageRoot: installed ? path.dirname(installed.directory) : path.resolve(__dirname, '../..'),
      operatorCwd: process.cwd(),
      bootLogPath: path.join(expandPath(dc.logDir), 'daemon-boot.err.log'),
      env: {
        ...(options?.noInfra ? { OMNITRON_NO_INFRA: '1' } : {}),
        ...(options?.noWatch ? { OMNITRON_NO_WATCH: '1' } : {}),
      },
    });
  }

  // Wait for daemon to become reachable via Unix socket
  const client = createDaemonClient(socketPath);
  const maxWait = 30_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (await client.isReachable()) {
      const info = await client.ping();
      s.stop(`Omnitron daemon started (PID: ${info.pid}, v${info.version})`);
      log.info(`  Socket: ${socketPath}`);
      log.info(`  HTTP:   http://localhost:${dc.httpPort}`);

      await client.disconnect();
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  await client.disconnect();

  if (!spawned) {
    // Started through the OS supervisor, which owns the restart. Nothing here
    // can say more than that it has not answered yet.
    s.stop(`The supervised daemon did not answer within ${maxWait / 1000}s`);
    log.info('  Check `omnitron service status`.');
    process.exit(1);
  }

  const { describeStartupTimeout } = await import('../daemon/spawn-daemon.js');
  const outcome = describeStartupTimeout(spawned, maxWait);
  s.stop(outcome.message);
  if (outcome.ok) {
    log.info(`  ${outcome.detail}`);
    process.exit(0);
  }
  log.error(`  ${outcome.detail}`);
  process.exit(1);
}

/**
 * omnitron down
 *
 * Stop the daemon — stops ALL projects, ALL stacks, ALL infrastructure.
 */
/**
 * What stopping the daemon has to do, given how it was started.
 *
 * `down` killed the process — SIGTERM, then SIGKILL — and said "Daemon
 * force-killed". When the daemon is installed as a service, that is not
 * stopping it: the supervisor has `KeepAlive`, and it starts a new one as
 * soon as the old one dies. Measured on this machine:
 *
 *     omnitron down   → "Daemon force-killed (PID: 69597)"
 *     29 seconds later → a new daemon, PID 73095, PPID 1
 *
 * The command reported success, the operator believed the daemon was down,
 * and anything done on that belief — rebuilding the package it runs from —
 * ran against a live daemon. The plist's `ThrottleInterval` is 10 seconds,
 * so the window in which the report is true is ten seconds wide.
 *
 * Unloading the service FIRST is the whole fix. Killing first and unloading
 * second leaves the same race, smaller: the supervisor can start a
 * replacement between the two.
 */
export interface DownPlan {
  /** Steps in the order they must happen. */
  steps: Array<'unload-service' | 'stop-process'>;
  /** What the operator is told, when the daemon is supervised. */
  note: string | null;
}

export function planDown(supervised: boolean): DownPlan {
  if (!supervised) return { steps: ['stop-process'], note: null };

  return {
    steps: ['unload-service', 'stop-process'],
    // Said because it is a change the operator did not ask for and will
    // notice at the next login. `up` arms it again.
    note: 'Autostart is off until `omnitron up` — the service is unloaded, so nothing will restart the daemon.',
  };
}

export async function downCommand(): Promise<void> {
  const { isServiceInstalled, serviceBootout } = await import('./service.js');
  const plan = planDown(isServiceInstalled());

  for (const step of plan.steps) {
    if (step === 'unload-service') {
      serviceBootout();
      // The supervisor sends SIGTERM and waits; the daemon's own shutdown
      // tasks run in that window. Give it the same budget the plist does
      // before deciding the process needs stopping directly.
      if (await waitForDaemonExit(35_000)) {
        log.success('Daemon stopped, and its service is unloaded.');
        if (plan.note) log.info(`  ${plan.note}`);
        return;
      }
      log.warn('The service is unloaded but the daemon is still running — stopping the process directly.');
      continue;
    }

    const { daemonStop } = await import('./daemon-cmd.js');
    await daemonStop();
    if (plan.note) log.info(`  ${plan.note}`);
  }
}

/** True once no daemon process is alive, false if it outlived the budget. */
async function waitForDaemonExit(budgetMs: number): Promise<boolean> {
  const pidFile = expandPath(DEFAULT_DAEMON_CONFIG.pidFile);
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const pid = new PidManager(pidFile).getPid();
    if (!pid || !PidManager.isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
