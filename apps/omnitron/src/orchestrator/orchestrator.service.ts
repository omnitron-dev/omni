/**
 * OrchestratorService — Core orchestration logic
 *
 * Thin orchestration layer over Titan PM module's ProcessSupervisor:
 *
 * Bootstrap mode:
 *   - Each app gets a ProcessSupervisor via pm.supervisor(config)
 *   - Supervisor manages all child lifecycle: spawn, health, metrics, crash recovery, restart
 *   - Single or multi-instance (pool) — configured via ISupervisorChildConfig
 *   - Scaling delegates to supervisor.scaleChild()
 *
 * Classic mode:
 *   - child_process.fork() with manual exit handling (legacy compat)
 *   - Real CPU/memory metrics via pidusage
 *
 * Architecture:
 *   pm.supervisor({ children: [{ process: bootstrap-process.js, ... }] })
 *     → ProcessSupervisor.fromConfig() → pm.spawn() or pm.pool() per child
 *     → fork-worker.js → worker-runtime.js → BootstrapProcess.init(...)
 *     → Full Titan Application inside each worker
 *     → Two Netron instances: PM management plane + app HTTP data plane
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import {
  PoolStrategy,
  SupervisionStrategy,
  RestartDecision,
  type ProcessManager,
  type ISupervisorConfig,
  type ISupervisorChildConfig,
  type ISupervisorChild,
  type IProcessMetrics,
  type IHealthStatus,
  type IProcessPoolOptions,
  type ProcessPool,
} from '@omnitron-dev/titan-pm';
import { EventEmitter } from '@omnitron-dev/eventemitter';

import type { MetricSample } from '@omnitron-dev/titan-metrics';
import type {
  IEcosystemConfig,
  IEcosystemAppEntry,
  IProcessEntry,
  ProcessInfoDto,
  AppStatus,
  IAppDefinition,
} from '../config/types.js';
import { AppHandle } from './app-handle.js';
import { launchClassic } from './classic-launcher.js';
import { resolveStartupOrder, resolveShutdownOrder } from './dependency-resolver.js';
import { buildRestartPolicy } from '../supervisor/restart-policy.js';
import { ServiceRouter } from './service-router.js';
import { loadBootstrapConfig, clearCacheFor } from './bootstrap-loader.js';
import { BuildService, type BuildResult } from './build-service.js';
import type { StateStore } from '../daemon/state-store.js';
import { CLI_VERSION } from '../config/defaults.js';
import type { Netron } from '@omnitron-dev/titan/netron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve bootstrap-process path — .ts in dev (tsx), .js when compiled
function resolveBootstrapProcessPath(): string {
  const jsPath = path.join(__dirname, 'bootstrap-process.js');
  if (fs.existsSync(jsPath)) return jsPath;
  const tsPath = path.join(__dirname, 'bootstrap-process.ts');
  if (fs.existsSync(tsPath)) return tsPath;
  return jsPath;
}
const BOOTSTRAP_PROCESS_PATH = resolveBootstrapProcessPath();


function mapStrategy(strategy: string): SupervisionStrategy {
  switch (strategy) {
    case 'one_for_all':
      return SupervisionStrategy.ONE_FOR_ALL;
    case 'rest_for_one':
      return SupervisionStrategy.REST_FOR_ONE;
    default:
      return SupervisionStrategy.ONE_FOR_ONE;
  }
}

export class OrchestratorService extends EventEmitter {
  private readonly handles = new Map<string, AppHandle>();
  private config: IEcosystemConfig | null = null;
  private readonly cwd: string;
  private metricsTimer: NodeJS.Timeout | null = null;
  private readonly appLogHandlers: Array<(appName: string, line: string) => void> = [];

  /** Dev mode — when true, child processes are bundled from source .ts via esbuild */
  devMode = false;

  /** esbuild bundling pipeline — pre-bundles TS entry points for child processes */
  private buildService: BuildService | null = null;

  /** Cached build results per app name */
  private readonly buildResults = new Map<string, BuildResult>();

  /** Daemon's Netron instance for native service routing */
  private daemonNetron: Netron | null = null;

  /** Daemon Unix socket path for child-to-daemon Netron connections */
  private daemonSocketPath: string | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly pm: ProcessManager,
    private readonly stateStore: StateStore,
    cwd?: string
  ) {
    super();
    this.cwd = cwd ?? process.cwd();
  }

  /**
   * Set the daemon Netron instance and socket path for native topology routing.
   * Called by the daemon after start when Netron is available.
   */
  setDaemonNetron(netron: Netron, socketPath: string): void {
    this.daemonNetron = netron;
    this.daemonSocketPath = socketPath;
    this.logger.info({ socketPath }, 'Daemon Netron set for native topology routing');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async startAll(config: IEcosystemConfig): Promise<void> {
    this.config = config;

    for (const batch of resolveStartupOrder(config.apps)) {
      const enabled = batch.filter((e) => e.enabled !== false);
      await Promise.all(
        enabled.map(async (e) => {
          try {
            await this.startApp(e, config);
          } catch (err) {
            this.logger.error(
              { app: e.name, error: (err as Error).message },
              'Failed to start app — continuing with remaining apps'
            );
          }
        })
      );
    }

    this.startMetricsPolling(config.monitoring.metrics.interval);
    this.persistState();
  }

  async startApp(entry: IEcosystemAppEntry, config?: IEcosystemConfig): Promise<AppHandle> {
    // Persist ecosystem config for restartApp — stack mode passes config per-app,
    // but restartApp calls startApp without it.
    if (config && !this.config) {
      this.config = config;
    }
    const cfg = config ?? this.config;
    if (!cfg) throw new Error('Ecosystem config not loaded');

    const existing = this.handles.get(entry.name);
    if (existing && existing.status === 'online') {
      this.logger.warn({ app: entry.name }, 'App already running');
      return existing;
    }

    const mode = entry.bootstrap ? 'bootstrap' : 'classic';
    const handle = new AppHandle(entry, mode);
    this.handles.set(entry.name, handle);

    this.logger.info({ app: entry.name, mode }, 'Starting app');

    try {
      if (mode === 'classic') {
        await this.launchClassicMode(entry, handle, cfg);
      } else {
        await this.launchBootstrapMode(entry, handle, cfg);
      }
      this.logger.info({ app: entry.name, pid: handle.pid, mode }, 'App started');
      this.persistState();
      return handle;
    } catch (err) {
      handle.markErrored();
      this.persistState();
      throw err;
    }
  }

  async stopApp(name: string, force = false, timeout = 10_000): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle || handle.status === 'stopped') return;

    handle.markStopping();

    // Unexpose topology services from daemon Netron before stopping processes
    if (handle.serviceRouter) {
      try {
        for (const svcName of handle.serviceRouter.getServiceNames()) {
          await handle.serviceRouter.unexposeService(svcName);
        }
      } catch {
        // Best-effort cleanup
      }
      handle.serviceRouter = null;
    }

    if (handle.mode === 'bootstrap' && handle.supervisor) {
      await handle.supervisor.stop();
    } else if (handle.childProcess) {
      await this.stopChildProcess(handle, force, timeout);
    }

    handle.markStopped();
    this.persistState();
    this.logger.info({ app: name }, 'App stopped');
  }

  async stopAll(force = false): Promise<number> {
    if (!this.config) return 0;

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    let count = 0;
    // When force=true (daemon shutdown), use short timeout per app (3s SIGTERM, then SIGKILL)
    const perAppTimeout = force ? 3_000 : 10_000;

    for (const batch of resolveShutdownOrder(this.config.apps)) {
      await Promise.all(
        batch.map(async (entry) => {
          try {
            await this.stopApp(entry.name, force, perAppTimeout);
            count++;
          } catch (err) {
            this.logger.error({ app: entry.name, error: (err as Error).message }, 'Failed to stop');
          }
        })
      );
    }

    try {
      await this.pm.shutdown({ force, timeout: force ? 5_000 : 30_000 });
    } catch {
      /* PM may have nothing left to clean up */
    }

    // Dispose esbuild watch contexts
    if (this.buildService) {
      try {
        await this.buildService.dispose();
      } catch { /* best-effort */ }
      this.buildService = null;
    }
    this.buildResults.clear();

    return count;
  }

  async restartApp(name: string): Promise<AppHandle> {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`Unknown app: ${name}`);
    const entry = handle.entry;

    // In dev mode, clear bootstrap config cache so topology changes are picked up
    if (this.devMode && entry.bootstrap) {
      clearCacheFor(path.resolve(this.cwd, entry.bootstrap));
      // Stop esbuild watch and clear stale build result — launchBootstrapMode will rebuild + re-watch
      if (this.buildService) {
        await this.buildService.unwatchApp(name);
      }
      this.buildResults.delete(name);
    }

    await this.stopApp(name);
    return this.startApp(entry);
  }

  /**
   * Resolve raw app name to its handle key.
   * In stack mode, handles are namespaced (e.g., 'omni/dev/main' for app 'main').
   * This finds the handle whose key ends with the raw app name.
   */
  resolveAppName(rawName: string): string | undefined {
    if (this.handles.has(rawName)) return rawName;
    for (const key of this.handles.keys()) {
      if (key.endsWith(`/${rawName}`)) return key;
    }
    return undefined;
  }

  /**
   * Reload app with zero-downtime strategy:
   *   1. Fork new process(es) with same config
   *   2. Wait for new process to report 'ready'
   *   3. Stop old process (drain in-flight requests)
   *   4. If new process fails, keep old one and report error
   *
   * Falls back to regular restart for classic mode apps or when
   * zero-downtime is not possible (single-process, no supervisor).
   */
  async reloadApp(name: string): Promise<AppHandle> {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`Unknown app: ${name}`);

    // Classic mode or no supervisor — cannot do zero-downtime, fall back to restart
    if (handle.mode !== 'bootstrap' || !handle.supervisor) {
      return this.restartApp(name);
    }

    const childNames = handle.supervisor.getChildNames();
    if (childNames.length === 0) {
      return this.restartApp(name);
    }

    this.logger.info({ app: name, children: childNames.length }, 'Zero-downtime reload starting');

    // For each child process, do a rolling restart via the supervisor.
    // The supervisor's restartChild stops the old child and starts a new one.
    // For pool children, the pool handles draining automatically.
    // We restart one child at a time to maintain availability.
    for (const childName of childNames) {
      this.logger.info({ app: name, child: childName }, 'Reloading child process');

      try {
        await handle.supervisor.restartChild(childName);

        // Wait for the new child to become healthy
        const health = await this.waitForChildHealth(handle, childName, 30_000);
        if (!health) {
          this.logger.warn(
            { app: name, child: childName },
            'Child did not become healthy after reload — continuing with remaining children'
          );
        }

        this.logger.info({ app: name, child: childName }, 'Child reloaded successfully');
      } catch (err) {
        this.logger.error(
          { app: name, child: childName, error: (err as Error).message },
          'Failed to reload child — aborting zero-downtime reload'
        );
        throw new Error(
          `Zero-downtime reload failed for '${name}' at child '${childName}': ${(err as Error).message}`
        );
      }
    }

    this.logger.info({ app: name }, 'Zero-downtime reload complete');
    this.persistState();
    return handle;
  }

  /**
   * Wait for a child process to report healthy status within a timeout.
   * Returns true if healthy, false if timeout exceeded.
   */
  private async waitForChildHealth(
    handle: AppHandle,
    childName: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!handle.supervisor) return false;

    const deadline = Date.now() + timeoutMs;
    const pollInterval = 1_000;

    while (Date.now() < deadline) {
      try {
        const health = await handle.supervisor.getChildHealth(childName);
        if (health?.status === 'healthy') return true;
      } catch {
        // Child may not be ready yet
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    return false;
  }

  // ============================================================================
  // Scaling — delegates to PM supervisor
  // ============================================================================

  async scaleApp(name: string, instances: number): Promise<AppHandle> {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`Unknown app: ${name}`);
    if (!this.config) throw new Error('Ecosystem config not loaded');
    if (handle.mode !== 'bootstrap') {
      this.logger.warn({ app: name }, 'Classic mode apps do not support scaling');
      return handle;
    }
    if (instances < 1) throw new Error('Instance count must be at least 1');
    if (instances === handle.instanceCount) return handle;

    if (!handle.supervisor) throw new Error(`No supervisor for app: ${name}`);

    this.logger.info({ app: name, from: handle.instanceCount, to: instances }, 'Scaling app');
    await handle.supervisor.scaleChild(name, instances);
    handle.instanceCount = instances;
    this.persistState();
    return handle;
  }

  // ============================================================================
  // Information
  // ============================================================================

  list(filter?: { prefix?: string }): ProcessInfoDto[] {
    let handles = Array.from(this.handles.values());
    if (filter?.prefix) {
      handles = handles.filter((h) => h.name.startsWith(filter.prefix!));
    }
    return handles.map((h) => this.toProcessInfo(h));
  }

  getApp(name: string): ProcessInfoDto | null {
    const h = this.handles.get(name);
    return h ? this.toProcessInfo(h) : null;
  }

  getHandle(name: string): AppHandle | undefined {
    return this.handles.get(name);
  }

  /**
   * List all handle names matching a prefix.
   * Used by ProjectService to find apps belonging to a specific stack.
   */
  listHandleNames(prefix?: string): string[] {
    const names = Array.from(this.handles.keys());
    if (!prefix) return names;
    return names.filter((n) => n.startsWith(prefix));
  }

  getWorkerHandle(processId: string) {
    return this.pm.getWorkerHandle(processId);
  }

  // ============================================================================
  // Monitoring — async, delegates to PM supervisor for bootstrap mode
  // ============================================================================

  async getMetrics(name?: string): Promise<Record<string, IProcessMetrics | null>> {
    const result: Record<string, IProcessMetrics | null> = {};

    for (const [appName, handle] of this.handles) {
      if (name && appName !== name) continue;

      if (handle.mode === 'bootstrap' && handle.supervisor) {
        const childNames = handle.supervisor.getChildNames();
        let cpu = 0,
          memory = 0,
          requests = 0,
          errors = 0;

        for (const childName of childNames) {
          // Try PM-level RPC metrics first
          const m = await handle.supervisor.getChildMetrics(childName);
          if (m && (m.cpu > 0 || m.memory > 0)) {
            cpu += m.cpu;
            memory += m.memory;
            requests += m.requests ?? 0;
            errors += m.errors ?? 0;
          } else {
            // Fallback: OS-level metrics via ps for the child PID
            const processId = handle.supervisor.getChildProcessId(childName);
            if (processId) {
              const workerHandle = this.pm.getWorkerHandle(processId);
              const childPid = workerHandle?.pid;
              if (childPid) {
                const osMetrics = await this.sampleProcessMetrics(childPid);
                cpu += osMetrics.cpu;
                memory += osMetrics.memory;
              }
            }
          }
        }

        const aggregated: IProcessMetrics = { cpu, memory, requests, errors };
        handle.lastMetrics = aggregated;
        result[appName] = aggregated;
      } else {
        // Classic mode: use cached metrics from polling
        result[appName] = handle.lastMetrics;
      }
    }

    return result;
  }

  async getHealth(name?: string): Promise<Record<string, IHealthStatus | null>> {
    const result: Record<string, IHealthStatus | null> = {};

    for (const [appName, handle] of this.handles) {
      if (name && appName !== name) continue;

      if (handle.mode === 'bootstrap' && handle.supervisor) {
        const childNames = handle.supervisor.getChildNames();
        if (childNames.length > 0) {
          const health = await handle.supervisor.getChildHealth(childNames[0]!);
          handle.lastHealth = health;
          result[appName] = health;
        } else {
          result[appName] = handle.lastHealth;
        }
      } else {
        result[appName] = handle.lastHealth;
      }
    }

    return result;
  }

  /**
   * Drain pre-built MetricSample[] from all children.
   * Each child runs its own MetricsCollector and buffers MetricSample[];
   * this method pulls and clears those buffers via Netron RPC.
   */
  async drainChildSamples(): Promise<Array<{ app: string; samples: MetricSample[] }>> {
    const results: Array<{ app: string; samples: MetricSample[] }> = [];

    for (const [appName, handle] of this.handles) {
      if (handle.mode !== 'bootstrap' || !handle.supervisor) continue;

      const childNames = handle.supervisor.getChildNames();
      for (const childName of childNames) {
        const processId = handle.supervisor.getChildProcessId(childName);
        if (!processId) continue;

        try {
          const workerHandle = this.pm.getWorkerHandle(processId);
          if (!workerHandle?.proxy) continue;

          const samples: MetricSample[] | undefined = await workerHandle.proxy.__drainMetrics?.();
          if (samples?.length) {
            results.push({ app: `${appName}/${childName}`, samples });
          }
        } catch {
          // Child may not support __drainMetrics yet — silently skip
        }
      }
    }

    return results;
  }

  /**
   * Toggle RPC metrics collection on child processes at runtime.
   * When disabled, the instrumented wrapper becomes a zero-overhead passthrough.
   */
  async setMetricsEnabled(name: string | undefined, enabled: boolean): Promise<void> {
    for (const [appName, handle] of this.handles) {
      if (name && appName !== name) continue;
      if (handle.mode !== 'bootstrap' || !handle.supervisor) continue;

      for (const childName of handle.supervisor.getChildNames()) {
        const processId = handle.supervisor.getChildProcessId(childName);
        if (!processId) continue;
        try {
          const wh = this.pm.getWorkerHandle(processId);
          await wh?.proxy?.__setMetricsEnabled?.({ enabled });
        } catch {
          // Child may not support __setMetricsEnabled — silently skip
        }
      }
    }
  }

  getLogs(name?: string, lines = 100): Array<{ app: string; lines: string[] }> {
    const result: Array<{ app: string; lines: string[] }> = [];
    for (const [appName, handle] of this.handles) {
      if (name && appName !== name) continue;
      result.push({ app: appName, lines: handle.getLogs(lines) });
    }
    return result;
  }

  /**
   * Get app status (or undefined if not tracked).
   */
  getAppStatus(name: string): AppStatus | undefined {
    const resolved = this.resolveAppName(name) ?? name;
    return this.handles.get(resolved)?.status;
  }

  /**
   * Register a handler that receives every log line from managed apps.
   * Used by LogManager to persist logs to disk with rotation.
   */
  onAppLog(handler: (appName: string, line: string) => void): void {
    this.appLogHandlers.push(handler);
  }

  // ============================================================================
  // Private — Launch
  // ============================================================================

  private async launchClassicMode(
    entry: IEcosystemAppEntry,
    handle: AppHandle,
    config: IEcosystemConfig
  ): Promise<void> {
    const child = await launchClassic(entry, handle, this.cwd, this.logger, this.appLogHandlers);

    child.on('exit', (code, signal) => {
      if (handle.status === 'stopping') {
        handle.markStopped();
      } else {
        this.logger.error({ app: entry.name, code, signal }, 'App exited unexpectedly');
        handle.markCrashed();
        this.handleClassicCrash(entry, handle, config);
      }
      this.persistState();
    });
  }

  /**
   * Launch bootstrap app via PM ProcessSupervisor.
   *
   * If the app's defineSystem() declares a `processes` topology, Omnitron creates
   * all topology children (server + worker pools) and wires IPC relay between them.
   * Otherwise, creates a single bootstrap-process as before.
   */
  private async launchBootstrapMode(
    entry: IEcosystemAppEntry,
    handle: AppHandle,
    config: IEcosystemConfig
  ): Promise<void> {
    handle.markStarting();

    const bootstrapAbsPath = path.resolve(this.cwd, entry.bootstrap!);

    // Load bootstrap definition to check for process topology and requirements
    let topology: IProcessEntry[] | undefined;
    let definition: IAppDefinition | undefined;
    try {
      definition = await loadBootstrapConfig(bootstrapAbsPath, { devMode: this.devMode });
      topology = definition.processes;
    } catch (err) {
      this.logger.warn(
        { app: entry.name, error: (err as Error).message },
        'Could not load bootstrap config for topology — using single-process mode'
      );
    }

    // Populate omnitronConfig from app's config/default.json if not set by bootstrap
    if (definition && !definition.omnitronConfig) {
      try {
        const srcDir = path.dirname(bootstrapAbsPath);
        const appRoot = path.resolve(srcDir, '..');
        const configPath = path.join(appRoot, 'config', 'default.json');
        const content = fs.readFileSync(configPath, 'utf-8');
        const json = JSON.parse(content);
        if (json.omnitron) {
          definition.omnitronConfig = json.omnitron;
        }
      } catch { /* config file missing — skip */ }
    }

    // Resolve infrastructure config and inject as env vars.
    // Skip if already injected by project.service.ts (stack flow sets OMNITRON_STACK).
    const alreadyResolved = !!(entry.env?.['OMNITRON_STACK'] && entry.env?.['DATABASE_URL']);
    if (!alreadyResolved && (definition?.requires || definition?.omnitronConfig)) {
      try {
        const { resolveStack, resolvedConfigToEnv } = await import('../project/config-resolver.js');
        const stackName = 'dev' as import('../config/types.js').StackName;

        // Build a single-app definitions map for resolveStack
        const definitions = new Map<string, import('../config/types.js').IAppDefinition>();
        definitions.set(entry.name, definition);

        // Use the default stack config (local type) for legacy direct startAll
        const stackConfig = config.stacks?.[stackName] ?? { type: 'local' as const };
        const projectName = config.project ?? 'default';
        const resolved = resolveStack(config, projectName, stackName, stackConfig, definitions, undefined);
        const appConfig = resolved.appConfigs.get(entry.name);

        if (appConfig) {
          const envVars = resolvedConfigToEnv(appConfig, entry.name, stackName);
          if (Object.keys(envVars).length > 0) {
            entry.env = { ...entry.env, ...envVars };
            this.logger.debug(
              { app: entry.name, envCount: Object.keys(envVars).length },
              'Injected resolved infrastructure config as env vars'
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          { app: entry.name, error: (err as Error).message },
          'Failed to resolve infrastructure config — app will use its own config sources'
        );
      }
    }

    // Build all entry points via esbuild (dev mode bundles from source .ts)
    if (definition && this.devMode) {
      try {
        if (!this.buildService) {
          this.buildService = new BuildService(/* isDev */ true);
        }
        const buildResult = await this.buildService.buildApp(entry.name, bootstrapAbsPath, definition);
        this.buildResults.set(entry.name, buildResult);
        this.logger.info(
          { app: entry.name, modules: buildResult.modulePaths.size },
          'Built entry points via esbuild'
        );

        // Start esbuild watch for incremental rebuilds on source changes.
        // On rebuild → restart the app (stop + re-build + re-launch).
        await this.buildService.watchApp(entry.name, bootstrapAbsPath, definition, () => {
          this.logger.info({ app: entry.name }, 'esbuild rebuild detected — restarting');
          this.restartApp(entry.name).catch((err) => {
            this.logger.error(
              { app: entry.name, error: (err as Error).message },
              'Restart after esbuild rebuild failed'
            );
          });
        });
      } catch (err) {
        this.logger.error(
          { app: entry.name, error: (err as Error).message },
          'esbuild failed — child processes will fall back to tsx'
        );
      }
    }

    const buildResult = this.buildResults.get(entry.name);
    // Use bundled bootstrap path for topology import when available
    const effectiveBootstrapPath = buildResult?.bootstrapPath ?? bootstrapAbsPath;

    if (topology && topology.length > 0) {
      await this.launchTopology(entry, handle, config, effectiveBootstrapPath, topology, buildResult);
    } else {
      await this.launchSingleProcess(entry, handle, config, effectiveBootstrapPath, buildResult);
    }
  }

  /**
   * Launch app with process topology — multiple children managed by Omnitron.
   *
   * All processes use BOOTSTRAP_PROCESS_PATH with { bootstrapPath, processName } dependencies.
   * The BootstrapProcess finds its own entry, imports the module, and wires transports.
   *
   * Processes with `instances > 1` are launched as PM pools with load balancing.
   * Processes with `topology.access` get Netron-native proxies via daemon socket.
   * Processes with `topology.expose` auto-expose their @Service on daemon Netron.
   *
   * Service metadata is auto-discovered from pool workers — no manual `exports`
   * config needed. The @Service decorator on the worker IS the source of truth.
   */
  private async launchTopology(
    entry: IEcosystemAppEntry,
    handle: AppHandle,
    config: IEcosystemConfig,
    bootstrapAbsPath: string,
    topology: IProcessEntry[],
    buildResult?: BuildResult
  ): Promise<void> {
    const policy = buildRestartPolicy(entry, config);

    if (!this.daemonNetron || !this.daemonSocketPath) {
      throw new Error(
        `Cannot launch topology for '${entry.name}': daemon Netron not available. ` +
        'Ensure setDaemonNetron() is called before starting apps.'
      );
    }

    const serviceRouter = new ServiceRouter(this.daemonNetron, this.logger);
    const daemonSocketUrl = `unix://${this.daemonSocketPath}`;

    // Topology startup order: providers (topology.expose) before consumers (topology.access).
    // Providers register their @Service on daemon Netron via ServiceRouter.
    // Consumers connect to daemon and queryInterface() for those services.
    // Currently only pool processes support topology.expose (ServiceRouter wraps pool.execute).
    const poolEntries = topology.filter((p) => (p.instances ?? 1) > 1);
    const singleEntries = topology.filter((p) => (p.instances ?? 1) <= 1);

    // Step 1: Create PM pools — must complete before Step 2 so services are available
    // Pools with topology.expose auto-discover @Service metadata from the first
    // worker via getExposedServices() and register on daemon Netron via ServiceRouter.
    const poolNames: string[] = [];

    for (const procEntry of poolEntries) {
      const instances = procEntry.instances!;
      const topologyAccess = procEntry.topology?.access ?? [];
      const bundledModulePath = buildResult?.modulePaths.get(procEntry.name);

      const poolOptions: IProcessPoolOptions = {
        size: instances,
        strategy: PoolStrategy.POWER_OF_TWO,
        metrics: true,
        replaceUnhealthy: true,
        requestTimeout: 120_000,
        maxQueueSize: 200,
        spawnOptions: {
          name: `${entry.name}/${procEntry.name}`,
          version: '1.0.0',
          allMethodsPublic: true,
          startupTimeout: procEntry.startupTimeout ?? 60_000,
          ...(entry.env && { env: entry.env as Record<string, string> }),
          ...((entry as any).cwd && { cwd: (entry as any).cwd }),
          dependencies: {
            bootstrapPath: bootstrapAbsPath,
            processName: procEntry.name,
            ...(bundledModulePath && { bundledModulePath }),
            ...(topologyAccess.length > 0 && {
              __daemonSocketUrl: daemonSocketUrl,
              __topologyConnects: topologyAccess,
            }),
          },
          health: {
            enabled: procEntry.health?.enabled !== false,
            interval: procEntry.health?.interval ?? config.monitoring.healthCheck.interval,
            timeout: procEntry.health?.timeout ?? config.monitoring.healthCheck.timeout,
          },
          observability: { metrics: true },
        },
        healthCheck: {
          enabled: procEntry.health?.enabled !== false,
          interval: procEntry.health?.interval ?? config.monitoring.healthCheck.interval,
        },
        autoScale: procEntry.scaling?.strategy === 'auto'
          ? {
              enabled: true,
              min: 1,
              max: procEntry.scaling?.maxInstances ?? instances * 4,
              targetCPU: procEntry.scaling?.targetCPU ?? 70,
              targetMemory: procEntry.scaling?.targetMemory ?? 80,
              queueThreshold: procEntry.scaling?.queueThreshold ?? 10,
              cooldownPeriod: procEntry.scaling?.cooldownPeriod ?? 30_000,
            }
          : {
              enabled: true,
              min: 1,
              max: instances * 4,
              targetCPU: 70,
              targetMemory: 80,
              queueThreshold: 10,
              cooldownPeriod: 30_000,
            },
      };

      this.logger.info(
        { app: entry.name, process: procEntry.name, instances },
        'Creating topology process pool'
      );

      // pm.pool() returns a Proxy wrapping ProcessPool — execute() dispatches to pool workers
      const pool = await this.pm.pool(BOOTSTRAP_PROCESS_PATH, poolOptions) as unknown as
        ProcessPool<unknown> & { execute(method: string, ...args: unknown[]): Promise<unknown> };
      poolNames.push(procEntry.name);

      // Auto-discover @Service metadata from pool workers and expose via ServiceRouter.
      // No manual `exports` needed — @Service decorator IS the source of truth.
      // Requires explicit `topology: { expose: true }` — opt-in for security.
      if (procEntry.topology?.expose === true) {
        try {
          let services = await pool.execute('getExposedServices') as
            Array<{ name: string; version?: string; methods: string[] }>;

          // Defensive: if services list is empty, the worker's Application may still
          // be registering services. Retry once after a short delay.
          if (!services || services.length === 0) {
            await new Promise((r) => setTimeout(r, 500));
            services = await pool.execute('getExposedServices') as
              Array<{ name: string; version?: string; methods: string[] }>;
          }

          if (!services || services.length === 0) {
            this.logger.warn(
              { app: entry.name, process: procEntry.name },
              'No @Service found on pool worker — topology.expose has no effect'
            );
          }

          for (const svc of services) {
            if (svc.methods.length === 0) continue;
            await serviceRouter.exposePoolService(
              procEntry.name,
              svc.name,
              svc.version ?? '1.0.0',
              pool as any,
              svc.methods
            );
            this.logger.info(
              { app: entry.name, process: procEntry.name, service: svc.name, methods: svc.methods.length },
              'Auto-discovered and exposed pool service on daemon Netron'
            );
          }
        } catch (err) {
          this.logger.error(
            { app: entry.name, process: procEntry.name, error: (err as Error).message },
            'Failed to auto-discover/expose pool services'
          );
        }
      }
    }

    // Step 2: Build supervisor children for single-instance processes
    const children: ISupervisorChildConfig[] = [];

    for (const procEntry of singleEntries) {
      const topologyAccess = procEntry.topology?.access ?? [];
      const bundledModulePath = buildResult?.modulePaths.get(procEntry.name);

      const spawnOpts = {
        name: `${entry.name}/${procEntry.name}`,
        version: '1.0.0',
        allMethodsPublic: true,
        startupTimeout: procEntry.startupTimeout ?? entry.startupTimeout ?? 30_000,
        ...(entry.env && { env: entry.env as Record<string, string> }),
        ...((entry as any).cwd && { cwd: (entry as any).cwd }),
        dependencies: {
          bootstrapPath: bootstrapAbsPath,
          processName: procEntry.name,
          ...(bundledModulePath && { bundledModulePath }),
          ...(topologyAccess.length > 0 && {
            __daemonSocketUrl: daemonSocketUrl,
            __topologyConnects: topologyAccess,
          }),
        },
        health: {
          enabled: procEntry.health?.enabled !== false,
          interval: procEntry.health?.interval ?? config.monitoring.healthCheck.interval,
          timeout: procEntry.health?.timeout ?? config.monitoring.healthCheck.timeout,
        },
        observability: { metrics: true },
      };

      children.push({
        name: `${entry.name}/${procEntry.name}`,
        process: BOOTSTRAP_PROCESS_PATH,
        spawnOptions: spawnOpts,
        critical: procEntry.critical ?? entry.critical ?? false,
      });
    }

    // Step 3: Create supervisor for single-instance children
    const supervisorConfig: ISupervisorConfig = {
      strategy: mapStrategy(config.supervision.strategy),
      maxRestarts: policy.maxRestarts ?? config.supervision.maxRestarts,
      window: policy.window ?? config.supervision.window,
      backoff: policy.backoff ?? config.supervision.backoff,
      children,
      onChildCrash: async (_child: ISupervisorChild, _error: Error): Promise<RestartDecision> => {
        // Always restart — supervisor's maxRestarts/window handles escalation.
        // Critical flag determines whether exceeding max restarts kills the app.
        return RestartDecision.RESTART;
      },
    };

    // Create supervisor WITHOUT starting — wire events first to avoid race condition
    const supervisor = this.pm.createSupervisor(supervisorConfig);

    supervisor.on('child:started', (childName: string) => {
      const processId = supervisor.getChildProcessId(childName);
      if (processId) {
        const workerHandle = this.pm.getWorkerHandle(processId);
        const info = this.pm.getProcess(processId);
        const childPid = workerHandle?.pid ?? info?.pid;
        handle.markOnline(childPid ?? process.pid);
      }
      this.persistState();
      this.emit('app:online', entry.name);
    });

    // Set supervisor on handle BEFORE start so attachLogCapture can access it
    handle.supervisor = supervisor;
    handle.serviceRouter = serviceRouter;
    handle.instanceCount = entry.instances ?? 1;
    handle.topologyProcesses = topology;

    this.wireSupervisorEvents(entry, handle, supervisor);

    // Now start — events will be captured correctly
    await supervisor.start();
  }

  /**
   * Launch single-process bootstrap app (no topology — original behavior).
   */
  private async launchSingleProcess(
    entry: IEcosystemAppEntry,
    handle: AppHandle,
    config: IEcosystemConfig,
    bootstrapAbsPath: string,
    buildResult?: BuildResult
  ): Promise<void> {
    const instances = entry.instances ?? 1;
    const policy = buildRestartPolicy(entry, config);

    // For single-process apps, use the first (only) process entry's bundled module
    const firstProcessName = buildResult?.modulePaths.keys().next().value;
    const bundledModulePath = firstProcessName
      ? buildResult?.modulePaths.get(firstProcessName)
      : undefined;

    const spawnOpts = {
      name: entry.name,
      version: '1.0.0',
      ...(entry.env && { env: entry.env as Record<string, string> }),
      dependencies: {
        bootstrapPath: bootstrapAbsPath,
        ...(bundledModulePath && { bundledModulePath }),
      },
      ...(entry.startupTimeout != null && { startupTimeout: entry.startupTimeout }),
      health: {
        enabled: true,
        interval: config.monitoring.healthCheck.interval,
        timeout: config.monitoring.healthCheck.timeout,
      },
      observability: { metrics: true },
    };

    const childConfig: ISupervisorChildConfig = {
      name: entry.name,
      process: BOOTSTRAP_PROCESS_PATH,
      spawnOptions: spawnOpts,
      critical: entry.critical ?? false,
    };

    if (instances > 1) {
      childConfig.poolOptions = {
        size: instances,
        strategy: PoolStrategy.ROUND_ROBIN,
        metrics: true,
        replaceUnhealthy: true,
        healthCheck: {
          enabled: true,
          interval: config.monitoring.healthCheck.interval,
        },
        spawnOptionsFactory: (index: number) => ({
          name: `${entry.name}-${index}`,
          ...(entry.env && { env: entry.env as Record<string, string> }),
          ...(entry.startupTimeout != null && { startupTimeout: entry.startupTimeout }),
          dependencies: {
            bootstrapPath: bootstrapAbsPath,
            ...(bundledModulePath && { bundledModulePath }),
            portOffset: index,
          },
          health: {
            enabled: true,
            interval: config.monitoring.healthCheck.interval,
            timeout: config.monitoring.healthCheck.timeout,
          },
          observability: { metrics: true },
        }),
      };
    }

    const supervisorConfig: ISupervisorConfig = {
      strategy: mapStrategy(config.supervision.strategy),
      maxRestarts: policy.maxRestarts ?? config.supervision.maxRestarts,
      window: policy.window ?? config.supervision.window,
      backoff: policy.backoff ?? config.supervision.backoff,
      children: [childConfig],
      onChildCrash: async (_child: ISupervisorChild, _error: Error): Promise<RestartDecision> => {
        // Always restart — supervisor's maxRestarts/window handles escalation.
        // Critical flag determines whether exceeding max restarts kills the app.
        return RestartDecision.RESTART;
      },
    };

    // Create supervisor WITHOUT starting — wire events first to avoid race condition
    const supervisor = this.pm.createSupervisor(supervisorConfig);

    // Wire supervisor events BEFORE start so we catch the initial child:started
    supervisor.on('child:started', (childName: string) => {
      const processId = supervisor.getChildProcessId(childName);
      if (processId) {
        // Prefer WorkerHandle.pid (actual child OS PID), fallback to IProcessInfo.pid
        const workerHandle = this.pm.getWorkerHandle(processId);
        const info = this.pm.getProcess(processId);
        const childPid = workerHandle?.pid ?? info?.pid;
        handle.markOnline(childPid ?? process.pid);
      }
      this.persistState();
      this.emit('app:online', entry.name);
    });

    // Set supervisor on handle BEFORE start so attachLogCapture can access it
    handle.supervisor = supervisor;
    handle.instanceCount = instances;

    this.wireSupervisorEvents(entry, handle, supervisor);

    // Now start — events will be captured correctly
    await supervisor.start();
  }

  /**
   * Wire common supervisor events (crash, restart, escalate) and log capture.
   */
  private wireSupervisorEvents(entry: IEcosystemAppEntry, handle: AppHandle, supervisor: any): void {
    supervisor.on('child:started', (childName: string) => {
      this.attachLogCapture(entry.name, childName, handle);
    });

    supervisor.on('child:crash', (childName: string, error: Error) => {
      // If app never reached 'online', mark as errored (not crashed — it never ran)
      if (handle.status === 'starting') {
        handle.markErrored();
      } else {
        handle.markCrashed();
      }
      this.logger.error({ app: entry.name, child: childName, error: error.message }, 'Process crashed');
      this.persistState();
      this.emit('app:crash', entry.name, error);
    });

    supervisor.on('child:restart', (childName: string, attempt: number) => {
      handle.restarts = attempt;
      this.logger.info({ app: entry.name, child: childName, attempt }, 'Process restarting');
      this.emit('app:restart', entry.name, attempt);
    });

    supervisor.on('escalate', (childName: string, _error: Error) => {
      handle.status = 'crashed';
      this.logger.error({ app: entry.name, child: childName }, 'App exceeded max restarts — escalated');
      this.persistState();
      this.emit('app:escalated', entry.name, childName);
    });
  }

  /**
   * Attach log capture to a child process's WorkerHandle.
   * Routes child stdout/stderr lines to AppHandle ring buffer for `getLogs()`.
   */
  private attachLogCapture(appName: string, childName: string, handle: AppHandle): void {
    const supervisor = handle.supervisor;
    if (!supervisor) return;

    const processId = supervisor.getChildProcessId(childName);
    if (!processId) return;

    const workerHandle = this.pm.getWorkerHandle(processId);
    if (!workerHandle?.onLog) return;

    workerHandle.onLog((line: string, _stream: 'stdout' | 'stderr') => {
      // In-memory ring buffer (for live CLI tailing)
      handle.appendLog(line);

      // Persist to disk via registered log handlers (LogManager)
      for (const handler of this.appLogHandlers) {
        try {
          handler(appName, line);
        } catch {
          // Log handler failure must not break the app
        }
      }
    });
  }



  // ============================================================================
  // Private — Classic mode
  // ============================================================================

  private async stopChildProcess(handle: AppHandle, force: boolean, timeout: number): Promise<void> {
    const child = handle.childProcess;
    if (!child || !child.pid) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // SIGKILL send is best-effort
        }
        resolve();
      }, timeout);

      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private async handleClassicCrash(
    entry: IEcosystemAppEntry,
    handle: AppHandle,
    config: IEcosystemConfig
  ): Promise<void> {
    const policy = buildRestartPolicy(entry, config);
    if (!policy.enabled) return;

    if (handle.restarts >= (policy.maxRestarts ?? 5)) {
      handle.status = 'crashed';
      this.logger.error({ app: entry.name }, 'Max restarts exceeded');
      this.emit('app:escalated', entry.name);
      return;
    }

    const backoff = policy.backoff ?? config.supervision.backoff;
    const delay = this.calculateBackoff(handle.restarts, backoff);
    this.logger.info({ app: entry.name, delay, attempt: handle.restarts + 1 }, 'Scheduling restart');

    const timer = setTimeout(async () => {
      // Guard: don't restart if orchestrator was stopped during backoff
      if (handle.status === 'stopping' || handle.status === 'stopped') return;
      try {
        handle.status = 'stopped';
        await this.startApp(entry, config);
      } catch (err) {
        this.logger.error({ app: entry.name, error: (err as Error).message }, 'Restart failed');
      }
    }, delay);

    // Allow cleanup on explicit stop
    handle.crashRestartTimer = timer;
  }

  private calculateBackoff(
    attempt: number,
    backoff: { type?: string; initial?: number; max?: number; factor?: number }
  ): number {
    const initial = backoff.initial ?? 1000;
    const max = backoff.max ?? 30_000;
    const factor = backoff.factor ?? 2;

    if (backoff.type === 'exponential') return Math.min(initial * Math.pow(factor, attempt), max);
    if (backoff.type === 'linear') return Math.min(initial * (attempt + 1), max);
    return initial;
  }

  /** Sample CPU/memory for a single OS process via `ps` (async — does not block event loop) */
  private async sampleProcessMetrics(pid: number): Promise<{ cpu: number; memory: number }> {
    try {
      const { execFile } = await import('node:child_process');
      const psOutput = await new Promise<string>((resolve, reject) => {
        execFile('ps', ['-p', String(pid), '-o', 'rss=,%cpu='], { timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      const [rssKb, cpuPercent] = psOutput.split(/\s+/);
      return {
        cpu: parseFloat(cpuPercent ?? '0'),
        memory: parseInt(rssKb ?? '0', 10) * 1024,
      };
    } catch {
      return { cpu: 0, memory: 0 };
    }
  }

  /** Periodic metrics polling for classic mode processes */
  private startMetricsPolling(interval: number): void {
    this.metricsTimer = setInterval(async () => {
      for (const handle of this.handles.values()) {
        if (handle.status !== 'online') continue;

        if (handle.mode === 'classic' && handle.childProcess?.pid) {
          const m = await this.sampleProcessMetrics(handle.childProcess.pid);
          handle.lastMetrics = { ...m, requests: 0, errors: 0 };
        } else if (handle.mode === 'bootstrap' && handle.pid) {
          const m = await this.sampleProcessMetrics(handle.pid);
          handle.lastMetrics = {
            ...m,
            requests: handle.lastMetrics?.requests ?? 0,
            errors: handle.lastMetrics?.errors ?? 0,
          };
        }
      }
    }, interval);
  }

  // ============================================================================
  // Private — Utilities
  // ============================================================================

  private toProcessInfo(handle: AppHandle): ProcessInfoDto {
    const info: ProcessInfoDto = {
      name: handle.name,
      pid: handle.pid,
      status: handle.status,
      cpu: handle.cpu,
      memory: handle.memory,
      uptime: handle.uptime,
      restarts: handle.restarts,
      instances: handle.instanceCount,
      port: handle.port,
      mode: handle.mode,
      critical: handle.entry.critical ?? false,
    };

    // Include sub-process topology if present
    if (handle.topologyProcesses && handle.topologyProcesses.length > 0 && handle.supervisor) {
      info.processes = [];
      for (const topo of handle.topologyProcesses) {
        const childNames = handle.supervisor.getChildNames();
        // Match topology entry to supervisor child by name
        const childName = childNames.find((cn) => cn.includes(topo.name)) ?? topo.name;
        const processId = handle.supervisor.getChildProcessId(childName);
        let childPid: number | null = null;
        let childStatus: AppStatus = 'stopped';

        if (processId) {
          const wh = this.pm.getWorkerHandle(processId);
          childPid = wh?.pid ?? null;
          childStatus = childPid ? 'online' : 'stopped';
        }

        // Derive process type from declarations for backward-compatible DTO
        const derivedType: 'server' | 'worker' | 'scheduler' | 'custom' =
          topo.transports ? 'server' : (topo.instances ?? 1) > 1 ? 'worker' : 'custom';

        info.processes.push({
          name: topo.name,
          type: derivedType,
          pid: childPid,
          status: childStatus,
          cpu: 0,
          memory: 0,
          uptime: handle.uptime,
          restarts: 0,
        });
      }
    }

    return info;
  }

  private persistState(): void {
    try {
      this.stateStore.save({
        version: CLI_VERSION,
        updatedAt: Date.now(),
        apps: Array.from(this.handles.values()).map(
          (h): PersistedAppState => ({
            name: h.name,
            pid: h.pid,
            status: h.status,
            mode: h.mode,
            startedAt: h.startedAt,
            restarts: h.restarts,
            port: h.port,
          })
        ),
      });
    } catch (err) {
      this.logger.warn({ error: (err as Error).message }, 'Failed to persist state');
    }
  }
}

type PersistedAppState = import('../daemon/state-store.js').PersistedAppState;
