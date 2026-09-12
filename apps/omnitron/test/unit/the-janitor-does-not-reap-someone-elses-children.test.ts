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
import { describe, it, expect, vi } from 'vitest';

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
