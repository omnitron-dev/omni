import { randomUUID } from 'node:crypto';
import { Netron, type RemotePeer } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { ControllerGrant, HandoffTicket } from '@omnitron-dev/titan-pm';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OrchestratorControl, AppExecutionView } from '../orchestrator/execution-contract.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { ExecutionHostService, ExecutionSnapshot, ExecutionMutation, ExecutionRead } from './execution-host.js';
import { EXECUTION_MUTATIONS, EXECUTION_READS, EXECUTION_METRICS } from './execution-host.js';
import type { ExecutionMetricsSink } from '../observability/metrics-bridge.js';
import { withControlDeadline } from './private-control-client.js';
import { runtimeDiagnostics } from '../monitoring/runtime-diagnostics.js';

/** One controller's connection to a resident process owner. Disconnect never stops applications. */
export class ExecutionClient {
  readonly orchestrator: OrchestratorControl;
  private readonly netron: Netron;
  private peer: RemotePeer | null = null;
  private remote: ExecutionHostService | null = null;
  private inventory: ExecutionSnapshot | null = null;
  private observedAt = 0;
  private grant: ControllerGrant | null = null;
  private sequence = 0;
  private eventCursor = 0;
  private deliverEvents = false;
  private metrics: ExecutionMetricsSink | null = null;
  private readonly emitter = new EventEmitter();
  private logHandlers: Array<(name: string, line: string) => void> = [];
  private poll: NodeJS.Timeout | null = null;
  private polling = false;
  private setup: Promise<void> = Promise.resolve();
  private setupFailure: unknown;
  private closed = false;

  constructor(readonly socketPath: string, logger: ILogger, readonly controllerId: string = randomUUID()) {
    this.netron = new Netron(logger, { id: `controller-${this.controllerId}` });
    this.netron.registerTransport('unix', () => new UnixSocketTransport());
    this.netron.setTransportOptions('unix', { requestTimeout: 10 * 60_000 });
    this.orchestrator = this.facade();
  }

  setLogger(logger: ILogger): void { runtimeDiagnostics.setLogger(logger); }

  async connect(): Promise<ExecutionSnapshot> {
    await this.netron.start();
    this.peer = await withControlDeadline(this.netron.connect(`unix://${this.socketPath}`, false), 15_000,
      'Execution owner handshake timed out; applications may still be running') as RemotePeer;
    this.remote = await this.peer.queryInterface<ExecutionHostService>('OmnitronExecution');
    const snapshot = await this.remote.snapshot();
    this.apply(snapshot);
    this.eventCursor = snapshot.acknowledgedEvent;
    return snapshot;
  }

  /** Start replay only after log, event and metrics consumers have all been installed. */
  async activateObservations(): Promise<void> {
    this.deliverEvents = true;
    await this.refresh();
  }

  /** A private-socket administrator explicitly replaces a dead or retiring controller. */
  async acquire(): Promise<ControllerGrant> {
    const snapshot = await this.rpc().snapshot();
    const prepared = await this.rpc().prepare({ grant: snapshot.status.controller, candidateId: this.controllerId });
    this.apply(prepared.snapshot);
    return this.accept(prepared.ticket, prepared.snapshot.inventoryDigest);
  }

  async prepare(candidateId: string): Promise<{ ticket: HandoffTicket; snapshot: ExecutionSnapshot }> {
    await this.flushSetup();
    return this.rpc().prepare({ grant: this.currentGrant(), candidateId });
  }

  async accept(ticket: HandoffTicket, inventoryDigest: string): Promise<ControllerGrant> {
    if (ticket.to.controllerId !== this.controllerId) throw new Error('Handoff ticket belongs to another backend');
    this.grant = await this.rpc().commit({ ticket, inventoryDigest });
    this.sequence = 0;
    if (!this.poll) {
      this.poll = setInterval(() => { void this.refresh(); }, 1000);
      this.poll.unref();
    }
    return { ...this.grant };
  }

  async abort(ticket: HandoffTicket): Promise<void> {
    await this.rpc().abort({ grant: this.currentGrant(), ticket });
  }

  async abortCandidate(candidateId: string): Promise<void> {
    const state = (await this.rpc().snapshot()).status;
    if (state.pending?.to.controllerId === candidateId && (state.phase === 'draining' || state.phase === 'prepared')) {
      await this.abort(state.pending);
    }
  }

  async shutdownOwner(): Promise<void> {
    await this.mutate('shutdownOwner', []);
  }

