/**
 * «Process survived SIGKILL» asked once, less than a second after the signal.
 *
 * SIGKILL cannot be caught, so a process reported as surviving it is almost
 * never a survivor — it is a question asked about the wrong thing, or asked
 * too early. Measured on the daemon log by pairing `workerId`: between
 * «SIGTERM timeout, sending SIGKILL» and «Process survived SIGKILL» there are
 * **0.49–0.92 seconds** (8 pairs on 2026-09-21; 15 such records in total,
 * plus 3 of the spawn-failure variant, and none at all on 09-22).
 *
 * That interval rules out two of the three explanations. A pid is not reused
 * inside a second; and a genuine survivor — one blocked in an uninterruptible
 * syscall — would still be there on the next sweep, which nothing reports.
 * What is left is the kernel not having torn the process down yet when we
 * asked.
 *
 * The same lesson is already written down twenty lines away, in
 * `apps/omnitron/src/orchestrator/process-janitor.ts:441`, where the janitor
 * polls with `awaitDeath` and the comment explains why: «SIGKILL is delivered
 * immediately but the process is not reaped until the kernel can tear it
 * down… The first version waited 500 ms and then reported at ERROR level that
 * the process had "survived SIGKILL"; observed 2026-09-14 on a pid that was
 * gone moments later. An alarm that fires on a normal delay teaches its
 * reader to disregard the case it exists to report.» The janitor was fixed.
 * The spawner kept the single probe — one direction of two, for the fourth
 * time today.
 *
 * Three things are wrong with that probe, in rising order:
 *
 *   1. `hasExited(child)` (`process-spawner.ts:148`) reads Node's own
 *      knowledge — `exitCode`/`signalCode` — and is not consulted here, so a
 *      child whose exit we have already been told about is still interrogated
 *      through the process table.
 *   2. It asks ONCE.
 *   3. `kill(pid, 0)` cannot tell a ZOMBIE from a living process. A zombie is
 *      dead and unreaped, and signal 0 answers for it happily — so the line
 *      can describe a process that is not running at all.
 *
 * Hence the verdict carries the OS state when it says «not dead»: `Z` means
 * reaping, anything else means a real survivor. Without that field the record
 * is unactionable, which is how it survived fifteen occurrences unexamined.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

import { confirmDeath } from '../src/confirm-death.js';

/** A child the process table reports alive for `aliveForCalls` questions. */
function child(opts: { pid?: number | undefined; exitCode?: number | null; signalCode?: NodeJS.Signals | null }) {
  return {
    // `?? 4242` would turn an explicit `undefined` back into a pid, which is
    // exactly the case the last assertion is about.
    pid: 'pid' in opts ? opts.pid : 4242,
    exitCode: opts.exitCode ?? null,
    signalCode: opts.signalCode ?? null,
  } as unknown as ChildProcess;
}

const instantly = async () => undefined;

describe('a question asked too early', () => {
  it('a child Node has already reported as exited is not interrogated at all', async () => {
    const isAlive = vi.fn(() => true); // the process table still shows it
    const verdict = await confirmDeath(child({ signalCode: 'SIGKILL' }), {
      isAlive,
      sleep: instantly,
      timeoutMs: 1_000,
      pollMs: 50,
    });

    expect(verdict.dead, 'Node told us it exited; that settles it').toBe(true);
    expect(isAlive, 'the process table was asked anyway').not.toHaveBeenCalled();
  });

  it('a child that disappears while we wait is dead, not a survivor', async () => {
    // The measured case: gone within a second of the signal.
    let calls = 0;
    const isAlive = vi.fn(() => {
      calls += 1;
      return calls < 3;
    });

    const verdict = await confirmDeath(child({}), {
      isAlive,
      sleep: instantly,
      timeoutMs: 1_000,
      pollMs: 50,
    });

    expect(verdict.dead, 'reported as surviving SIGKILL while merely being reaped').toBe(true);
    expect(isAlive.mock.calls.length, 'it took more than one question').toBeGreaterThan(1);
  });

  it('a child that never goes away is reported, with what the OS calls it', async () => {
    // Control: the alarm must still fire for the case it exists for — and it
    // must say WHICH case, or the reader cannot act on it.
    const verdict = await confirmDeath(child({}), {
      isAlive: () => true,
      sleep: instantly,
      timeoutMs: 300,
      pollMs: 50,
      processState: async () => 'Z',
    });

    expect(verdict.dead).toBe(false);
    if (!verdict.dead) {
      expect(verdict.state, 'a record without the state cannot be acted on').toBe('Z');
    }
  });

  it('a child with no pid was never there to kill', async () => {
    // Control: the existing early return stays.
    const isAlive = vi.fn(() => true);
    const verdict = await confirmDeath(child({ pid: undefined }), { isAlive, sleep: instantly });

    expect(verdict.dead).toBe(true);
    expect(isAlive).not.toHaveBeenCalled();
  });
});
