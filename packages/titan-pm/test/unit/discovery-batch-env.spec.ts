/**
 * Discovery must not fork `ps` once per process on the host.
 *
 * The env is what DECIDES whether a process is one of ours, so a per-match
 * cost model is not achievable: reading env per pid means reading it for every
 * pid in the table. On Darwin that read was `execSync('ps -p <pid> -E ...')`.
 *
 * Measured on an idle macOS host with ~860 processes, same test, same moment:
 *
 *     per-pid path : 6478 ms
 *     batch path   :   99 ms
 *
 * — and both returned the identical process with the same fully-qualified name
 * and managed flag, so this is a cost change and not a behaviour change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

vi.mock('../../src/liveness.js', () => ({
  isAlive: () => true,
}));

const { discoverManagedProcesses } = await import('../../src/discovery.js');

const HOST_PIDS = Array.from({ length: 300 }, (_, i) => 1000 + i);
const TAGGED = 1042;

function psTable(): string {
  return ['  PID  PPID     ELAPSED', ...HOST_PIDS.map((p) => `  ${p}     1    00:07`)].join('\n');
}

function psBatchEnv(): string {
  return HOST_PIDS.map((p) =>
    p === TAGGED
      ? `  ${p} node server.js OMNITRON_APP_NAME=api OMNITRON_PROJECT=proj OMNITRON_STACK=stack OMNITRON_MANAGED=1`
      : `  ${p} /usr/bin/something --flag PATH=/usr/bin`
  ).join('\n');
}

describe('discoverManagedProcesses — batched env read', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it('reads every environment in one ps call, not one per pid', () => {
    // The per-pid command is served too, so the old code path would also
    // find the process: the ONLY thing this test can fail on is how many
    // times `ps` was forked.
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('ps -eo')) return psTable();
      if (cmd.startsWith('ps -A -E')) return psBatchEnv();
      if (cmd.startsWith(`ps -p ${TAGGED} `)) {
        return 'node server.js OMNITRON_APP_NAME=api OMNITRON_PROJECT=proj OMNITRON_STACK=stack OMNITRON_MANAGED=1';
      }
      if (cmd.startsWith('ps -p ')) return '/usr/bin/something --flag PATH=/usr/bin';
      throw new Error(`unexpected command: ${cmd}`);
    });

    const found = discoverManagedProcesses();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      pid: TAGGED,
      appName: 'api',
      fullyQualifiedName: 'proj/stack/api',
      managed: true,
    });

    // Two forks total: the process table, and every environment on the host.
    // Before this change it was 1 + 300.
    expect(execSyncMock).toHaveBeenCalledTimes(2);
    const commands = execSyncMock.mock.calls.map((c) => c[0] as string);
    expect(commands.filter((c) => c.startsWith('ps -p '))).toHaveLength(0);
  });

  it('falls back to the per-pid reader when the batch call fails', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('ps -eo')) return psTable();
      if (cmd.startsWith('ps -A -E')) throw new Error('ps: illegal option -- E');
      if (cmd.startsWith(`ps -p ${TAGGED} `)) {
        return 'node server.js OMNITRON_APP_NAME=api OMNITRON_PROJECT=proj OMNITRON_STACK=stack OMNITRON_MANAGED=1';
      }
      if (cmd.startsWith('ps -p ')) return '/usr/bin/something --flag PATH=/usr/bin';
      throw new Error(`unexpected command: ${cmd}`);
    });

    // A BSD without `-E`, or any other reason the batch form is unavailable,
    // must degrade to the old path rather than discover nothing — an empty
    // result here reads as "no managed processes" and would send the
    // orchestrator on to re-spawn every one of them.
    const found = discoverManagedProcesses();

    expect(found).toHaveLength(1);
    expect(found[0]?.appName).toBe('api');
    expect(execSyncMock.mock.calls.filter((c) => (c[0] as string).startsWith('ps -p ')).length).toBe(
      HOST_PIDS.length
    );
  });
});
