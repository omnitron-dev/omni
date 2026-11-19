import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readDiskSpace } from '../monitoring/host-disk.js';
import type { DaemonEvent } from '../shared/events.js';
import type { EventBroadcasterService } from '../services/event-broadcaster.service.js';
import type { FlowAuthority, FlowBinding, FlowLedger } from './flow-ledger.js';
import type { FlowDefinition } from '../shared/dto/flows.js';
import type { FlowWorkspace } from '../shared/dto/flow-runtime.js';

export type OutgoingFlowDelivery = ReturnType<FlowLedger['delivery']>;
export class UnconfirmedDelivery extends Error {}
const MAX_PENDING_STACK_EVENTS = 128;
interface Dependencies {
  admit(): Promise<void>;
  scope(workspace: FlowWorkspace): Promise<FlowBinding>;
  review?(definition: FlowDefinition, binding: FlowBinding, authority: FlowAuthority): Promise<void>;
  deliver(entry: OutgoingFlowDelivery, check: (dispatch?: boolean) => void): Promise<string>;
  report(error: unknown): void;
  readDisk?: typeof readDiskSpace;
}
/** One controller drives the persisted source clocks. Receivers deduplicate adjacent controllers using the durable delivery ID. */
export class FlowRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
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
    const before = this.ledger.verifyActivation(id, activation);
    if (!isDeepStrictEqual(before.binding, await this.deps.scope(before.workspace)))
      throw Error('The registered workspace or stack changed. Review the activation.');
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
    if (this.closed || this.running) return;
    clearTimeout(this.timer);
    const due = this.ledger.nextDue();
    if (due === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.running = this.tick()
          .catch((error) => this.deps.report(error))
          .finally(() => {
            this.running = undefined;
            this.wake(1000);
          });
      },
      Math.max(delay, due - Date.now(), 0)
    );
    this.timer.unref();
  }
  async tick() {
    await this.deps.admit();
    if (this.closed) return;
    const reader = this.deps.readDisk ?? readDiskSpace;
    for (const source of this.ledger.due()) {
      let sample;
      try {
        await this.checkWorkspace(source.flow_id, source.activation);
        sample = await reader(source.path);
      } catch (error) {
        sample = error instanceof Error ? error : Error('Disk sample failed');
      }
      if (this.closed) return;
      try {
        this.ledger.settleSample(source, sample);
      } catch (error) {
        this.ledger.settleSample(source, error instanceof Error ? error : Error('Flow evaluation failed'));
      }
    }
    for (const { id } of this.ledger.pending()) {
      if (this.closed) return;
      const entry = this.ledger.delivery(id);
      const check = (dispatch = false) => {
        const current = this.ledger.delivery(id);
        if (
          this.closed ||
          current.active?.id !== entry.row.activation ||
          current.session !== entry.session ||
          current.public.status !== 'pending'
        )
          throw Error('The flow activation changed before delivery');
        if (dispatch) this.ledger.markDispatch(id, entry.row.activation, entry.session);
      };
      let result: string;
      try {
        check();
        await this.checkWorkspace(entry.row.flow_id, entry.row.activation);
        result = await this.deps.deliver(entry, check);
      } catch (error) {
        const unknown = error instanceof UnconfirmedDelivery;
        this.ledger.finish(
          id,
          unknown ? id : null,
          error instanceof Error ? error.message.slice(0, 512) : 'Delivery needs review',
          unknown
        );
        continue;
      }
      this.ledger.finish(id, result, null);
    }
  }
  async dispose() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.subscription) this.subscription.broadcaster.unsubscribe(this.subscription.id);
    await this.running;
    await this.received;
  }
}
