import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guardianControlGroup, guardianGroupIdentity, prepareGuardianFence, checkGuardianStopFence, verifyStoppedGuardian } from '../../src/daemon/system-guardian-cgroup.js';
import { readProcessLifetime } from '@omnitron-dev/common/process-identity';

vi.mock('@omnitron-dev/common/process-identity', async importOriginal => ({ ...await importOriginal<typeof import('@omnitron-dev/common/process-identity')>(), readProcessLifetime: vi.fn() }));
let root: string;
const guardian = 101, backend = 102, unit = 'omnitron-daemon.service', group = '/system.slice/' + unit;
const facts = { Id: unit, ActiveState: 'active', MainPID: String(guardian), KillMode: 'control-group', Delegate: 'no', ControlGroup: group };
const write = (dir: string, file: string, value: string) => fs.writeFileSync(path.join(dir, file), value + '\n');
function domain(dir: string, pids: number[], descendants = 0) {
  fs.mkdirSync(dir, { recursive: true });
  write(dir, 'cgroup.procs', pids.join('\n')); write(dir, 'cgroup.type', 'domain');
  write(dir, 'cgroup.events', 'populated ' + Number(pids.length > 0) + '\nfrozen 0');
  write(dir, 'cgroup.stat', 'nr_descendants ' + descendants + '\nnr_dying_descendants 0');
}
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-cgroup-'))); domain(root, [backend, guardian]); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
it('binds the root to the exact non-delegated active systemd unit and its MainPID', () => {
  expect(guardianControlGroup(unit, guardian, facts)).toBe(group);
  for (const changed of [{ MainPID: '777' }, { Delegate: undefined }, { Delegate: 'yes' }, { ActiveState: 'failed' }, { Id: 'other.service' },
    { ControlGroup: '/bad/../' + unit }, { ControlGroup: './' + unit }, { ControlGroup: group + '/worker' }, { KillMode: 'mixed' }]) {
    expect(() => guardianControlGroup(unit, guardian, { ...facts, ...changed } as Record<string, string>)).toThrow();
  }
});
it('accepts empty descendants but refuses occupied descendants or any extra PID, even outside a known application', () => {
  const nested = path.join(root, 'a'), leaf = path.join(nested, 'b');
  domain(root, [backend, guardian], 2); domain(nested, [], 1); domain(leaf, []);
  expect(guardianGroupIdentity(root, [guardian, backend])).toMatch(/^[a-f0-9]{64}$/);
  domain(leaf, [345]); expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow(/nested process/);
  domain(leaf, []); write(root, 'cgroup.procs', '101\n102\n999'); expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow(/process/);
});
it('reads the documented unordered PID set without mistaking repeated entries for another process', () => {
  const identity = guardianGroupIdentity(root, [guardian, backend]);
  write(root, 'cgroup.procs', '102\n101\n102\n101');
  expect(guardianGroupIdentity(root, [guardian, backend])).toBe(identity);
  write(root, 'cgroup.procs', '102\n101\n999\n999');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow('expected PIDs [101 102], observed [101 102 999]');
  write(root, 'cgroup.procs', '102\n102');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow('expected PIDs [101 102], observed [102]');
});
it('distinguishes unsafe cgroup state from process membership and refuses ambiguous event records', () => {
  write(root, 'cgroup.events', 'populated 1\nfrozen 1');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow('observed populated=1, frozen=1');
  write(root, 'cgroup.events', 'populated 0\npopulated 1\nfrozen 0');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow('observed populated=unknown, frozen=0');
  write(root, 'cgroup.procs', '101\n1e2');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow('Malformed PID record');
});
it('rejects disappearing, dying, unreadable, symlinked and non-domain cgroups', () => {
  write(root, 'cgroup.stat', 'nr_descendants 1\nnr_dying_descendants 0');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow(/changed/);
  write(root, 'cgroup.stat', 'nr_descendants 0\nnr_dying_descendants 1');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow(/changed/);
  domain(root, [guardian, backend]); fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow(/Unexpected/);
  fs.unlinkSync(path.join(root, 'link')); write(root, 'cgroup.type', 'threaded');
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow(/domain/);
  domain(root, [guardian, backend]); fs.unlinkSync(path.join(root, 'cgroup.procs'));
  expect(() => guardianGroupIdentity(root, [guardian, backend])).toThrow();
});
function mountFixture() {
  const realpath = fs.realpathSync, stat = fs.statSync, lstat = fs.lstatSync, open = fs.openSync, opendir = fs.opendirSync, readFile = fs.readFileSync;
  const virtual = '/sys/fs/cgroup' + group;
  const mapped = (file: unknown) => typeof file === 'string' && file.startsWith(virtual) ? root + file.slice(virtual.length) : file;
  vi.spyOn(fs, 'statfsSync').mockReturnValue({ type: 0x63677270 } as ReturnType<typeof fs.statfsSync>);
  vi.spyOn(fs, 'lstatSync').mockImplementation(((p: string, o: object) => lstat(mapped(p) as string, o)) as typeof fs.lstatSync);
  vi.spyOn(fs, 'opendirSync').mockImplementation((p, o) => opendir(mapped(p) as string, o));
  vi.spyOn(fs, 'openSync').mockImplementation((p, f, m) => open(mapped(p) as string, f, m));
  vi.spyOn(fs, 'statSync').mockImplementation(((p: string, o: object) => stat(p.startsWith('/proc/') ? process.execPath : p, o)) as typeof fs.statSync);
  vi.spyOn(fs, 'realpathSync').mockImplementation(((p: string) => p.startsWith('/proc/') ? process.execPath :
    realpath(mapped(p) as string).replace(root, virtual)) as typeof fs.realpathSync);
  vi.spyOn(fs, 'readFileSync').mockImplementation(((p: string) => p.endsWith('/cgroup') ? '0::' + group + '\n' :
    p.endsWith('/cmdline') ? Buffer.from('node\0service\0') : readFile(p)) as typeof fs.readFileSync);
  vi.mocked(readProcessLifetime).mockImplementation(pid => ({ state: 'alive', identity: 'boot:' + pid }));
}
it('rejects PID reuse after preparation, and a PID replaced between two observations', () => {
  mountFixture();
  const fence = checkGuardianStopFence(group, guardian, backend);
  vi.mocked(readProcessLifetime).mockImplementation(pid => ({ state: 'alive', identity: 'other:' + pid }));
  expect(() => checkGuardianStopFence(group, guardian, backend, fence)).toThrow(/identity changed/);
  vi.mocked(readProcessLifetime).mockImplementationOnce(() => ({ state: 'alive', identity: 'first' }));
  expect(() => checkGuardianStopFence(group, guardian, backend)).toThrow(/identity changed/);
});

