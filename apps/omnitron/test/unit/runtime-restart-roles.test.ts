import { expect, it, vi } from 'vitest';
import { restoreRuntimeRoles, type RuntimeUpdateCall } from '../../src/daemon/runtime-update-host.js';
import type { RuntimeUpdateIdentity, RuntimeUpdatePlan } from '../../src/shared/dto/runtime-update.js';

const previous = 'a'.repeat(64), owner = 'b'.repeat(64), guardian = 'c'.repeat(64), candidate = 'd'.repeat(64);
const plan = { instance: '/fixture', target: { artifact: candidate }, configuration: { sha256: 'e'.repeat(64), basis: 'retained-next-start' },
  before: { backend: previous, owner, guardian, ownerId: 'original' } } as RuntimeUpdatePlan;
function fixture(lost?: 'backend' | 'guardian') {
  const roles = { owner, ownerId: 'restored', backend: candidate, guardian: candidate } as RuntimeUpdateIdentity;
  const accepted = vi.fn(async () => {}), observe = vi.fn(async () => ({ ...roles }));
  let fail = lost;
  const calls: string[][] = [];
  const call: RuntimeUpdateCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (args[1] === 'upgrade') {
      expect(accepted).toHaveBeenCalledOnce();
      roles.backend = previous;
      if (fail === 'backend') { fail = undefined; throw Error('backend acknowledgement lost'); }
    } else if (args[2] === 'prepare') return { file: '/fixture/guardian-plan.json' } as T;
    else if (args[2] === 'apply' && args[4] !== '--check') {
      roles.guardian = guardian;
      if (fail === 'guardian') { fail = undefined; throw Error('guardian acknowledgement lost'); }
    }
    return {} as T;
  };
  return { roles, accepted, observe, calls, finish: () => restoreRuntimeRoles(plan, observe, accepted, call) };
}

it('checks restored application evidence before the ordinary backend and guardian handoffs', async () => {
  const f = fixture(); await f.finish();
  expect(f.calls).toEqual([
    ['backend', 'upgrade', `/fixture/runtime/releases/${previous}/packages/0/dist`],
    ['backend', 'guardian', 'prepare', `/fixture/runtime/releases/${guardian}/packages/0/dist`],
    ['backend', 'guardian', 'apply', '/fixture/guardian-plan.json', '--check'],
    ['backend', 'guardian', 'apply', '/fixture/guardian-plan.json'],
  ]);
  await f.finish(); expect(f.calls).toHaveLength(4);
});

it.each(['backend', 'guardian'] as const)('finishes after a lost %s reply without repeating the committed handoff', async stage => {
  const f = fixture(stage);
  await expect(f.finish()).rejects.toThrow('acknowledgement lost');
  await f.finish();
  expect(f.calls.filter(args => args[1] === 'upgrade')).toHaveLength(1);
  expect(f.calls.filter(args => args[2] === 'apply' && args[4] !== '--check')).toHaveLength(1);
  expect(f.roles).toMatchObject({ backend: previous, owner, guardian });
});

it.each(['old-owner', 'foreign-owner', 'foreign-controller', 'foreign-guardian', 'unhealthy-apps'])('refuses %s before further role changes', async drift => {
  const f = fixture();
  if (drift === 'old-owner') f.roles.ownerId = 'original';
  if (drift === 'foreign-owner') f.roles.owner = 'f'.repeat(64);
  if (drift === 'foreign-controller') f.roles.backend = 'f'.repeat(64);
  if (drift === 'foreign-guardian') f.roles.guardian = 'f'.repeat(64);
  if (drift === 'unhealthy-apps') f.accepted.mockRejectedValue(Error('health regressed'));
  await expect(f.finish()).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
