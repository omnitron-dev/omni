/**
 * LifecycleController — phased graceful shutdown with hard exit guarantee.
 *
 * Standalone primitive (no DI dependencies) that drives the shutdown
 * sequence for any Titan-based runtime: full Application instances,
 * lightweight worker-runtimes (titan-pm), the omnitron daemon, or
 * any process that wants robust signal handling.
 *
 * The contract:
 *
 *   register(task)   — attach a hook scoped to a phase (priority bucket)
 *   shutdown(reason) — execute every registered task in phase order;
 *                      exits the process exactly once when done OR when
 *                      the total deadline elapses, whichever comes first
 *
 * Phases (priority buckets) — drives both ordering AND parallelism:
 *
 *   First..High      (0–29):   "stop accepting work"
 *                              drain queues, flag unhealthy, close listeners
 *   AboveNormal..Below (30–79): "stop runtime"
 *                              cancel timers, scheduled tasks, watchers
 *   Low..Last        (80–100): "dispose"
 *                              close DB pools, redis, KMS, flush logs
 *
 * Tasks within the same priority bucket run **in parallel** by default
 * (they're meant to be independent). A task can opt out with
 * `parallel: false`. Tasks across buckets are strictly sequential.
 *
 * Exit guarantees:
 *
 *   1. Each bucket has its own deadline (`bucketTimeoutMs`, default 10s).
 *      A bucket whose tasks haven't finished is abandoned — any in-flight
 *      promises are left running but the controller moves on.
 *
 *   2. The total shutdown has a global deadline (`totalTimeoutMs`,
 *      default 30s). If hit, controller force-exits immediately.
 *
 *   3. process.exit() ALWAYS runs at the end (success path, deadline
 *      path, or critical-failure path) unless explicitly disabled for
 *      tests via `setExitOverride`. There is no path where the process
 *      stays alive after `shutdown()` resolves.
 *
 * Signal handling:
 *
 *   `installSignalHandlers()` wires SIGTERM/SIGINT/SIGHUP to call
 *   `shutdown()` exactly once per signal. Subsequent signals during an
 *   in-flight shutdown trigger a hard force-exit (operator wants out).
 *
 * Telemetry:
 *
 *   Each phase emits start/finish/timeout events to the optional
 *   `onPhaseEvent` hook — Prometheus exporters or structured loggers
 *   consume that without coupling to the controller.
 */

import type { IShutdownTask, ShutdownReason } from '../types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Phase derived from a task's priority bucket. Surfaced in events and
 * metrics; not used to register tasks (priority numbers stay the
 * single source of truth — see `bucketOf`).
 */
export type LifecyclePhase = 'pre-stop' | 'stop-runtime' | 'dispose';

export interface LifecycleControllerOptions {
  /** Default per-task timeout when the task itself doesn't specify one. */
  readonly defaultTaskTimeoutMs?: number;
  /** Per-bucket budget. Tasks not finishing inside the budget are abandoned. */
  readonly bucketTimeoutMs?: number;
  /**
   * Total shutdown budget. After this elapses the controller force-exits
   * regardless of where it was. Should be ≥ sum(bucketTimeoutMs * #buckets).
   */
  readonly totalTimeoutMs?: number;
  /**
   * Buffer added on top of `totalTimeoutMs` before the safety net
   * `process.exit(2)` fires from a separate timer. The two timers are
   * defence in depth — if anything in `shutdown()` itself hangs, the
   * safety net still gets the process out.
   */
  readonly forceKillBufferMs?: number;
  /** Optional structured logger; falls back to console at info level. */
  readonly logger?: LifecycleLogger;
  /** Optional telemetry sink — see `LifecyclePhaseEvent`. */
  readonly onPhaseEvent?: (event: LifecyclePhaseEvent) => void;
  /**
   * Override `process.exit` (mainly for tests). Returning `false`
   * suppresses exit; returning `true` (default) exits with the code
   * passed in. The override receives the same code the controller
   * would use otherwise.
   */
  readonly exitOverride?: (code: number) => boolean | void;
}

export interface LifecycleLogger {
  debug(payload: unknown, msg?: string): void;
  info(payload: unknown, msg?: string): void;
  warn(payload: unknown, msg?: string): void;
  error(payload: unknown, msg?: string): void;
}

export interface LifecyclePhaseEvent {
  readonly phase: LifecyclePhase;
  readonly kind: 'phase-start' | 'phase-finish' | 'phase-timeout' | 'task-start' | 'task-finish' | 'task-error';
  readonly taskName?: string;
  readonly durationMs?: number;
  readonly error?: unknown;
}

