/**
 * The CLI told the operator to start a daemon that was already running.
 *
 * `DaemonClient.isReachable()` raced a `ping` against five seconds and
 * returned a boolean, and twenty-five command files turned the false into
 * `Daemon is not running`. That message is right for one of the three things
 * the false can mean, and its advice — start it — is wrong for the other two.
 *
 * The one that matters is a daemon mid-boot. It answers nothing while its
 * apps come up, which on this stand is minutes, and for the whole of that
 * window every command in the CLI reported the daemon as down. Hit twice in
 * one session on the development host; the second time it was almost written
 * into a report as evidence that the stand was dead. `omnitron down`, run a
 * moment later, found the same daemon alive and said so.
 *
 * `status.ts` had the distinction all along, in its own copy, for itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describeAbsence, adviseAbsence } from '../../src/commands/daemon-required.js';
import type { DaemonAbsence } from '../../src/daemon/daemon-client.js';

describe('what the operator is told', () => {
  const cases: Array<[DaemonAbsence, RegExp, RegExp | null]> = [
    [{ kind: 'stopped' }, /^Daemon is not running$/, /omnitron up/],
    [{ kind: 'stale', pid: 42 }, /not running.*42.*crash/, /omnitron up/],
    [{ kind: 'silent', pid: 42, waitedMs: 5000 }, /is running \(PID 42\).*did not answer within 5s/, /busy|Retry/],
    [{ kind: 'unknown', reason: 'EACCES' }, /Could not reach the daemon: EACCES/, null],
  ];

  it.each(cases)('describes %j distinctly', (absence, headline, advice) => {
    expect(describeAbsence(absence)).toMatch(headline);
    if (advice) expect(adviseAbsence(absence)).toMatch(advice);
    else expect(adviseAbsence(absence)).toBeNull();
  });

  it('never tells the operator to start a daemon that is running', () => {
    // The specific harm: the advice sends them to `omnitron up`, which
    // refuses because a daemon is already running, which reads as a second
    // fault on top of the first.
    const silent = adviseAbsence({ kind: 'silent', pid: 42, waitedMs: 5000 });
    expect(silent).not.toMatch(/omnitron up/);
  });

  it('gives each situation its own words', () => {
    const said = cases.map(([a]) => describeAbsence(a));
    expect(new Set(said).size).toBe(said.length);
  });
});

// =============================================================================
// The diagnosis itself
// =============================================================================

const { DaemonClient } = await import('../../src/daemon/daemon-client.js');

/** A client whose ping fails at once, pointed at a pid file we control. */
function clientOver(pidFileContents: string | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-pid-'));
  const pidFile = path.join(dir, 'daemon.pid');
  if (pidFileContents !== null) fs.writeFileSync(pidFile, pidFileContents);

  const client = new DaemonClient();
  // Rejecting rather than hanging: a closed socket refuses immediately, and
  // the five-second race above it is not what these assert.
  (client as unknown as { ping: () => Promise<never> }).ping = () =>
    Promise.reject(new Error('connect ENOENT /Users/x/.omnitron/daemon.sock'));

  return { client, pidFile, dir };
}

describe('a silent socket is diagnosed by asking the OS, not by guessing', () => {
  let tmp: string[] = [];
  beforeEach(() => { tmp = []; });
  afterEach(() => {
    for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /**
   * Ask the real entry point — the one every command calls — against a pid
   * file of our choosing.
   *
   * Through `whyUnreachable`, not the private helper beneath it: a test that
   * calls the helper passes against a `whyUnreachable` that never calls it,
   * which is exactly the shape this file exists to rule out.
   */
  async function diagnose(pidFileContents: string | null): Promise<DaemonAbsence> {
    const { client, pidFile, dir } = clientOver(pidFileContents);
    tmp.push(dir);
    vi.spyOn(
      DaemonClient.prototype as unknown as { resolvePidFile: () => string },
      'resolvePidFile' as never,
    ).mockReturnValue(pidFile as never);
    const absence = await client.whyUnreachable();
    expect(absence, 'a ping that rejected must not read as reachable').not.toBeNull();
    return absence!;
  }

  it('calls a live pid silent, not stopped', async () => {
    // This process is alive by definition, which is the whole point: the
    // socket said nothing and the process table says otherwise.
    const absence = await diagnose(String(process.pid));

    expect(absence.kind).toBe('silent');
    expect(absence).toMatchObject({ pid: process.pid });
  });

  it('calls a dead pid stale', async () => {
    // 2^22 is above every system's pid_max, so it cannot be in use.
    const absence = await diagnose(String(4_194_304));

    expect(absence.kind).toBe('stale');
  });

  it('calls a missing pid file stopped', async () => {
    expect((await diagnose(null)).kind).toBe('stopped');
  });

  it('reads the two-line pid file format', async () => {
    // `<pid>\n<signature>` since T#56. A parser that took the whole file
    // would produce NaN and answer "stopped" for a running daemon.
    const absence = await diagnose(`${process.pid}\n/path/to/daemon-entry.js`);

    expect(absence).toMatchObject({ kind: 'silent', pid: process.pid });
  });
});
