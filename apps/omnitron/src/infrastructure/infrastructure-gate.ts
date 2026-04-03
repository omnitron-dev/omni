/**
 * InfrastructureGate — Promise-based readiness gate
 *
 * Apps that declare `requires` in their bootstrap config must NOT start
 * until infrastructure (postgres, redis, minio) is provisioned and healthy.
 *
 * The daemon calls `markReady()` after successful infra provisioning.
 * The orchestrator calls `waitForReady()` before launching apps that need infra.
 */

import type { InfrastructureState } from './types.js';

export class InfrastructureGate {
  private readyResolve: ((state: InfrastructureState) => void) | null = null;
  private readyPromise: Promise<InfrastructureState>;
  private state: InfrastructureState | null = null;
  private failed = false;
  private failReason: string | null = null;

  constructor() {
    this.readyPromise = new Promise<InfrastructureState>((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /**
   * Mark infrastructure as ready. Resolves all pending `waitForReady()` calls.
   */
  markReady(state: InfrastructureState): void {
    this.state = state;
    this.failed = false;
    this.failReason = null;
    if (this.readyResolve) {
      this.readyResolve(state);
      this.readyResolve = null;
    }
  }

  /**
   * Mark infrastructure provisioning as failed.
   * Apps waiting on the gate will proceed with a degraded state
   * rather than hanging forever.
   */
  markFailed(reason: string): void {
    this.failed = true;
    this.failReason = reason;
    // Resolve with empty state so waiters don't hang
    if (this.readyResolve) {
      this.readyResolve({ services: {}, ready: false });
      this.readyResolve = null;
    }
  }

  /**
   * Wait for infrastructure to become ready.
   * Returns immediately if already ready.
   * Throws if timeout is exceeded.
   */
  async waitForReady(timeoutMs = 120_000): Promise<InfrastructureState> {
    if (this.state) return this.state;

    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Infrastructure not ready after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
    });

    return Promise.race([this.readyPromise, timeout]);
  }

  /** Check if infrastructure is currently ready (non-blocking). */
  isReady(): boolean {
    return this.state?.ready === true;
  }

  /** Check if infrastructure provisioning failed. */
  isFailed(): boolean {
    return this.failed;
  }

  /** Get failure reason, if any. */
  getFailReason(): string | null {
    return this.failReason;
  }

  /** Get the current infrastructure state (null if not yet provisioned). */
  getState(): InfrastructureState | null {
    return this.state;
  }

  /**
   * Reset the gate for a fresh provisioning cycle.
   * Used when infrastructure is re-provisioned after a failure.
   */
  reset(): void {
    this.state = null;
    this.failed = false;
    this.failReason = null;
    this.readyPromise = new Promise<InfrastructureState>((resolve) => {
      this.readyResolve = resolve;
    });
  }
}
