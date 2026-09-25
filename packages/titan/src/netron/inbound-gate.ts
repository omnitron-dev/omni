/**
 * The door every inbound invocation passes through, and the one place that
 * decides whether it may.
 *
 * Inbound means taken off the wire: an HTTP `/netron/invoke`, `/batch` or
 * `/authenticate`, and a remote peer's `call`/`get`/`set` packet (WebSocket,
 * TCP, unix). Calls through the local peer and outbound S2S clients do not pass
 * here — they belong to the process's own work, its teardown included.
 *
 * Why it exists: `Application.stop()` tore its modules down — the database
 * manager's `@PreDestroy` closed every connection — while the transports were
 * still accepting and running calls; they were closed last. Measured on daos
 * main, 2026-09-25: for ~1.85 s after «Closing all database connections» a
 * sign-up was accepted, CREATED the account, and answered «Database connection
 * with id default not found». Every restart and every deploy of every app, and
 * of the omnitron daemon, has that window.
 *
 * So the first step of stopping is `drain()`: from then on every NEW inbound
 * call is refused — 503 with `SHUTTING_DOWN`, which a client may retry on
 * another process — and the calls already running are waited for, up to a
 * ceiling, before anything is torn down.
 */

import { ErrorCode, TitanError } from '../errors/index.js';

/** The business code a refused call carries. */
export const SHUTTING_DOWN = 'SHUTTING_DOWN';

/** What a caller is told when it arrives after stopping has begun. */
export function shuttingDownError(): TitanError {
  return new TitanError({
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message: 'The server is shutting down; retry the call on another instance',
    details: { errorCode: SHUTTING_DOWN, retryable: true },
  });
}

/** How a drain ended. */
export interface DrainResult {
  /** Every admitted call finished before the ceiling. */
  drained: boolean;
  /** Admitted calls still running when the drain stopped waiting. */
  left: number;
}

export class InboundGate {
  private draining = false;
  private running = 0;
  private refusedCount = 0;
  private waiters: Array<() => void> = [];

  /**
   * Whether a new inbound call may start. When it may, it is counted as
   * running until `leave()`, which the caller must reach however it ends.
   */
  enter(): boolean {
    if (this.draining) {
      this.refusedCount++;
      return false;
    }
    this.running++;
    return true;
  }

  /** An admitted call finished — answered, failed or abandoned. */
  leave(): void {
    if (this.running > 0) this.running--;
    if (this.running === 0 && this.waiters.length > 0) {
      for (const wake of this.waiters.splice(0)) wake();
    }
  }

  /**
   * Admit calls again: the process is serving once more. The count of
   * refusals starts over with it, so it says what this run refused.
   */
  reopen(): void {
    this.draining = false;
    this.refusedCount = 0;
  }

  /** Stopping has begun: new calls are being refused. */
  get isDraining(): boolean {
    return this.draining;
  }

  /** Admitted calls not yet finished. */
  get inflight(): number {
    return this.running;
  }

  /** Calls refused since the drain began. */
  get refused(): number {
    return this.refusedCount;
  }

  /**
   * Refuse every new call from now on, and wait for the running ones — at most
   * `timeoutMs`. Never throws: a call that hangs must not hold the process past
   * its ceiling, and `timeoutMs <= 0` (a forced stop) does not wait at all.
   */
  async drain(timeoutMs: number): Promise<DrainResult> {
    this.draining = true;
    if (this.running === 0 || timeoutMs <= 0) {
      return { drained: this.running === 0, left: this.running };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      new Promise<boolean>((resolve) => this.waiters.push(() => resolve(true))),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
    return { drained, left: this.running };
  }
}