  /** Local administrator recovery, used only after the failed controller is confirmed dead. */
  async prepareReplacement(expectedOwnerId: string, candidateId: string): Promise<HandoffTicket> {
    let snapshot = await this.rpc().snapshot();
    if (snapshot.status.owner.id !== expectedOwnerId) throw new Error('Execution owner changed; recovery is refused');
    if (snapshot.status.phase === 'uncertain') {
      await this.rpc().reconcileCommit();
      snapshot = await this.rpc().snapshot();
    }
    if (snapshot.status.pending && ['draining', 'prepared'].includes(snapshot.status.phase)) {
      await this.rpc().abort({ grant: snapshot.status.controller, ticket: snapshot.status.pending });
      snapshot = await this.rpc().snapshot();
    }
    return (await this.rpc().prepare({ grant: snapshot.status.controller, candidateId })).ticket;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    await withControlDeadline(this.netron.stop(), 2000, 'Execution owner disconnect timed out').catch(() => undefined);
    this.peer = null;
    this.remote = null;
  }

  state(): { owner: ExecutionSnapshot['status']['owner']; phase: string; epoch: number; observedAgeMs: number } | null {
    if (!this.inventory) return null;
    return { owner: this.inventory.status.owner, phase: this.inventory.status.phase,
      epoch: this.inventory.status.controller.epoch, observedAgeMs: performance.now() - this.observedAt };
  }

  private rpc(): ExecutionHostService {
    if (!this.remote || this.closed) throw new Error('Execution owner connection is closed; application state is unknown');
    return this.remote;
  }

  private currentGrant(): ControllerGrant {
    if (!this.grant) throw new Error('This backend has not acquired execution control');
    return this.grant;
  }

  private view(): ExecutionSnapshot {
    if (this.closed || !this.inventory || performance.now() - this.observedAt > 5000) {
      throw new Error('Execution owner inventory is stale; applications may still be running. Restore the owner connection before controlling them.');
    }
    return this.inventory;
  }

