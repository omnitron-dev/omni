/**
 * Process Supervisor Implementation
 *
 * Implements supervision trees for fault-tolerant process management.
 *
 * Two creation modes:
 *   1. Decorator-based: @Supervisor + @Child decorators on a class
 *   2. Config-based: ISupervisorConfig object (no decorators needed)
 *
 * Config-based mode is designed for orchestrators, process managers,
 * and other systems that create supervision trees programmatically.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type {
  ISupervisorOptions,
  ISupervisorChild,
  ISupervisorConfig,
  ISupervisorChildConfig,
  IProcessManager,
  IProcessInfo,
  IProcessMetrics,
  IHealthStatus,
} from './types.js';
import { SupervisionStrategy, RestartDecision } from './types.js';

import { SUPERVISOR_METADATA_KEY } from './decorators.js';

/**
 * Process supervisor for managing child processes with restart strategies.
 *
 * Events:
 *   - 'child:crash' (name, error) — child crashed
 *   - 'child:restart' (name, attempt) — child restarting
 *   - 'child:started' (name) — child successfully started
 *   - 'child:stopped' (name) — child stopped
 *   - 'child:start-failed' (name, error) — child failed to start (T#60).
 *       Emitted on every startup failure, including non-critical/optional
 *       children that no longer propagate the exception. Subscribe to
 *       observe partial-startup conditions instead of polling.
 *   - 'escalate' (name, error) — critical child exceeded max restarts
 *   - 'shutdown' () — supervisor shutting down
 */
export class ProcessSupervisor extends EventEmitter {
  private children = new Map<string, { info: ISupervisorChild; proxy: any }>();
  /** Reverse lookup map for O(1) processId -> name resolution */
  private readonly processIdToName = new Map<string, string>();
  private restartCounts = new Map<string, number>();
  private restartTimestamps = new Map<string, number[]>();
  private isStarted = false;
  /**
   * In-flight start promise so concurrent `start()` calls join the
   * same async operation instead of racing through `setupMonitoring()`
   * twice and registering duplicate crash handlers (T#59).
   */
  private startPromise: Promise<void> | null = null;
  /**
   * `true` once `stop()` has begun, BEFORE any child has been removed.
   * The crash handler reads this flag and refuses to restart anyone
   * whose crash arrives while the supervisor is mid-shutdown. Without
   * this gate, a child crashing during stop() would be `performRestart`-ed
   * — the supervisor brought it back up moments before tearing the
   * whole tree down. (T#59)
   */
  private isStopping = false;
  private crashHandler: ((info: IProcessInfo, error: Error) => Promise<void>) | null = null;

  /**
   * Pre-resolved children for config-based creation (set by fromConfig).
   * When set, getSupervisorMetadata() is bypassed.
   */
  private configChildren: Map<string, ISupervisorChild> | null = null;

  /** Custom crash handler from config */
  private configCrashHandler: ((child: ISupervisorChild, error: Error) => Promise<RestartDecision>) | null = null;

  /**
   * Pending backoff-sleep wakers tracked so `stop()` can wake every
   * in-flight `performRestart` immediately rather than letting them
   * run out their (potentially 30s) delay during shutdown. Each
   * entry is the timer handle + a `resolve` callback into the
   * sleeping promise. (T#60)
   */
  private pendingBackoffSleeps = new Set<{ timer: NodeJS.Timeout; resolve: () => void }>();

  constructor(
    private readonly manager: IProcessManager,
    private readonly SupervisorClass: new () => any,
    private readonly options: ISupervisorOptions,
    private readonly logger: ILogger
  ) {
    super();
  }

