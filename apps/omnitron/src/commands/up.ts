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
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { log, select, isCancel } from '@xec-sh/kit';
import { spinner } from './spinner.js';
import { ProjectRegistry } from '../project/registry.js';
import { loadEcosystemConfig, loadEcosystemConfigFile } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG, OMNITRON_HOME } from '../config/defaults.js';
import { OmnitronDaemon } from '../daemon/daemon.js';
import { PidManager } from '../daemon/pid-manager.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { DaemonRole, IDaemonConfig } from '../config/types.js';
import { expandPath } from '../shared/paths.js';

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
  /**
   * Daemon auth settings. `jwtSecret` is generated once and persisted so the
   * console's JWT sessions survive daemon restarts (see ensurePersistedJwtSecret).
   */
  auth?: { jwtSecret: string };
  /**
   * Transport-level rate limiting and proxy trust for the daemon's HTTP
   * surface. Persisted because the daemon boots from THIS file, not from the
   * project's ecosystem config — anything set only there is invisible to a
   * running daemon.
   */
  httpRateLimit?: IDaemonConfig['httpRateLimit'];

  /**
   * Transport bind address and the address slaves dial to reach a master.
   *
   * Here for the same reason `httpRateLimit` is: this file is what the daemon
   * boots from. `IDaemonConfig` documents `host` at length — "set `0.0.0.0`
   * to accept connections from other hosts" — and until these fields existed
   * there was nowhere to set it that the daemon would read. A provisioned
   * slave wrote `daemon: { host: '0.0.0.0', … }` into an `omnitron.config.ts`
   * whose schema has no `daemon` key, and booted on loopback.
   */
  host?: string;
  port?: number;
  httpPort?: number;
  advertiseHost?: string;
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
  // 0600 — the file now carries the JWT signing secret, so keep it owner-only.
  fs.writeFileSync(DAEMON_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(DAEMON_CONFIG_PATH, 0o600); // tighten perms even if the file pre-existed world-readable
  } catch {
    /* best-effort on platforms without chmod semantics */
  }
}

/**
 * Read the daemon's persisted JWT signing secret, generating and storing a
 * random 32-byte one on first use.
 *
 * Without this the secret falls back to a hardcoded dev constant (or, in
 * production, the daemon refuses to boot). Persisting a per-install secret
 * keeps console sessions (rows in `omnitron_sessions`) valid across daemon
 * restarts — otherwise every `/netron/invoke` 401s after a restart and the
 * operator is silently logged out.
 */
export function ensurePersistedJwtSecret(): string {
  const existing = readSavedDaemonConfig();
  if (existing?.auth?.jwtSecret) return existing.auth.jwtSecret;
  const jwtSecret = randomBytes(32).toString('hex');
  const base: SavedDaemonConfig =
    existing ?? { role: 'master', initialized: true, initializedAt: new Date().toISOString() };
  writeSavedDaemonConfig({ ...base, auth: { ...existing?.auth, jwtSecret } });
  return jwtSecret;
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

    // Recreate when absent, not running, OR running-but-network-detached — the
    // last case is the OrbStack/dockerd-restart artifact that leaves the auth
    // DB 'running' yet unreachable (host :5480 dead), which silently breaks
    // Console login. The named data volume is preserved across recreation.
    const detached = existing?.status === 'running' && existing.networkAttached === false;
    if (!existing || existing.status !== 'running' || detached) {
      if (existing) await removeContainer(pgSpec.name);
      await ensureImage(pgSpec.image);
      for (const vol of pgSpec.volumes) {
        if (!vol.source.startsWith('/')) await createVolume(vol.source);
      }
      await createContainer(pgSpec);
      await waitForHealthy(pgSpec.name, 60_000);
      s.stop(detached ? 'omnitron-pg recreated (was network-detached; port 5480)' : 'omnitron-pg ready (port 5480)');
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
    role: savedConfig.role,
    ...(savedConfig.master ? { master: savedConfig.master } : {}),
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
    return;
  }

  // Ensure omnitron-pg (Console auth DB) is healthy on EVERY master start, not
  // just first-run init — recreates it if absent, stopped, or running-but-
  // network-detached (the OrbStack/dockerd-restart artifact that silently
  // breaks Console login). Idempotent: a healthy container is left as-is.
  if (savedConfig.role === 'master' && !options?.noInfra) {
    await provisionOmnitronPg();
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
    spawned = spawnDaemon({
      entryPath: path.resolve(__dirname, '../daemon/daemon-entry.js'),
      // Where `node_modules` is — see `spawn-daemon.ts`. This file used to
      // fork without it, and the child looked for `tsx` in the operator's
      // login directory.
      packageRoot: path.resolve(__dirname, '../..'),
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
export async function downCommand(): Promise<void> {
  const { daemonStop } = await import('./daemon-cmd.js');
  await daemonStop();
}