  private async refresh(): Promise<void> {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      this.apply(await withControlDeadline(this.rpc().snapshot({ afterEvent: this.eventCursor }), 4000, 'Execution owner observation timed out'));
      if (this.deliverEvents && this.grant) await this.rpc().acknowledge({ grant: this.grant, cursor: this.eventCursor });
      runtimeDiagnostics.resolve('execution.observation-unavailable');
    }
    catch (error) {
      if (!this.closed) runtimeDiagnostics.failure('execution.observation-unavailable', 'Execution owner observation is unavailable; application state is unknown', error,
        'Inspect the private execution-owner log and socket. Do not restart applications merely because the backend lost its observation channel.');
    }
    finally { this.polling = false; }
  }

  private apply(snapshot: ExecutionSnapshot): void {
    if (snapshot.protocol !== 1 || (this.inventory && snapshot.status.owner.id !== this.inventory.status.owner.id)) {
      throw new Error('Execution owner identity or protocol changed; automatic process adoption is refused');
    }
    if (this.inventory && snapshot.revision < this.inventory.revision) return;
    this.inventory = snapshot;
    this.observedAt = performance.now();
    if (!this.deliverEvents) return;
    if (snapshot.droppedEvents) runtimeDiagnostics.record({ id: 'execution.live-event-gap', severity: 'warning',
      title: 'Execution live-event backlog exceeded capacity', evidence: [`${snapshot.droppedEvents} live observations were evicted`],
      remedy: 'Inspect the execution-owner disk logs for the complete application log. Historical metrics in this interval may be incomplete.' });
    for (const event of snapshot.events) {
      if (event.sequence <= this.eventCursor) continue;
      if (event.kind === 'log') {
        for (const handler of this.logHandlers) handler(event.app, String(event.detail));
      } else if (event.kind === 'metric') {
        const metric = event.detail;
        if (this.metrics && metric && typeof metric === 'object' && EXECUTION_METRICS.includes(metric.method)) {
          const invoke = this.metrics[metric.method] as (...args: unknown[]) => void;
          invoke.apply(this.metrics, metric.args);
        }
      } else if (event.kind === 'crash') this.emitter.emit('app:crash', event.app, new Error(String(event.detail)));
      else if (event.kind === 'restart') this.emitter.emit('app:restart', event.app, event.detail);
      else this.emitter.emit('app:online', event.app);
      this.eventCursor = event.sequence;
    }
  }

  private async flushSetup(): Promise<void> {
    await this.setup;
    if (this.setupFailure) throw this.setupFailure;
  }

  private async mutate(method: ExecutionMutation, args: unknown[]): Promise<unknown> {
    await this.flushSetup();
    return this.submit(method, args);
  }

  private async submit(method: ExecutionMutation, args: unknown[]): Promise<unknown> {
    const reply = await this.rpc().mutate({ grant: this.currentGrant(), sequence: ++this.sequence, method, args });
    this.apply(reply.snapshot);
    if (['startApp', 'startKnownApp', 'restartApp', 'restartAfterChange', 'reloadApp', 'scaleApp'].includes(method)) {
      return reply.value ? this.handle((reply.value as { appName: string }).appName) : undefined;
    }
    return reply.value;
  }

  private async read(method: ExecutionRead, args: unknown[]): Promise<unknown> {
    return withControlDeadline(this.rpc().read({ method, args }), 15_000, `Execution read ${method} timed out; application state is unknown`);
  }

  private resolve(name: string): string | undefined {
    const apps = this.view().apps;
    if (apps.some(app => app.info.name === name)) return name;
    const matches = apps.filter(app => app.info.name.split('/').at(-1) === name);
    return matches.length === 1 ? matches[0]!.info.name : undefined;
  }

  private handle(name: string): AppExecutionView | undefined {
    const canonical = this.resolve(name) ?? name;
    const snapshot = this.view().apps.find(app => app.info.name === canonical);
    if (!snapshot) return undefined;
    return {
      ...snapshot.info, entry: snapshot.entry, startedAt: snapshot.startedAt,
      instanceCount: snapshot.instanceCount, lastMetrics: snapshot.lastMetrics, lastExit: snapshot.lastExit,
      childMetrics: new Map(snapshot.childMetrics), topologyProcesses: snapshot.topology,
      topologyPools: new Map(snapshot.pools.map(pool => [pool.name, { getWorkerIds: () => [...pool.workerIds] }])),
      supervisor: snapshot.children ? {
        getChildNames: () => snapshot.children!.map(child => child.name),
        getChildProcessId: child => snapshot.children!.find(item => item.name === child)?.processId,
        restartChild: async child => { await this.mutate('restartChild', [canonical, child]); },
        getChildProxy: async child => ({
          getExposedServices: () => this.read('getExposedServices', [canonical, child]),
          callExposedService: (service: string, method: string, args: unknown[]) => this.mutate('callService', [canonical, service, method, args]),
        }),
      } : null,
    };
  }

  private facade(): OrchestratorControl {
    const local: Record<string, unknown> = {
      list: (filter?: { prefix?: string }) => this.view().apps.filter(app => !filter?.prefix || app.info.name.startsWith(filter.prefix)).map(app => app.info),
      getApp: (name: string) => this.view().apps.find(app => app.info.name === (this.resolve(name) ?? name))?.info ?? null,
      getHandle: (name: string) => this.handle(name),
      resolveAppName: (name: string) => this.resolve(name),
      listHandleNames: (prefix?: string) => this.view().apps.map(app => app.info.name).filter(name => !prefix || name.startsWith(prefix)),
      getWorkerHandle: (id: string) => this.view().workers.find(worker => worker.info.id === id),
      getChildProcessInfo: (id: string) => this.view().workers.find(worker => worker.info.id === id)?.info,
      getAppStatus: (name: string) => this.handle(name)?.status,
      getBuildWatchedApps: () => this.view().watchedApps,
      getLogs: (name?: string, lines = 100) => this.view().apps.filter(app => !name || app.info.name === this.resolve(name))
        .map(app => ({ app: app.info.name, lines: app.logs.slice(-lines) })),
      hasDeclaredReadiness: (name: string) => this.view().apps.find(app => app.info.name === this.resolve(name))?.declaredReadiness ?? false,
      onAppLog: (handler: (name: string, line: string) => void) => { this.logHandlers.push(handler); },
      // Child-to-parent routing terminates at the stable owner's socket.
      setDaemonNetron: () => {},
      setMetricsBridge: (bridge: Parameters<OrchestratorService['setMetricsBridge']>[0]) => {
        this.metrics = bridge;
        bridge.attachOrchestrator(this.orchestrator);
      },
    };
    for (const method of EXECUTION_READS) local[method] = (...args: unknown[]) => this.read(method, args);
    for (const method of EXECUTION_MUTATIONS) local[method] = (...args: unknown[]) => this.mutate(method, args);
    Object.defineProperty(local, 'devMode', {
      get: () => this.view().devMode,
      set: (value: boolean) => {
        this.setup = this.setup.then(async () => { await this.submit('setDevMode', [value]); })
          .catch((error: unknown) => { this.setupFailure = error; });
      },
    });
    // The compatibility seam is deliberately finite: no arbitrary remote
    // property access, native handles, or executable callback serialization.
    return new Proxy(local, {
      get: (target, property) => {
        if (Object.hasOwn(target, property)) return Reflect.get(target, property);
        const value: unknown = Reflect.get(this.emitter, property);
        return typeof value === 'function' ? value.bind(this.emitter) : value;
      },
    }) as unknown as OrchestratorControl;
  }
}
