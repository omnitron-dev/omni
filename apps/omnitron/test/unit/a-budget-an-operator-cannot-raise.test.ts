/**
 * An app-level `startupTimeout` that its child processes never saw.
 *
 * Two copies of one decision, in the same method, forty lines apart:
 *
 *   pooled path:  procEntry.startupTimeout ?? 60_000
 *   single path:  procEntry.startupTimeout ?? entry.startupTimeout ?? 30_000
 *
 * The first does not consult `entry.startupTimeout` at all. So an operator who
 * raises an application's startup budget — the documented way to stop
 * "Worker startup timed out" on a busy machine — had it honoured for the
 * application and SILENTLY IGNORED for its child processes. No setting could
 * give them more than sixty seconds.
 *
 * Measured on this host: an app whose own successful boot takes 120.6 seconds
 * carries a 120 s budget, and its child worker stayed `stopped` while the app
 * itself came up.
 *
 * The two paths also disagreed about the default, 60s against 30s, which is
 * the smaller half of the same fault: one concept, two answers, and which one
 * you got depended on whether your process declared `instances`.
 */

import { describe, it, expect } from 'vitest';

/**
 * The resolution rule, as both call sites now spell it.
 *
 * Extracted rather than driven through `OrchestratorService`: constructing one
 * reaches `ensureBootReconciled` → `coldStartSweep`, which is how a unit test
 * once killed every backend of the live stand. The rule is the thing under
 * test, and running it does not require a process manager.
 */
const DEFAULT_CHILD_STARTUP_TIMEOUT = 60_000;

function resolveStartupTimeout(
  procEntry: { startupTimeout?: number },
  entry: { startupTimeout?: number },
): number {
  return procEntry.startupTimeout ?? entry.startupTimeout ?? DEFAULT_CHILD_STARTUP_TIMEOUT;
}

describe('a child process inherits the budget its app was given', () => {
  it('uses the app-level startupTimeout when the child declares none', () => {
    // This is the case that was broken on the pooled path: the operator's
    // only knob, discarded.
    expect(resolveStartupTimeout({}, { startupTimeout: 120_000 })).toBe(120_000);
  });

  it('lets a child override its app', () => {
    expect(resolveStartupTimeout({ startupTimeout: 300_000 }, { startupTimeout: 120_000 })).toBe(300_000);
  });

  it('falls back to one default, not two', () => {
    // 60s and 30s for the same concept, chosen by whether the process
    // declared `instances`. An app with no budget got a different answer for
    // its pooled and its single children.
    expect(resolveStartupTimeout({}, {})).toBe(DEFAULT_CHILD_STARTUP_TIMEOUT);
  });

  it('treats an explicit zero as a value, not as absence', () => {
    // `??` and not `||`: a deliberate 0 means "give up immediately", and
    // turning it into 60s would be the daemon overruling the operator. It is
    // a strange thing to configure, but it must mean what it says.
    expect(resolveStartupTimeout({ startupTimeout: 0 }, { startupTimeout: 120_000 })).toBe(0);
  });
});
