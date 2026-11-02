import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { stackExecutionKey, type StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackNodeKey } from './stack-placement.js';

export interface StackTarget { host: string; port: number; applications: boolean; nodeId?: string }
interface TargetState { version: 1; revision: number; nodes: StackTarget[] }

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

function read(value: TargetState | null): TargetState {
  if (value === null) return { version: 1, revision: 0, nodes: [] };
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.nodes)) {
    throw new Error('Corrupt stack target journal');
  }
  return { ...value, nodes: merge(value.nodes) };
}

/** Deployment destinations remain obligations until every node confirms a stop. */
export class StackTargets {
  constructor(private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>) {}
  private key(scope: StackExecutionScope): string { return `lifecycle:stack-targets:${stackExecutionKey(scope)}`; }
  inspect(scope: StackExecutionScope, declared: StackTarget[] = []): TargetState {
    const state = read(this.store.kvGetSync<TargetState>(this.key(scope), { strict: true }));
    return { ...state, nodes: merge(state.nodes, declared) };
  }
  remember(scope: StackExecutionScope, targets: StackTarget[]): void {
    this.store.kvUpdateSync<TargetState>(this.key(scope), current => {
      const state = read(current);
      if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('Stack target revision exhausted');
      return { version: 1, revision: state.revision + 1, nodes: merge(state.nodes, targets) };
    });
  }
  confirmStopped(scope: StackExecutionScope, revision: number): void {
    this.store.kvUpdateSync<TargetState>(this.key(scope), current => {
      const state = read(current);
      if (state.revision !== revision) throw new Error('Deployment targets changed during stop; inspect and reconcile again');
      if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('Stack target revision exhausted');
      return { version: 1, revision: state.revision + 1, nodes: [] };
    });
  }
}
