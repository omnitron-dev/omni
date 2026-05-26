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
import type { IDaemonService } from '../shared/dto/services.js';
import type {
  ProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
  ChildDiagnosticsDto,
  LogPathsDto,
} from '../config/types.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { IHealthService } from '@omnitron-dev/titan-health';
import type { LogManager } from '../monitoring/log-manager.js';
import type { IEcosystemConfig } from '../config/types.js';
import { CLI_VERSION, DAEMON_SERVICE_ID } from '../config/defaults.js';
import { loadEcosystemConfig } from '../config/loader.js';
import type { OmnitronDaemon } from './daemon.js';
import { VIEWER_ROLES, OPERATOR_ROLES, ADMIN_ROLES } from '../shared/roles.js';

@Service({ name: DAEMON_SERVICE_ID })
export class DaemonRpcService implements IDaemonService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly titanHealth: IHealthService,
    private readonly logManager: LogManager,
    private config: IEcosystemConfig,
    private readonly daemon: OmnitronDaemon
  ) {}

  // ============================================================================
  // Process Management (Operator: admin + operator)
  // ============================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startApp(data: { name: string }): Promise<ProcessInfoDto> {
    const entry = this.config.apps.find((a) => a.name === data.name);
    if (!entry) throw Errors.notFound('App', data.name);

    // Inject project + default-stack context so `ensureNamespacedEntry`
    // promotes a bare-name `entry.name` to the canonical
    // `${project}/${stack}/${name}` form. Without this, every CLI
    // `omnitron start <bareName>` (and every webapp "Start" button)
    // registered handles under bare keys that the stack/project view
    // filtered out by prefix — same fault class as the user-reported
    // "main shows stopped" bug.
    const enriched = this.namespaceEntry(entry);
    await this.orchestrator.startApp(enriched);
    return this.orchestrator.getApp(data.name)!;
  }

  /**
   * Decorate an ecosystem entry with the daemon's default project +
   * stack env so downstream `ensureNamespacedEntry` promotes the
   * handle key. No-op when the entry already declares them or the
   * daemon config lacks a project name (multi-project deployments
   * MUST go through the stack-mode startStack path instead).
   */
  private namespaceEntry(entry: import('../config/types.js').IEcosystemAppEntry): import('../config/types.js').IEcosystemAppEntry {
    const project = this.config.project;
    if (!project) return entry;
    if (entry.env?.['OMNITRON_PROJECT'] && entry.env?.['OMNITRON_STACK']) return entry;
    const stacks = this.config.stacks ?? {};
    const stackKeys = Object.keys(stacks);
    const defaultStack = stackKeys.length === 1 ? stackKeys[0] : (stacks['dev'] ? 'dev' : stackKeys[0]);
    if (!defaultStack) return entry;
    return {
      ...entry,
      env: {
        ...entry.env,
        OMNITRON_PROJECT: project,
        OMNITRON_STACK: defaultStack,
      },
    };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startAll(): Promise<ProcessInfoDto[]> {
    await this.orchestrator.startAll(this.config);
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
      await this.orchestrator.stopApp(data.name, data.force, data.timeout);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopAll(data: { force?: boolean }): Promise<{ count: number }> {
    const count = await this.orchestrator.stopAll(data.force);
    return { count };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async restartApp(data: { name: string }): Promise<ProcessInfoDto> {
    await this.orchestrator.restartApp(data.name);
    return this.orchestrator.getApp(data.name)!;
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async restartAll(): Promise<ProcessInfoDto[]> {
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
          // eslint-disable-next-line no-console
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
    await this.orchestrator.reloadApp(data.name);
    return this.orchestrator.getApp(data.name)!;
  }

  // ============================================================================
  // Information (Viewer: admin + operator + viewer)
  // ============================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async list(): Promise<ProcessInfoDto[]> {
    return this.orchestrator.list();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getApp(data: { name: string }): Promise<ProcessInfoDto> {
    const info = this.orchestrator.getApp(data.name);
    if (!info) throw Errors.notFound('App', data.name);
    return info;
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async status(): Promise<DaemonStatusDto> {
    const apps = this.orchestrator.list();
    const totalCpu = apps.reduce((sum, a) => sum + a.cpu, 0);
    const totalMemory = apps.reduce((sum, a) => sum + a.memory, 0) + process.memoryUsage.rss();

    return {
      version: CLI_VERSION,
      pid: process.pid,
      uptime: Date.now() - this.startedAt,
      apps,
      totalCpu,
      totalMemory,
    };
  }

  // ============================================================================
  // Monitoring (Viewer: admin + operator + viewer)
  // ============================================================================

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getMetrics(data: { name?: string }): Promise<AggregatedMetricsDto> {
    const raw = await this.orchestrator.getMetrics(data.name);
    const apps: AggregatedMetricsDto['apps'] = {};
    let totalCpu = 0;
    let totalMemory = 0;

    for (const [name, m] of Object.entries(raw)) {
      apps[name] = {
        cpu: m?.cpu ?? 0,
        memory: m?.memory ?? 0,
        requests: m?.requests ?? 0,
        errors: m?.errors ?? 0,
      };
      totalCpu += m?.cpu ?? 0;
      totalMemory += m?.memory ?? 0;
    }

    return { timestamp: Date.now(), apps, totals: { cpu: totalCpu, memory: totalMemory } };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getHealth(_data: { name?: string }): Promise<AggregatedHealthDto> {
    const result = await this.titanHealth.check();

    // Map TitanHealth indicators to AggregatedHealthDto
    const apps: AggregatedHealthDto['apps'] = {};
    for (const [name, indicator] of Object.entries(result.indicators)) {
      const check: { name: string; status: 'pass' | 'warn' | 'fail'; message?: string } = {
        name,
        status: indicator.status === 'healthy' ? 'pass' : indicator.status === 'degraded' ? 'warn' : 'fail',
      };
      if (indicator.message) check.message = indicator.message;
      apps[name] = { status: indicator.status, checks: [check] };
    }

    return {
      timestamp: Date.now(),
      overall: result.status,
      apps,
    };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getLogs(data: { name?: string; lines?: number }): Promise<LogEntryDto[]> {
    return this.logManager.getLogs(data.name, data.lines);
  }

  // ============================================================================
  // Scaling (Operator: admin + operator)
  // ============================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async scale(data: { name: string; instances: number }): Promise<ProcessInfoDto> {
    await this.orchestrator.scaleApp(data.name, data.instances);
    return this.orchestrator.getApp(data.name)!;
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
    // Defer shutdown to allow RPC response to be sent first.
    // Application's shutdown system handles process.exit() automatically.
    setTimeout(() => {
      this.daemon.stop().catch(() => process.exit(1));
    }, 100);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async reloadConfig(): Promise<{ success: boolean }> {
    const newConfig = await loadEcosystemConfig();
    this.config = newConfig;
    // P0-G — push the new config into the orchestrator too. Pre-fix
    // these two refs drifted: daemon.startApp read the new entries,
    // orchestrator.restartApp kept reading the old ones (mode, env,
    // dependsOn, restart policy all silently stale until next daemon
    // restart).
    this.orchestrator.setConfig(newConfig);
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
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getDependencyGraph(data: { name: string }): Promise<{
    nodes: Array<{ id: string; label?: string; type?: string }>;
    edges: Array<{ from: string; to: string; type?: 'dependency' | 'parent' }>;
  } | null> {
    return this.orchestrator.getDependencyGraph(data.name);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async inspect(data: { name: string }): Promise<AppDiagnosticsDto> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw Errors.notFound('App', data.name);

    const metricsMap = await this.orchestrator.getMetrics(data.name);
    const appMetrics = metricsMap[data.name];

    const memory = { heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0, rss: 0 };
    if (handle.pid && handle.status === 'online') {
      // P1-G — async + cached. Pre-fix this issued `execSync('ps')`
      // on every inspect RPC, blocking the daemon event loop for
      // ~5-50 ms per call. The webapp polls inspect every ~5s and
      // multiple panels can fire concurrent inspects → daemon stalls
      // visibly on tab switches.
      const rss = await this.readProcessRss(handle.pid);
      if (rss != null) memory.rss = rss;
    }
    if (memory.rss === 0 && appMetrics?.memory) {
      memory.rss = appMetrics.memory;
    }

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
        const processId = handle.supervisor.getChildProcessId(childName);
        const workerHandle = processId ? this.orchestrator.getWorkerHandle(processId) : undefined;
        const procInfo = processId ? this.orchestrator.getChildProcessInfo(processId) : undefined;
        const uptimeSeconds =
          typeof procInfo?.startTime === 'number'
            ? Math.floor((Date.now() - procInfo.startTime) / 1000)
            : undefined;
        const entry: ChildDiagnosticsDto = {
          name: childName,
          pid: workerHandle?.pid ?? null,
          ...(processId && { processId }),
          ...(workerHandle?.serviceName && { serviceName: workerHandle.serviceName }),
          ...(workerHandle?.serviceVersion && { serviceVersion: workerHandle.serviceVersion }),
          ...(uptimeSeconds !== undefined && { uptimeSeconds }),
        };
        children.push(entry);
        if (workerHandle?.serviceName) {
          services.push(`${workerHandle.serviceName}@${workerHandle.serviceVersion}`);
        }
      }
    }

    // T#66: log paths. Project-mode apps live under
    // ~/.omnitron/projects/{project}/{stack}/logs/{app}/, standalone
    // apps under ~/.omnitron/logs/{app}/. The exact resolution is
    // LogManager's responsibility — we just surface the result so
    // operators don't have to memorise which layout an app uses.
    const logPaths: LogPathsDto = {
      app: this.logManager.getLogFilePath(data.name, 'app'),
      error: this.logManager.getLogFilePath(data.name, 'error'),
    };

    const appConfig: Record<string, unknown> = {};
    const entry = this.config?.apps?.find((a) => a.name === data.name);
    if (entry) {
      appConfig['mode'] = handle.mode;
      appConfig['instances'] = handle.instanceCount ?? 1;
      appConfig['critical'] = entry.critical ?? false;
      if (handle.port) appConfig['port'] = handle.port;
      if (entry.bootstrap) appConfig['bootstrap'] = entry.bootstrap;
    }

    return {
      name: handle.name,
      pid: handle.pid,
      status: handle.status,
      memory,
      uptime: handle.uptime,
      restarts: handle.restarts,
      services,
      children,
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
      const childNames = handle.supervisor.getChildNames();
      if (childNames.length === 0) throw Errors.conflict(`No running children for app '${data.name}'`);

      const proxy = await handle.supervisor.getChildProxy(childNames[0]!);
      if (!proxy) throw Errors.internal(`Cannot get proxy for app '${data.name}'`);

      const service = (proxy as any)[data.service];
      if (!service) throw Errors.notFound('Service', `${data.service}@${data.name}`);

      const fn = service[data.method];
      if (typeof fn !== 'function') throw Errors.notFound('Method', `${data.service}.${data.method}`);

      return fn.call(service, ...data.args);
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

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getEnv(data: { name: string }): Promise<Record<string, string>> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw Errors.notFound('App', data.name);
    return handle.entry.env ?? {};
  }

  // ============================================================================
  // Watch Mode (Operator: admin + operator)
  // ============================================================================

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async enableWatch(data: { apps?: string[] }): Promise<{ watching: Array<{ name: string; directory: string }> }> {
    const watching = await this.daemon.enableWatch(data.apps);
    return { watching };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async disableWatch(): Promise<{ success: boolean }> {
    this.daemon.disableWatch();
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getWatchStatus(): Promise<{ enabled: boolean; apps: Array<{ name: string; directory: string }> }> {
    return this.daemon.getWatchStatus();
  }

  /**
   * Async RSS lookup for an inspect-call. Cached per-pid for
   * `RSS_TTL_MS` so concurrent / repeated inspects in a tight
   * window (typical UI poll behaviour) share a single `ps` spawn
   * instead of fanning out — under load the cache reduces a 5-tab
   * inspect storm from N×ps to 1×ps.
   */
  private readonly rssCache = new Map<number, { rss: number; at: number }>();
  private static readonly RSS_TTL_MS = 2_000;

  private async readProcessRss(pid: number): Promise<number | null> {
    const now = Date.now();
    const cached = this.rssCache.get(pid);
    if (cached && now - cached.at < DaemonRpcService.RSS_TTL_MS) return cached.rss;
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const exec = promisify(execFile);
      const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'rss='], { timeout: 1_000 });
      const rssKb = parseInt(stdout.trim(), 10);
      if (Number.isNaN(rssKb)) return null;
      const rss = rssKb * 1024;
      this.rssCache.set(pid, { rss, at: now });
      // Bound the cache so it doesn't grow past the active-pid set.
      if (this.rssCache.size > 200) {
        for (const [k, v] of this.rssCache) {
          if (now - v.at > DaemonRpcService.RSS_TTL_MS) this.rssCache.delete(k);
        }
      }
      return rss;
    } catch {
      return null;
    }
  }
}
