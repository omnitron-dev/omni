import { parsePoolScaleRequest, assertPoolScaleTarget } from '../shared/pool-scale.js';
/**
 * DaemonRpcService — Netron RPC service exposed by the daemon
 *
 * Implements IDaemonService interface. CLI communicates with daemon
 * exclusively through this Netron service:
 * - Local: Unix socket transport (CLI on same host)
 * - Remote: TCP transport (fleet operations across servers)
 *
 * RBAC roles:
 *   - Public (anonymous): ping
 *   - Viewer (admin+operator+viewer): list, status, getApp, getMetrics, getHealth, getLogs, inspect, getEnv, getWatchStatus
 *   - Operator (admin+operator): startApp, stopApp, restartApp, reloadApp, startAll, stopAll, restartAll, scale, enableWatch, disableWatch
 *   - Admin (admin only): shutdown, reloadConfig, exec
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { callExposedService, type ExposingSupervisor } from '../orchestrator/call-exposed-service.js';
import type { IDaemonService } from '../shared/dto/services.js';
import type {
  ProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
  ChildDiagnosticsDto,
  PoolDiagnosticsDto,
  LogPathsDto,
} from '../config/types.js';
import { configuredStartEntry, withDefaultStack } from '../orchestrator/app-name.js';
import { worstVerdict } from '../orchestrator/app-health.js';
import { redactEnv } from '../shared/redact-env.js';
import type { AuditService } from '../services/audit.service.js';
import type { OrchestratorControl as OrchestratorService } from '../orchestrator/execution-contract.js';
import type { IHealthService } from '@omnitron-dev/titan-health';
import type { LogManager } from '../monitoring/log-manager.js';
import type { IEcosystemConfig } from '../config/types.js';
import { CLI_VERSION, DAEMON_SERVICE_ID } from '../config/defaults.js';
import { OWN_BUILD } from '../shared/build-stamp.js';
import { runtimeDiagnostics } from '../monitoring/runtime-diagnostics.js';
import { loadStartupEcosystem } from './startup-config.js';
import type { OmnitronDaemon } from './daemon.js';
import { OPERATOR_ROLES, ADMIN_ROLES, CONTROL_PLANE_READ_ROLES, CONTROL_PLANE_ROLES } from '../shared/roles.js';

@Service({ name: DAEMON_SERVICE_ID })
export class DaemonRpcService implements IDaemonService {
  private readonly startedAt = Date.now();

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async inspectInstalledArtifacts(data: { names: string[] }) {
    const { inspectInstalledArtifacts } = await import('../release/installed-artifacts.js');
    return inspectInstalledArtifacts(this.orchestrator, data?.names);
  }

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly titanHealth: IHealthService,
    private readonly logManager: LogManager,
    private config: IEcosystemConfig,
    private readonly daemon: OmnitronDaemon,
    private readonly assertLifecycleMutable?: () => void,
  ) {}

  // ============================================================================
  // Process Management (Operator: admin + operator)
  // ============================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startApp(data: { name: string }): Promise<ProcessInfoDto> {
    this.assertLifecycleMutable?.();
    const known = this.orchestrator.getApp(data.name);
    if (known) {
      if (known.status === 'online' || known.status === 'starting') return known;
      const started = await this.orchestrator.startKnownApp(known.name);
      const observed = started && this.orchestrator.getApp(known.name);
      if (!observed) throw Errors.notFound('Registered application', known.name);
      return observed;
    }
    const entry = configuredStartEntry(data.name, this.config);
    if (entry) {
      await this.orchestrator.startApp(entry);
      const observed = this.orchestrator.getApp(entry.name);
      if (!observed) throw Errors.notFound('Started application', entry.name);
      return observed;
    }
    if (data.name.includes('/')) {
      const [project, stack] = data.name.split('/');
      throw Errors.notFound('App', data.name + ' — no registered handle or matching declaration. Use `omnitron stack start ' +
        project + ' ' + stack + '` to start that stack.');
    }
    throw Errors.notFound('App', data.name);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startAll(): Promise<ProcessInfoDto[]> {
    this.assertLifecycleMutable?.();
    // Bulk startup must carry the same project/stack identity as a single-app
    // start. Preserve declared names/dependencies for startup ordering; the owner
    // promotes each entry when it registers the actual process handle.
    await this.orchestrator.startAll({ ...this.config, apps: this.config.apps.map(entry => withDefaultStack(entry, this.config)) });
    return this.orchestrator.list();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopApp(data: { name: string; force?: boolean; timeout?: number }): Promise<{ success: boolean; error?: string }> {
    // P1-H — let the operator distinguish "stop happened" from
    // "stop tried and SIGKILL failed". Pre-fix this always returned
    // {success: true} regardless of whether stopChild swallowed an
    // exception; UI rendered "stopped" while `ps` still showed the
    // process. Now we surface stopChild errors explicitly without
    // throwing — Netron clients see a structured payload they can
    // render, and the typed return preserves back-compat for
    // callers that only checked `success`.
    try {
      this.assertLifecycleMutable?.();
      await this.orchestrator.stopApp(data.name, data.force, data.timeout);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopAll(data: { force?: boolean }): Promise<{ count: number }> {
    this.assertLifecycleMutable?.();
    const count = await this.orchestrator.stopAll(data.force);
    return { count };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async restartApp(data: { name: string }): Promise<ProcessInfoDto> {
    this.assertLifecycleMutable?.();
    await this.orchestrator.restartApp(data.name);
    return this.orchestrator.getApp(data.name)!;
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async restartAll(): Promise<ProcessInfoDto[]> {
    this.assertLifecycleMutable?.();
    const entries = this.config.apps;
    // P0-H — was a serial `for..await`. One hung app blocked the
    // entire fleet restart (the operator hits "Restart all" and the
    // whole UI stalls on apps[i+1..n]). Run in parallel with
    // allSettled + per-app deadline so a slow restart can't take
    // down the rest. Caller still sees the final fleet state via
    // `orchestrator.list()`; per-app failures surface in the daemon
    // log.
    const PER_APP_TIMEOUT_MS = 60_000;
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await Promise.race([
            this.orchestrator.restartApp(entry.name),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`restartApp(${entry.name}) timed out after ${PER_APP_TIMEOUT_MS}ms`)), PER_APP_TIMEOUT_MS),
            ),
          ]);
        } catch (err) {
           
          console.warn(
            `[daemon.restartAll] ${entry.name} failed: ${(err as Error).message} — continuing`,
          );
        }
      }),
    );
    return this.orchestrator.list();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async reloadApp(data: { name: string }): Promise<ProcessInfoDto> {
    this.assertLifecycleMutable?.();
    await this.orchestrator.reloadApp(data.name);
    return this.orchestrator.getApp(data.name)!;
  }

  // ============================================================================
  // Information (Viewer: admin + operator + viewer)
  // ============================================================================

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async list(): Promise<ProcessInfoDto[]> {
    return this.orchestrator.list();
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getApp(data: { name: string }): Promise<ProcessInfoDto> {
    const info = this.orchestrator.getApp(data.name);
    if (!info) throw Errors.notFound('App', data.name);
    return info;
  }

  @Public({ auth: { roles: CONTROL_PLANE_ROLES } })
  attestApplicationOwner(data: import('../shared/dto/backend.js').ApplicationOwnerObservation) {
    return this.daemon.attestApplicationOwner(data);
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async status(): Promise<DaemonStatusDto> {
    const apps = this.orchestrator.list();
    const totalCpu = apps.reduce((sum, a) => sum + a.cpu, 0);
    const appsMemory = apps.reduce((sum, a) => sum + a.memory, 0);
    const daemonMemory = process.memoryUsage.rss();

    return {
      version: CLI_VERSION,
      // Which commit is running: the package version is 0.2.0 on every build.
      build: OWN_BUILD,
      execution: this.daemon.backendRuntimeStatus(),
      pid: process.pid,
      uptime: Date.now() - this.startedAt,
      apps,
      totalCpu,
      // Kept for older readers: apps AND daemon. `omnitron status` printed
      // it in the «Omnitron Daemon» box as the daemon's memory — 2.4 GB for a
      // daemon whose own RSS was 254 MB (2,808,774,656 = apps 2,555,019,264 +
      // daemon 253,755,392, byte for byte). The two parts are named below.
      totalMemory: appsMemory + daemonMemory,
      daemonMemory,
      appsMemory,
    };
  }

  // ============================================================================
  // Monitoring (Viewer: admin + operator + viewer)
  // ============================================================================

  /**
   * Each app's resources and traffic.
   *
   * Traffic is what the app's processes reported their transports answered
   * (`reportTraffic`). This used to pass `requests`/`errors` through with
   * `?? 0` and drop `latency`: the counts were the supervisor's own calls to
   * the process wrapper (one more for every `omnitron inspect --graph`), an
   * app that reported nothing read as zero, and MEAN/P95/P99 were never
   * filled. An unknown name is refused rather than answered with nothing.
   */
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getMetrics(data: { name?: string }): Promise<AggregatedMetricsDto> {
    const raw = await this.orchestrator.getMetrics(data.name);
    if (data.name !== undefined && Object.keys(raw).length === 0) {
      throw Errors.notFound('App', data.name);
    }
    const apps: AggregatedMetricsDto['apps'] = {};
    let totalCpu = 0;
    let totalMemory = 0;

    for (const [name, m] of Object.entries(raw)) {
      const t = m?.traffic;
      apps[name] = {
        cpu: m?.cpu ?? 0,
        memory: m?.memory ?? 0,
        traffic: t ? 'measured' : 'not-reported',
        ...(t
          ? {
              requests: t.requests,
              errors: t.serverErrors,
              clientErrors: t.clientErrors,
              probes: t.probes,
              ...(t.held !== undefined ? { held: t.held } : {}),
              latency: t.latency
                ? {
                    p50: t.latency.p50,
                    p95: t.latency.p95,
                    p99: t.latency.p99,
                    mean: t.latency.mean,
                    max: t.latency.max,
                    count: t.latency.count,
                    windowMs: t.latency.windowMs,
                  }
                : null,
            }
          : {}),
      };
      totalCpu += m?.cpu ?? 0;
      totalMemory += m?.memory ?? 0;
    }

    return { timestamp: Date.now(), apps, totals: { cpu: totalCpu, memory: totalMemory } };
  }

  /**
   * The daemon's own indicators, and each app as the app answered.
   *
   * This returned the daemon's titan-health indicators under `apps` — one
   * «app» per indicator — and never asked an app anything: `omnitron health`
   * read «Apps: 5 healthy» beside six apps, and `omnitron health main`
   * printed the daemon's memory for a question about `main`.
   */
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getHealth(data: { name?: string }): Promise<AggregatedHealthDto> {
    const answered = await this.orchestrator.getHealth(data.name);
    if (data.name !== undefined && Object.keys(answered).length === 0) {
      throw Errors.notFound('App', data.name);
    }

    const apps: AggregatedHealthDto['apps'] = {};
    for (const [name, health] of Object.entries(answered)) {
      apps[name] = health
        ? {
            status: health.status,
            checks: health.checks.map((c) => ({ name: c.name, status: c.status, ...(c.message ? { message: c.message } : {}) })),
          }
        : { status: 'degraded', checks: [{ name: 'health', status: 'warn', message: 'this app has not answered a health question yet' }] };
    }

    let daemon: AggregatedHealthDto['daemon'];
    if (data.name === undefined) {
      const result = await this.titanHealth.check();
      daemon = {
        status: result.status,
        ...(runtimeDiagnostics.snapshot().active.length ? { diagnostics: runtimeDiagnostics.snapshot().active } : {}),
        indicators: Object.entries(result.indicators).map(([name, indicator]) => ({
          name,
          status: indicator.status === 'healthy' ? 'pass' : indicator.status === 'degraded' ? 'warn' : 'fail',
          ...(indicator.message ? { message: indicator.message } : {}),
        })),
      };
    }

    const overall = worstVerdict([...(daemon ? [daemon.status] : []), ...Object.values(apps).map((a) => a.status)]);
    return { timestamp: Date.now(), overall, ...(daemon ? { daemon } : {}), apps };
  }


  /**
   * An app's latest records: from this daemon's capture when it runs the app,
   * otherwise from the rows stored in the log table — which is where the
   * nodes' synced logs live.
   *
   * This read the local capture only, so every app on another machine had no
   * logs: `omnitron logs sample/deployed/main` answered «No log entries found»
   * while `OmnitronLogs.queryLogs` on this same daemon returned that app's
   * rows from node 16f3dd5a. Each stored entry says where it came from in
   * `data.sourceNode` — the node's id, or `null` for this machine's own.
   *
   * Nodes name what they run `<project>/deployed/<app>`; that is the name
   * their rows carry and the one this answers to. Mapping a stack's name
   * (`sample/test/main`) onto it needs the stack's nodes, which this service
   * cannot see — `omnitron logs` asks the project for them and comes back
   * with the node's name.
   */
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getLogs(data: { name?: string; lines?: number }): Promise<LogEntryDto[]> {
    const local = this.logManager.getLogs(data.name, data.lines);
    if (data.name === undefined || local.length > 0) return local;
    // A retained handle can belong to a crashed process, or to a process
    // adopted after handoff. An empty volatile buffer is not empty history.
    return this.logStore
      ? this.logStore.storedEntries(data.name, data.lines ?? 100, !!this.orchestrator.getHandle(data.name))
      : local;
  }

  /** Where the stored rows are — the daemon hands it over once it has one (`daemon.ts`). */
  private logStore: { storedEntries(app: string, lines: number, localOnly?: boolean): Promise<LogEntryDto[]> } | null = null;

  setLogStore(store: { storedEntries(app: string, lines: number, localOnly?: boolean): Promise<LogEntryDto[]> }): void {
    this.logStore = store;
  }

  // ============================================================================
  // Scaling (Operator: admin + operator)
  // ============================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async scale(data: { name: string; instances: number; process?: string }): Promise<ProcessInfoDto> {
    this.assertLifecycleMutable?.();
    const request = parsePoolScaleRequest(data);
    assertPoolScaleTarget(this.orchestrator.getApp(request.name), request);
    try {
      await this.orchestrator.scaleApp(request.name, request.instances, request.process);
      const observed = this.orchestrator.getApp(request.name)!;
      await this.audit?.record({ action: 'app.pool.resize', resourceType: 'app', resourceId: observed.name,
        details: { process: request.process, requested: request.instances,
          observed: observed.processes?.find(item => item.name === request.process)?.instances, lifetime: 'until-restart' }, outcome: 'ok' });
      return observed;
    } catch (error) {
      await this.audit?.record({ action: 'app.pool.resize', resourceType: 'app', resourceId: request.name,
        details: { process: request.process, requested: request.instances, lifetime: 'until-restart' }, outcome: 'failed', error });
      throw error;
    }
  }

  // ============================================================================
  // Lifecycle (Mixed: ping is public, shutdown/reloadConfig are admin)
  // ============================================================================

  @Public({ auth: { allowAnonymous: true } })
  async ping(): Promise<{ uptime: number; version: string; pid: number }> {
    return {
      uptime: Date.now() - this.startedAt,
      version: CLI_VERSION,
      pid: process.pid,
    };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async shutdown(_data: { force?: boolean }): Promise<{ success: boolean }> {
    this.assertLifecycleMutable?.();
    // Defer shutdown to allow RPC response to be sent first.
    // Application's shutdown system handles process.exit() automatically.
    setTimeout(() => {
      this.daemon.stop().catch(() => process.exit(1));
    }, 100);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async reloadConfig(): Promise<{ success: boolean }> {
    this.assertLifecycleMutable?.();
    // OS services often start in the user's home, rather than the registered
    // project. Reload and cold start must resolve the same configuration and
    // retain the same runtime project identity.
    const newConfig = await loadStartupEcosystem(process.cwd());
    // P0-G — push the new config into the orchestrator too. Pre-fix
    // these two refs drifted: daemon.startApp read the new entries,
    // orchestrator.restartApp kept reading the old ones (mode, env,
    // dependsOn, restart policy all silently stale until next daemon
    // restart).
    await this.orchestrator.setConfig(newConfig);
    this.config = newConfig;
    // Same omission as the config refs above, one layer out: the file
    // watcher keeps its own app list, so without this a reload changed
    // which apps get restarted but not which are watched.
    await this.daemon.applyWatchConfig(newConfig);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async setMetricsEnabled(data: { name?: string; enabled: boolean }): Promise<{ success: boolean }> {
    await this.orchestrator.setMetricsEnabled(data.name, data.enabled);
    return { success: true };
  }

  // ============================================================================
  // Diagnostics (inspect is viewer, exec is admin)
  // ============================================================================

  /**
   * Live DI graph for a single app — used by `omnitron inspect <app> --graph`.
   * Returns null if the app isn't running or doesn't expose
   * `getDependencyGraph` (legacy bootstraps).
   */
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getDependencyGraph(data: { name: string }): Promise<{
    nodes: Array<{ id: string; label?: string; type?: string }>;
    edges: Array<{ from: string; to: string; type?: 'dependency' | 'parent' }>;
  } | null> {
    return this.orchestrator.getDependencyGraph(data.name);
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async inspect(data: { name: string }): Promise<AppDiagnosticsDto> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw Errors.notFound('App', data.name);

    // The app's resident memory is every process it runs — supervisor
    // children and pool workers — sampled in one `ps` by the code `list`
    // reads (`sampleAppMetrics`), which also leaves each entry's share in
    // `handle.childMetrics`. This used to `ps` the single pid on the handle:
    // one process, and the app's last child rather than its server —
    // «Memory RSS 157.2MB» for a quotes of ~508 MB. Keyed by the
    // handle's own name, because `data.name` is what the operator typed and
    // `main` is not a key of the answer. A stopped app has no processes; its
    // last sample is history, not memory.
    const metricsMap = await this.orchestrator.getMetrics(handle.name);
    const appMetrics = metricsMap[handle.name];
    const memory = {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      arrayBuffers: 0,
      rss: handle.status === 'stopped' ? 0 : (appMetrics?.memory ?? 0),
    };
    const sampledRss = (entryName: string): number | undefined =>
      handle.status === 'stopped' ? undefined : handle.childMetrics.get(entryName)?.memory;
    const secondsSince = (startTime: unknown): number | undefined =>
      typeof startTime === 'number' ? Math.floor((Date.now() - startTime) / 1000) : undefined;

    // T#66: per-child diagnostic surface. The legacy `services`
    // flat list collapsed every child's service name into a single
    // dedupe-less array — when 4 bootstrap children all exposed
    // `BootstrapApp` (Titan's default Application service name)
    // operators saw `BootstrapApp@1.0.0` four times with no way to
    // tell which child each entry referred to. The new `children`
    // array is keyed by supervisor child name (e.g. "http",
    // "captcha-generator") and carries OS pid + processId + uptime.
    const children: ChildDiagnosticsDto[] = [];
    const services: string[] = [];
    if (handle.mode === 'bootstrap' && handle.supervisor) {
      const childNames = handle.supervisor.getChildNames();
      for (const childName of childNames) {
        // A pool child's proxy answers `__processId` with a function.
        const rawId: unknown = handle.supervisor.getChildProcessId(childName);
        const processId = typeof rawId === 'string' ? rawId : undefined;
        const workerHandle = processId ? this.orchestrator.getWorkerHandle(processId) : undefined;
        const procInfo = processId ? this.orchestrator.getChildProcessInfo(processId) : undefined;
        const uptimeSeconds = secondsSince(procInfo?.startTime);
        // `childMetrics` is keyed by topology entry; a supervisor child is
        // named `${app}/${entry}`, or by the app alone when it has no topology.
        const prefix = `${handle.name}/`;
        const rss = sampledRss(childName.startsWith(prefix) ? childName.slice(prefix.length) : childName);
        const entry: ChildDiagnosticsDto = {
          name: childName,
          pid: workerHandle?.pid ?? null,
          ...(processId && { processId }),
          ...(workerHandle?.serviceName && { serviceName: workerHandle.serviceName }),
          ...(workerHandle?.serviceVersion && { serviceVersion: workerHandle.serviceVersion }),
          ...(uptimeSeconds !== undefined && { uptimeSeconds }),
          ...(rss !== undefined && { rss }),
        };
        children.push(entry);
        if (workerHandle?.serviceName) {
          services.push(`${workerHandle.serviceName}@${workerHandle.serviceVersion}`);
        }
      }
    }

    // Pools are not supervisor children, so the walk above never saw them —
    // storage's two transform workers were in no section of this answer.
    const pools: PoolDiagnosticsDto[] = [];
    for (const [poolName, pool] of handle.topologyPools) {
      const workers = pool.getWorkerIds().map((workerId) => {
        const uptimeSeconds = secondsSince(this.orchestrator.getChildProcessInfo(workerId)?.startTime);
        return {
          pid: this.orchestrator.getWorkerHandle(workerId)?.pid ?? null,
          processId: workerId,
          ...(uptimeSeconds !== undefined && { uptimeSeconds }),
        };
      });
      const rss = sampledRss(poolName);
      pools.push({
        name: poolName,
        declaredInstances: handle.topologyProcesses?.find((p) => p.name === poolName)?.instances ?? workers.length,
        workers,
        ...(rss !== undefined && { rss }),
      });
    }

    // T#66: log paths. Project-mode apps live under
    // ~/.omnitron/projects/{project}/{stack}/logs/{app}/, standalone
    // apps under ~/.omnitron/logs/{app}/. The exact resolution is
    // LogManager's responsibility — we just surface the result so
    // operators don't have to memorise which layout an app uses.
    //
    // `handle.name`, NOT `data.name`. LogManager picks the layout by
    // counting slashes, so it needs the fully-qualified name the writer
    // uses; `data.name` is whatever the operator typed. `omnitron inspect
    // main` therefore reported ~/.omnitron/logs/main/app.log while the app
    // was writing to ~/.omnitron/projects/acme/dev/logs/main/app.log — and
    // the reported file EXISTS, left over from the standalone era and full
    // of real log lines from days earlier, so tailing it during an incident
    // looks like an app that has gone quiet. `getLogFilePath` also mkdirs
    // its answer, so asking the wrong question created the decoy directory.
    // `getHandle` already resolves a bare name (see its comment — the same
    // bug was fixed for `omnitron env main`), so the qualified name is
    // right here.
    const logPaths: LogPathsDto = {
      app: this.logManager.getLogFilePath(handle.name, 'app'),
      error: this.logManager.getLogFilePath(handle.name, 'error'),
    };

    // From the entry the app was started with. This looked the name up in
    // the daemon's own config, which holds bare names and none of a
    // project's apps — `config: {}` for `main` and `sample/dev/main` alike.
    const entry = handle.entry;
    const appConfig: Record<string, unknown> = {
      mode: handle.mode,
      instances: handle.instanceCount ?? 1,
      critical: entry.critical ?? false,
      ...(handle.port && { port: handle.port }),
      ...(entry.bootstrap && { bootstrap: entry.bootstrap }),
    };

    return {
      name: handle.name,
      pid: handle.pid,
      status: handle.status,
      memory,
      uptime: handle.uptime,
      restarts: handle.restarts,
      services,
      children,
      pools,
      logPaths,
      config: appConfig,
      // Surface the crash context when the app is dead so
      // `omnitron inspect` can render exit code + signal +
      // stderr tail without a separate RPC round-trip.
      ...(handle.lastExit && { lastExit: { ...handle.lastExit } }),
    };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async exec(data: { name: string; service: string; method: string; args: unknown[] }): Promise<unknown> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw Errors.notFound('App', data.name);
    if (handle.status !== 'online') throw Errors.conflict(`App '${data.name}' is not online`);

    if (handle.mode === 'bootstrap' && handle.supervisor) {
      return this.execInBootstrapApp(handle.supervisor, data);
    }

    if (!handle.port) throw Errors.conflict(`App '${data.name}' has no port configured`);

    const { HttpConnection } = await import('@omnitron-dev/titan/netron/transport/http');
    const connection = new HttpConnection(`http://127.0.0.1:${handle.port}`, { timeout: 30_000 });

    try {
      const service = await connection.queryInterface(data.service);
      const fn = (service as any)[data.method];
      if (typeof fn !== 'function') throw Errors.notFound('Method', `${data.service}.${data.method}`);
      return await fn.call(service, ...data.args);
    } finally {
      try {
        await connection.close();
      } catch {
        // connection cleanup is best-effort
      }
    }
  }

  /** A bootstrap app's call, through the one road `exec` and the alert sink share. */
  private async execInBootstrapApp(
    supervisor: NonNullable<ReturnType<OrchestratorService['getHandle']>>['supervisor'] & object,
    data: { name: string; service: string; method: string; args: unknown[] },
  ): Promise<unknown> {
    return callExposedService(supervisor as ExposingSupervisor, data.name, data.service, data.method, data.args);
  }

  /**
   * An app's environment with its secrets replaced (`redactEnv`): by key name,
   * and the password inside a URL-shaped value. This returned every value in
   * clear to anyone with the operator role — `omnitron env main` printed
   * JWT_SECRET and the database password — and `inspect` masked by key name
   * alone, which left the password in `DATABASE_URL` on the screen.
   */
  @Public({ auth: { roles: CONTROL_PLANE_ROLES } })
  async getEnv(data: { name: string }): Promise<Record<string, string>> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw Errors.notFound('App', data.name);
    return redactEnv(handle.entry.env ?? {});
  }

  /**
   * The clear values — admin only, and recorded in the audit trail with who
   * asked, because once shown they cannot be taken back.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async revealEnv(data: { name: string }): Promise<Record<string, string>> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw Errors.notFound('App', data.name);
    const env = handle.entry.env ?? {};
    if (!this.audit) throw new Error('Audit storage is required to reveal environment values');
    await this.audit.record({
      action: 'app.env.reveal',
      resourceType: 'app',
      resourceId: handle.name,
      details: { keys: Object.keys(env).length },
    }, true);
    return { ...env };
  }

  private audit: AuditService | undefined;

  /** Wired once the audit trail is up; a daemon without one reveals nothing it could not record. */
  setAudit(audit: AuditService): void {
    this.audit = audit;
  }

  // ============================================================================
  // Watch Mode (Operator: admin + operator)
  // ============================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async enableWatch(data: { apps?: string[] }): Promise<{ watching: Array<{ name: string; directory: string }> }> {
    this.assertLifecycleMutable?.();
    const watching = await this.daemon.enableWatch(data.apps);
    return { watching };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async disableWatch(): Promise<{ success: boolean }> {
    await this.daemon.disableWatch();
    return { success: true };
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getWatchStatus(): Promise<{ enabled: boolean; watching: boolean; reason?: string; apps: Array<{ name: string; directory: string }> }> {
    return this.daemon.getWatchStatus();
  }
}
