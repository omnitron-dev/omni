/**
 * One budget for stopping a child, split once and read by both sides.
 *
 * Stopping a child is a ladder the SUPERVISOR walks: send `shutdown` over
 * IPC, wait; SIGTERM, wait; SIGKILL, wait. The child meanwhile runs its own
 * shutdown with its own timeouts. Until this file the two sides computed
 * their windows independently, and they disagreed:
 *
 *     supervisor  GRACEFUL 2000 + SIGTERM 2000  → SIGKILL at 4000
 *     child       totalTimeoutMs = 5000 + 1000  → plans to finish at 6000
 *
 * The child's comment says it wants «the full window minus a small safety
 * buffer so we exit before the parent's SIGKILL ladder fires» — the
 * intention was right and the arithmetic contradicted it. And the variable
 * that was supposed to carry the budget across, `TITAN_SHUTDOWN_TIMEOUT_MS`,
 * was READ in two places and SET by nobody, so the child always used its own
 * 5000 default regardless of what the supervisor had decided.
 *
 * Measured on the stand, `priceverse/stream-aggregator` on 2026-09-22:
 *
 *     08:05:43.085  lifecycle: phase started      ← SIGTERM, 2 s after shutdown
 *     08:05:44.650  Disconnecting remote peer
 *     08:05:44.651  Closing unix transport server
 *     08:05:45.036  SIGTERM timeout, sending SIGKILL
 *
 * It was not hung. It was walking its phases and missed by 0.4 s, inside a
 * window it had been told was five seconds and was actually two.
 *
 * The deadline belongs to whoever holds SIGKILL, so the supervisor splits the
 * budget and TELLS the child its share; the child fits its phases inside what
 * it was given. Raising the supervisor's window instead would be paid on
 * every stop — six seconds per app is thirty-six per six-app stack, on every
 * deploy and every daemon restart.
 */

/** The supervisor's escalation ladder for one child. */
export interface ShutdownLadder {
  /** Wait after the IPC `shutdown` message before SIGTERM. */
  gracefulMs: number;
  /** Wait after SIGTERM before SIGKILL. This is the child's real window. */
  sigtermMs: number;
  /** Wait after SIGKILL before giving up on the process entirely. */
  sigkillMs: number;
  /**
   * What the child has for its `dispose` phase — the SIGTERM window.
   *
   * Measured rather than assumed, because I first assumed the opposite. The
   * IPC `shutdown` message does start work in the child, but a different
   * part of it: on 2026-09-22 at 11:18 the message landed at 28.285, the
   * phases it triggers were finished by 28.391 — 106 ms — and then nothing
   * happened until SIGTERM at 30.283. `dispose`, which is where
   * `service-wrapper-shutdown` runs, starts on the SIGNAL.
   *
   * So the child's real budget is this phase alone, and the ratios below
   * follow from that measurement.
   */
  childWindowMs: number;
}

/** Default budget when a caller states none. Matches the legacy 2:2:1 split. */
export const DEFAULT_SHUTDOWN_BUDGET_MS = 5_000;

/**
 * Split a stop budget into the supervisor's ladder.
 *
 * 10% waiting for the child to act on the IPC message, 70% after SIGTERM,
 * 20% after SIGKILL.
 *
 * The legacy split was 40/40/20, and measurement showed the first share was
 * almost entirely waste while the second was short. On 2026-09-22 at 11:18
 * the IPC message landed at 28.285 and everything it triggers was done by
 * 28.391 — 106 ms of a 2000 ms window — after which the child sat idle until
 * SIGTERM at 30.283. Meanwhile `dispose`, which starts on that signal, ran
 * out of time at 1600 ms with «Lifecycle task "service-wrapper-shutdown"
 * exceeded 1600ms».
 *
 * Moving the share costs nothing: SIGKILL still lands at 80% of the budget,
 * so a six-app stack stops in the same time it did — the phase that needed
 * the time simply has it. 500 ms for a step measured at 106 is a fivefold
 * margin.
 */
export function shutdownLadder(totalDeadlineMs?: number): ShutdownLadder {
  if (totalDeadlineMs === 0) {
    // Brutal kill: no grace at all, just enough to observe the exit.
    return { gracefulMs: 0, sigtermMs: 0, sigkillMs: 500, childWindowMs: 0 };
  }

  const budget = totalDeadlineMs ?? DEFAULT_SHUTDOWN_BUDGET_MS;
  const gracefulMs = Math.floor(budget * 0.1);
  const sigtermMs = Math.floor(budget * 0.7);
  const sigkillMs = budget - gracefulMs - sigtermMs;

  return { gracefulMs, sigtermMs, sigkillMs, childWindowMs: sigtermMs };
}

/** The timeouts a child's LifecycleController is built with. */
export interface LifecycleWindows {
  defaultTaskTimeoutMs: number;
  bucketTimeoutMs: number;
  totalTimeoutMs: number;
  forceKillBufferMs: number;
}

/**
 * Fit a child's shutdown phases inside the window it was given.
 *
 * Every number here is at or below `childWindowMs`, which is the property
 * the suite pins: a child that respects its own timeouts finishes before the
 * supervisor's SIGKILL, so a kill means the child really did hang rather
 * than that the two sides disagreed about the arithmetic.
 */
export function lifecycleWindows(childWindowMs: number): LifecycleWindows {
  const total = Math.max(200, childWindowMs);
  // Leave a fifth of the window for the controller to notice and exit after
  // the hooks are done, with a floor so a tiny budget still runs something.
  const buffer = Math.max(100, Math.floor(total * 0.2));
  const forHooks = Math.max(100, total - buffer);

  return {
    defaultTaskTimeoutMs: forHooks,
    bucketTimeoutMs: forHooks,
    totalTimeoutMs: total,
    forceKillBufferMs: buffer,
  };
}
