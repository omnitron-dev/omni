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
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log, spinner, select, isCancel } from '@xec-sh/kit';
import { ProjectRegistry } from '../project/registry.js';
import { loadEcosystemConfig, loadEcosystemConfigFile } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG, OMNITRON_HOME } from '../config/defaults.js';
import { OmnitronDaemon } from '../daemon/daemon.js';
import { PidManager } from '../daemon/pid-manager.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { DaemonRole } from '../config/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Saved daemon config (~/.omnitron/config.json)
// =============================================================================

export interface SavedDaemonConfig {
  role: DaemonRole;
  master?: { host: string; port: number };
  initialized: boolean;
  initializedAt: string;
  /** Whether to auto-start webapp (Console UI) with daemon. Set via `omnitron up --webapp`. */
  webapp?: boolean;
}

const DAEMON_CONFIG_PATH = path.join(OMNITRON_HOME, 'config.json');

export function readSavedDaemonConfig(): SavedDaemonConfig | null {
  try {
    const raw = fs.readFileSync(DAEMON_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as SavedDaemonConfig;
  } catch {
    return null;
  }
}

export function writeSavedDaemonConfig(config: SavedDaemonConfig): void {
  fs.mkdirSync(OMNITRON_HOME, { recursive: true });
  fs.writeFileSync(DAEMON_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

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

  // Provision omnitron-pg for master on first run
  if (role === 'master' && !options?.noInfra) {
    await provisionOmnitronPg();
  }

  log.success('Configuration saved to ~/.omnitron/config.json\n');
  return savedConfig;
}

/**
 * Provision omnitron-pg Docker container (master first-run only).
 */
async function provisionOmnitronPg(): Promise<void> {
  const s = spinner();
  s.start('Provisioning Omnitron internal database...');

  try {
    const { resolveOmnitronPg } = await import('../infrastructure/service-resolver.js');
    const { createContainer, getContainerState, waitForHealthy, ensureImage, removeContainer, createVolume } =
      await import('../infrastructure/container-runtime.js');

    const pgSpec = resolveOmnitronPg();
    const existing = await getContainerState(pgSpec.name);

    if (!existing || existing.status !== 'running') {
      if (existing) await removeContainer(pgSpec.name);
      await ensureImage(pgSpec.image);
      for (const vol of pgSpec.volumes) {
        if (!vol.source.startsWith('/')) await createVolume(vol.source);
      }
      await createContainer(pgSpec);
      await waitForHealthy(pgSpec.name, 60_000);
      s.stop('omnitron-pg ready (port 5480)');
    } else {
      s.stop('omnitron-pg already running');
    }
  } catch (err) {
    s.stop(`Failed to provision omnitron-pg: ${(err as Error).message}`);
    log.warn('You can retry with `omnitron infra up` later.');
  }
}

export async function upCommand(options?: UpCommandOptions): Promise<void> {
  // 1. First-run setup — configure daemon role
  const savedConfig = await ensureDaemonConfig(options);

  // 1.1. Update webapp flag if explicitly provided
  if (options?.webapp !== undefined) {
    savedConfig.webapp = options.webapp;
    writeSavedDaemonConfig(savedConfig);
  }

  // 1.5. Resolve ecosystem config
  const registry = new ProjectRegistry();
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
    role: savedConfig.role,
    ...(savedConfig.master ? { master: savedConfig.master } : {}),
  };
  const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
  const socketPath = dc.socketPath.replace('~', process.env['HOME'] ?? '');
  const pidManager = new PidManager(pidFile);

  if (pidManager.cleanupStale(socketPath)) {
    log.info('Cleaned up stale daemon state');
  }

  if (pidManager.isRunning()) {
    const pid = pidManager.getPid();
    log.error(`Daemon already running (PID: ${pid}).`);
    log.info('Use `omnitron stack start/stop` to manage stacks.');
    log.info('Use `omnitron down` to stop.');
    return;
  }

  // 3. Foreground mode — blocks terminal
  if (options?.foreground) {
    await startForeground(config, options, registry, dc);
    return;
  }

  // 4. Background mode (default) — fork detached daemon
  await startBackground(socketPath, dc, options);
}

// =============================================================================
// Foreground (--foreground)
// =============================================================================

async function startForeground(
  config: import('../config/types.js').IEcosystemConfig,
  options: UpCommandOptions | undefined,
  registry: ProjectRegistry,
  dc: import('../config/types.js').IDaemonConfig,
): Promise<void> {
  const projects = registry.list();

  log.info(`Starting omnitron daemon (role: ${dc.role}, foreground)`);
  log.info(`Projects: ${projects.length > 0 ? projects.map((p) => p.name).join(', ') : '(auto-detected)'}`);

  for (const p of projects) {
    if (p.enabledStacks?.length) {
      log.info(`  ${p.name}: stacks [${p.enabledStacks.join(', ')}]`);
    }
  }

  if (dc.role === 'slave') {
    log.info(`Sync: slave → master at ${dc.master?.host}:${dc.master?.port}`);
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

  // Fork the daemon entry point as a detached child process
  const daemonScript = path.resolve(__dirname, '../daemon/daemon-entry.js');
  const child = fork(daemonScript, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      OMNITRON_CWD: process.cwd(),
      ...(options?.noInfra ? { OMNITRON_NO_INFRA: '1' } : {}),
      ...(options?.noWatch ? { OMNITRON_NO_WATCH: '1' } : {}),
    },
    execArgv: ['--import', 'tsx/esm'],
  });

  child.unref();

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

  s.stop('Daemon started — verifying connectivity timed out (may still be initializing)');
  await client.disconnect();
  process.exit(0);
}

/**
 * omnitron down
 *
 * Stop the daemon — stops ALL projects, ALL stacks, ALL infrastructure.
 */
export async function downCommand(): Promise<void> {
  const { daemonStop } = await import('./daemon-cmd.js');
  await daemonStop();
}
