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
import type { IDaemonService } from '../shared/dto/services.js';
import type {
  ProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
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
    if (!entry) throw new Error(`Unknown app: ${data.name}`);

    await this.orchestrator.startApp(entry);
    return this.orchestrator.getApp(data.name)!;
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startAll(): Promise<ProcessInfoDto[]> {
    await this.orchestrator.startAll(this.config);
    return this.orchestrator.list();
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopApp(data: { name: string; force?: boolean; timeout?: number }): Promise<{ success: boolean }> {
    await this.orchestrator.stopApp(data.name, data.force, data.timeout);
    return { success: true };
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
    for (const entry of entries) {
      await this.orchestrator.restartApp(entry.name);
    }
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
    if (!info) throw new Error(`Unknown app: ${data.name}`);
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

  @Public({ auth: { roles: VIEWER_ROLES } })
  async inspect(data: { name: string }): Promise<AppDiagnosticsDto> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw new Error(`Unknown app: ${data.name}`);

    const metricsMap = await this.orchestrator.getMetrics(data.name);
    const appMetrics = metricsMap[data.name];

    const memory = { heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0, rss: 0 };
    if (handle.pid && handle.status === 'online') {
      try {
        const { execSync } = await import('node:child_process');
        const psOutput = execSync(`ps -p ${handle.pid} -o rss=`, { encoding: 'utf-8' }).trim();
        const rssKb = parseInt(psOutput, 10);
        if (!isNaN(rssKb)) {
          memory.rss = rssKb * 1024;
        }
      } catch {
        /* process may have exited */
      }
    }
    if (memory.rss === 0 && appMetrics?.memory) {
      memory.rss = appMetrics.memory;
    }

    const services: string[] = [];
    if (handle.mode === 'bootstrap' && handle.supervisor) {
      const childNames = handle.supervisor.getChildNames();
      for (const childName of childNames) {
        const processId = handle.supervisor.getChildProcessId(childName);
        if (processId) {
          const workerHandle = this.orchestrator.getWorkerHandle(processId);
          if (workerHandle?.serviceName) {
            services.push(`${workerHandle.serviceName}@${workerHandle.serviceVersion}`);
          }
        }
      }
    }

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
      config: appConfig,
    };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async exec(data: { name: string; service: string; method: string; args: unknown[] }): Promise<unknown> {
    const handle = this.orchestrator.getHandle(data.name);
    if (!handle) throw new Error(`Unknown app: ${data.name}`);
    if (handle.status !== 'online') throw new Error(`App '${data.name}' is not online`);

    if (handle.mode === 'bootstrap' && handle.supervisor) {
      const childNames = handle.supervisor.getChildNames();
      if (childNames.length === 0) throw new Error(`No running children for app '${data.name}'`);

      const proxy = await handle.supervisor.getChildProxy(childNames[0]!);
      if (!proxy) throw new Error(`Cannot get proxy for app '${data.name}'`);

      const service = (proxy as any)[data.service];
      if (!service) throw new Error(`Service '${data.service}' not found on app '${data.name}'`);

      const fn = service[data.method];
      if (typeof fn !== 'function') throw new Error(`Method '${data.method}' not found on service '${data.service}'`);

      return fn.call(service, ...data.args);
    }

    if (!handle.port) throw new Error(`App '${data.name}' has no port configured`);

    const { HttpConnection } = await import('@omnitron-dev/titan/netron/transport/http');
    const connection = new HttpConnection(`http://127.0.0.1:${handle.port}`, { timeout: 30_000 });

    try {
      const service = await connection.queryInterface(data.service);
      const fn = (service as any)[data.method];
      if (typeof fn !== 'function') throw new Error(`Method '${data.method}' not found on service '${data.service}'`);
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
    if (!handle) throw new Error(`Unknown app: ${data.name}`);
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
}
