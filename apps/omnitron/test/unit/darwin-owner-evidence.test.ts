import { describe, expect, it } from 'vitest';
import { darwinProcessCohort, parseDarwinJob, parseDarwinProcesses, parseDarwinSockets, type DarwinProcessIdentity } from '../../src/daemon/darwin-owner-evidence.js';

const row = (pid: number, ppid: number, pgid: number, executable = '/usr/bin/node'): DarwinProcessIdentity =>
  ({ pid, ppid, pgid, uid: 501, lifetime: `boot:${pid}`, executable });

describe('Darwin owner recovery native observations', () => {
  it('preserves process ancestry, native groups and stable birth identity without reading arguments', () => {
    expect(parseDarwinProcesses('  70  1 70 501 Mon Nov  2 01:22:03 2026 /opt/project path/app\n', 'boot'))
      .toEqual([{ pid: 70, ppid: 1, pgid: 70, uid: 501, lifetime: 'boot:Mon Nov  2 01:22:03 2026', executable: '/opt/project path/app' }]);
  });
  it.each(['', '70 unknown', '70 1 70 501 unknown /bin/node', '70 1 70 501 Mon Nov 2 01:22:03 2026 /a\n70 1 70 501 Mon Nov 2 01:22:03 2026 /a'])('refuses incomplete or ambiguous process output', output => {
    expect(() => parseDarwinProcesses(output, 'boot')).toThrow();
  });
  it('includes non-Node descendants, detached descendant groups, and reparented members of retained groups', () => {
    const rows = [row(10, 1, 10), row(11, 10, 10, '/usr/bin/python3'), row(12, 11, 12, '/opt/worker-rust'),
      row(13, 1, 12, '/opt/reparented'), row(14, 1, 70), row(90, 1, 90)];
    expect(darwinProcessCohort(rows, [10], [70]).map(item => item.pid)).toEqual([10, 11, 12, 13, 14]);
  });
  it('retains a process group after its original leader exits', () => {
    expect(darwinProcessCohort([row(11, 1, 10), row(90, 1, 90)], [], [10]).map(item => item.pid)).toEqual([11]);
  });
  it('accepts the signed reserved UID used by macOS system processes', () => {
    expect(parseDarwinProcesses('70 1 70 -2 Mon Nov  2 01:22:03 2026 /usr/libexec/dhcp6d', 'boot')[0]!.uid).toBe(-2);
  });
  it('requires the exact launchd domain and distinguishes waiting from quiescence', () => {
    const target = 'gui/501/dev.omnitron.fixture.owner';
    expect(parseDarwinJob(`${target} = {\n state = not running\n}`, target)).toEqual({ mainPid: 0, state: 'inactive' });
    expect(parseDarwinJob(`${target} = {\n state = waiting\n}`, target)).toEqual({ mainPid: 0, state: 'activating' });
    expect(parseDarwinJob(`${target} = {\n state = running\n pid = 70\n}`, target)).toEqual({ mainPid: 70, state: 'active' });
    expect(() => parseDarwinJob('system/dev.omnitron.fixture.owner = {\n state = not running\n}', target)).toThrow('identity');
    expect(() => parseDarwinJob(`${target} = {\n state = unrecognized\n}`, target)).toThrow('Unknown');
  });
  it('checks every kernel Unix socket in the execution directory, without prefix collisions', () => {
    expect(parseDarwinSockets('p70\0\nf1\0n/private/home/execution/owner.sock\0n/private/home/execution/backend.sock\0n/private/home/execution-other/x\0\n', '/private/home/execution'))
      .toEqual(['/private/home/execution/owner.sock', '/private/home/execution/backend.sock']);
    expect(() => parseDarwinSockets('unrecognized\0', '/private/home/execution')).toThrow('Unrecognized');
  });
});
