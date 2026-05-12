/**
 * Internal collaborator — graceful-shutdown coordinator.
 *
 * Owns the shutdown-task map, the cleanup-handler set, and the
 * orchestration of `LifecycleController.shutdown()`. The split-out:
 *
 *   - registration: `registerTask` / `unregisterTask` / `registerCleanup`
 *   - default-task seeding: `seedDefaults()` registers `flush-logs`,
 *     `close-connections`, and `save-state` matching legacy semantics.
 *   - execution: `execute()` builds a fresh `LifecycleController`,
 *     funnels user tasks through it, and adds the two internal terminal
 *     tasks (`__app_di_stop`, `__app_cleanup`) at the dispose phase.
 *
 * Why a dedicated collaborator? The legacy `shutdown()` /
 * `executeShutdown()` pair was ~300 lines that interleaved concerns:
 * timeout racing, controller wiring, phase-event translation, and
 * state-machine resets. Each had its own subtle defect history (T#25
 * for the un-reset latch alone). Centralising the orchestration lets
 * the Application orchestrator say "shut down with this reason" once
 * and trust the coordinator to handle the details.
 *
 * Single responsibility: own the task / cleanup registries and drive
 * the lifecycle controller. The orchestrator supplies the two terminal
 * hooks (DI stop + cleanup) — this class doesn't reach back into
 * Application.
 *
 * @internal
 */

import { Errors } from '../../errors/index.js';
import {
  ApplicationEvent,
  ShutdownPriority,
  ShutdownReason,
  type IShutdownTask,
} from '../../types.js';
import {
  LifecycleController,
  type LifecyclePhaseEvent,
} from '../../lifecycle/index.js';
import type { ILogger } from '../../modules/logger/index.js';

/** Internal terminal task id — DI stop. */
export const INTERNAL_TASK_DI_STOP = '__app_di_stop';
/** Internal terminal task id — user cleanup handlers. */
export const INTERNAL_TASK_CLEANUP = '__app_cleanup';

const INTERNAL_TASK_IDS = new Set<string>([INTERNAL_TASK_DI_STOP, INTERNAL_TASK_CLEANUP]);

export interface ShutdownCoordinatorDeps {
  /** Default and per-task timeout for the lifecycle controller. */
  shutdownTimeoutMs: number;
  emit: (event: ApplicationEvent, data?: unknown) => void;
  getLogger: () => ILogger | undefined;
  /** Forced DI-stop callback. The orchestrator passes a closure that calls `Application.stop()`. */
  diStop: (signal?: NodeJS.Signals, timeout?: number) => Promise<void>;
}

export class ShutdownCoordinator {
  private readonly tasks = new Map<string, IShutdownTask>();
  private readonly cleanupHandlers = new Set<() => Promise<void> | void>();

  private _isShuttingDown = false;
  private _shutdownPromise: Promise<void> | null = null;

  constructor(private readonly deps: ShutdownCoordinatorDeps) {}

  // ─── Status queries ──────────────────────────────────────────────────

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  get hasTasks(): boolean {
    return this.tasks.size > 0;
  }

  get hasCleanupHandlers(): boolean {
    return this.cleanupHandlers.size > 0;
  }

  get taskCount(): number {
    return this.tasks.size;
  }

  get cleanupCount(): number {
    return this.cleanupHandlers.size;
  }

  taskValues(): IterableIterator<IShutdownTask> {
    return this.tasks.values();
  }

  // ─── Registrations ───────────────────────────────────────────────────