  /**
   * Create a supervisor from a plain config object (no decorators needed).
   *
   * Maps ISupervisorChildConfig[] to ISupervisorChild[] (the internal format)
   * and bypasses decorator metadata resolution.
   */
  static fromConfig(manager: IProcessManager, config: ISupervisorConfig, logger: ILogger): ProcessSupervisor {
    // Placeholder class — supervisor doesn't use it in config mode
    class ConfigSupervisor {}

    const supervisor = new ProcessSupervisor(
      manager,
      ConfigSupervisor,
      {
        strategy: config.strategy,
        maxRestarts: config.maxRestarts,
        window: config.window,
        backoff: config.backoff,
      },
      logger
    );

    // Map config children to internal ISupervisorChild format
    supervisor.configChildren = new Map();
    for (const child of config.children) {
      supervisor.configChildren.set(child.name, configChildToInternal(child));
    }

    if (config.onChildCrash) {
      supervisor.configCrashHandler = config.onChildCrash;
    }

    return supervisor;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Start the supervisor and all child processes.
   *
   * T#59: idempotent against concurrent calls. The pre-T#59 guard was
   * `if (this.isStarted) return` BEFORE the children loop, with
   * `this.isStarted = true` AFTER it — two concurrent `start()` calls
   * both passed the guard, both called `setupMonitoring()` (registering
   * two crash handlers on the manager), and both ran the children loop
   * (every child got spawned twice). Tracking the in-flight promise
   * makes concurrent callers join the same operation.
   */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.isStarted) return;
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    this.logger.info({ supervisor: this.SupervisorClass.name }, 'Starting supervisor');

    // Resolve children: config-based or decorator-based
    const childrenMap = this.configChildren ?? this.getDecoratorChildren();

    // T#52: register the crash handler BEFORE starting any children.
    // The historical order was:
    //
    //     for (...children) await startChild(...);
    //     setupMonitoring();         //  ← too late
    //
    // A child that started successfully but exited within milliseconds
    // (config error, missing port, instant assertion failure) fired its
    // `process:crash` event before `setupMonitoring()` registered the
    // listener — the crash was lost. `children.set(name, ...)` had
    // already happened, so the supervisor thought the process was
    // running while the OS process was already gone. Subsequent
    // restarts depended on user-driven `restartChild()`, and
    // `processIdToName` ended up pointing at a dead pid that would
    // never produce another event. Registering first means every
    // process:crash from t=0 reaches the handler.
    this.setupMonitoring();

    // Start child processes in order
    for (const [name, childDef] of childrenMap) {
      await this.startChild(name, childDef);
    }

