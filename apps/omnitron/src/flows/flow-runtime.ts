import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readDiskSpace } from '../monitoring/host-disk.js';
import type { DaemonEvent } from '../shared/events.js';
import type { EventBroadcasterService } from '../services/event-broadcaster.service.js';
import type { FlowAuthority, FlowBinding, FlowLedger } from './flow-ledger.js';
import type { FlowDefinition } from '../shared/dto/flows.js';
import type { FlowWorkspace } from '../shared/dto/flow-runtime.js';
import { readMeshDisk, type FlowMesh } from './mesh-disk.js';

export type OutgoingFlowDelivery = ReturnType<FlowLedger['delivery']>;
export type FlowScopeReader = (workspace: FlowWorkspace, nodes?: readonly string[]) => Promise<FlowBinding>;

export async function verifyFlowScope(ledger: FlowLedger, scope: FlowScopeReader, flowId: string, activation: string) {
  const reviewed = ledger.verifyActivation(flowId, activation);
  const current = await scope(reviewed.workspace, Object.keys(reviewed.binding.mesh ?? {}));
  if (!isDeepStrictEqual(reviewed.binding, current))
    throw Error('The registered workspace or stack changed, or its mesh node was replaced. Review the activation.');
  return reviewed;
}
export class UnconfirmedDelivery extends Error {}
const MAX_PENDING_STACK_EVENTS = 128;
interface Dependencies {
  admit(): Promise<void>;
  scope: FlowScopeReader;
  mesh?: FlowMesh;
  review?(definition: FlowDefinition, binding: FlowBinding, authority: FlowAuthority): Promise<void>;
  deliver(entry: OutgoingFlowDelivery, check: (dispatch?: boolean) => void): Promise<string>;
  report(error: unknown): void;
  readDisk?: typeof readDiskSpace;
}
/** One controller drives the persisted source clocks. Receivers deduplicate adjacent controllers using the durable delivery ID. */
export class FlowRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private delivering: Promise<void> | undefined;
  private deliveryRequested = false;
  private received: Promise<void> = Promise.resolve();
  private pendingStackEvents = 0;
  private droppedStackEvents = 0;
  private closed = false;
  private subscription?: { broadcaster: EventBroadcasterService; id: string };
  constructor(
    readonly ledger: FlowLedger,
    private readonly deps: Dependencies
  ) {}
  async checkWorkspace(id: string, activation: string) {
    return verifyFlowScope(this.ledger, this.deps.scope, id, activation);
  }
  async review(definition: FlowDefinition, binding: FlowBinding, authority: FlowAuthority) {
    await this.deps.review?.(definition, binding, authority);
  }

  listen(broadcaster: EventBroadcasterService) {
    this.subscription = {
      broadcaster,
      id: broadcaster.subscribe(['stack.started', 'stack.stopped'], (event) => this.observe(event)),
    };
    this.wake();
  }
  private observe(event: DaemonEvent) {
    if (this.closed || !['stack.started', 'stack.stopped'].includes(event.channel)) return;
    const data = event.data as Record<string, unknown> | undefined;
    if (typeof data?.['project'] !== 'string' || typeof data['stack'] !== 'string') return;
    const targets = this.ledger.stackSources(event.channel, data['project'], data['stack']);
    if (!targets.length) return;
    // The broadcaster cannot wait or replay. Keep bursts bounded while checking the real workspace and owner.
    if (this.pendingStackEvents >= MAX_PENDING_STACK_EVENTS) {
      if (++this.droppedStackEvents === 1)
        this.deps.report(
          Error('Flow stack event queue is full; new stack broadcasts are being dropped before journaling')
        );
      return;
    }
    this.pendingStackEvents++;
    const fields: Record<string, string | number> = { project: data['project'], stack: data['stack'] };
    for (const key of ['type', 'appCount', 'nodeCount', 'reason']) {
      const value = data[key];
      if (typeof value === 'string' || typeof value === 'number') fields[key] = value;
    }
    const eventId = randomUUID();
    this.received = this.received
      .then(async () => {
        await this.deps.admit();
        for (const target of targets) {
          if (this.closed) return;
          try {
            await this.checkWorkspace(target.id, target.activation);
            this.ledger.recordStackEvent(target, event.channel, fields, eventId);
          } catch (error) {
            this.deps.report(error);
          }
        }
        this.wake();
      })
      .catch((error) => this.deps.report(error))
      .finally(() => {
        if (--this.pendingStackEvents === 0 && this.droppedStackEvents) {
          this.deps.report(
            Error(`Flow stack event queue drained after dropping ${this.droppedStackEvents} broadcasts`)
          );
          this.droppedStackEvents = 0;
        }
      });
  }
  wake(delay = 0) {
    if (this.closed) return;
    if (this.running) {
      if (delay === 0) void this.flushDeliveries().catch((error) => this.deps.report(error));
      return;
    }
    clearTimeout(this.timer);
    const due = this.ledger.nextDue();
    if (due === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.tick()
          .catch((error) => this.deps.report(error))
          .finally(() => {
            this.wake(1000);
          });
      },
      Math.max(delay, due - Date.now(), 0)
    );
    this.timer.unref();
  }
  tick(): Promise<void> {
    this.running ??= this.runDue().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async runDue() {
    if (this.closed) return;
    await this.deps.admit();
    if (this.closed) return;
    const due = this.ledger.due();
    // A slow peer must not hold up the other disks. Bound concurrent work and reuse its snapshot for every mount.
    const snapshots = new Map<string, ReturnType<FlowMesh['snapshot']>>();
    const mesh = this.deps.mesh;
    const batchMesh: FlowMesh | undefined = mesh && {
      identity: (id) => mesh.identity(id),
      snapshot(id) {
        const key = id + ':' + mesh.identity(id);
        let snapshot = snapshots.get(key);
        if (!snapshot) {
          snapshot = mesh.snapshot(id);
          snapshots.set(key, snapshot);
        }
        return snapshot;
      },
    };
    const sampleOne = async (source: (typeof due)[number]) => {
      let sample;
      try {
        const { binding, definition } = await this.checkWorkspace(source.flow_id, source.activation);
        const node = definition.nodes.find((n) => n.id === source.node);
        if (!node) throw Error('Disk source no longer exists in the active graph');
        if (node.type === 'mesh.disk@1') {
          const id = String(node.config['nodeId']);
          sample = await readMeshDisk(batchMesh, id, source.path, binding.mesh?.[id]);
        } else {
          sample = await (this.deps.readDisk ?? readDiskSpace)(source.path);
        }
      } catch (error) {
        sample = error instanceof Error ? error : Error('Disk sample failed');
      }
      if (this.closed) return;
      try {
        const receipt = this.ledger.settleSample(source, sample);
        if (receipt?.deliveries.some((row) => row.status === 'pending'))
          void this.flushDeliveries().catch((error) => this.deps.report(error));
      } catch (error) {
        this.ledger.settleSample(source, error instanceof Error ? error : Error('Flow evaluation failed'));
      }
    };
    let next = 0;
    const workers = Array.from({ length: Math.min(4, due.length) }, async () => {
      while (!this.closed && next < due.length) await sampleOne(due[next++]!);
    });
    await Promise.all([this.flushDeliveries(), ...workers]);
    await this.flushDeliveries();
  }
  /** Persisted commands can make progress while a peer is still answering an unrelated sample. */
  private flushDeliveries(): Promise<void> {
    this.deliveryRequested = true;
    this.delivering ??= Promise.resolve()
      .then(async () => {
        while (!this.closed && this.deliveryRequested) {
          this.deliveryRequested = false;
          await this.deliverBatch();
        }
      })
      .finally(() => {
        this.delivering = undefined;
        if (this.deliveryRequested && !this.closed) this.wake();
      });
    return this.delivering;
  }
  private async deliverBatch() {
    const pending = this.ledger.pending();
    if (!pending.length) return;
    await this.deps.admit();
    for (const { id } of pending) {
      if (this.closed) return;
      const entry = this.ledger.delivery(id);
      const check = (dispatch = false) => {
        const current = this.ledger.delivery(id);
        if (
          this.closed ||
          current.active?.id !== entry.row.activation ||
          current.row.attempt !== entry.row.attempt ||
          current.session !== entry.session ||
          current.public.status !== 'pending'
        )
          throw Error('The flow activation changed before delivery');
        if (dispatch) this.ledger.markDispatch(entry.row, entry.session);
      };
      let result: string;
      try {
        check();
        await this.checkWorkspace(entry.row.flow_id, entry.row.activation);
        result = await this.deps.deliver(entry, check);
      } catch (error) {
        const unknown = error instanceof UnconfirmedDelivery;
        this.ledger.finish(
          entry.row,
          unknown ? id : null,
          error instanceof Error ? error.message.slice(0, 512) : 'Delivery needs review',
          unknown
        );
        continue;
      }
      this.ledger.finish(entry.row, result, null);
    }
    if (pending.length === 32) this.deliveryRequested = true;
  }
  async dispose() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.subscription) this.subscription.broadcaster.unsubscribe(this.subscription.id);
    await this.running;
    await this.delivering;
    await this.received;
  }
}
