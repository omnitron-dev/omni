/**
 * PeriodicProbe — shared scaffolding for periodic health/probe loops.
 *
 * HEARTBEAT-UNIFY: the netron connection manager and multi-backend pool each
 * hand-rolled the SAME pattern — `setInterval` + a re-entrancy guard (T#50: a
 * slow async sweep must not pile up overlapping rounds) + start/stop. This
 * centralises that scaffolding (one tested implementation of the guard, unref
 * and lifecycle) so the per-loop code keeps only its actual probe `task`.
 *
 * Deliberately scaffolding-only: it unifies the timer plumbing, NOT the health
 * concern. The `task` is whatever each loop already did.
 *
 * @since 0.1.0
 */

export interface PeriodicProbeOptions {
  /** Interval between ticks, in milliseconds. */
  intervalMs: number;
  /** The probe work to run each tick. May be sync or async; its return value is ignored. */
  task: () => unknown;
  /**
   * Invoked with any error thrown synchronously by `task` or rejected by its
   * returned promise. If omitted, such errors are swallowed (the caller opted
   * out of error handling — matching loops that never reject).
   */
  onError?: (error: unknown) => void;
  /**
   * Drop a tick when the previous `task` is still running (re-entrancy guard).
   * Prevents a slow async sweep from piling up overlapping rounds. Default true.
   */
  preventOverlap?: boolean;
  /** Run `task` once immediately on {@link start}, before the first interval. Default false. */
  runImmediately?: boolean;
  /** `unref()` the interval so it alone won't keep the Node process alive. Default false. */
  unref?: boolean;
}

/**
 * A start/stoppable periodic task with a built-in re-entrancy guard.
 */
export class PeriodicProbe {
  private timer?: ReturnType<typeof setInterval>;
  private taskRunning = false;

  constructor(private readonly options: PeriodicProbeOptions) {}

  /** Whether the interval is currently active. */
  get isActive(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Start ticking. Idempotent — a no-op if already active (callers that need to
   * reconfigure should {@link stop} first).
   */
  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    if (this.options.runImmediately) {
      this.runTick();
    }
    this.timer = setInterval(() => this.runTick(), this.options.intervalMs);
    if (this.options.unref) {
      this.timer.unref?.();
    }
  }

  /** Stop ticking and clear the interval. Idempotent. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.taskRunning = false;
  }

  /**
   * Run one tick. `task` is invoked SYNCHRONOUSLY (matching the hand-rolled
   * loops), then its result (if a promise) is awaited to release the guard;
   * synchronous throws and async rejections both route to `onError`.
   */
  private runTick(): void {
    if (this.options.preventOverlap !== false && this.taskRunning) {
      return;
    }
    this.taskRunning = true;
    try {
      const result = this.options.task();
      if (result instanceof Promise) {
        result
          .catch((error) => {
            this.options.onError?.(error);
          })
          .finally(() => {
            this.taskRunning = false;
          });
      } else {
        // Synchronous task completed within the tick.
        this.taskRunning = false;
      }
    } catch (error) {
      // Synchronous throw from task().
      this.options.onError?.(error);
      this.taskRunning = false;
    }
  }
}
