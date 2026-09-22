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
 */

import { describe, it, expect } from 'vitest';

import {
  shutdownLadder,
  lifecycleWindows,
  DEFAULT_SHUTDOWN_BUDGET_MS,
} from '../src/shutdown-windows.js';

describe('a deadline neither side agreed on', () => {
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

  it('the default budget reproduces the ladder that shipped', () => {
    // Control: this is a refactor of live behaviour, not a new policy. The
    // legacy numbers were 2000 / 2000 / 1000.
    const ladder = shutdownLadder();

    expect(ladder.gracefulMs).toBe(2_000);
    expect(ladder.sigtermMs).toBe(2_000);
    expect(ladder.sigkillMs).toBe(1_000);
    expect(ladder.childWindowMs, 'which is what the child actually had all along').toBe(2_000);
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
    const windows = lifecycleWindows(shutdownLadder(300).childWindowMs);

    expect(windows.defaultTaskTimeoutMs).toBeGreaterThan(0);
    expect(windows.forceKillBufferMs).toBeGreaterThan(0);
    expect(windows.totalTimeoutMs).toBeLessThanOrEqual(Math.max(200, 120));
  });
});
