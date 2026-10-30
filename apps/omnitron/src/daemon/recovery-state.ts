/**
 * Write-ahead invalidation for controller bookkeeping. Application processes
 * remain in the owner; this boundary only decides whether a saved controller
 * snapshot is safe to reuse after its process has died.
 */
export class RecoveryState {
  private revision = 0;
  private active = 0;
  private invalidate: ((reason: string) => void) | null = null;

  attach(invalidate: (reason: string) => void): () => void {
    if (this.invalidate) throw new Error('A recovery journal is already attached');
    invalidate('Controller startup has not published a recovery snapshot');
    this.invalidate = invalidate;
    return () => { if (this.invalidate === invalidate) this.invalidate = null; };
  }

  token(): number | null { return this.active === 0 ? this.revision : null; }
  unchanged(token: number): boolean { return this.active === 0 && token === this.revision; }

  run<T>(reason: string, work: () => T): T {
    // Persistence must precede even synchronous mutation. Failure refuses
    // the operation instead of leaving an apparently recoverable old state.
    this.invalidate?.(reason);
    this.revision++;
    this.active++;
    let asynchronous = false;
    try {
      const result = work();
      if (result instanceof Promise) {
        asynchronous = true;
        return result.finally(() => { this.active--; }) as T;
      }
      return result;
    } finally { if (!asynchronous) this.active--; }
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
