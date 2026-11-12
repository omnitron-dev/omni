/**
 * Write-ahead invalidation for controller bookkeeping. Application processes
 * remain in the owner; this boundary only decides whether a saved controller
 * snapshot is safe to reuse after its process has died.
 */
export class RecoveryState {
  private revision = 0;
  private readonly active = new Map<string, number>();
  private invalidate: ((reason: string) => void) | null = null;

  attach(invalidate: (reason: string) => void): () => void {
    if (this.invalidate) throw new Error('A recovery journal is already attached');
    invalidate('Controller startup has not published a recovery snapshot');
    this.invalidate = invalidate;
    return () => { if (this.invalidate === invalidate) this.invalidate = null; };
  }

  token(): number | null { return this.active.size === 0 ? this.revision : null; }
  unchanged(token: number): boolean { return this.active.size === 0 && token === this.revision; }

  /** A current observation, not a history of the last invalidation. Nested
   * operations with the same name remain active until every caller settles. */
  pendingOperations(): Array<{ reason: string; count: number }> {
    return [...this.active].map(([reason, count]) => ({ reason, count }));
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

/** A finite list of ownership mutations, including internal scheduled work. */
export function RecoveryMutation(): MethodDecorator {
  return (_target, name, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    descriptor.value = function recoverableMutation(this: unknown, ...args: unknown[]) {
      return recoveryState.run(String(name), () => original.apply(this, args));
    };
  };
}
