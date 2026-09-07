/**
 * What `omnitron list` reports for a child process.
 *
 * The child rows carried two values that were not measurements. `uptime` was
 * the PARENT app's uptime, and `restarts` was the literal `0`. Both read as
 * facts about the child, and the table is the primary command of the tool.
 *
 * Observed on this machine, and the reason these tests exist: the `transform`
 * pool of `daos/dev/storage` was replaced at 10:49 (pids 57269+58823 →
 * 76441+76513). Two minutes later `omnitron list` printed `UPTIME 1d 0h` and
 * `RST 0` for pid 76441, a process the OS said was 156 seconds old. An
 * operator reading that table after the incident would conclude nothing had
 * happened.
 *
 * The honest sources both exist and are already used elsewhere:
 * `IProcessInfo.startTime` — fresh per spawn, since a restart re-registers
 * the child under a new process id — and `ProcessSupervisor.getRestartCount`,
 * which is the counter the supervisor actually maintains. Note that
 * `IProcessInfo.restartCount` is NOT that counter: it is assigned `0` at
 * registration and incremented nowhere, so wiring it up would have preserved
 * the defect through a new path.
 */

import { describe, it, expect } from 'vitest';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import type { IProcessEntry } from '../../src/config/types.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface FakeProc {
  pid: number;
  startTime: number;
}

/**
 * `pm` is the I/O boundary — the process manager owning the OS processes.
 * Everything else is production's: the orchestrator, the handle, and the
 * mapping under test are the real ones, reached through the real `list()`.
 */
function makeOrchestrator(procs: Record<string, FakeProc>): OrchestratorService {
  const logger: any = {
    info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
    child() { return logger; },
  };
  const pm: any = {
    getWorkerHandle: (id: string) => (procs[id] ? { pid: procs[id]!.pid } : undefined),
    getProcess: (id: string) =>
      procs[id]
        ? { id, name: id, status: 'running', startTime: procs[id]!.startTime, restartCount: 0 }
        : undefined,
  };
  const stateStore: any = { save() {}, load: () => null };
  return new OrchestratorService(logger, pm, stateStore, process.cwd());
}

function entry(name: string, extra: Partial<IProcessEntry> = {}): IProcessEntry {
  return { name, module: `./${name}.js`, ...extra } as IProcessEntry;
}

/**
 * One app, two topology entries: a supervisor-managed child and a pool.
 * `process.pid` stands in for every child pid so the mapper's `isAlive`
 * signal-0 guard sees a live process — the guard is production's and must
 * not be the thing that decides the outcome here.
 */
function scenario(opts: { appStatus: 'online' | 'crashed'; childRestarts: number }) {
  const now = Date.now();
  const procs: Record<string, FakeProc> = {
    'proc-http': { pid: process.pid, startTime: now - 3 * MINUTE },
    'pool-a': { pid: process.pid, startTime: now - 5 * MINUTE },
    'pool-b': { pid: process.pid, startTime: now - 5 * MINUTE },
  };
  const orch = makeOrchestrator(procs);

  const handle = new AppHandle({ name: 'demo', bootstrap: './demo.ts' } as any, 'bootstrap');
  handle.status = opts.appStatus;
  handle.pid = process.pid;
  // The app itself really has been up for a day. That is the value the child
  // rows used to borrow.
  handle.startedAt = opts.appStatus === 'online' ? now - DAY : 0;

  handle.topologyProcesses = [
    entry('http', { transports: { http: { port: 3000 } } as any }),
    entry('pool', { instances: 2 }),
  ];
  handle.supervisor = {
    getChildNames: () => ['http'],
    getChildProcessId: (n: string) => (n === 'http' ? 'proc-http' : null),
    getRestartCount: (n: string) => (n === 'http' ? opts.childRestarts : 0),
  } as any;
  handle.topologyPools.set('pool', {
    size: 2,
    getWorkerIds: () => ['pool-a', 'pool-b'],
  } as any);

  (orch as any).handles.set('demo', handle);
  const [app] = orch.list();
  return {
    app: app!,
    http: app!.processes!.find((p) => p.name === 'http')!,
    pool: app!.processes!.find((p) => p.name === 'pool')!,
  };
}

describe('omnitron list — child process runtime', () => {
  it('reports the child\'s own uptime, not the app\'s', () => {
    const { app, http } = scenario({ appStatus: 'online', childRestarts: 0 });

    // The app genuinely has a day of uptime; the child was spawned 3 minutes
    // ago. Borrowing the app's value is what made a 156-second-old process
    // report `1d 0h`.
    expect(app.uptime).toBeGreaterThan(DAY - MINUTE);
    expect(http.uptime).toBeGreaterThanOrEqual(3 * MINUTE);
    expect(http.uptime).toBeLessThan(4 * MINUTE);
  });

  it('reports the restart count the supervisor maintains', () => {
    const { http } = scenario({ appStatus: 'online', childRestarts: 2 });

    // Not `toBeGreaterThan(0)`: the value has to be the supervisor's, and a
    // looser assertion would pass on any non-zero number the mapper invented.
    expect(http.restarts).toBe(2);
  });

  it('does not claim zero restarts for a pool, which has no such counter', () => {
    const { pool } = scenario({ appStatus: 'online', childRestarts: 2 });

    // A pool is not a supervisor child, so nothing counts its restarts. `0`
    // here would be absence written as a value from the domain — the reader
    // cannot tell "never restarted" from "not tracked".
    expect(pool.restarts).toBeNull();
  });

  it('gives a pool the uptime of the worker whose pid it prints', () => {
    const { pool } = scenario({ appStatus: 'online', childRestarts: 0 });

    // The row shows one pid for a pool of several, so the row must be
    // internally consistent: that pid's uptime, not the app's.
    expect(pool.uptime).toBeGreaterThanOrEqual(5 * MINUTE);
    expect(pool.uptime).toBeLessThan(6 * MINUTE);
    expect(pool.instances).toBe(2);
    expect(pool.declaredInstances).toBe(2);
  });

  it('keeps reporting a live child when the app itself is crashed', () => {
    const { app, http } = scenario({ appStatus: 'crashed', childRestarts: 0 });

    // Observed live: `daos/dev/priceverse` was crashed, so `handle.uptime`
    // was 0, so every one of its children reported `-` — including two that
    // were alive and serving. The child's clock does not stop because its
    // parent's did.
    expect(app.uptime).toBe(0);
    expect(http.uptime).toBeGreaterThanOrEqual(3 * MINUTE);
  });
});
