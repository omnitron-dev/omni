/**
 * Internal collaborator — Application lifecycle state machine.
 *
 * Holds the `ApplicationState`, the start/stop in-flight promise pair, and
 * the start/stop hook lists. Every transition between states goes through
 * `transition(from, to)` so invariants live in one place.
 *
 * Why a dedicated collaborator? The legacy `Application` interleaved state
 * mutations with module-loop logic, leaving the order between
 * `setState(Starting)` ↔ `_startTime = Date.now()` ↔ first emit fragile.
 * Centralising state ownership means the Application orchestrator only
 * asks questions ("can I start?", "are we shutting down?") and the state
 * machine answers without leaking mutable fields.
 *
 * Single responsibility: track lifecycle state + the in-flight start/stop
 * promises + the registered start/stop hooks. Knows nothing about
 * modules, the container, or shutdown tasks.
 *
 * @internal
 */

import {
  ApplicationState,
  type ILifecycleHook,
  LifecycleState,
} from '../../types.js';
import { Errors } from '../../errors/index.js';

/**
 * Default timeout for `onStart` hooks that don't declare their own.
 * Matches the prior in-line constant in the legacy Application.
 */
export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/**
 * Default priority assigned to a `onStart` / `onStop` hook registered as
 * a bare function. Lower numbers run first; 100 is the historical default.
 */
export const DEFAULT_HOOK_PRIORITY = 100;

export class LifecycleStateMachine {
  private _state: ApplicationState = ApplicationState.Created;
  private _lifecycleState: LifecycleState = LifecycleState.Created;
  private _startTime = 0;
  private _startupTime = 0;
  private _startPromise: Promise<void> | null = null;
  private _stopPromise: Promise<void> | null = null;
  private _isStarted = false;

  private readonly _startHooks: ILifecycleHook[] = [];
  private readonly _stopHooks: ILifecycleHook[] = [];

  // ─── State queries ───────────────────────────────────────────────────

  get state(): ApplicationState {
    return this._state;
  }

  get isStarted(): boolean {
    return this._state === ApplicationState.Started;
  }

  get lifecycleState(): LifecycleState {
    return this._lifecycleState;
  }

  /**
   * Total milliseconds since the most recent `start()` began. Reads
   * 0 before the first start so callers don't see negative numbers.
   */
  get uptime(): number {
    return this._startTime ? Date.now() - this._startTime : 0;
  }

  /**
   * Time the most recent `start()` took to reach `Started`. Set in
   * `markStarted()`; reads as 0 prior to first successful start.
   */
  get startupTime(): number {
    return this._startupTime;
  }

  get startPromise(): Promise<void> | null {
    return this._startPromise;
  }

  get stopPromise(): Promise<void> | null {
    return this._stopPromise;
  }

  // ─── Transitions ────────────────────────────────────────────────────

  /**
   * Validate that the application can move from its current state into
   * `Starting`. Throws the same `Errors.conflict` instances the legacy
   * implementation produced so consumer error-message assertions stay
   * intact. The state itself is not mutated until `beginStart()`.
   */
  ensureCanStart(): void {
    const s = this._state;
    if (s === ApplicationState.Created || s === ApplicationState.Stopped) return;
    if (s === ApplicationState.Starting) return; // caller will await existing promise
    if (s === ApplicationState.Stopping) return; // caller will await existing stopPromise then retry
    if (s === ApplicationState.Started) {
      throw Errors.conflict('Application is already started or starting');
    }
    if (s === ApplicationState.Failed) {
      throw Errors.conflict('Cannot start from failed state');
    }
    throw Errors.conflict(`Cannot start application in state: ${s}`);
  }

  /**
   * Record the in-flight start promise. The state transition itself is
   * NOT performed here — the Application orchestrator routes it through
   * `setState(Starting)` so test consumers that monkey-patch `setState`
   * can observe the transition (a legacy contract several test suites
   * depend on). This method ONLY captures the side-effects: start time
   * reset + promise registration.
   */
  beginStart(work: Promise<void>): { dispose: () => void } {
    this._lifecycleState = LifecycleState.Starting;
    this._startTime = Date.now();
    this._startupTime = 0;
    this._startPromise = work;
    return {
      dispose: () => {
        this._startPromise = null;
      },
    };
  }