it('prepares only after an extra root member leaves and the original lifetimes are reverified', async () => {
  mountFixture(); vi.useFakeTimers();
  try {
    const file = path.join(root, 'cgroup.procs');
    fs.writeFileSync(file, '101\n102\n999\n');
    const inspect = vi.fn(async () => checkGuardianStopFence(group, guardian, backend));
    const pending = prepareGuardianFence(guardian, backend, inspect);
    await vi.advanceTimersByTimeAsync(100);
    expect(inspect).toHaveBeenCalledTimes(2);
    fs.writeFileSync(file, '101\n102\n');
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual(checkGuardianStopFence(group, guardian, backend));
  } finally { vi.useRealTimers(); }
});

it('keeps the refusal for a persistent, missing or nested member and never admits a reused PID', async () => {
  mountFixture(); vi.useFakeTimers();
  const inspect = vi.fn(async () => checkGuardianStopFence(group, guardian, backend));
  try {
    write(root, 'cgroup.procs', '101\n102\n999');
    const timeout = expect(prepareGuardianFence(guardian, backend, inspect)).rejects.toThrow('observed [101 102 999]');
    await vi.advanceTimersByTimeAsync(1600); await timeout;
    inspect.mockClear(); write(root, 'cgroup.procs', '101');
    await expect(prepareGuardianFence(guardian, backend, inspect)).rejects.toThrow('observed [101]');
    expect(inspect).toHaveBeenCalledTimes(1);
    inspect.mockClear(); domain(root, [guardian, backend], 1); domain(path.join(root, 'child'), [999]);
    await expect(prepareGuardianFence(guardian, backend, inspect)).rejects.toThrow('cgroup "child"');
    expect(inspect).toHaveBeenCalledTimes(1);
    domain(path.join(root, 'child'), []); write(root, 'cgroup.procs', '101\n102\n999');
    const reused = expect(prepareGuardianFence(guardian, backend, inspect)).rejects.toThrow('identity changed');
    await vi.advanceTimersByTimeAsync(0);
    write(root, 'cgroup.procs', '101\n102');
    vi.mocked(readProcessLifetime).mockImplementation(pid => ({state:'alive', identity:'replacement:' + pid}));
    await vi.advanceTimersByTimeAsync(100); await reused;
  } finally { vi.useRealTimers(); }
});
it('allows a confirmed backend exit only during retirement, retaining the prepared guardian and process identity', () => {
  mountFixture();
  const fence = checkGuardianStopFence(group, guardian, backend);
  write(root, 'cgroup.procs', String(guardian));
  vi.mocked(readProcessLifetime).mockImplementation(pid => pid === backend ? { state: 'dead' } : { state: 'alive', identity: 'boot:' + pid });
  expect(() => checkGuardianStopFence(group, guardian, backend, fence)).toThrow(/lifetimes/);
  expect(checkGuardianStopFence(group, guardian, backend, fence, true)).toEqual(fence);
  vi.mocked(readProcessLifetime).mockImplementation(pid => pid === backend ? { state: 'unknown' } : { state: 'alive', identity: 'boot:' + pid });
  expect(() => checkGuardianStopFence(group, guardian, backend, fence, true)).toThrow(/lifetimes/);
});

it('requires a positively inactive native unit and empty cgroup to resume after both original processes exited', () => {
  mountFixture(); const fence = checkGuardianStopFence(group, guardian, backend);
  const inactive = { Id: unit, LoadState: 'loaded', ActiveState: 'inactive', MainPID: '0', ControlGroup: group };
  expect(() => verifyStoppedGuardian(unit, fence, { ...inactive, MainPID: '12345' })).toThrow(/not verifiably stopped/);
  expect(() => verifyStoppedGuardian(unit, fence, inactive)).toThrow(/process/);
  domain(root, []); expect(() => verifyStoppedGuardian(unit, fence, inactive)).not.toThrow();
  expect(() => verifyStoppedGuardian(unit, undefined, inactive)).not.toThrow();
  expect(() => verifyStoppedGuardian(unit, undefined, { ...inactive, ControlGroup: '' })).not.toThrow();
  expect(() => verifyStoppedGuardian(unit, undefined, { ...inactive, ControlGroup: '/system.slice/foreign.service' })).toThrow();
  expect(() => verifyStoppedGuardian(unit, undefined, { ...inactive, MainPID: '777', ControlGroup: '' })).toThrow();
});
