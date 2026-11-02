import { describe, expect, it, vi } from 'vitest';
import { assertKernelHandoffFence } from '../../src/daemon/backend-upgrade.js';
import { activateManagedTarget, planManagedRollout, reconcileManagedTarget,
  type ManagedHostEvidence, type ManagedHostRequest, type ManagedRolloutObservation } from '../../src/services/managed-rollout.js';

const previous = 'a'.repeat(64), candidate = 'b'.repeat(64), commit = 'c'.repeat(40);
const plan: ManagedRolloutObservation = { previous, candidate, commit, ownerId: 'owner', ownerPid: 81,
  backendPid: 103, appsDigest: 'd'.repeat(64), selectionRevision: 5 };

function fixture() {
  const initial: ManagedHostEvidence = {
    ...plan, qualified: candidate, current: previous, priorSelection: null, unhealthy: [],
    bundle: { root: '/instance/runtime', version: '1', commit: '0'.repeat(40) },
  };
  let current = structuredClone(initial);
  const set = (patch: Partial<ManagedHostEvidence>) => { current = { ...current, ...patch }; };
  const dispatch = vi.fn(async (request: ManagedHostRequest) => {
    if (request.operation === 'switch') {
      expect(request.revision).toBe(current.selectionRevision);
      expect(request.pid).toBe(current.backendPid);
      expect(request.from).toBe(current.current);
      set({ current: request.to, backendPid: current.backendPid + 1, priorSelection: current.current, unhealthy: [],
        bundle: { ...current.bundle, commit: request.to === candidate ? commit : initial.bundle.commit },
        selectionRevision: current.selectionRevision + 1 });
    }
    return structuredClone(current);
  });
  return { dispatch, set };
}

describe('fenced resident kernel transitions', () => {
  it('plans only a full source SHA and dispatches a native compare-and-switch exactly once', async () => {
    const { dispatch } = fixture();
    await expect(planManagedRollout(dispatch, '../source')).rejects.toThrow(/full lowercase/);
    expect(dispatch).not.toHaveBeenCalled();
    expect(await planManagedRollout(dispatch, commit)).toEqual(plan);
    await activateManagedTarget(dispatch, plan);
    await activateManagedTarget(dispatch, plan);
    expect(await reconcileManagedTarget(dispatch, plan)).toBe('candidate');
    expect(dispatch.mock.calls.filter(([r]) => r.operation === 'switch')).toHaveLength(1);
  });

  it('checks the native fence before accepting digest IDs or a selection revision', () => {
    const valid = { current: previous, candidate, selectionRevision: 5, backendPid: 103, ownerId: 'owner', ownerPid: 81, appsDigest: plan.appsDigest };
    expect(() => assertKernelHandoffFence(valid)).not.toThrow();
    for (const change of [{ candidate: '../runtime' }, { candidate: previous }, { current: 'main' },
      { selectionRevision: 0 }, { appsDigest: 'bad' }, { ownerPid: -2 }, { backendPid: NaN }]) {
      expect(() => assertKernelHandoffFence({ ...valid, ...change })).toThrow('Invalid managed kernel handoff fence');
    }
  });

  it('rolls back the exact candidate after a failed postcondition with the same owner and unchanged inventory', async () => {
    const { dispatch, set } = fixture();
    const run = async (r: ManagedHostRequest) => {
      const result = await dispatch(r);
      if (r.operation === 'switch' && r.to === candidate) set({ unhealthy: ['test/main'] });
      return result;
    };
    await expect(activateManagedTarget(run, plan)).rejects.toMatchObject({ outcome: 'rolled-back' });
    expect(await reconcileManagedTarget(run, plan)).toBe('previous');
  });

  it('accepts a lost SSH acknowledgement when the same healthy owner independently confirms the exact new selection', async () => {
    const { dispatch } = fixture();
    const run = async (r: ManagedHostRequest) => {
      const result = await dispatch(r);
      if (r.operation === 'switch') throw Error('Lost SSH acknowledgement');
      return result;
    };
    await activateManagedTarget(run, plan);
    expect(dispatch.mock.calls.filter(([r]) => r.operation === 'switch')).toHaveLength(1);
  });

  it('does not send a rollback after losing the owner or seeing an unrelated selection', async () => {
    const { dispatch, set } = fixture();
    const run = async (r: ManagedHostRequest) => {
      const result = await dispatch(r);
      if (r.operation === 'switch') { set({ ownerId: 'replacement-owner' }); throw Error('Lost SSH acknowledgement'); }
      return result;
    };
    await expect(activateManagedTarget(run, plan)).rejects.toMatchObject({ outcome: 'uncertain' });
    expect(dispatch.mock.calls.filter(([r]) => r.operation === 'switch')).toHaveLength(1);
    await expect(reconcileManagedTarget(run, plan)).rejects.toThrow(/owner or application/);
  });

  it('refuses to attribute a selected candidate to a different revision or previous release', async () => {
    const { dispatch, set } = fixture();
    await activateManagedTarget(dispatch, plan);
    set({ priorSelection: 'e'.repeat(64) });
    await expect(reconcileManagedTarget(dispatch, plan)).rejects.toThrow(/cannot be attributed/);
  });
});