    this.isStarted = true;
  }

  /**
   * Stop the supervisor and all child processes.
   *
   * T#59: sets `isStopping = true` BEFORE doing anything else so the
   * crash handler (which can fire any time before the manager-level
   * `off()` takes effect) refuses to restart children that die during
   * shutdown. Without this gate, a child crashing in the window
   * between `stop()` start and `stopChild(name)` for itself would be
   * `performRestart`-ed by the crash handler, racing the very stop
   * loop that was tearing it down.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) return;

    this.isStopping = true;
    this.logger.info({ supervisor: this.SupervisorClass.name }, 'Stopping supervisor');
    this.emit('shutdown');

    if (this.crashHandler) {
      this.manager.off('process:crash', this.crashHandler);
      this.crashHandler = null;
    }

    // T#60: wake every in-flight backoff sleep so the
    // `performRestart` paths exit immediately via the
    // `isStopping` check, instead of letting them run out
    // their full (potentially 30s) delay during teardown.
    for (const sleep of this.pendingBackoffSleeps) {
      clearTimeout(sleep.timer);
      sleep.resolve();
    }
    this.pendingBackoffSleeps.clear();

    // Stop all children in reverse order
    const names = Array.from(this.children.keys()).reverse();
    for (const name of names) {
      await this.stopChild(name);
    }

    this.isStarted = false;
    this.isStopping = false;
  }

  /**
   * Sleep for `delayMs`, but resolve immediately if `stop()` is
   * called. The sleeper enters its handle into `pendingBackoffSleeps`
   * so `stop()` can clear the timer and resolve the promise without
   * waiting for the timeout to fire (T#60).
   */
  private sleepCancellableOnStop(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      // Register the entry first so `stop()` can resolve it
      // even if the host process schedules unusually.
      const entry: { timer: NodeJS.Timeout; resolve: () => void } = {
        timer: undefined as unknown as NodeJS.Timeout,
        resolve: () => {
          this.pendingBackoffSleeps.delete(entry);
          resolve();
        },
      };
      entry.timer = setTimeout(entry.resolve, delayMs);
      this.pendingBackoffSleeps.add(entry);
    });
  }

  /**
   * Restart a specific child
   */
  async restartChild(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    await this.stopChild(name);
    await this.startChild(name, child.info);
  }

  // ============================================================================
  // Public API — child access, scaling, metrics
  // ============================================================================

  /** Get child proxy by name */
  getChildProxy(name: string): any | null {
    return this.children.get(name)?.proxy ?? null;
  }

  /** Get all child names */
  getChildNames(): string[] {
    return Array.from(this.children.keys());
  }

  /** Get PM process ID for a child */
  getChildProcessId(name: string): string | null {
    const child = this.children.get(name);
    if (!child) return null;
    return (child.proxy as any)?.__processId ?? null;
  }

  /** Get all PM process IDs across all children */
  getAllProcessIds(): string[] {
    const ids: string[] = [];
    for (const child of this.children.values()) {
      const id = (child.proxy as any)?.__processId;
      if (id) ids.push(id);
    }
    return ids;
  }

  /** Get restart count for a child */
  getRestartCount(name: string): number {
    return this.restartCounts.get(name) ?? 0;
  }

  /** Scale a pool child */
  async scaleChild(name: string, size: number): Promise<void> {
    const child = this.children.get(name);
    if (!child) throw Errors.notFound('Supervisor child', name);

    if (!child.info.pool) {
      throw Errors.badRequest(`Child '${name}' is not a pool — cannot scale`);
    }

    if (typeof child.proxy?.scale === 'function') {
      await child.proxy.scale(size);
    }
  }

  /** Get metrics for a child via PM */
  async getChildMetrics(name: string): Promise<IProcessMetrics | null> {
    const processId = this.getChildProcessId(name);
    if (!processId) return null;
    return this.manager.getMetrics(processId);
  }

  /** Get health for a child via PM */
  async getChildHealth(name: string): Promise<IHealthStatus | null> {
    const processId = this.getChildProcessId(name);
    if (!processId) return null;
    return this.manager.getHealth(processId);
  }

  /** Whether supervisor is running */
  get running(): boolean {
    return this.isStarted;
  }

  // ============================================================================
  // Private — Child lifecycle
  // ============================================================================

  private async startChild(name: string, childDef: ISupervisorChild): Promise<void> {
    this.logger.debug({ child: name }, 'Starting child process');

    try {
      let proxy;

      if (childDef.pool) {
        // Create process pool
        proxy = await this.manager.pool(childDef.processClass, childDef.pool);
      } else {
        // Create single process
        proxy = await this.manager.spawn(childDef.processClass, childDef.options);
      }

      this.children.set(name, { info: childDef, proxy });
      // P1-D — DO NOT reset `restartCounts` on successful start.
      // Pre-fix this zeroed the counter every time a child came back
      // up, so a crash → quick-restart → 2s of life → crash → restart
      // loop never tripped `maxRestarts` because the counter never
      // accumulated. The sliding-window `restartTimestamps` (below)
      // is the source of truth for the circuit-breaker; the lifetime
      // counter is for reporting (UI "restarts since boot"). Keep
      // the lifetime view monotonic so operators see the real
      // history. Only initialise when missing (first start).
      if (!this.restartCounts.has(name)) {
        this.restartCounts.set(name, 0);
      }

      // Add to reverse lookup map for O(1) crash handling
      const processId = (proxy as any).__processId;
      if (processId) {
        this.processIdToName.set(processId, name);
      }

      this.emit('child:started', name);
    } catch (error) {
      this.logger.error({ err: error, child: name }, 'Failed to start child process');

      // T#60: surface every startup failure as an event. Pre-T#60 the
      // non-critical / optional path swallowed the error in silence —
      // listeners had no way to know a child never came up. Critical
      // children still rethrow (start() rolls back the whole tree),
      // but we emit BEFORE rethrowing so subscribers get the signal
      // regardless of caller behavior.
      this.emit('child:start-failed', name, error as Error);

      if (!childDef.optional && childDef.critical) {
        throw error;
      }
    }
  }

  private async stopChild(name: string): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    this.logger.debug({ child: name, shutdownTimeout: child.info.shutdownTimeout }, 'Stopping child process');

    try {
      const processId = (child.proxy as any).__processId;
      if (processId) {
        this.processIdToName.delete(processId);
      }

      // T#61: if the child declared a per-child shutdownTimeout, we
      // need to thread it into the WorkerHandle.terminate() call.
      // `manager.kill()` doesn't accept a timeout in its current
      // signature, so for an override we fetch the WorkerHandle
      // directly and call terminate({ shutdownTimeout }). Without
      // an override we keep the historical `manager.kill(processId)`
      // path so the proxy-disconnect / health-monitor cleanup still
      // runs in the right order.
      if (processId) {
        if (typeof child.info.shutdownTimeout === 'number') {
          // Mirror manager.kill's cleanup but with the timeout
          // threaded through. Best-effort proxy disconnect first.
          try {
            if (child.proxy && typeof child.proxy.__destroy === 'function') {
              await child.proxy.__destroy();
            }
          } catch {
            /* proxy may already be dead */
          }
          const handle: any = (this.manager as any).getWorkerHandle?.(processId);
          if (handle && typeof handle.terminate === 'function') {
            await handle.terminate({ shutdownTimeout: child.info.shutdownTimeout });
          } else {
            // Manager doesn't expose getWorkerHandle in this test
            // double; fall back to manager.kill (loses the override
            // but keeps the legacy lifecycle).
            await this.manager.kill(processId);
          }
        } else {
          await this.manager.kill(processId);
        }
      } else {
        // Fallback: try pool destroy or direct proxy cleanup
        try {
          if (typeof child.proxy?.destroy === 'function') {
            await child.proxy.destroy();
          } else if ('__destroy' in child.proxy) {
            await child.proxy.__destroy();
          }
        } catch {
          // Best-effort cleanup — process may already be gone
        }
      }

      this.children.delete(name);
      this.emit('child:stopped', name);
    } catch (error) {
      this.logger.error({ err: error, child: name }, 'Failed to stop child process');
    }
  }

  // ============================================================================
  // Private — Crash handling
  // ============================================================================

  private setupMonitoring(): void {
    this.crashHandler = async (info: IProcessInfo, error: Error) => {
      try {
        // T#59: drop crash events that arrive while we're tearing
        // the supervisor down. The pre-T#59 handler still ran
        // `performRestart` on these, racing the stop loop — a
        // shut-down child would briefly come back online before
        // being killed again moments later. Emitting `child:crash`
        // (without restart) preserves observability for tests that
        // assert on the event.
        if (this.isStopping || !this.isStarted) {
          const name = this.processIdToName.get(info.id);
          if (name) this.emit('child:crash', name, error);
          return;
        }
        const name = this.processIdToName.get(info.id);
        if (name) {
          const child = this.children.get(name);
          if (child) {
            this.emit('child:crash', name, error);
            await this.handleChildCrash(name, child.info, error);
          }
        }
      } catch (handlerError) {
        this.logger.error({ err: handlerError, originalError: String(error) }, 'Error in crash handler');
      }
    };

    this.manager.on('process:crash', this.crashHandler);
  }

  private async handleChildCrash(name: string, childDef: ISupervisorChild, error: Error): Promise<void> {
    this.logger.error({ err: error, child: name }, 'Child process crashed');

    const decision = await this.getRestartDecision(name, childDef, error);

    switch (decision) {
      case RestartDecision.RESTART:
        await this.performRestart(name, childDef);
        break;
      case RestartDecision.ESCALATE:
        await this.escalateFailure(name, childDef, error);
        break;
      case RestartDecision.SHUTDOWN:
        await this.shutdownAll();
        break;
      case RestartDecision.IGNORE:
      default:
        break;
    }
  }

  private async getRestartDecision(name: string, childDef: ISupervisorChild, error: Error): Promise<RestartDecision> {
    const window = this.options.window || 60_000;

    // True sliding window: prune anything older than the window AND persist
    // the pruned list so timestamps don't grow unbounded. (The previous
    // logic gated on a lifetime counter that startChild reset to 0 on
    // every restart — defeating the purpose of the window budget entirely.)
    const cutoff = Date.now() - window;
    const recent = (this.restartTimestamps.get(name) ?? []).filter((t) => t > cutoff);
    this.restartTimestamps.set(name, recent);

    // User-supplied policies take precedence over the framework default.
    // The window budget below is only the *fallback* for callers that don't
    // wire a custom crash handler — anyone who has explicitly chosen a
    // policy (config or decorator) owns the decision and the framework
    // must consult them on every crash.
    if (this.configCrashHandler) {
      return this.configCrashHandler(childDef, error);
    }

    const supervisor = new this.SupervisorClass();
    if (typeof supervisor.onChildCrash === 'function') {
      return supervisor.onChildCrash({ ...childDef, name }, error);
    }

    // Default framework policy: window-based budget. Crash rate exceeded
    // → escalate (critical) or give up (non-critical).
    const maxRestarts = this.options.maxRestarts || 3;
    if (recent.length >= maxRestarts) {
      this.logger.warn(
        { child: name, recent: recent.length, maxRestarts, windowMs: window },
        'Child crash rate exceeded restart budget'
      );
      return childDef.critical ? RestartDecision.ESCALATE : RestartDecision.IGNORE;
    }

    return RestartDecision.RESTART;
  }

  private async performRestart(name: string, _childDef: ISupervisorChild): Promise<void> {
    const strategy = this.options.strategy || SupervisionStrategy.ONE_FOR_ONE;

    const count = (this.restartCounts.get(name) || 0) + 1;
    this.restartCounts.set(name, count);

    const timestamps = this.restartTimestamps.get(name) || [];
    timestamps.push(Date.now());
    this.restartTimestamps.set(name, timestamps);

    this.emit('child:restart', name, count);

    // T#60: drive the backoff curve off the *windowed* restart count,
    // not the lifetime counter. Pre-T#60 a child that had crashed 200
    // times last week (long since recovered, all timestamps pruned)
    // would still hit the 30s ceiling on its first crash today because
    // `count` is monotonic for the supervisor's lifetime. Using
    // `recent.length` aligns backoff with the same sliding-window the
    // budget check uses — the child crashes pay backoff matching their
    // current crash rate, not their historical rap sheet.
    const window = this.options.window || 60_000;
    const cutoff = Date.now() - window;
    const recentCount = (this.restartTimestamps.get(name) ?? []).filter((t) => t > cutoff).length;

    // T#53: honour `options.backoff` between the crash and the
    // respawn. The historical path was `restartChild(name)` with no
    // delay — a child crashing 3× in 100ms produced 3 respawns in
    // 100ms, hammering the OS and starving the sliding-window budget
    // before it could trip. Default backoff (300ms exponential
    // capped at 30s) prevents that without affecting the happy path
    // of a single isolated crash.
    //
    // T#60: the backoff sleep is now cancellable and isStopping-aware.
    // Pre-T#60 the sleep was uncancellable — a `stop()` issued during
    // a 30s backoff had to wait the full 30s before the supervisor
    // teardown completed, AND when the sleep finally resolved it
    // proceeded to spawn the child during/after shutdown (no
    // `isStopping` check on the post-sleep path). Now we:
    //   1. Track the timer so `stop()` can wake the sleep early.
    //   2. Re-check `isStopping` after the sleep before restarting.
    const delayMs = this.computeBackoffDelay(recentCount);
    if (delayMs > 0) {
      this.logger.debug({ child: name, count, recentCount, delayMs }, 'Backing off before restart');
      await this.sleepCancellableOnStop(delayMs);
    }
    if (this.isStopping || !this.isStarted) {
      this.logger.debug(
        { child: name, count },
        'Skipping post-backoff restart — supervisor is stopping',
      );
      return;
    }

    switch (strategy) {
      case SupervisionStrategy.ONE_FOR_ONE:
      case SupervisionStrategy.SIMPLE_ONE_FOR_ONE:
        await this.restartChild(name);
        break;
      case SupervisionStrategy.ONE_FOR_ALL:
        await this.restartAll();
        break;
      case SupervisionStrategy.REST_FOR_ONE:
        await this.restartRestForOne(name);
        break;
      default:
        await this.restartChild(name);
        break;
    }
  }

  /**
   * Compute the inter-restart delay for the Nth restart of a child (T#53).
   *
   * Honours `options.backoff`:
   *   - type: 'exponential' (default), 'linear', or 'fixed'
   *   - initial: starting delay in ms (default 300ms)
   *   - factor: growth multiplier (default 2 for exponential, 1 for linear)
   *   - max: hard cap in ms (default 30s)
   *
   * The Nth restart of a child during a steady crash loop pays roughly
   * `initial × factor^(N-1)` ms — by the time crashes are pathological,
   * the supervisor is sleeping the full `max` between attempts and the
   * sliding-window budget has time to trip.
   */
  private computeBackoffDelay(restartCount: number): number {
    const cfg = this.options.backoff;
    if (!cfg) {
      // T#53 (scoped): the audit's "ignores backoff config" complaint
      // is specifically about a configured backoff being silently
      // skipped. With no backoff configured we keep the historical
      // zero-delay behaviour — callers who care about respawn pacing
      // must opt in via `options.backoff`. This avoids surprising
      // existing tests/deployments that drove their own timing.
      return 0;
    }
    const initial = cfg.initial ?? 300;
    const max = cfg.max ?? 30_000;
    const factor = cfg.factor ?? (cfg.type === 'linear' ? 1 : 2);
    const n = Math.max(0, restartCount - 1);

    let delay: number;
    switch (cfg.type ?? 'exponential') {
      case 'fixed':
        delay = initial;
        break;
      case 'linear':
        delay = initial + factor * n * initial;
        break;
      case 'exponential':
      default:
        delay = initial * Math.pow(factor, n);
    }
    return Math.min(delay, max);
  }

  private async restartAll(): Promise<void> {
    const children = Array.from(this.children.entries());
    for (const [name] of children) {
      await this.stopChild(name);
    }
    for (const [name, child] of children) {
      await this.startChild(name, child.info);
    }
  }

  private async restartRestForOne(failedChild: string): Promise<void> {
    const children = Array.from(this.children.entries());
    const failedIndex = children.findIndex(([name]) => name === failedChild);
    if (failedIndex === -1) return;

    for (let i = failedIndex; i < children.length; i++) {
      const entry = children[i];
      if (!entry) continue;
      const [name, child] = entry;
      await this.stopChild(name);
      await this.startChild(name, child.info);
    }
  }

  /**
   * A child has exhausted its restart budget. The supervisor's strategy
   * dictates whether siblings live on or share the failure:
   *
   *   ONE_FOR_ONE / SIMPLE_ONE_FOR_ONE — siblings are independent;
   *     emit and continue.
   *   ONE_FOR_ALL — children are a unit; if one is dead, the whole
   *     subtree is dead. Stop everyone (no restart — the whole budget
   *     is exhausted, restart would just churn).
   *   REST_FOR_ONE — children form a chain; the failed one and
   *     everything started after it depend on it being healthy.
   *     Stop the failed child and every sibling that came after.
   *
   * Mirrors OTP supervisor escalation semantics. Without this, the
   * `strategy` setting silently changed behavior on the *restart* path
   * but not on the *give-up* path — leaving siblings running in an
   * inconsistent state when their dependency had been declared dead.
   */
  private async escalateFailure(name: string, _childDef: ISupervisorChild, error: Error): Promise<void> {
    this.logger.error({ child: name, error }, 'Child failure escalated');
    this.emit('escalate', name, error);

    const strategy = this.options.strategy ?? SupervisionStrategy.ONE_FOR_ONE;
    if (strategy === SupervisionStrategy.ONE_FOR_ALL) {
      // T#59: snapshot the names BEFORE the stop loop. `stopChild`
      // calls `this.children.delete(name)`, which mutates the map
      // the legacy `for (const [siblingName] of this.children)` loop
      // was iterating — JS Map iteration with concurrent deletion
      // skips the entry that was just removed AND any entry the
      // iterator advanced past while the previous stopChild was
      // awaiting. Result: siblings silently survived an escalation
      // that was supposed to stop them.
      const siblings = Array.from(this.children.keys());
      this.logger.warn({ child: name, strategy, stopping: siblings }, 'Stopping all siblings per ONE_FOR_ALL escalation');
      for (const siblingName of siblings) {
        await this.stopChild(siblingName).catch((err) =>
          this.logger.error({ err, child: siblingName }, 'Error stopping sibling during escalation')
        );
      }
    } else if (strategy === SupervisionStrategy.REST_FOR_ONE) {
      const order = Array.from(this.children.keys());
      const failedIndex = order.indexOf(name);
      if (failedIndex === -1) return;
      const tail = order.slice(failedIndex);
      this.logger.warn({ child: name, strategy, stopping: tail }, 'Stopping failed + later siblings per REST_FOR_ONE escalation');
      for (const siblingName of tail) {
        await this.stopChild(siblingName).catch((err) =>
          this.logger.error({ err, child: siblingName }, 'Error stopping sibling during escalation')
        );
      }
    }
    // ONE_FOR_ONE / SIMPLE_ONE_FOR_ONE: nothing else to do — emit was enough.
  }

  private async shutdownAll(): Promise<void> {
    this.logger.info('Shutting down supervisor due to child failure');
    this.emit('shutdown');
    await this.stop();
  }

  // ============================================================================
  // Private — Metadata resolution
  // ============================================================================

  /**
   * Get children from @Supervisor/@Child decorator metadata.
   * Only used in decorator-based mode (configChildren is null).
   */
  private getDecoratorChildren(): Map<string, ISupervisorChild> {
    const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, this.SupervisorClass);
    if (!metadata) {
      throw Errors.notFound('Supervisor metadata', this.SupervisorClass.name);
    }

    // Resolve process classes from property values
    const instance = new this.SupervisorClass();
    if (metadata.children) {
      for (const [key, childDef] of metadata.children) {
        const propertyKey = (childDef as any).propertyKey || key;
        const processClass = (instance as any)[propertyKey];
        if (processClass) {
          childDef.processClass = processClass;
        }
      }
    }

    return metadata.children ?? new Map();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert config child to internal ISupervisorChild format */
function configChildToInternal(child: ISupervisorChildConfig): ISupervisorChild {
  return {
    name: child.name,
    processClass: child.process,
    options: child.spawnOptions as any,
    pool: child.poolOptions,
    critical: child.critical,
    optional: child.optional,
    shutdownTimeout: child.shutdownTimeout,
  };
}
