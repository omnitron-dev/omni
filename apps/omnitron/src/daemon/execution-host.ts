import type { LogManager } from '../monitoring/log-manager.js';
import type { LogRecord } from '../monitoring/log-line.js';
import type { JournalItem, LogJournalStats } from '../monitoring/log-journal.js';
import { createHash } from 'node:crypto';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { ControllerHandoff } from '@omnitron-dev/titan-pm';
import type { ControllerGrant, ControllerHandoffStatus, HandoffTicket, IProcessInfo } from '@omnitron-dev/titan-pm';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { ExecutionAppSnapshot } from '../orchestrator/execution-contract.js';
import { callExposedService, type ExposingProcess } from '../orchestrator/call-exposed-service.js';
import type { ExecutionJournal } from './execution-journal.js';
import type { ExecutionMetricsSink } from '../observability/metrics-bridge.js';

// Only a private, owner-only Unix listener may expose this service. The
// backend authenticates end users with Omnitron RBAC before entering it.
const OWNER_ROLES = ['execution-controller'];

export const EXECUTION_READS = ['getDependencyGraph', 'getMetrics', 'getHealth', 'explainPortConflict'] as const;
export const EXECUTION_MUTATIONS = [
  'startAll', 'startApp', 'stopApp', 'stopAll', 'redefineApp', 'restartApp', 'startKnownApp',
  'restartAfterChange', 'reloadApp', 'scaleApp', 'setWatchMode', 'setConfig',
  'configureReadiness', 'drainChildSamples', 'setMetricsEnabled',
] as const;
export type ExecutionMutation = typeof EXECUTION_MUTATIONS[number] | 'setDevMode' | 'restartChild' | 'callService' | 'shutdownOwner';
export type ExecutionRead = typeof EXECUTION_READS[number] | 'getExposedServices';
export const EXECUTION_METRICS = ['recordAppRestart', 'recordAppCrash', 'recordAppEscalated',
  'recordJanitorSweep', 'evictApp', 'recordResilientHandleReset', 'recordEsbuildBuild'] as const;
type MetricObservation = { method: typeof EXECUTION_METRICS[number]; args: unknown[] };

export interface ExecutionEvent {
  sequence: number;
  kind: 'log' | 'online' | 'crash' | 'restart' | 'metric';
  app: string;
  detail: string | number | null | MetricObservation;
}

export interface ExecutionSnapshot {
  protocol: 1;
  logs?: { protocol: 1; journal: LogJournalStats };
  revision: number;
  status: ControllerHandoffStatus;
  apps: ExecutionAppSnapshot[];
  workers: Array<{ info: IProcessInfo; pid?: number; serviceName?: string; serviceVersion?: string }>;
  devMode: boolean;
  watchedApps: Array<{ name: string; directory: string }>;
  watchEnabled: boolean;
  events: ExecutionEvent[];
  lastEvent: number;
  acknowledgedEvent: number;
  droppedEvents: number;
  inventoryDigest: string;
}

/** Native handles, supervisors and pools never leave this resident owner. */
@Service({ name: 'OmnitronExecution' })
export class ExecutionHostService {
  private events: ExecutionEvent[] = [];
  private lastEvent = 0;
  private revision = 0;
  private acknowledgedEvent = 0;

