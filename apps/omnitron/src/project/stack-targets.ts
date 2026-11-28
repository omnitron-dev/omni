import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { StackLaunchConfirmation } from '../shared/dto/project.js';
import { stackExecutionKey, type StackExecutionScope } from '../shared/dto/stack-execution.js';
import { validateRemotePlacement, type RemotePlacement } from './remote-placement.js';
import { stackNodeKey } from './stack-placement.js';

export interface StackTarget { host: string; port: number; applications: boolean; nodeId?: string }
interface TargetState { version: 1 | 2; revision: number; nodes: StackTarget[]; placement?: RemotePlacement }

function merge(...sets: readonly StackTarget[][]): StackTarget[] {
  const nodes = new Map<string, StackTarget>();
  const endpoints = new Map<string, string>();
  for (const targets of sets) for (const target of targets) {
    if (!target || typeof target.host !== 'string' || !target.host || /[\s/\\\0]/.test(target.host) ||
        !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 || typeof target.applications !== 'boolean' ||
        (target.nodeId !== undefined && (typeof target.nodeId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(target.nodeId)))) {
      throw new Error('Corrupt stack target inventory');
    }
    const key = stackNodeKey(target.host, target.port);
    const previous = nodes.get(key);
    if (target.nodeId) {
      const pinned = endpoints.get(target.nodeId);
      if (pinned && pinned !== key) throw new Error(`Recipient ${target.nodeId} is already pinned to ${pinned}; reconcile the previous allocation first`);
      endpoints.set(target.nodeId, key);
    }
    if (previous?.nodeId && target.nodeId && previous.nodeId !== target.nodeId) {
      throw new Error(`Recipient identity changed for ${key}; reconcile the previous allocation first`);
    }
    nodes.set(key, { ...previous, ...target, ...(previous?.nodeId && { nodeId: previous.nodeId }),
      applications: target.applications || previous?.applications === true });
  }
  return [...nodes.values()].sort((a, b) => stackNodeKey(a.host, a.port).localeCompare(stackNodeKey(b.host, b.port)));
}

function read(value: TargetState | null, scope: StackExecutionScope): TargetState {
  if (value == null) return { version: 1, revision: 0, nodes: [] };
  if ((value.version !== 1 && value.version !== 2) || (value.version === 2) !== !!value.placement || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.nodes)) {
    throw new Error('Corrupt stack target journal');
  }
  if (value.placement) validateRemotePlacement(value.placement, scope);
  return { ...value, nodes: merge(value.nodes) };
}

/** Deployment destinations remain obligations until every node confirms a stop. */
export class StackTargets {
  constructor(private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>) {}
  private key(scope: StackExecutionScope): string { return `lifecycle:stack-targets:${stackExecutionKey(scope)}`; }
  inspect(scope: StackExecutionScope, declared: StackTarget[] = []): TargetState {
    const state = read(this.store.kvGetSync<TargetState>(this.key(scope), { strict: true }), scope);
    return { ...state, nodes: merge(state.nodes, declared) };
  }
  remember(scope: StackExecutionScope, targets: StackTarget[]): void {
    this.store.kvUpdateSync<TargetState>(this.key(scope), current => {
      const state = read(current, scope);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('Stack target revision exhausted');
      return { ...state, revision: state.revision + 1, nodes: merge(state.nodes, targets) };
    });
  }
  /** Store placement and its generation together with the old recipient's cleared obligations. */
  select(scope: StackExecutionScope, expectedRevision: number, placement: RemotePlacement, recheck: () => void): void {
    validateRemotePlacement(placement, scope);
    this.store.kvUpdateSync<TargetState>(this.key(scope), current => {
      const state = read(current, scope);
      if (state.nodes.length || state.revision !== expectedRevision || state.revision === Number.MAX_SAFE_INTEGER ||
          placement.receipt.generation !== expectedRevision + 1) throw Error('Stack target generation or outstanding deployment obligations changed');
      recheck();
      // Earlier writers reject v2 before deployment or stop; they cannot discard this binding in a v1 update.
      return { ...state, version: 2, revision: state.revision + 1, placement };
    });
  }
  activated(scope: StackExecutionScope, digest: string, confirmation?: StackLaunchConfirmation): void {
    this.store.kvUpdateSync<TargetState>(this.key(scope), current => {
      const state = read(current, scope);
      if (state.placement?.receipt.digest !== digest) throw Error('Remote placement changed before confirming activation');
      const selected = state.placement.selected;
      if (confirmation && (!selected || confirmation.id !== selected.release || confirmation.manifestSha256 !== selected.manifestSha256 ||
          confirmation.nodeId !== selected.nodeId || confirmation.node !== stackNodeKey(selected.host, selected.port)))
        throw Error('Launch confirmation does not match the selected release and recipient');
      const retained = state.placement.confirmation;
      if (retained && confirmation) {
        const ids = [...new Set([...(retained.journalRuns ?? []), ...(confirmation.journalRuns ?? [])])];
        if (ids.length === (retained.journalRuns?.length ?? 0)) return state;
        if (ids.length > 16) throw Error('A launch can reference up to 16 related Pipeline journals');
        confirmation = { ...retained, journalRuns: ids };
      } else if (state.placement.activated && !confirmation) return state;
      if (state.revision === Number.MAX_SAFE_INTEGER) throw Error('Stack target revision exhausted');
      return { ...state, revision: state.revision + 1, placement: { ...state.placement, activated: true, ...(confirmation && { confirmation }) } };
    });
  }
  confirmStopped(scope: StackExecutionScope, revision: number): void {
    this.store.kvUpdateSync<TargetState>(this.key(scope), current => {
      const state = read(current, scope);
      if (state.revision !== revision) throw new Error('Deployment targets changed during stop; inspect and reconcile again');
      if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('Stack target revision exhausted');
      return { ...state, revision: state.revision + 1, nodes: [] };
    });
  }
}
