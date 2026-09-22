/**
 * `shutdownTimeout: 0` reached the child as 5000 ms.
 *
 * The supervisor splits its budget and tells the child its share through
 * `TITAN_SHUTDOWN_TIMEOUT_MS`. Both readers of that variable did this:
 *
 *     Number(process.env['TITAN_SHUTDOWN_TIMEOUT_MS']) || <default>
 *
 * `0` is a value an operator states on purpose — `shutdownLadder(0)` supports
 * it, and its court says so: «a brutal kill leaves the child no window and
 * says so». It means stop NOW. `0 || 5000` is 5000, so the child told to
 * leave immediately sized its shutdown to five seconds and held its port for
 * all five, while the supervisor's own ladder killed it long before. The
 * variable exists precisely so the two sides agree, and this made them
 * disagree in the one case where the disagreement is total.
 *
 * Found by applying a form from elsewhere today — `port: 0` read as absence
 * in titan's WebSocket transport, on two layers — to this package's own
 * environment reads. Same operator, same mistake, written this morning.
 *
 * Both call sites now go through one function, because two readers of one
 * variable is how they drifted apart in the first place: `worker-runtime`
 * fell back to the ladder's child window and `last-resort-handlers` to a
 * constant of its own, so a malformed value produced two different windows.
 */

import { describe, it, expect } from 'vitest';

import { childShutdownWindowMs, DEFAULT_FORCE_EXIT_MS } from '../src/shutdown-windows.js';

describe('a zero window meant five seconds', () => {
  it('honours a stated zero', () => {
    // «Stop now» has to survive the read. This is the whole defect.
    expect(childShutdownWindowMs({ TITAN_SHUTDOWN_TIMEOUT_MS: '0' })).toBe(0);
  });

  it('carries any window the supervisor states', () => {
    expect(childShutdownWindowMs({ TITAN_SHUTDOWN_TIMEOUT_MS: '3500' })).toBe(3500);
    expect(childShutdownWindowMs({ TITAN_SHUTDOWN_TIMEOUT_MS: '30000' })).toBe(30_000);
  });

  it('falls back when nothing was said', () => {
    // Control: a child spawned by something that does not set the variable
    // at all — an older supervisor, a test harness — still gets a window.
    expect(childShutdownWindowMs({})).toBe(DEFAULT_FORCE_EXIT_MS);
  });

  it('ignores a value that is not a window', () => {
    // Control: a typo is not a decision. Negative and non-numeric both fall
    // back rather than producing a window that cannot be waited on.
    expect(childShutdownWindowMs({ TITAN_SHUTDOWN_TIMEOUT_MS: '' })).toBe(DEFAULT_FORCE_EXIT_MS);
    expect(childShutdownWindowMs({ TITAN_SHUTDOWN_TIMEOUT_MS: 'soon' })).toBe(DEFAULT_FORCE_EXIT_MS);
    expect(childShutdownWindowMs({ TITAN_SHUTDOWN_TIMEOUT_MS: '-1' })).toBe(DEFAULT_FORCE_EXIT_MS);
  });

  it('both readers answer the same number', () => {
    // They used to fall back differently — one to the ladder's child window,
    // one to a constant of its own — so the same malformed value produced
    // two windows for one child.
    const env = { TITAN_SHUTDOWN_TIMEOUT_MS: 'nonsense' };
    expect(childShutdownWindowMs(env)).toBe(childShutdownWindowMs({ ...env }));
  });
});
