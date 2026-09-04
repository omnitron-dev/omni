import { spawn, type ChildProcess } from 'node:child_process';
import { describe, it, expect, afterEach } from 'vitest';

import { discoverManagedProcesses, parseEtime, parsePsRows } from '../../src/discovery.js';

describe('parseEtime', () => {
  it('parses MM:SS', () => {
    expect(parseEtime('00:07')).toBe(7);
    expect(parseEtime('12:38')).toBe(12 * 60 + 38);
  });

  it('parses HH:MM:SS', () => {
    expect(parseEtime('12:38:21')).toBe(12 * 3600 + 38 * 60 + 21);
  });

  it('parses DD-HH:MM:SS', () => {
    expect(parseEtime('50-02:22:58')).toBe(50 * 86_400 + 2 * 3600 + 22 * 60 + 58);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseEtime('  01:00  ')).toBe(60);
  });

  it('returns 0 for anything it cannot read', () => {
    expect(parseEtime('')).toBe(0);
    expect(parseEtime('   ')).toBe(0);
    expect(parseEtime('-')).toBe(0);
    expect(parseEtime('12')).toBe(0);
    expect(parseEtime('a:b')).toBe(0);
    expect(parseEtime('1:2:3:4')).toBe(0);
    expect(parseEtime('-1:00')).toBe(0);
  });
});

describe('parsePsRows', () => {
  it('parses real macOS `ps -eo pid,ppid,etime` output', () => {
    const raw = ['  PID  PPID     ELAPSED', '    1     0 50-02:22:58', '  305     1    12:38:21', ''].join('\n');
    expect(parsePsRows(raw)).toEqual([
      { pid: 1, ppid: 0, elapsedSeconds: 50 * 86_400 + 2 * 3600 + 22 * 60 + 58 },
      { pid: 305, ppid: 1, elapsedSeconds: 12 * 3600 + 38 * 60 + 21 },
    ]);
  });

  it('parses the minimal two-column fallback', () => {
    const raw = ['  PID  PPID', '    1     0', '  305     1', ''].join('\n');
    expect(parsePsRows(raw)).toEqual([
      { pid: 1, ppid: 0, elapsedSeconds: 0 },
      { pid: 305, ppid: 1, elapsedSeconds: 0 },
    ]);
  });

  it('skips blank and unparseable rows', () => {
    const raw = ['  PID  PPID     ELAPSED', '', 'garbage row', '  42     1    00:05'].join('\n');
    expect(parsePsRows(raw)).toEqual([{ pid: 42, ppid: 1, elapsedSeconds: 5 }]);
  });
});

describe('discoverManagedProcesses', () => {
  const spawned: ChildProcess[] = [];

  afterEach(() => {
    for (const child of spawned.splice(0)) {
      if (child.pid && !child.killed) child.kill('SIGKILL');
    }
  });

  it('matches on OMNITRON_APP_NAME and builds the fully-qualified name', () => {
    const found = discoverManagedProcesses({
      listPids: () => [
        { pid: process.pid, ppid: 1, elapsedSeconds: 12 },
        { pid: process.pid, ppid: 1, elapsedSeconds: 34 },
      ],
      readEnv: (pid) =>
        pid === process.pid
          ? {
              OMNITRON_MANAGED: '1',
              OMNITRON_APP_NAME: 'api',
              OMNITRON_PROJECT: 'daos',
              OMNITRON_STACK: 'prod',
            }
          : null,
    });

    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      appName: 'api',
      fullyQualifiedName: 'daos/prod/api',
      managed: true,
      elapsedSeconds: 12,
    });
  });

  it('ignores processes without an app-name tag', () => {
    const found = discoverManagedProcesses({
      listPids: () => [{ pid: process.pid, ppid: 1, elapsedSeconds: 0 }],
      readEnv: () => ({ PATH: '/usr/bin' }),
    });
    expect(found).toEqual([]);
  });

  it('falls back to the bare app name without project/stack', () => {
    const [found] = discoverManagedProcesses({
      listPids: () => [{ pid: process.pid, ppid: 1, elapsedSeconds: 0 }],
      readEnv: () => ({ OMNITRON_APP_NAME: 'solo', OMNITRON_MANAGED: 'true' }),
    });
    expect(found?.fullyQualifiedName).toBe('solo');
    expect(found?.managed).toBe(true);
  });

  /**
   * The regression test for the real defect.
   *
   * `listAllPids()` used to run `ps -eo pid,ppid,etimes`. `etimes` is a procps
   * (Linux) extension: on macOS/BSD that command fails with
   * `ps: etimes: keyword not found` and exit 1, so execSync threw, the bare
   * catch swallowed it, and discovery returned [] on every Darwin host — a
   * silent total failure on a platform the module header claims to support.
   *
   * This test walks the real process table, so it fails on macOS before the
   * fix and passes after it. It is also the only test in the package that
   * exercises src/discovery.ts against the host at all.
   */
  it('discovers a real tagged child process from the host process table', async () => {
    const appName = `pm-discovery-probe-${process.pid}-${Date.now()}`;
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: {
        ...process.env,
        OMNITRON_MANAGED: '1',
        OMNITRON_APP_NAME: appName,
        OMNITRON_PROJECT: 'titan-pm-test',
        OMNITRON_STACK: 'unit',
      },
      stdio: 'ignore',
    });
    spawned.push(child);
    expect(child.pid).toBeGreaterThan(0);

    // The child has to appear in the process table and finish exec'ing before
    // its environment is readable; poll rather than sleeping a fixed amount.
    const deadline = Date.now() + 15_000;
    let match: ReturnType<typeof discoverManagedProcesses>[number] | undefined;
    while (Date.now() < deadline) {
      match = discoverManagedProcesses().find((p) => p.appName === appName);
      if (match) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(match, 'tagged child process was not discovered from the host process table').toBeDefined();
    expect(match).toMatchObject({
      pid: child.pid,
      appName,
      fullyQualifiedName: `titan-pm-test/unit/${appName}`,
      managed: true,
    });
    expect(match!.elapsedSeconds).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
