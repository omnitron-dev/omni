import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { restoreRuntimeRoles, type RuntimeUpdateCall } from '../../src/daemon/runtime-update-host.js';
import { writePrivateRecord, readPrivateRecord } from '../../src/daemon/execution-journal.js';
import type { RuntimeUpdateRestoration } from '../../src/daemon/runtime-update.js';
import type { SupervisorTransition } from '../../src/daemon/supervisor-transition.js';
import type { RuntimeUpdateIdentity, RuntimeUpdatePlan } from '../../src/shared/dto/runtime-update.js';

const previous = 'a'.repeat(64), owner = 'b'.repeat(64), guardian = 'c'.repeat(64), candidate = 'd'.repeat(64);
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture(lost?: 'backend' | 'guardian' | 'retired' | 'configured') {
  const instance = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-roles-')); directories.push(instance);
  const plan = { instance, target: { artifact: candidate }, configuration: { sha256: 'e'.repeat(64), basis: 'retained-next-start' },
    before: { backend: previous, owner, guardian, ownerId: 'original', scope: 'user' } } as RuntimeUpdatePlan;
  const roles = { owner, ownerId: 'restored', ownerPid: 42, backend: candidate, guardian: candidate } as RuntimeUpdateIdentity;
  let available = true;
  const accepted = vi.fn(async () => {}), observe = vi.fn(async () => {
    if (!available) throw Error('No healthy backend exists during guardian restoration');
    return { ...roles };
  });
  const id = randomUUID(), file = path.join(instance, 'runtime', `supervisor-transition-${id}.json`);
  const before = { instanceHome: instance, scope: 'user', owner: { artifact: owner },
    backend: { artifact: candidate, label: 'fixture-guardian', unit: 'fixture-guardian.service' } };
  const transition = { protocol: 1, id, phase: 'prepared', createdAt: new Date().toISOString(), before,
    after: { ...before, backend: { ...before.backend, artifact: guardian } }, unit: { file: path.join(instance, 'unit'), before: 'old', after: 'new' },
    backend: { runtime: previous, pid: 43, control: path.join(instance, 'control.sock'), socket: path.join(instance, 'daemon.sock') },
    owner: { id: 'restored', pid: 42, inventory: 'a'.repeat(64) }, guardianPid: 44 } as SupervisorTransition;
  let reference: ReturnType<RuntimeUpdateRestoration['guardian']>, fail = lost;
  const restoration: RuntimeUpdateRestoration = { guardian: () => reference,
    recordGuardian: vi.fn(async value => { reference = value; }) };
  const calls: string[][] = [];
  const call: RuntimeUpdateCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (args[1] === 'upgrade') {
      expect(accepted).toHaveBeenCalledOnce(); roles.backend = previous;
      if (fail === 'backend') { fail = undefined; throw Error('backend acknowledgement lost'); }
    } else if (args[2] === 'prepare') {
      await writePrivateRecord(file, transition); return { file } as T;
    } else if (args[2] === 'apply') {
      expect(reference?.file).toBe(file);
      if (args[4] === '--check') expect((await readPrivateRecord<SupervisorTransition>(file))!.phase).toBe('prepared');
      else {
        if (fail === 'retired' || fail === 'configured') {
          transition.phase = fail; fail = undefined; available = false;
          await writePrivateRecord(file, transition); throw Error('guardian acknowledgement lost');
        }
        roles.guardian = guardian; available = true; transition.phase = 'complete';
        await writePrivateRecord(file, transition);
        if (fail === 'guardian') { fail = undefined; throw Error('guardian acknowledgement lost'); }
      }
    }
    return {} as T;
  };
  return { roles, accepted, observe, calls, file, transition, restoration,
    finish: () => restoreRuntimeRoles(plan, observe, accepted, call, restoration) };
}

it('checks restored applications and persists the existing guardian plan before its first effect', async () => {
  const f = await fixture(); await f.finish();
  expect(f.calls.map(args => args.slice(0, 3))).toEqual([
    ['backend', 'upgrade', expect.stringContaining(previous)], ['backend', 'guardian', 'prepare'],
    ['backend', 'guardian', 'apply'], ['backend', 'guardian', 'apply'],
  ]);
  expect(f.restoration.guardian()).toEqual({ file: f.file, intentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await f.finish(); expect(f.calls).toHaveLength(4);
});

it.each(['backend', 'guardian', 'retired', 'configured'] as const)('resumes a lost %s reply through the recorded transaction without another owner or plan', async stage => {
  const f = await fixture(stage);
  await expect(f.finish()).rejects.toThrow('acknowledgement lost');
  await f.finish();
  expect(f.calls.filter(args => args[1] === 'upgrade')).toHaveLength(1);
  expect(f.calls.filter(args => args[2] === 'prepare')).toHaveLength(1);
  expect(f.calls.filter(args => args[2] === 'apply' && args[4] === '--check')).toHaveLength(1);
  expect(f.calls.filter(args => args[2] === 'apply' && args[4] !== '--check')).toHaveLength(['retired', 'configured'].includes(stage) ? 2 : 1);
  expect(f.roles).toMatchObject({ backend: previous, owner, guardian });
});

it.each(['old-owner', 'foreign-owner', 'foreign-controller', 'foreign-guardian', 'unhealthy-apps'])('refuses %s before further role changes', async drift => {
  const f = await fixture();
  if (drift === 'old-owner') f.roles.ownerId = 'original';
  if (drift === 'foreign-owner') f.roles.owner = 'f'.repeat(64);
  if (drift === 'foreign-controller') f.roles.backend = 'f'.repeat(64);
  if (drift === 'foreign-guardian') f.roles.guardian = 'f'.repeat(64);
  if (drift === 'unhealthy-apps') f.accepted.mockRejectedValue(Error('health regressed'));
  await expect(f.finish()).rejects.toThrow(); expect(f.calls).toHaveLength(0);
});

it.each(['intent', 'target', 'owner', 'instance', 'unsafe-file'])('refuses a changed guardian %s before resuming its effects', async changed => {
  const f = await fixture('retired');
  await expect(f.finish()).rejects.toThrow('acknowledgement lost');
  const calls = f.calls.length;
  if (changed === 'intent') f.transition.unit.after = 'substituted unit';
  if (changed === 'target') f.transition.after.backend.artifact = 'f'.repeat(64);
  if (changed === 'owner') f.transition.owner.id = 'foreign';
  if (changed === 'instance') f.transition.before.instanceHome += '/foreign';
  await writePrivateRecord(f.file, f.transition);
  if (changed === 'unsafe-file') await fs.chmod(f.file, 0o644);
  await expect(f.finish()).rejects.toThrow(); expect(f.calls).toHaveLength(calls);
});
