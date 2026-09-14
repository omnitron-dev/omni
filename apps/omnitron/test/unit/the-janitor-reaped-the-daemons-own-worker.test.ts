/**
 * The janitor killed the health monitor, 108 times, and called it an orphan.
 *
 * `ProcessJanitor` reaps every `fork-worker.js` process parented by this
 * daemon that the daemon does not claim. What it claims comes from
 * `OrchestratorService.collectOwnedPids`, and that walked the orchestrator's
 * APP handles — supervisor children, topology pools — plus `getForkedPids()`,
 * a claim titan-pm holds only from `fork()` until `spawn()` settles and then
 * releases by design.
 *
 * The daemon's own system workers are spawned through the same process
 * manager and belong to no app. So the health-monitor worker was owned for
 * the length of its startup and an orphan from the moment it was ready — and
 * the janitor's 60-second age threshold only decided how long it lived, not
 * whether it died.
 *
 * Measured on the development daemon, 2026-09-14: eight deaths sampled, each
 * 0.4-2.7 s after a janitor sweep; 108 in three and a half hours. Every one
 * recorded as `code: 0, signal: null`, because SIGTERM reaches Titan's
 * graceful shutdown — a clean exit, indistinguishable in the log from a
 * worker that chose to stop. The console meanwhile showed the daemon's
 * fallback readings, which know only whether a TCP port answers, instead of
 * the worker's, which had established over SSH that the node had no omnitron
 * installed at all.
 *
 * The rule these pin: a pid the process manager vouches for is not an orphan,
 * whatever it was started for.
 */

import { describe, it, expect, vi } from 'vitest';

// `ensureBootReconciled` walks `ps` through this export before it reaches the
// janitor. Nothing here calls that path, but the import is resolved at module
// scope in the service, so it is mocked at the boundary rather than on the
// instance. See the longer note in `boot-reconcile.spec.ts`.
vi.mock('@omnitron-dev/titan-pm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverManagedProcesses: () => [],
}));

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { ProcessStatus } from '@omnitron-dev/titan-pm';

const noopLogger: any = {
  info: () => undefined, warn: () => undefined, error: () => undefined,
  debug: () => undefined, trace: () => undefined, fatal: () => undefined,
  child: () => noopLogger,
};

/** A process manager holding the records given, and no in-flight spawns. */
function managerWith(records: Array<{ pid?: number; status: string }>) {
  return {
    getForkedPids: () => new Set<number>(),
    listProcesses: () => records,
    getWorkerHandle: () => undefined,
  } as any;
}

/** The orchestrator's live owned set, with no apps registered. */
function ownedWith(pm: any): Set<number> {
  const stateStore = { save: () => undefined, load: () => null, clear: () => undefined } as any;
  const svc = new OrchestratorService(noopLogger, pm, stateStore, process.cwd());
  return (svc as any).collectOwnedPids();
}

describe('a system worker is not an orphan', () => {
  it('claims a running process that belongs to no app', () => {
    // The health-monitor case exactly: spawned through the process manager by
    // `SystemWorkerManager`, so it has a record and a pid, and reachable
    // through no app handle at all.
    const owned = ownedWith(managerWith([{ pid: 7777, status: ProcessStatus.RUNNING }]));

    expect(owned.has(7777)).toBe(true);
  });

  it('claims it while it is still starting, and while it is stopping', () => {
    // Startup is where this worker spends most of its life — 100-160 seconds
    // to build a Titan application, measured on the same daemon. Shutdown is
    // short but is still a live process holding what it holds.
    const owned = ownedWith(managerWith([
      { pid: 1, status: ProcessStatus.PENDING },
      { pid: 2, status: ProcessStatus.STARTING },
      { pid: 3, status: ProcessStatus.STOPPING },
    ]));

    expect([...owned].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('does not claim a pid whose process has ended', () => {
    // A terminal record keeps the pid it had and the OS reuses pids. Vouching
    // for one would protect precisely the leaked worker the janitor exists to
    // reap — and it would do so on the strength of a process that is gone.
    const owned = ownedWith(managerWith([
      { pid: 11, status: ProcessStatus.STOPPED },
      { pid: 12, status: ProcessStatus.FAILED },
      { pid: 13, status: ProcessStatus.CRASHED },
    ]));

    expect([...owned]).toEqual([]);
  });

  it('reads the statuses titan-pm actually emits', () => {
    // The terminal set is written as string literals, because `ProcessStatus`
    // is a const object whose VALUES are what a record carries. A typo there
    // is invisible: the record simply never matches, the pid is protected,
    // and a leak survives every sweep in silence.
    const terminal = [ProcessStatus.STOPPED, ProcessStatus.FAILED, ProcessStatus.CRASHED];
    const live = [ProcessStatus.PENDING, ProcessStatus.STARTING, ProcessStatus.RUNNING, ProcessStatus.STOPPING];

    for (const status of terminal) {
      expect(ownedWith(managerWith([{ pid: 900, status }])).has(900)).toBe(false);
    }
    for (const status of live) {
      expect(ownedWith(managerWith([{ pid: 900, status }])).has(900)).toBe(true);
    }
    // Every member of the enum is covered, so a new one cannot be added
    // without this failing.
    expect(new Set([...terminal, ...live])).toEqual(new Set(Object.values(ProcessStatus)));
  });

  it('skips a record with no pid of its own', () => {
    // A worker thread shares the daemon's pid. Adding it would hand the
    // janitor the daemon's own pid to reason about.
    const owned = ownedWith(managerWith([{ status: ProcessStatus.RUNNING }]));

    expect([...owned]).toEqual([]);
  });

  it('still claims a spawn that has not settled', () => {
    // The window `getForkedPids` was added for. The registry below is empty,
    // which is what it holds while a child is still booting.
    const pm = {
      getForkedPids: () => new Set<number>([4242]),
      listProcesses: () => [],
      getWorkerHandle: () => undefined,
    } as any;

    expect([...ownedWith(pm)]).toEqual([4242]);
  });

  it('survives a manager that reports neither', () => {
    // Both accessors are optional on the interface the orchestrator holds,
    // and the test doubles across this suite supply `{}`.
    expect([...ownedWith({} as any)]).toEqual([]);
  });
});
