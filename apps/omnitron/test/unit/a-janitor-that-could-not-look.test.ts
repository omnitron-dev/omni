/**
 * The janitor stopped working exactly when it was needed, 990 times.
 *
 * `ps -eo pid,ppid,etime,args` over a thousand processes takes 0.07 seconds.
 * The janitor gave it ten, and `execFile`'s timeout is a timer on the
 * daemon's own event loop — so when that loop is busy, the timer fires and
 * SIGKILLs a `ps` that already finished. Measured on the development host:
 *
 *     990 sweeps skipped
 *     36 fork-workers alive as children of a daemon claiming none of them
 *     one of them 5 hours old, holding port 3001
 *
 * The deadline was not protecting against a slow `ps`. It was firing because
 * the control plane was doing its job, which is when orphans appear.
 *
 * Worse than the skipping: a skipped sweep returned `[]` and reported
 * `forkWorkersAlive: 0, orphansFound: 0` — a measurement of nothing,
 * indistinguishable from a tidy machine. 990 clean sweeps, recorded.
 */

import { describe, it, expect, vi } from 'vitest';

import { ProcessJanitor } from '../../src/orchestrator/process-janitor.js';

const silent: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silent,
};

const janitor = (listProcesses: () => unknown, logger: unknown = silent, onMetrics?: (m: unknown) => void) =>
  new ProcessJanitor({
    getOwnedPids: () => new Set<number>(),
    listProcesses: listProcesses as never,
    logger: logger as never,
    ...(onMetrics ? { onMetrics: onMetrics as never } : {}),
  });

describe('a sweep that could not read the process table', () => {
  it('is not reported as a sweep that found nothing', async () => {
    const metrics = await janitor(() => null).runSweep();

    // These used to be the same value and the same metrics, so a janitor
    // disabled for hours was indistinguishable from a tidy machine.
    expect(metrics.swept).toBe(false);
    expect(metrics.orphansFound).toBe(0);
  });

  it('is distinguishable from an empty machine', async () => {
    const empty = await janitor(() => []).runSweep();

    expect(empty.swept).toBe(true);
    expect(empty.forkWorkersAlive).toBe(0);
  });

  it('says so, louder as it keeps happening', async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const loud: any = {
      ...silent,
      warn: (_o: unknown, m?: string) => warnings.push(String(m)),
      error: (_o: unknown, m?: string) => errors.push(String(m)),
      child: () => loud,
    };
    const j = janitor(() => null, loud);

    for (let i = 0; i < 6; i += 1) await j.runSweep();

    // One skip is noise. A run of them is a janitor that has stopped
    // working, and only the count makes that visible — 990 identical
    // warnings did not.
    expect(warnings.length).toBeGreaterThan(0);
    expect(errors.some((m) => /not being reaped/i.test(m))).toBe(true);
  });

  it('forgets the run once a sweep succeeds', async () => {
    const errors: string[] = [];
    const loud: any = { ...silent, error: (_o: unknown, m?: string) => errors.push(String(m)), child: () => loud };
    let fail = true;
    const j = janitor(() => (fail ? null : []), loud);

    for (let i = 0; i < 6; i += 1) await j.runSweep();
    fail = false;
    await j.runSweep();
    const before = errors.length;
    fail = true;
    await j.runSweep();

    // A single failure after a healthy run is not an outage.
    expect(errors.length).toBe(before);
  });
});

describe('the deadline ps is given', () => {
  it('is long enough to survive a busy event loop', async () => {
    const { __test__ } = await import('../../src/orchestrator/process-janitor.js');

    // The real `ps` on a thousand processes takes under a tenth of a second.
    // The deadline exists for a `ps` that genuinely hangs — an NFS mount, a
    // wedged process table — not for a control plane under load.
    const source = (await import('node:fs')).readFileSync(
      new URL('../../src/orchestrator/process-janitor.ts', import.meta.url),
      'utf-8',
    );
    const declared = /const PS_TIMEOUT_MS = ([\d_]+);/.exec(source)?.[1]?.replace(/_/g, '');

    expect(Number(declared)).toBeGreaterThanOrEqual(60_000);
    expect(typeof __test__.listForkWorkersFromPs).toBe('function');
  });
});

describe('an abandoned child', () => {
  // Every pid here is imaginary AND every kill is intercepted. Writing this
  // file, a test naming pid 7858 — chosen as an obviously-fake number —
  // signalled the real process holding port 3001 on this machine, because
  // the janitor called `process.kill` directly and nothing could stand in
  // its way. The seam is the fix; remembering to be careful is not.

  it('is reaped when the daemon does not claim it', async () => {
    const killed: number[] = [];
    const j = new ProcessJanitor({
      getOwnedPids: () => new Set<number>(),
      listProcesses: () => [
        { pid: 7858, ppid: process.pid, command: 'node titan-pm/dist/fork-worker.js', elapsedSeconds: 18_635 },
      ],
      logger: silent as never,
      kill: ((pid: number) => { killed.push(pid); }) as never,
    });

    await j.runSweep();

    // Our own child, old enough not to be mid-startup, and in none of our
    // handles. Measured: pid 7858, five hours old, holding port 3001 while
    // the daemon reported the app crashed. The rule existed; the sweep that
    // applies it had not run in 990 attempts.
    expect(killed).toContain(7858);
  });

  it('is left alone while it may still be starting', async () => {
    const killed: number[] = [];
    const j = new ProcessJanitor({
      getOwnedPids: () => new Set<number>(),
      listProcesses: () => [
        { pid: 999, ppid: process.pid, command: 'node titan-pm/dist/fork-worker.js', elapsedSeconds: 1 },
      ],
      logger: silent as never,
      kill: ((pid: number) => { killed.push(pid); }) as never,
    });

    await j.runSweep();

    // A process the daemon started a second ago is not yet in any handle —
    // and between a failed spawn's SIGTERM and its confirmed exit there is a
    // window where it is alive, ours, and already released.
    expect(killed).toEqual([]);
  });
});