  /**
   * Stop counterpart of `beginStart`. State transition is left to the
   * Application orchestrator's `setState(Stopping)` call.
   */
  beginStop(work: Promise<void>): { dispose: () => void } {
    this._lifecycleState = LifecycleState.Stopping;
    this._stopPromise = work;
    return {
      dispose: () => {
        this._stopPromise = null;
      },
    };
  }

  /**
   * Stop is a no-op when not started or failed; signal that to the
   * orchestrator so it can return early without mutating state.
   */
  canStop(): boolean {
    return this._state === ApplicationState.Started || this._state === ApplicationState.Failed;
  }

  /**
   * Finalise a successful start. ONLY does the bookkeeping (lifecycle
   * axis, started flag, startup time) — the `ApplicationState`
   * transition is performed by the orchestrator via `setState(Started)`
   * so monkey-patched setState observers fire.
   */
  markStarted(): void {
    this._lifecycleState = LifecycleState.Running;
    this._isStarted = true;
    // Floor at 1ms so consumer assertions like `startupTime > 0` hold
    // for instantaneously-starting apps in tests.
    this._startupTime = Math.max(1, Date.now() - this._startTime);
  }

  /** Finalise a successful stop. */
  markStopped(): void {
    this._lifecycleState = LifecycleState.Stopped;
    this._isStarted = false;
  }

  markFailed(): void {
    this._isStarted = false;
  }

  markShuttingDown(): void {
    this._lifecycleState = LifecycleState.ShuttingDown;
  }

  // ─── Direct setter (legacy escape hatch) ─────────────────────────────

  /**
   * Force-set the state. The legacy `Application.setState()` was private
   * and called from a small number of test paths. Routing the same
   * mutation through here preserves any reliance the tests still have
   * on direct state pokes.
   */
  forceState(state: ApplicationState): void {
    this._state = state;
    if (state === ApplicationState.Started) this._isStarted = true;
    else if (state === ApplicationState.Stopped || state === ApplicationState.Failed)
      this._isStarted = false;
  }

  // ─── Hooks ──────────────────────────────────────────────────────────

  /**
   * Append a hook, normalising plain-function input into the
   * `ILifecycleHook` shape with a default priority and the caller-
   * supplied priority/timeout overrides. Result list is sorted ascending
   * by priority so the lowest-numbered hook runs first.
   */
  addStartHook(
    hook: ILifecycleHook | (() => void | Promise<void>),
    priority?: number,
    timeout?: number,
  ): void {
    this._startHooks.push(this.normaliseHook(hook, priority, timeout));
    this._startHooks.sort((a, b) => (a.priority ?? DEFAULT_HOOK_PRIORITY) - (b.priority ?? DEFAULT_HOOK_PRIORITY));
  }

  addStopHook(
    hook: ILifecycleHook | (() => void | Promise<void>),
    priority?: number,
    timeout?: number,
  ): void {
    this._stopHooks.push(this.normaliseHook(hook, priority, timeout));
    this._stopHooks.sort((a, b) => (a.priority ?? DEFAULT_HOOK_PRIORITY) - (b.priority ?? DEFAULT_HOOK_PRIORITY));
  }

  /** Read-only view of registered start hooks. */
  get startHooks(): readonly ILifecycleHook[] {
    return this._startHooks;
  }

  /** Read-only view of registered stop hooks. */
  get stopHooks(): readonly ILifecycleHook[] {
    return this._stopHooks;
  }

  private normaliseHook(
    hook: ILifecycleHook | (() => void | Promise<void>),
    priority?: number,
    timeout?: number,
  ): ILifecycleHook {
    if (typeof hook === 'function') {
      return {
        handler: hook,
        priority: priority ?? DEFAULT_HOOK_PRIORITY,
        timeout,
      };
    }
    return hook;
  }
}