  /**
   * Register a task. Accepts both the object form and the legacy
   * positional form `(name, handler, priority?, critical?)`. The
   * returned id is auto-generated when not supplied.
   *
   * Default priority is `ShutdownPriority.Normal` (50). Lower numbers
   * run first; the lifecycle controller's bucketing handles ranges.
   */
  registerTask(
    taskOrName: IShutdownTask | string,
    handler?: () => void | Promise<void>,
    priority?: number,
    critical?: boolean,
  ): string {
    let task: IShutdownTask;
    if (typeof taskOrName === 'string') {
      task = {
        name: taskOrName,
        handler: handler ?? (() => undefined),
        priority: priority ?? ShutdownPriority.Normal,
        critical,
      };
    } else {
      task = { ...taskOrName };
    }
    if (!task.id) {
      task.id = `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
    if (task.priority === undefined) task.priority = ShutdownPriority.Normal;

    this.tasks.set(task.id, task);
    this.deps.getLogger()?.debug({ taskId: task.id, taskName: task.name }, 'Registered shutdown task');
    return task.id;
  }

  unregisterTask(taskId: string): void {
    this.tasks.delete(taskId);
  }

  registerCleanup(handler: () => Promise<void> | void): void {
    this.cleanupHandlers.add(handler);
  }

  /**
   * Sequentially invoke every cleanup handler, swallowing per-handler
   * exceptions so a failure in one doesn't prevent the others from
   * running. Clears the set on exit — handlers don't fire again on a
   * subsequent shutdown cycle.
   */
  async runCleanupHandlers(): Promise<void> {
    const logger = this.deps.getLogger();
    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        logger?.error({ error }, 'Cleanup handler failed');
      }
    }
    this.cleanupHandlers.clear();
  }

  // ─── Default-task seeding ────────────────────────────────────────────

  /**
   * Register the three legacy default tasks: `flush-logs`,
   * `close-connections`, `save-state`. The Application orchestrator
   * provides the logger flush implementation; we just glue priorities
   * and ids to the right slots.
   *
   * `flushLogs` is the actual flush implementation — passed in instead
   * of imported because we'd otherwise reach back into Application's
   * container access.
   */
  seedDefaults(opts: {
    flushLogs: () => Promise<void>;
    emitStateSave: () => void;
  }): void {
    const logger = this.deps.getLogger();

    this.registerTask({
      id: 'flush-logs',
      name: 'Flush Logs',
      priority: ShutdownPriority.Last,
      handler: async () => {
        logger?.info('Flushing logs...');
        try {
          await opts.flushLogs();
          logger?.info('Logs flushed successfully');
        } catch (error) {
          logger?.warn({ error }, 'Failed to flush logger');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    });

    this.registerTask({
      id: 'close-connections',
      name: 'Close Active Connections',
      priority: ShutdownPriority.High,
      handler: async () => {
        logger?.info('Closing active connections');
      },
    });

    this.registerTask({
      id: 'save-state',
      name: 'Save Application State',
      priority: ShutdownPriority.VeryHigh,
      handler: async () => {
        logger?.info('Saving application state');
        opts.emitStateSave();
      },
    });
  }

  // ─── Execution ───────────────────────────────────────────────────────

  /**
   * Top-level shutdown entry. Concurrent calls join the in-flight
   * promise. The flag is RESET in the `finally` so the embedded /
   * test-mode case (where `process.exit` is suppressed) can drive a
   * second shutdown later — without the reset, every subsequent call
   * would no-op against the stale settled promise.
   */
  async shutdown(reason: ShutdownReason, details?: unknown): Promise<void> {
    if (this._isShuttingDown && this._shutdownPromise) {
      await this._shutdownPromise;
      return;
    }
    this._isShuttingDown = true;
    const logger = this.deps.getLogger();

    logger?.info({ reason, details }, 'Starting graceful shutdown');
    this.deps.emit(ApplicationEvent.ShutdownStart, { reason, details });

    this._shutdownPromise = this.executeViaController(reason, details);

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(Errors.timeout('Shutdown', this.deps.shutdownTimeoutMs)),
        this.deps.shutdownTimeoutMs);
    });

    try {
      await Promise.race([this._shutdownPromise, timeoutPromise]);
      logger?.info('Graceful shutdown completed successfully');
      this.deps.emit(ApplicationEvent.ShutdownComplete, { reason, success: true });
    } catch (error) {
      logger?.error({ error }, 'Graceful shutdown failed or timed out');
      this.deps.emit(ApplicationEvent.ShutdownError, { reason, error });
      throw error;
    } finally {
      this._isShuttingDown = false;
      this._shutdownPromise = null;
    }
  }

  /**
   * Build the controller, register tasks + internal terminal tasks,
   * and run. The terminal tasks land in the `dispose` bucket
   * (priority 1000+) so they fire after every user task.
   */
  private async executeViaController(reason: ShutdownReason, details: unknown): Promise<void> {
    const detailsWithSignal = details as { signal?: NodeJS.Signals } | undefined;

    const controller = new LifecycleController({
      bucketTimeoutMs: this.deps.shutdownTimeoutMs,
      totalTimeoutMs: this.deps.shutdownTimeoutMs,
      forceKillBufferMs: 1_000,
      defaultTaskTimeoutMs: this.deps.shutdownTimeoutMs,
      logger: this.adaptLogger(),
      onPhaseEvent: (e) => this.handlePhaseEvent(e),
      // Application owns process.exit — suppress here so the controller
      // doesn't race the outer shutdown() exit path.
      exitOverride: () => false,
    });

    for (const task of this.tasks.values()) {
      controller.register({ ...task, parallel: false });
    }
    controller.register({
      id: INTERNAL_TASK_DI_STOP,
      name: INTERNAL_TASK_DI_STOP,
      priority: 1000,
      parallel: false,
      handler: () => this.deps.diStop(detailsWithSignal?.signal, this.deps.shutdownTimeoutMs),
    });
    controller.register({
      id: INTERNAL_TASK_CLEANUP,
      name: INTERNAL_TASK_CLEANUP,
      priority: 1001,
      parallel: false,
      handler: () => this.runCleanupHandlers(),
    });

    await controller.shutdown(reason, details);
  }

  // ─── Phase-event bridge ──────────────────────────────────────────────

  /**
   * Translate `LifecyclePhaseEvent` into the legacy
   * `ShutdownTaskComplete` / `ShutdownTaskError` events. Internal
   * terminal tasks (`__app_di_stop`, `__app_cleanup`) are silenced — the
   * legacy implementation never surfaced them. Phase-level events flow
   * through the `LifecyclePhaseEvent` application event so observability
   * code can consume duration histograms without parsing the per-task
   * stream.
   */
  private handlePhaseEvent(event: LifecyclePhaseEvent): void {
    if (event.kind === 'task-finish' && event.taskName) {
      if (INTERNAL_TASK_IDS.has(event.taskName)) return;
      this.deps.getLogger()?.debug({ taskName: event.taskName }, 'Shutdown task completed');
      this.deps.emit(ApplicationEvent.ShutdownTaskComplete, { task: event.taskName });
      return;
    }
    if (event.kind === 'task-error' && event.taskName) {
      if (INTERNAL_TASK_IDS.has(event.taskName)) return;
      this.deps.getLogger()?.error(
        { error: event.error, taskName: event.taskName },
        'Shutdown task failed',
      );
      this.deps.emit(ApplicationEvent.ShutdownTaskError, {
        task: event.taskName,
        error: event.error,
      });
      return;
    }
    if (event.kind === 'phase-start' || event.kind === 'phase-finish' || event.kind === 'phase-timeout') {
      this.deps.emit(ApplicationEvent.LifecyclePhaseEvent, event);
    }
  }

  /**
   * Adapter so the controller's `LifecycleLogger` lands on the
   * application's pino-style logger. Returns undefined when no logger
   * is set so the controller's own console fallback is used.
   */
  private adaptLogger() {
    const logger = this.deps.getLogger();
    if (!logger) return undefined;
    return {
      debug: (payload: unknown, msg?: string) => logger.debug(payload as object, msg ?? ''),
      info:  (payload: unknown, msg?: string) => logger.info(payload as object, msg ?? ''),
      warn:  (payload: unknown, msg?: string) => logger.warn(payload as object, msg ?? ''),
      error: (payload: unknown, msg?: string) => logger.error(payload as object, msg ?? ''),
    };
  }
}
