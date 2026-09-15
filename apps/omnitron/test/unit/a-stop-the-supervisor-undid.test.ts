/**
 * `omnitron down` reported the daemon stopped, and it came back on its own.
 *
 * `down` killed the process — SIGTERM, then SIGKILL — and printed "Daemon
 * force-killed (PID: 69597)". The daemon is installed as a service, the
 * supervisor has `KeepAlive`, and it started a replacement:
 *
 *     omnitron down    → Daemon force-killed (PID: 69597)
 *     29 seconds later → a new daemon, PID 73095, PPID 1
 *
 * The command reported success, and anything done on the strength of that
 * report — rebuilding the package the daemon runs from, which is the reason
 * anyone stops it — ran against a live daemon. The plist's
 * `ThrottleInterval` is 10 seconds, so the window in which the report was
 * true is ten seconds wide.
 *
 * Measured while taking a restart window on this machine, by noticing a
 * daemon process whose start time was after the stop that had just
 * succeeded.
 */

import { describe, it, expect } from 'vitest';

import { planDown } from '../../src/commands/up.js';

describe('stopping a daemon a supervisor is watching', () => {
  it('unloads the service BEFORE stopping the process', () => {
    const plan = planDown(true);

    // Order is the whole fix. Killing first and unloading second leaves the
    // same race, smaller: the supervisor can start a replacement between
    // the two steps.
    expect(plan.steps).toEqual(['unload-service', 'stop-process']);
    expect(plan.steps[0]).toBe('unload-service');
  });

  it('says that autostart is now off', () => {
    const plan = planDown(true);

    // A change the operator did not ask for and would meet at the next
    // login. Naming the command that arms it again is what makes it a
    // decision rather than a surprise.
    expect(plan.note).toMatch(/autostart is off/i);
    expect(plan.note).toContain('omnitron up');
  });

  it('leaves an unsupervised daemon alone', () => {
    const plan = planDown(false);

    // A daemon started by `omnitron up` in a terminal has no service to
    // unload, and unloading one that was never installed would report a
    // change that did not happen.
    expect(plan.steps).toEqual(['stop-process']);
    expect(plan.note).toBeNull();
  });
});
