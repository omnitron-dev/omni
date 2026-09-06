/**
 * A test run that is killed leaves its containers running forever.
 *
 * `cleanup` is wired to `process.on('exit')`, `SIGINT` and `SIGTERM`, which
 * covers every ending the process gets to observe. It does not cover SIGKILL,
 * and that is the ending vitest uses when a worker overruns its teardown — so
 * the containers of a killed run keep their ports, their memory and their
 * anonymous volumes, and nothing on the machine is left holding a reference to
 * them.
 *
 * Measured on this machine: `docker ps -a --filter label=test.cleanup=true`
 * returned 67 containers, some `Up 7 hours`, some still in `Created` — from
 * runs that had ended hours earlier. Their layers and volumes were a large part
 * of a Docker VM at 93% (191.2 G of 205.4 G), which is what turned
 * `titan-redis` (45 failures, 112 × "no space") and every `test/security` file
 * in paysys (19 failures, all `TRUNCATE` in `beforeEach`) red. None of those
 * failures were in the code they named.
 *
 * The `test.manager` label already carries the creating process's pid, so an
 * orphan is identifiable without guessing: the process that owns it is gone.
 * Two conditions, both required, because either one alone can be wrong —
 *
 *   - the owner pid is not alive. A pid can be REUSED, so this alone could call
 *     a live manager's container someone else's;
 *   - the container is older than a grace period. A container seconds old
 *     belongs to a run that is starting, whatever the pid table says.
 *
 * Reaping needs both, so a container is removed only when it is both
 * unclaimed and not new. The failure direction of each condition is to leave
 * a container behind, which the next run reaps — never to remove a live one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.fn<(...args: any[]) => any>(() => '');

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: (...args: unknown[]) => execFileSyncMock(...args) };
});
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: (...args: unknown[]) => execFileSyncMock(...args) };
});

const { DockerTestManager } = await import('./docker-test-manager.js');

/** A pid above Linux/macOS pid_max: `kill(pid, 0)` is guaranteed ESRCH. */
const DEAD_PID = 9_999_999;

/** `docker ps --format` renders this shape; the reaper has to read it back. */
function psRow(id: string, ageMs: number, managerId: string): string {
  const created = new Date(Date.now() - ageMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())} ` +
    `${pad(created.getHours())}:${pad(created.getMinutes())}:${pad(created.getSeconds())} ` +
    `${offset(created)} MSK`;
  return `${id}\t${stamp}\ttest.cleanup=true,test.id=${id},test.manager=${managerId}`;
}

function offset(d: Date): string {
  const mins = -d.getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

function removedIds(): string[] {
  return execFileSyncMock.mock.calls
    .map((c) => c[1] as string[])
    .filter((args) => Array.isArray(args) && args[0] === 'rm')
    .flatMap((args) => args.filter((a) => a.startsWith('orphan') || a.startsWith('live') || a.startsWith('fresh')));
}

function armPs(rows: string[]) {
  execFileSyncMock.mockImplementation((_bin: string, args: string[]) => {
    if (args?.[0] === 'ps') return rows.join('\n');
    return '';
  });
}

describe('DockerTestManager orphan reaper', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue('');
    (DockerTestManager as any).orphanReapDone = false;
  });

  it('removes a container whose owning process is gone', () => {
    armPs([psRow('orphan-1', 2 * 60 * 60 * 1000, `${DEAD_PID}-abc-def`)]);

    new DockerTestManager();

    expect(removedIds()).toEqual(['orphan-1']);
  });

  it('keeps a container whose owning process is still running', () => {
    // A parallel vitest run is exactly this: another worker, alive, with
    // containers this manager must not touch. Removing them is how the
    // previous label-wide cleanup broke parallel runs.
    armPs([psRow('live-1', 2 * 60 * 60 * 1000, `${process.pid}-abc-def`)]);

    new DockerTestManager();

    expect(removedIds()).toEqual([]);
  });

  it('keeps a container that is younger than the grace period', () => {
    // Pids are reused. A container created a minute ago belongs to a run that
    // is starting, whatever the pid table now says about its creator.
    armPs([psRow('fresh-1', 30 * 1000, `${DEAD_PID}-abc-def`)]);

    new DockerTestManager();

    expect(removedIds()).toEqual([]);
  });

  it('reaps in one call rather than one call per container', () => {
    // 67 orphans at ~200 ms per `docker rm` is 13 s added to the start of a
    // test file, paid by every worker at once.
    armPs([
      psRow('orphan-1', 2 * 60 * 60 * 1000, `${DEAD_PID}-a-b`),
      psRow('orphan-2', 2 * 60 * 60 * 1000, `${DEAD_PID}-c-d`),
      psRow('orphan-3', 2 * 60 * 60 * 1000, `${DEAD_PID}-e-f`),
    ]);

    new DockerTestManager();

    const rmCalls = execFileSyncMock.mock.calls
      .map((c) => c[1] as string[])
      .filter((args) => Array.isArray(args) && args[0] === 'rm');

    expect(rmCalls.length, 'one removal call expected for all orphans').toBe(1);
    expect(removedIds()).toEqual(['orphan-1', 'orphan-2', 'orphan-3']);
  });

  it('removes anonymous volumes along with the orphan', () => {
    // The orphan holds the same anonymous volume a normal removal would drop;
    // reaping without -v converts a container leak into a volume leak.
    armPs([psRow('orphan-1', 2 * 60 * 60 * 1000, `${DEAD_PID}-a-b`)]);

    new DockerTestManager();

    const rmArgs = execFileSyncMock.mock.calls
      .map((c) => c[1] as string[])
      .find((args) => Array.isArray(args) && args[0] === 'rm');

    expect(rmArgs).toContain('-v');
    expect(rmArgs).toContain('-f');
  });

  it('runs once per process, not once per manager', () => {
    armPs([]);

    new DockerTestManager();
    const afterFirst = execFileSyncMock.mock.calls.filter((c) => (c[1] as string[])?.[0] === 'ps').length;
    new DockerTestManager();
    const afterSecond = execFileSyncMock.mock.calls.filter((c) => (c[1] as string[])?.[0] === 'ps').length;

    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1);
  });

  it('survives docker being unavailable', () => {
    // The reaper runs in a constructor. A machine without a reachable docker
    // must still get a manager — the failure belongs to the first container
    // command, with its own message, not to construction.
    execFileSyncMock.mockImplementation((_bin: string, args: string[]) => {
      if (args?.[0] === 'ps') throw new Error('Cannot connect to the Docker daemon');
      return '';
    });

    expect(() => new DockerTestManager()).not.toThrow();
  });
});