  constructor(
    private readonly orchestrator: OrchestratorService,
    readonly fence: ControllerHandoff,
    private readonly journal: ExecutionJournal,
    private readonly hooks: {
      logs?: LogManager;
      watch?: (enabled: boolean, apps?: string[]) => void;
      watchConfig?: (config: Parameters<OrchestratorService['setConfig']>[0]) => void;
      watchedApps?: () => Array<{ name: string; directory: string }>;
      shutdown?: () => void;
    } = {},
  ) {
    if (!hooks.logs?.journal) orchestrator.onAppLog((app, line) => this.record('log', app, line));
    orchestrator.on('app:online', (app: string) => this.record('online', app, null));
    orchestrator.on('app:crash', (app: string, error: Error) => this.record('crash', app, error.message));
    orchestrator.on('app:restart', (app: string, attempt: number) => this.record('restart', app, attempt));
    const emit = (method: MetricObservation['method']) => (...args: unknown[]) => this.record('metric', '', { method, args });
    const sink: ExecutionMetricsSink = {
      attachOrchestrator() {}, recordAppRestart: emit('recordAppRestart'), recordAppCrash: emit('recordAppCrash'),
      recordAppEscalated: emit('recordAppEscalated'), recordJanitorSweep: emit('recordJanitorSweep'),
      evictApp: emit('evictApp'), recordResilientHandleReset: emit('recordResilientHandleReset'), recordEsbuildBuild: emit('recordEsbuildBuild'),
    };
    orchestrator.setMetricsBridge(sink);
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async snapshot(data: { afterEvent?: number } = {}): Promise<ExecutionSnapshot> {
    const afterEvent = data.afterEvent ?? this.acknowledgedEvent;
    if (!Number.isSafeInteger(afterEvent) || afterEvent < 0 || afterEvent > this.lastEvent) throw new Error('Invalid execution event cursor');
    const ids = new Set<string>();
    const apps = this.orchestrator.list().map(info => {
      const handle = this.orchestrator.getHandle(info.name)!;
      const children = handle.supervisor?.getChildNames().map(name => {
        const raw: unknown = handle.supervisor!.getChildProcessId(name);
        if (typeof raw !== 'string') return { name };
        ids.add(raw);
        return { name, processId: raw };
      }) ?? null;
      const pools = [...handle.topologyPools].map(([name, pool]) => {
        const workerIds = pool.getWorkerIds();
        for (const id of workerIds) ids.add(id);
        return { name, workerIds };
      });
      return {
        info, entry: handle.entry, startedAt: handle.startedAt, instanceCount: handle.instanceCount,
        lastMetrics: handle.lastMetrics, lastExit: handle.lastExit, childMetrics: [...handle.childMetrics],
        // Topology hooks are executable code and stay in the owner. A
        // controller needs topology identity and transport declarations.
        topology: handle.topologyProcesses?.map(item => ({
          name: item.name, ...(item.instances !== undefined && { instances: item.instances }),
          ...(item.transports?.http && { transports: { http: item.transports.http } }),
        })) ?? null,
        children, pools, logs: handle.getLogs(1000),
        declaredReadiness: this.orchestrator.hasDeclaredReadiness(info.name),
      } satisfies ExecutionAppSnapshot;
    });
    const workers: ExecutionSnapshot['workers'] = [];
    for (const id of ids) {
      const info = this.orchestrator.getChildProcessInfo(id);
      const handle = this.orchestrator.getWorkerHandle(id);
      if (info) workers.push({ info, ...(handle?.pid !== undefined && { pid: handle.pid }),
        ...(handle?.serviceName && { serviceName: handle.serviceName }),
        ...(handle?.serviceVersion && { serviceVersion: handle.serviceVersion }) });
    }
    const oldest = this.events[0]?.sequence ?? this.lastEvent + 1;
    const inventory = apps.map(app => ({ name: app.info.name, pid: app.info.pid,
      startedAt: app.startedAt, restarts: app.info.restarts, children: app.children, pools: app.pools,
      entry: app.entry }));
    const workerIdentities = workers.map(worker => ({ id: worker.info.id, pid: worker.pid,
      startedAt: worker.info.startTime, restarts: worker.info.restartCount }));
    return {
      ...(this.hooks.logs?.journal ? { logs: { protocol: 1 as const, journal: this.hooks.logs.journalStats()! } } : {}),
      protocol: 1, revision: ++this.revision, status: this.fence.status(), apps, workers,
      devMode: this.orchestrator.devMode, watchEnabled: this.orchestrator.devMode,
      watchedApps: [...this.orchestrator.getBuildWatchedApps(), ...(this.hooks.watchedApps?.() ?? [])],
      events: this.events.filter(event => event.sequence > afterEvent), lastEvent: this.lastEvent,
      acknowledgedEvent: this.acknowledgedEvent,
      droppedEvents: Math.max(0, oldest - afterEvent - 1),
      inventoryDigest: createHash('sha256').update(JSON.stringify({ apps: inventory, workers: workerIdentities })).digest('hex'),
    };
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async acknowledge(data: { grant: ControllerGrant; cursor: number }): Promise<void> {
    const current = this.fence.status().controller;
    if (data.grant.ownerId !== current.ownerId || data.grant.controllerId !== current.controllerId || data.grant.epoch !== current.epoch) {
      throw new Error('A retired controller cannot acknowledge execution observations');
    }
    if (!Number.isSafeInteger(data.cursor) || data.cursor < this.acknowledgedEvent || data.cursor > this.lastEvent) throw new Error('Invalid observation acknowledgment');
    this.acknowledgedEvent = data.cursor;
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async readLogs(): Promise<Array<JournalItem<{ app: string; record: LogRecord }>>> {
    if (!this.hooks.logs?.journal) throw new Error('This owner has no durable log journal');
    return this.hooks.logs.journal.peek();
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async acknowledgeLogs(data: { grant: ControllerGrant; records: Array<{ id: string; digest: string }> }): Promise<void> {
    const current = this.fence.status().controller;
    if (data.grant.ownerId !== current.ownerId || data.grant.controllerId !== current.controllerId || data.grant.epoch !== current.epoch) {
      throw new Error('A retired controller cannot acknowledge captured logs');
    }
    if (!Array.isArray(data.records) || data.records.length > 500 || data.records.some(record =>
      typeof record.id !== 'string' || typeof record.digest !== 'string' || record.digest.length !== 64)) throw new Error('Invalid log acknowledgment');
    if (!this.hooks.logs?.journal) throw new Error('This owner has no durable log journal');
    this.hooks.logs.journal.acknowledge(data.records);
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async read(data: { method: ExecutionRead; args: unknown[] }): Promise<unknown> {
    if (data.method === 'getExposedServices') {
      const [app, child] = data.args;
      if (typeof app !== 'string' || typeof child !== 'string') throw new Error('An application and child name are required');
      const proxy = await this.orchestrator.getHandle(app)?.supervisor?.getChildProxy(child) as ExposingProcess | undefined;
      return proxy?.getExposedServices?.() ?? [];
    }
    if (!(EXECUTION_READS as readonly string[]).includes(data.method) || !Array.isArray(data.args)) throw new Error('Unsupported execution read');
    const fn = this.orchestrator[data.method] as (...args: unknown[]) => Promise<unknown>;
    return fn.apply(this.orchestrator, data.args);
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async mutate(data: { grant: ControllerGrant; sequence: number; method: ExecutionMutation; args: unknown[] }): Promise<{ value: unknown; snapshot: ExecutionSnapshot }> {
    if (!Array.isArray(data.args)) throw new Error('Execution arguments must be an array');
    const fingerprint = createHash('sha256').update(JSON.stringify([data.method, data.args])).digest('hex');
    // The receipt holds the outcome, not a snapshot that becomes stale while
    // a caller is retrying a lost response.
    const value = await this.fence.run(data.grant, data.sequence, fingerprint, () => this.invoke(data.method, data.args));
    return { value, snapshot: await this.snapshot() };
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async prepare(data: { grant: ControllerGrant; candidateId: string }): Promise<{ ticket: HandoffTicket; snapshot: ExecutionSnapshot }> {
    const ticket = await this.fence.prepare(data.grant, data.candidateId);
    return { ticket, snapshot: await this.snapshot() };
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async commit(data: { ticket: HandoffTicket; inventoryDigest: string }): Promise<ControllerGrant> {
    const current = await this.snapshot();
    const alreadyCommitted = current.status.controller.controllerId === data.ticket.to.controllerId &&
      current.status.controller.epoch === data.ticket.to.epoch;
    if (!alreadyCommitted && data.inventoryDigest !== current.inventoryDigest) throw new Error('Execution inventory changed; reconcile the owner before committing');
    return this.fence.commit(data.ticket);
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async abort(data: { grant: ControllerGrant; ticket: HandoffTicket }): Promise<void> {
    this.fence.abort(data.grant, data.ticket);
  }

  @Public({ auth: { roles: OWNER_ROLES } })
  async reconcileCommit(): Promise<ControllerGrant> {
    const record = await this.journal.read();
    if (!record || record.owner.id !== this.fence.owner.id) throw new Error('Execution journal belongs to a different owner');
    return this.fence.resolveCommit(record.grant);
  }

  private async invoke(method: ExecutionMutation, args: unknown[]): Promise<unknown> {
    if (method === 'shutdownOwner') {
      if (this.orchestrator.list().some(app => app.status !== 'stopped' && app.status !== 'crashed' && app.status !== 'errored')) {
        throw new Error('Stop applications explicitly before stopping their execution owner');
      }
      if (!this.hooks.shutdown) throw new Error('Owner shutdown is unavailable');
      this.hooks.shutdown();
      return { accepted: true };
    }
    if (method === 'setDevMode') {
      if (typeof args[0] !== 'boolean') throw new Error('devMode must be boolean');
      this.orchestrator.devMode = args[0];
      return undefined;
    }
    if (method === 'restartChild' || method === 'callService') {
      const [app, childOrService, remoteMethod, input] = args;
      if (typeof app !== 'string' || typeof childOrService !== 'string') throw new Error('An application and child/service name are required');
      const handle = this.orchestrator.getHandle(app);
      if (!handle?.supervisor) throw new Error(`No supervisor for ${app}`);
      if (method === 'restartChild') return handle.supervisor.restartChild(childOrService);
      if (typeof remoteMethod !== 'string' || !Array.isArray(input)) throw new Error('A service method and arguments are required');
      return callExposedService(handle.supervisor, app, childOrService, remoteMethod, input);
    }
    if (!(EXECUTION_MUTATIONS as readonly string[]).includes(method)) throw new Error('Unsupported execution mutation');
    const fn = this.orchestrator[method as typeof EXECUTION_MUTATIONS[number]] as (...values: unknown[]) => unknown;
    const result = await fn.apply(this.orchestrator, args);
    if (method === 'setWatchMode') {
      const [enabled, apps] = args as [boolean, string[] | undefined];
      this.orchestrator.devMode = enabled;
      this.hooks.watch?.(enabled, apps);
    }
    if (method === 'setConfig') this.hooks.watchConfig?.(args[0] as Parameters<OrchestratorService['setConfig']>[0]);
    if (['startApp', 'startKnownApp', 'restartApp', 'restartAfterChange', 'reloadApp', 'scaleApp'].includes(method)) {
      return result ? { appName: (result as { name: string }).name } : undefined;
    }
    return result;
  }

  private record(kind: ExecutionEvent['kind'], app: string, detail: ExecutionEvent['detail']): void {
    // Bound individual live observations as well as their count. Complete
    // log lines are retained by the owner's independent disk log writer.
    if (typeof detail === 'string' && detail.length > 4096) detail = detail.slice(0, 4096) + ' [live tail truncated; see disk log]';
    this.events.push({ sequence: ++this.lastEvent, kind, app, detail });
    // Disk logs are captured separately by the owner, throughout a controller
    // outage. A gap in this bounded live tail is explicit, never concealed.
    if (this.events.length > 10_000) this.events.splice(0, this.events.length - 10_000);
  }
}
