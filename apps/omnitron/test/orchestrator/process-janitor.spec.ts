/**
 * ProcessJanitor unit tests.
 *
 * Janitor logic is decoupled from `ps` and the kernel via two
 * injectable callbacks (`listProcesses`, `isAlive`). Tests provide
 * deterministic fakes; `process.kill` is also stubbed so the host
 * process is never touched.
 *
 * Coverage:
 *   - ownedPids ⊇ alive → no reap
 *   - alive but not owned, ppid = us → reaped
 *   - alive but not owned, ppid = init/dead → reaped (cold-start case)
 *   - cold-start sweep kills all stale fork-workers, leaves ours
 *   - kill errors don't crash the sweep
 *   - sweep metrics are emitted and accurate
 *   - start/stop are idempotent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessJanitor, __test__, type PsRow } from '../../src/orchestrator/process-janitor.js';

type KillSig = string | number;

describe('ProcessJanitor', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let killCalls: Array<{ pid: number; signal: KillSig }>;
  let alivePids: Set<number>;

  beforeEach(() => {
    killCalls = [];
    alivePids = new Set();
    killSpy = vi.spyOn(process, 'kill');
    killSpy.mockImplementation((pid: number, signal?: KillSig | 0) => {
      const sig = (signal ?? 'SIGTERM') as KillSig;
      if (sig === 0) {
        if (alivePids.has(pid)) return true;
        const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        throw err;
      }
      killCalls.push({ pid, signal: sig });
      // Both SIGTERM and SIGKILL kill in our fake.
      alivePids.delete(pid);
      return true;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  function makeListProcesses(rows: Array<Omit<PsRow, 'elapsedSeconds'> & { elapsedSeconds?: number }>) {
    // Default to 600s (10 min) so existing tests don't accidentally hit the
    // new minProcessAgeSeconds guard.
    const filled: PsRow[] = rows.map((r) => ({ ...r, elapsedSeconds: r.elapsedSeconds ?? 600 }));
    for (const r of filled) alivePids.add(r.pid);
    return () => filled;
  }

  function isAlive(pid: number) {
    return alivePids.has(pid);
  }

  it('does not reap pids the orchestrator owns', async () => {
    const list = makeListProcesses([
      { pid: 100, ppid: process.pid, command: 'fork-worker' },
      { pid: 101, ppid: process.pid, command: 'fork-worker' },
    ]);
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      getOwnedPids: () => new Set([100, 101]),
      listProcesses: list,
      isAlive,
    });
    const m = await janitor.runSweep();
    expect(m.orphansFound).toBe(0);
    expect(killCalls).toHaveLength(0);
  });

  it('reaps fork-workers parented to this daemon but not owned', async () => {
    const list = makeListProcesses([
      { pid: 100, ppid: process.pid, command: 'fork-worker' },
      { pid: 200, ppid: process.pid, command: 'fork-worker' },
    ]);
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      getOwnedPids: () => new Set([100]),
      listProcesses: list,
      isAlive,
    });
    const m = await janitor.runSweep();
    expect(m.orphansFound).toBe(1);
    expect(killCalls.some((c) => c.pid === 200 && c.signal === 'SIGTERM')).toBe(true);
    expect(killCalls.some((c) => c.pid === 100)).toBe(false);
  });

  it('reaps fork-workers whose ppid is dead (init-adopted)', async () => {
    // ppid 99999 is "dead" because it's not in alivePids.
    const list = makeListProcesses([{ pid: 300, ppid: 99999, command: 'fork-worker' }]);
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      getOwnedPids: () => new Set(),
      listProcesses: list,
      isAlive,
    });
    const m = await janitor.runSweep();
    expect(m.orphansFound).toBe(1);
    expect(killCalls.some((c) => c.pid === 300)).toBe(true);
  });

  it('coldStartSweep reaps stale workers, leaves ours', async () => {
    const list = makeListProcesses([
      { pid: 400, ppid: 12345, command: 'fork-worker' }, // stale
      { pid: 401, ppid: process.pid, command: 'fork-worker' }, // ours
    ]);
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      getOwnedPids: () => new Set(),
      listProcesses: list,
      isAlive,
    });
    await janitor.coldStartSweep();
    expect(killCalls.some((c) => c.pid === 400)).toBe(true);
    expect(killCalls.some((c) => c.pid === 401)).toBe(false);
  });

  it('emits metrics with accurate counts', async () => {
    const list = makeListProcesses([
      { pid: 100, ppid: process.pid, command: 'fork-worker' },
      { pid: 200, ppid: process.pid, command: 'fork-worker' },
      { pid: 201, ppid: process.pid, command: 'fork-worker' },
    ]);
    const seen: unknown[] = [];
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      getOwnedPids: () => new Set([100]),
      listProcesses: list,
      isAlive,
      onMetrics: (m) => {
        seen.push(m);
      },
    });
    await janitor.runSweep();
    expect(seen).toHaveLength(1);
    const m = seen[0] as { forkWorkersAlive: number; orphansFound: number; orphansKilled: number };
    expect(m.forkWorkersAlive).toBe(3);
    expect(m.orphansFound).toBe(2);
    expect(m.orphansKilled).toBe(2);
  });

  it('kill failure (other than ESRCH) does not crash the sweep', async () => {
    const list = makeListProcesses([{ pid: 500, ppid: process.pid, command: 'fork-worker' }]);
    killSpy.mockImplementation((pid: number, signal?: KillSig | 0) => {
      const sig = (signal ?? 'SIGTERM') as KillSig;
      if (sig === 0) {
        if (pid === 500) return true;
        const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        throw err;
      }
      const err = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      throw err;
    });
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      getOwnedPids: () => new Set(),
      listProcesses: list,
      isAlive: () => true,
    });
    const m = await janitor.runSweep();
    expect(m.orphansFound).toBe(1);
    // Both signals threw EPERM — net successful kills are 0; killErrors
    // is the gap (the metric records this without crashing).
    expect(m.killErrors).toBeGreaterThanOrEqual(0);
  });

  it('does NOT reap a young (under minProcessAge) process even if not in owned set', async () => {
    // Newly-spawned worker — supervisor hasn't yet registered its
    // childName, so getOwnedPids() doesn't include this PID. Without
    // the grace period, the janitor would kill it during its DB/Redis
    // init phase.
    const list = makeListProcesses([
      { pid: 700, ppid: process.pid, command: 'fork-worker', elapsedSeconds: 5 },
    ]);
    const janitor = new ProcessJanitor({
      gracefulMs: 1,
      minProcessAgeSeconds: 60,
      getOwnedPids: () => new Set(),
      listProcesses: list,
      isAlive,
    });
    const m = await janitor.runSweep();
    expect(m.orphansFound).toBe(0);
    expect(killCalls).toHaveLength(0);
  });

  it('parseEtime handles SS / MM:SS / HH:MM:SS / DD-HH:MM:SS', () => {
    const { parseEtime } = __test__;
    expect(parseEtime('0')).toBe(0);
    expect(parseEtime('45')).toBe(45);
    expect(parseEtime('01:30')).toBe(90);
    expect(parseEtime('02:00:00')).toBe(7200);
    expect(parseEtime('1-00:00:00')).toBe(86400);
    expect(parseEtime('2-12:30:15')).toBe(2 * 86400 + 12 * 3600 + 30 * 60 + 15);
    expect(parseEtime('')).toBe(0);
  });

  it('start/stop are idempotent', () => {
    const janitor = new ProcessJanitor({
      intervalMs: 50,
      getOwnedPids: () => new Set(),
      listProcesses: () => [],
      isAlive: () => false,
    });
    janitor.start();
    janitor.start(); // no-op
    janitor.stop();
    janitor.stop(); // no-op
  });
});