/**
 * Map a task's priority number to a LifecyclePhase. Existing apps use
 * the ShutdownPriority enum values (0–100); the bucketing keeps that
 * model alive without forcing migration.
 */
export function bucketOf(priority: number): LifecyclePhase {
  if (priority < 30) return 'pre-stop';
  if (priority < 80) return 'stop-runtime';
  return 'dispose';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Strict order — must match the keys callers expect to see in events. */
const PHASE_ORDER: readonly LifecyclePhase[] = ['pre-stop', 'stop-runtime', 'dispose'];

const DEFAULTS = {
  defaultTaskTimeoutMs: 10_000,
  bucketTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
  forceKillBufferMs: 1_000,
} as const;

/**
 * Internal task record. Each `register()` call inserts one entry; the
 * record carries the bucket lookup we computed once so we don't redo
 * it during shutdown.
 */
interface TaskRecord extends IShutdownTask {
  readonly id: string;
  readonly priority: number;
  readonly phase: LifecyclePhase;
}

export class LifecycleController {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly opts: Required<Omit<LifecycleControllerOptions, 'logger' | 'onPhaseEvent' | 'exitOverride'>> &
    Pick<LifecycleControllerOptions, 'logger' | 'onPhaseEvent' | 'exitOverride'>;

  private signalHandlers = new Map<NodeJS.Signals, NodeJS.SignalsListener>();
  private uncaughtListener?: (err: Error) => void;
  private rejectionListener?: (reason: unknown) => void;
  private shutdownPromise: Promise<void> | null = null;
  private forceKillTimer: NodeJS.Timeout | null = null;

  constructor(options: LifecycleControllerOptions = {}) {
    this.opts = {
      defaultTaskTimeoutMs: options.defaultTaskTimeoutMs ?? DEFAULTS.defaultTaskTimeoutMs,
      bucketTimeoutMs: options.bucketTimeoutMs ?? DEFAULTS.bucketTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs ?? DEFAULTS.totalTimeoutMs,
      forceKillBufferMs: options.forceKillBufferMs ?? DEFAULTS.forceKillBufferMs,
      logger: options.logger,
      onPhaseEvent: options.onPhaseEvent,
      exitOverride: options.exitOverride,
    };
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a task. Returns an unregister function for cases where
   * the registrant's own lifecycle (test teardown, hot reload) wants
   * to detach.
   */
  register(task: IShutdownTask): () => void {
    const id = task.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const priority = task.priority ?? 50;
    const record: TaskRecord = {
      ...task,
      id,
      priority,
      phase: bucketOf(priority),
    };
    this.tasks.set(id, record);
    return () => {
      this.tasks.delete(id);
    };
  }

  /** Remove a previously-registered task by id. No-op if unknown. */
  unregister(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /** Visible for diagnostics / tests. */
  size(): number {
    return this.tasks.size;
  }

  // -------------------------------------------------------------------------
  // Signal handling
  // -------------------------------------------------------------------------

  /**
   * Attach SIGTERM/SIGINT/SIGHUP listeners. First signal triggers
   * shutdown; a second signal during the in-flight shutdown forces
   * an immediate exit (operator wants out NOW, e.g. impatient Ctrl+C).
   *
   * Returns an `uninstall` function that removes the listeners. Safe
   * to call once.
   */
  installSignalHandlers(): () => void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    for (const signal of signals) {
      const handler = () => {
        if (this.shutdownPromise) {
          // Second signal — operator wants force exit.
          this.opts.logger?.warn?.({ signal }, 'second signal during shutdown — force exit');
          this.exit(2);
          return;
        }
        const reason = signalReason(signal);
        void this.shutdown(reason, { signal });
      };
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    // Uncaught exception / rejection → shutdown with non-zero exit.
    this.uncaughtListener = (err: Error) => {
      this.opts.logger?.error?.({ err }, 'uncaughtException — shutting down');
      void this.shutdown('uncaughtException' as ShutdownReason, { error: err }, /* exitCode */ 1);
    };
    this.rejectionListener = (reason: unknown) => {
      this.opts.logger?.error?.({ reason }, 'unhandledRejection — shutting down');
      void this.shutdown('unhandledRejection' as ShutdownReason, { reason }, /* exitCode */ 1);
    };
    process.on('uncaughtException', this.uncaughtListener);
    process.on('unhandledRejection', this.rejectionListener);

    return () => this.uninstallSignalHandlers();
  }

  /** Detach signal listeners. Safe to call without prior install. */
  uninstallSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.off(signal, handler);
    }
    this.signalHandlers.clear();
    if (this.uncaughtListener) process.off('uncaughtException', this.uncaughtListener);
    if (this.rejectionListener) process.off('unhandledRejection', this.rejectionListener);
    this.uncaughtListener = undefined;
    this.rejectionListener = undefined;
  }

  // -------------------------------------------------------------------------
  // Shutdown — phased execution + hard exit guarantee
  // -------------------------------------------------------------------------

  /**
   * Run all registered tasks in phase order, then exit the process.
   * Concurrent calls coalesce — only the first call drives the
   * shutdown; others await the same promise.
   */
  shutdown(reason: ShutdownReason, details?: unknown, exitCode = 0): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.runShutdown(reason, details, exitCode);
    return this.shutdownPromise;
  }

  private async runShutdown(reason: ShutdownReason, details: unknown, exitCode: number): Promise<void> {
    // Arm the safety net: even if our own logic hangs, this fires.
    const forceKillAt = this.opts.totalTimeoutMs + this.opts.forceKillBufferMs;
    this.forceKillTimer = setTimeout(() => {
      this.opts.logger?.error?.(
        { totalTimeoutMs: this.opts.totalTimeoutMs, forceKillBufferMs: this.opts.forceKillBufferMs },
        'shutdown safety net fired — force-exiting',
      );
      this.exit(2);
    }, forceKillAt);
    this.forceKillTimer.unref(); // don't keep the loop alive on its own

    const overallStart = Date.now();
    let aggregateError: unknown = null;

    try {
      for (const phase of PHASE_ORDER) {
        const elapsed = Date.now() - overallStart;
        const remaining = this.opts.totalTimeoutMs - elapsed;
        if (remaining <= 0) {
          this.opts.logger?.warn?.({ phase, elapsed }, 'total shutdown deadline reached — skipping remaining phases');
          break;
        }
        const phaseDeadline = Math.min(this.opts.bucketTimeoutMs, remaining);
        await this.runPhase(phase, reason, details, phaseDeadline);
      }
    } catch (err) {
      aggregateError = err;
      this.opts.logger?.error?.({ err }, 'shutdown phase aborted');
    } finally {
      if (this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = null;
      }
    }

    // Final exit. If a critical task failed, surface non-zero.
    const finalCode = aggregateError ? 1 : exitCode;
    this.exit(finalCode);

    if (aggregateError) throw aggregateError;
  }

  /**
   * Drive every task in `phase`. Tasks marked `parallel !== false`
   * (default true) within the phase race together; sequential tasks
   * (`parallel: false`) run after the parallel batch in registration
   * order. Critical-task failure aborts the phase but does not cancel
   * already-running peers.
   */
  private async runPhase(
    phase: LifecyclePhase,
    reason: ShutdownReason,
    details: unknown,
    phaseDeadlineMs: number,
  ): Promise<void> {
    const phaseTasks = [...this.tasks.values()]
      .filter((t) => t.phase === phase)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id);
      });
    if (phaseTasks.length === 0) return;

    const phaseStart = Date.now();
    this.emitPhaseEvent({ phase, kind: 'phase-start' });
    this.opts.logger?.info?.(
      { phase, tasks: phaseTasks.length, deadlineMs: phaseDeadlineMs },
      'lifecycle: phase started',
    );

    const parallelBatch = phaseTasks.filter((t) => t.parallel !== false);
    const sequentialBatch = phaseTasks.filter((t) => t.parallel === false);

    let phaseError: unknown = null;

    // Run the parallel batch under a single phase-deadline race. If
    // the batch overruns, we abandon outstanding tasks and continue.
    if (parallelBatch.length > 0) {
      try {
        await this.raceWithDeadline(
          Promise.all(parallelBatch.map((task) => this.runTask(task, reason, details))),
          phaseDeadlineMs,
          phase,
        );
      } catch (err) {
        if (isCritical(err)) {
          phaseError = err;
        }
      }
    }

    // Sequential tasks fire only if we still have budget; each gets
    // whatever's left of the phase budget.
    for (const task of sequentialBatch) {
      const used = Date.now() - phaseStart;
      const remaining = phaseDeadlineMs - used;
      if (remaining <= 0) {
        this.emitPhaseEvent({ phase, kind: 'phase-timeout', taskName: task.name });
        break;
      }
      try {
        await this.raceWithDeadline(this.runTask(task, reason, details), remaining, phase);
      } catch (err) {
        if (isCritical(err)) {
          phaseError = err;
          break;
        }
      }
    }

    const durationMs = Date.now() - phaseStart;
    this.emitPhaseEvent({ phase, kind: 'phase-finish', durationMs });
    this.opts.logger?.info?.({ phase, durationMs }, 'lifecycle: phase finished');

    if (phaseError) throw phaseError;
  }

  /**
   * Execute a single task with its individual timeout (falling back to
   * the controller default). Wraps every error so the caller can tell
   * "critical" from "ordinary" without re-inspecting the task record.
   */
  private async runTask(task: TaskRecord, reason: ShutdownReason, details: unknown): Promise<void> {
    const taskTimeoutMs = task.timeout ?? this.opts.defaultTaskTimeoutMs;
    const taskStart = Date.now();
    this.emitPhaseEvent({ phase: task.phase, kind: 'task-start', taskName: task.name });
    try {
      await this.raceWithDeadline(
        Promise.resolve(task.handler(reason, details)),
        taskTimeoutMs,
        task.phase,
        task.name,
      );
      const durationMs = Date.now() - taskStart;
      this.emitPhaseEvent({ phase: task.phase, kind: 'task-finish', taskName: task.name, durationMs });
    } catch (err) {
      const durationMs = Date.now() - taskStart;
      this.emitPhaseEvent({ phase: task.phase, kind: 'task-error', taskName: task.name, durationMs, error: err });
      this.opts.logger?.error?.({ err, taskName: task.name, phase: task.phase }, 'lifecycle: task failed');
      if (task.critical) {
        throw makeCritical(`Critical shutdown task failed: ${task.name}`, err);
      }
      // Non-critical failures don't propagate — sibling tasks should
      // still get their chance.
    }
  }

  /**
   * Promise.race against a deadline. Resolved as void so the caller
   * doesn't need to know the original return type.
   */
  private raceWithDeadline<T>(
    promise: Promise<T>,
    timeoutMs: number,
    phase: LifecyclePhase,
    taskName?: string,
  ): Promise<void> {
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new LifecycleTimeoutError(phase, taskName, timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([promise.then(() => undefined), timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  // -------------------------------------------------------------------------
  // Exit
  // -------------------------------------------------------------------------

  /** Single source of truth for process termination. */
  private exit(code: number): void {
    // Tests can suppress exit; everyone else gets out.
    if (this.opts.exitOverride) {
      const result = this.opts.exitOverride(code);
      if (result === false) return;
    }
    // We use process.exit (not exitCode + natural unwind) because the
    // whole point of shutdown is to STOP — leftover handles holding
    // sockets must not keep us alive.
    process.exit(code);
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  private emitPhaseEvent(event: LifecyclePhaseEvent): void {
    try {
      this.opts.onPhaseEvent?.(event);
    } catch (err) {
      // Telemetry must never break shutdown.
      this.opts.logger?.warn?.({ err }, 'onPhaseEvent threw');
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CRITICAL_SIGIL = Symbol('lifecycle.critical');

interface CriticalError extends Error {
  readonly [CRITICAL_SIGIL]: true;
  readonly cause: unknown;
}

function makeCritical(message: string, cause: unknown): CriticalError {
  const e = new Error(message) as CriticalError;
  (e as { cause: unknown }).cause = cause;
  Object.defineProperty(e, CRITICAL_SIGIL, { value: true, enumerable: false });
  return e;
}

function isCritical(err: unknown): err is CriticalError {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[CRITICAL_SIGIL] === true;
}

export class LifecycleTimeoutError extends Error {
  constructor(
    public readonly phase: LifecyclePhase,
    public readonly taskName: string | undefined,
    public readonly timeoutMs: number,
  ) {
    super(
      taskName
        ? `Lifecycle task "${taskName}" exceeded ${timeoutMs}ms in phase "${phase}"`
        : `Lifecycle phase "${phase}" exceeded ${timeoutMs}ms`,
    );
    this.name = 'LifecycleTimeoutError';
  }
}

function signalReason(signal: NodeJS.Signals): ShutdownReason {
  switch (signal) {
    case 'SIGTERM':
      return 'SIGTERM' as ShutdownReason;
    case 'SIGINT':
      return 'SIGINT' as ShutdownReason;
    case 'SIGHUP':
      return 'SIGHUP' as ShutdownReason;
    default:
      return 'signal' as ShutdownReason;
  }
}
