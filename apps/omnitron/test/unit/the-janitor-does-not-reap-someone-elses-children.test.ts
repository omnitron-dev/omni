/**
 * A foreign parent is not evidence of a dead one.
 *
 * `coldStartSweep` read `row.ppid !== myPid` — reap anything not parented by
 * ME — on the assumption that only the daemon ever calls it, and only at
 * boot. Nothing enforces that assumption, and when it is wrong the cost is
 * every running app on the machine.
 *
 * Measured 2026-09-12: ONE unit test constructing an `OrchestratorService`
 * and calling `startApp` reached `ensureBootReconciled` → `coldStartSweep`,
 * where `process.pid` was the vitest worker's, and killed all six backends of
 * the live dev stand. The daemon itself survived, so `omnitron ls` reported
 * `crashed` for apps that nothing had crashed — which is how it stayed
 * unexplained through several restarts.
 *
 * `runSweep` already had the right rule: "some other parent — not ours, leave
 * alone". The two halves of one janitor disagreed about what an orphan is,
 * and only the cheap half ran at the moment nothing else was there to object.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { ProcessJanitor, type PsRow } from '../../src/orchestrator/process-janitor.js';

const row = (pid: number, ppid: number, elapsedSeconds = 3600): PsRow => ({
  pid,
  ppid,
  command: `node fork-worker.js --id=${pid}`,
  elapsedSeconds,
});

function janitor(rows: PsRow[], alive: (pid: number) => boolean, owned: number[] = []) {
  const killed: number[] = [];
  const j = new ProcessJanitor({
    getOwnedPids: () => new Set(owned),
    listProcesses: () => rows,
    isAlive: alive,
    gracefulMs: 1,
  });
  // `reap` is where the signals go; capture rather than send them.
  (j as unknown as { reap: (pids: number[]) => Promise<number> }).reap = async (pids) => {
    killed.push(...pids);
    return pids.length;
  };
  return { j, killed };
}

describe('the process listing is asynchronous', () => {
  /**
   * It was `execSync('ps -eo …')` with no timeout, called from a 30-second
   * `setInterval` on the daemon's own event loop. A synchronous spawn blocks
   * that loop entirely — no RPC answered, no log line written, no socket
   * serviced — and with no timeout there is no upper bound on "entirely".
   * Observed on the development daemon: the main thread parked in
   * `SyncProcessRunner::Spawn` under `Environment::RunTimers` while its
   * seventeen supervised processes ran on unwatched.
   *
   * The contract that prevents a return to that is this one: the janitor
   * AWAITS its listing, so the real implementation can be asynchronous.
   */
  it('accepts a listing that resolves later', async () => {
    const rows = [row(101, 1)];
    const killed: number[] = [];
    const j = new ProcessJanitor({
      getOwnedPids: () => new Set<number>(),
      listProcesses: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return rows;
      },
      isAlive: () => false,
      gracefulMs: 1,
    });
    (j as unknown as { reap: (pids: number[]) => Promise<number> }).reap = async (pids) => {
      killed.push(...pids);
      return pids.length;
    };

    await j.coldStartSweep();

    // A janitor that called its listing without awaiting would see a Promise
    // where it expects an array, filter nothing out of it, and reap nothing —
    // silently.
    expect(killed).toEqual([101]);
  });
});

describe('coldStartSweep and the orphan it could not see', () => {
  /**
   * The sweep's whole purpose, in its own words: kill every `fork-worker.js`
   * "adopted by init after a previous daemon died". It could not kill one.
   *
   * A dead parent's children are REPARENTED — to launchd on macOS, to init or
   * a subreaper on Linux — so an orphan's `ppid` becomes 1. The filter asked
   * `!isAlive(ppid)`, and pid 1 is alive on every running system, so the
   * answer was `false` for exactly the processes it was written to find.
   *
   * Measured 2026-09-14, minutes after a daemon restart: seven orphans with
   * `ppid = 1`, oldest four and a half hours, still holding their TCP ports.
   * Their replacements could not bind, exhausted their restart budget on
   * EADDRINUSE and gave up — and the console blamed the applications.
   */
  it('reaps a worker reparented to init', async () => {
    const orphan = { pid: 500, ppid: 1, command: 'node fork-worker.js', elapsedSeconds: 16_000 };
    // pid 1 is alive. That is the point: liveness of the REAPER says nothing
    // about the liveness of the parent that actually started this process.
    const { j, killed } = janitor([orphan], (pid) => pid === 1);

    await j.coldStartSweep();

    expect(killed).toEqual([500]);
  });

  it('still leaves another live daemon\'s children alone', async () => {
    // The incident this guard was added for: a unit test whose `process.pid`
    // was a vitest worker reached `coldStartSweep` and killed every backend of
    // the live stand. A foreign parent that is ALIVE is not a dead one.
    const otherDaemonsChild = { pid: 501, ppid: 4242, command: 'node fork-worker.js', elapsedSeconds: 900 };
    const { j, killed } = janitor([otherDaemonsChild], (pid) => pid === 4242 || pid === 1);

    await j.coldStartSweep();

    expect(killed).toEqual([]);
  });

  it('leaves its own children alone', async () => {
    const mine = { pid: 502, ppid: process.pid, command: 'node fork-worker.js', elapsedSeconds: 5 };
    const { j, killed } = janitor([mine], () => true);

    await j.coldStartSweep();

    expect(killed).toEqual([]);
  });
});

