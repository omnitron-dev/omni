/**
 * The child planned to finish at six seconds; the supervisor killed it at
 * four.
 *
 *     supervisor  GRACEFUL 2000 + SIGTERM 2000  → SIGKILL at 4000
 *     child       totalTimeoutMs = 5000 + 1000  → plans to finish at 6000
 *
 * Two independent computations of one deadline, and the variable meant to
 * carry the budget across — `TITAN_SHUTDOWN_TIMEOUT_MS` — was READ in two
 * places (`worker-runtime.ts:678`, `last-resort-handlers.ts:70`) and SET by
 * nobody. So the child used its own 5000 default whatever the supervisor had
 * decided, and the comment beside it — «give __shutdown the full window minus
 * a small safety buffer so we exit before the parent's SIGKILL ladder fires»
 * — described an intention the arithmetic contradicted.
 *
 * Measured, `priceverse/stream-aggregator` on 2026-09-22:
 *
 *     08:05:43.085  lifecycle: phase started      ← SIGTERM, 2 s after shutdown
 *     08:05:44.650  Disconnecting remote peer
 *     08:05:44.651  Closing unix transport server
 *     08:05:45.036  SIGTERM timeout, sending SIGKILL
 *
 * Not hung: walking its phases, 0.4 s short, inside a window it believed was
 * five seconds and was two. Which also explains a negative result from
 * earlier the same day — after the shutdown hooks were repaired so they
 * actually ran (16a7797a), the share of killed workers did not move: 4.2%
 * before, 3.9% after. The hooks ran; nobody gave them more time.
 *
 * The deadline belongs to whoever holds SIGKILL. The supervisor splits the
 * budget and tells the child its share; the child fits inside it. Raising the
 * supervisor's window instead would be paid on every stop — six seconds per
 * app is thirty-six per six-app stack, on every deploy and every daemon
 * restart, and nobody would connect the slower deploy to this change.
 *
 * AND THEN THE SPLIT ITSELF TURNED OUT TO BE WRONG, which the stand reported
 * within the hour of the first fix reaching it: «Lifecycle task
 * "service-wrapper-shutdown" exceeded 1600ms in phase "dispose"». Agreeing
 * the two sides on one number exposed that the number was badly divided —
 * 40% to a phase that used 106 ms of it, 40% to the phase that ran out. The
 * ratios are 10/70/20 now, SIGKILL still lands at 80% of the budget, and the
 * cost of stopping a stack is unchanged. The first assertion below carries
 * the trace.
 */

import { describe, it, expect } from 'vitest';

import {
  shutdownLadder,
  lifecycleWindows,
  DEFAULT_SHUTDOWN_BUDGET_MS,
} from '../src/shutdown-windows.js';

describe('a deadline neither side agreed on', () => {
  it('the phase that does the work gets the share of the budget', () => {
    // I first assumed the child's window was both phases, because the IPC
    // `shutdown` message arrives before SIGTERM and does start work. The
    // stand said otherwise within the hour, and the trace is exact:
    //
    //     11:18:28.285  Application stopping        ← IPC message landed
    //     11:18:28.391  lifecycle: phase finished   ← 106 ms, all of it
    //     ……… 1.9 seconds of nothing ………
    //     11:18:30.283  Received SIGTERM
    //     11:18:30.285  lifecycle: phase started    phase: dispose
    //     11:18:31.886  lifecycle: task failed      exceeded 1600ms
    //
    // `dispose` — where `service-wrapper-shutdown` runs — starts on the
    // SIGNAL. So the window is `sigtermMs` alone, and the old 40/40 split
    // spent nineteen twentieths of the first share on waiting while the
    // second ran out.
    for (const budget of [DEFAULT_SHUTDOWN_BUDGET_MS, 10_000]) {
      const ladder = shutdownLadder(budget);

      expect(ladder.childWindowMs, 'dispose starts on SIGTERM, so that is the window').toBe(
        ladder.sigtermMs,
      );
      expect(
        ladder.sigtermMs,
        'the phase that works must outweigh the phase that waits',
      ).toBeGreaterThan(ladder.gracefulMs * 2);
      // And the cost of stopping is unchanged: SIGKILL still lands at the
      // same point, so a six-app stack takes what it always took.
      expect(ladder.gracefulMs + ladder.sigtermMs).toBe(Math.floor(budget * 0.8));
    }
  });

  it('a child that respects its own timeouts finishes before SIGKILL', () => {
    for (const budget of [DEFAULT_SHUTDOWN_BUDGET_MS, 2_000, 10_000, 30_000]) {
      const ladder = shutdownLadder(budget);
      const windows = lifecycleWindows(ladder.childWindowMs);

      expect(
        windows.totalTimeoutMs,
        `budget ${budget}: the child plans past the kill at ${ladder.childWindowMs}`,
      ).toBeLessThanOrEqual(ladder.childWindowMs);
      expect(windows.bucketTimeoutMs).toBeLessThanOrEqual(windows.totalTimeoutMs);
      expect(windows.defaultTaskTimeoutMs).toBeLessThanOrEqual(windows.totalTimeoutMs);
    }
  });

  it('the ladder still spends the whole budget and nothing more', () => {
    // Control: the split is a division of one number, not three independent
    // constants that happen to add up.
    for (const budget of [5_000, 2_500, 12_000]) {
      const { gracefulMs, sigtermMs, sigkillMs } = shutdownLadder(budget);
      expect(gracefulMs + sigtermMs + sigkillMs, `budget ${budget}`).toBe(budget);
    }
  });

  it('the default budget still spends the same total, redistributed', () => {
    // NOT a reproduction of the legacy 2000/2000/1000 any more: that split
    // was measured to be wrong, giving the waiting phase twenty times what
    // it used and the working phase less than it needed. What must not move
    // is the cost — SIGKILL at the same instant — and that is asserted here.
    const ladder = shutdownLadder();

    expect(ladder.gracefulMs).toBe(500);
    expect(ladder.sigtermMs).toBe(3_500);
    expect(ladder.sigkillMs).toBe(1_000);
    expect(ladder.gracefulMs + ladder.sigtermMs, 'SIGKILL lands where it always did').toBe(4_000);
  });

  it('a brutal kill leaves the child no window and says so', () => {
    // Control: `shutdownTimeout: 0` means stop now. The child must not be
    // handed a window it does not have.
    const ladder = shutdownLadder(0);

    expect(ladder.gracefulMs).toBe(0);
    expect(ladder.sigtermMs).toBe(0);
    expect(ladder.childWindowMs).toBe(0);
    expect(ladder.sigkillMs, 'still long enough to observe the exit').toBeGreaterThan(0);
  });

  it('a window too small to divide still leaves something to run in', () => {
    // Control: a caller can state an absurd budget. Phases of zero would
    // make every stop a kill, which is the failure this whole change exists
    // to remove.
    const ladder = shutdownLadder(300);
    const windows = lifecycleWindows(ladder.childWindowMs);

    expect(windows.defaultTaskTimeoutMs).toBeGreaterThan(0);
    expect(windows.forceKillBufferMs).toBeGreaterThan(0);
    expect(windows.totalTimeoutMs).toBeLessThanOrEqual(Math.max(200, ladder.childWindowMs));
  });
});
