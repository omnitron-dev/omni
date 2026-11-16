import { retry, BackoffStrategy } from '@omnitron-dev/titan/utils';

/**
 * Write-ahead invalidation for controller bookkeeping. Application processes
 * remain in the owner; this boundary only decides whether a saved controller
 * snapshot is safe to reuse after its process has died.
 */
export class RecoveryState {
  private revision = 0;
  private readonly active = new Map<string, number>();
  private readonly held = new Map<string, string>();
  private invalidate: ((reason: string) => void) | null = null;

  attach(invalidate: (reason: string) => void): () => void {
    if (this.invalidate) throw new Error('A recovery journal is already attached');
    invalidate('Controller startup has not published a recovery snapshot');
    this.invalidate = invalidate;
    return () => { if (this.invalidate === invalidate) this.invalidate = null; };
  }

  token(): number | null { return this.active.size === 0 && this.held.size === 0 ? this.revision : null; }
  unchanged(token: number): boolean { return this.token() === token; }

  /** Read-only review may account for exact known operations. This token is
   * never a recovery certificate: token()/unchanged() remain strictly idle. */
  reviewToken(active: ReadonlyMap<string, number>, holds: ReadonlySet<string>): number | null {
    if (this.active.size !== active.size || this.held.size !== holds.size ||
        [...this.active].some(([reason, count]) => active.get(reason) !== count) ||
        [...this.held.keys()].some(id => !holds.has(id))) return null;
    return this.revision;
  }

  /** A durable operation outlives its caller. Only its journal may release this
   * hold, after recording a known outcome; a rejected promise is insufficient. */
  hold(id: string, reason: string): void {
    const previous = this.held.get(id);
    if (previous !== undefined) {
      if (previous !== reason) throw new Error(`Recovery hold ${id} has a different reason`);
      return;
    }
    this.invalidate?.(reason);
    this.revision++;
    this.held.set(id, reason);
  }

  release(id: string): void {
    if (this.held.delete(id)) this.revision++;
  }

  /** A current observation, not a history of the last invalidation. Nested
   * operations with the same name remain active until every caller settles. */
  pendingOperations(): Array<{ reason: string; count: number }> {
    const pending = new Map(this.active);
    for (const reason of this.held.values()) pending.set(reason, (pending.get(reason) ?? 0) + 1);
    return [...pending].map(([reason, count]) => ({ reason, count }));
  }

  run<T>(reason: string, work: () => T): T {
    // Persistence must precede even synchronous mutation. Failure refuses
    // the operation instead of leaving an apparently recoverable old state.
    this.invalidate?.(reason);
    this.revision++;
    this.active.set(reason, (this.active.get(reason) ?? 0) + 1);
    const settled = () => {
      const remaining = this.active.get(reason)! - 1;
      if (remaining === 0) this.active.delete(reason);
      else this.active.set(reason, remaining);
    };
    let asynchronous = false;
    try {
      const result = work();
      if (result instanceof Promise) {
        asynchronous = true;
        return result.finally(settled) as T;
      }
      return result;
    } finally { if (!asynchronous) settled(); }
  }
}

export const recoveryState = new RecoveryState();
export class RecoveryBusyError extends Error {}

/** Wait only for transient read-side ownership observations. The caller keeps
 * its revision fence; native mutations and payload verification are not retried. */
export function observeRecoveryState<T>(capture: () => T): Promise<T> {
  const deadline = performance.now() + 30_000;
  return retry(async () => capture(), {
    maxRetries: 120, initialDelay: 250, maxDelay: 250,
    backoffStrategy: BackoffStrategy.Fixed, jitterFactor: 0,
    shouldRetry: error => error instanceof RecoveryBusyError && performance.now() < deadline,
  });
}

/** A finite list of ownership mutations, including internal scheduled work. */
export function RecoveryMutation(): MethodDecorator {
  return (_target, name, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = function recoverableMutation(this: unknown, ...args: unknown[]) {
      return recoveryState.run(String(name), () => original.apply(this, args));
    };
  };
}