describe('coldStartSweep', () => {
  it('leaves a worker whose parent is alive and is not us', async () => {
    // The live-stand case: another daemon is running and owns these.
    const otherDaemon = 4242;
    const { j, killed } = janitor([row(1001, otherDaemon), row(1002, otherDaemon)], (pid) => pid === otherDaemon);

    await expect(j.coldStartSweep()).resolves.toBe(0);
    expect(killed, 'these belong to a daemon that is still running').toEqual([]);
  });

  it('reaps a worker whose parent is gone', async () => {
    // The case it exists for: a previous daemon died and init adopted its
    // children.
    const deadDaemon = 9999;
    const { j, killed } = janitor([row(2001, deadDaemon)], () => false);

    await expect(j.coldStartSweep()).resolves.toBe(1);
    expect(killed).toEqual([2001]);
  });

  it('leaves its own children alone', async () => {
    const { j, killed } = janitor([row(3001, process.pid)], () => true);

    await expect(j.coldStartSweep()).resolves.toBe(0);
    expect(killed).toEqual([]);
  });

  it('tells a dead parent from a live one in the same listing', async () => {
    const live = 5555;
    const dead = 6666;
    const { j, killed } = janitor([row(4001, live), row(4002, dead)], (pid) => pid === live);

    await j.coldStartSweep();

    expect(killed).toEqual([4002]);
  });
});

describe('the two sweeps agree on what an orphan is', () => {
  it('runSweep also leaves another daemon’s children alone', async () => {
    // The rule this test pins was already right here — it is asserted so the
    // two halves cannot drift apart again.
    const otherDaemon = 4242;
    const { j, killed } = janitor([row(1001, otherDaemon)], (pid) => pid === otherDaemon);

    const metrics = await j.runSweep();

    expect(metrics.orphansFound).toBe(0);
    expect(killed).toEqual([]);
  });

  it('runSweep reaps an unclaimed child of THIS process', async () => {
    const { j, killed } = janitor([row(1002, process.pid)], () => true);

    const metrics = await j.runSweep();

    expect(metrics.orphansFound).toBe(1);
    expect(killed).toEqual([1002]);
  });
});


// =============================================================================
// Reaping: what a count means
// =============================================================================

describe('reap — a signal sent is not a process gone', () => {
  /**
   * These exercise the REAL `reap`, so `process.kill` is replaced rather than
   * the method. Every case here was silent before: the escalation produced no
   * log, one process could score two successes, and SIGKILL counted itself
   * successful at the moment the signal left.
   */
  function realJanitor(rows: PsRow[], opts: {
    kill: (pid: number, sig: string) => void;
    alive: (pid: number) => boolean;
  }) {
    const logs: Array<{ level: string; msg: string; pids?: number[] }> = [];
    const logger: any = {
      debug: () => {},
      info: () => {},
      warn: (o: any, m: string) => logs.push({ level: 'warn', msg: m, pids: o?.pids }),
      error: (o: any, m: string) => logs.push({ level: 'error', msg: m, pids: o?.pids }),
    };
    const j = new ProcessJanitor({
      getOwnedPids: () => new Set<number>(),
      listProcesses: () => rows,
      isAlive: opts.alive,
      gracefulMs: 1,
      logger,
    });
    const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: string) => {
      opts.kill(pid, sig);
      return true;
    }) as any);
    return { j, logs, spy };
  }

  afterEach(() => vi.restoreAllMocks());

  it('escalates to SIGKILL and says so', async () => {
    // Measured: every orphan holding a port ignored SIGTERM and stayed in `R`.
    const signals: Array<[number, string]> = [];
    let dead = false;
    const { j, logs, spy } = realJanitor([{ pid: 700, ppid: 1, command: 'node fork-worker.js', elapsedSeconds: 100 }], {
      kill: (pid, sig) => { signals.push([pid, sig]); if (sig === 'SIGKILL') dead = true; },
      alive: (pid) => (pid === 700 ? !dead : true),
    });

    const reaped = await j.coldStartSweep();

    expect(signals).toEqual([[700, 'SIGTERM'], [700, 'SIGKILL']]);
    expect(reaped).toBe(1);
    expect(logs.some((l) => /escalating to SIGKILL/.test(l.msg))).toBe(true);
    spy.mockRestore();
  });

  it('does not let one process\'s double-count cover for another that survived', async () => {
    // The defect needs TWO processes to show, which is why it lasted: a pid
    // that answered `ESRCH` to SIGTERM scored a success, then scored a SECOND
    // one in the SIGKILL pass for not being alive. `Math.min(success, n)` at
    // the end clamps per BATCH, so the spare success paid for a process that
    // genuinely refused to die and the batch reported "all reaped".
    //
    // 701 is already gone; 702 ignores every signal. The honest answer is 1.
    // The old code returned 2.
    const { j, spy } = realJanitor(
      [
        { pid: 701, ppid: 1, command: 'node fork-worker.js', elapsedSeconds: 100 },
        { pid: 702, ppid: 1, command: 'node fork-worker.js', elapsedSeconds: 100 },
      ],
      {
        kill: (pid) => {
          if (pid === 701) { const e: any = new Error('no such process'); e.code = 'ESRCH'; throw e; }
          // 702 takes its signals and carries on.
        },
        alive: (pid) => pid === 702,
      },
    );

    expect(await j.coldStartSweep()).toBe(1);
    spy.mockRestore();
  });

  it('does not report a process that survived SIGKILL as reaped', async () => {
    const { j, logs, spy } = realJanitor([{ pid: 702, ppid: 1, command: 'node fork-worker.js', elapsedSeconds: 100 }], {
      kill: () => { /* signals land, the process does not care */ },
      alive: () => true,
    });

    // It used to return 1: success was recorded when the signal was SENT.
    expect(await j.coldStartSweep()).toBe(0);
    expect(logs.some((l) => l.level === 'error' && /survived SIGKILL/.test(l.msg))).toBe(true);
    spy.mockRestore();
  });
});
