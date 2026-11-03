import { describe, expect, it, vi } from 'vitest';
import { commandFailure } from '../../src/execution/command-failure.js';
import { stageCatalogRuntime } from '../../src/services/kernel-distribution.js';
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
  it('reads the native CLI failure envelope after process warnings and omits eval source when a child gives no reason', () => {
    const stderr = '(node:123) Warning: experimental\n' + JSON.stringify({ ok: false, error: 'Wait for the recovery certificate' });
    expect(commandFailure(stderr, 'exit 1')).toBe('Wait for the recovery certificate');
    expect(commandFailure(JSON.stringify({ ok: false, error: 'Command failed: node -e private-data' }), 'exit 1')).toBe('exit 1');
    expect(commandFailure('file:///node/[eval1]:16\nthrow Error(secret)\n  ^', 'SIGTERM')).toBe('SIGTERM');
    expect(commandFailure('', 'ETIMEDOUT')).toBe('ETIMEDOUT');
  });

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

  it('never switches an already-current runtime whose build or native selection no longer matches', async () => {
    const { dispatch, set } = fixture();
    const current = { ...plan, previous: candidate };
    set({ current: candidate, bundle: { root: '/instance/runtime', version: '1', commit } });
    expect(await reconcileManagedTarget(dispatch, current)).toBe('candidate');
    set({ selectionRevision: current.selectionRevision + 1 });
    await expect(activateManagedTarget(dispatch, current)).rejects.toThrow(/attributed/);
    set({ selectionRevision: current.selectionRevision, bundle: { root: '/instance/runtime', version: '1', commit: '0'.repeat(40) } });
    await expect(activateManagedTarget(dispatch, current)).rejects.toThrow(/attributed/);
    expect(dispatch.mock.calls.some(([r]) => r.operation === 'switch')).toBe(false);
  });

  it('explains a pool rotation without dispatch and keeps identity details out of the switch request', async () => {
    const { dispatch, set } = fixture();
    const identity = { protocol: 1 as const, owner: { id: plan.ownerId, pid: plan.ownerPid }, appCount: 1, workerCount: 1,
      workersDigest: 'a'.repeat(64), groups: [
        { kind: 'app' as const, app: 'worker', members: 0, digest: 'a'.repeat(64) },
        { kind: 'pool' as const, app: 'worker', pool: 'analysis', members: 1, digest: 'b'.repeat(64) },
      ] };
    set({ identity });
    const reviewed = await planManagedRollout(dispatch, commit);
    expect(reviewed.identity).toEqual(identity);
    const rotated = structuredClone(identity);
    rotated.groups[1]!.digest = 'c'.repeat(64);
    set({ identity: rotated, appsDigest: 'e'.repeat(64) });
    await expect(activateManagedTarget(dispatch, reviewed)).rejects.toThrow('worker/analysis');
    expect(dispatch.mock.calls.some(([r]) => r.operation === 'switch')).toBe(false);
    set({ identity, appsDigest: plan.appsDigest });
    await activateManagedTarget(dispatch, reviewed);
    const sent = dispatch.mock.calls.map(([r]) => r).find(r => r.operation === 'switch');
    expect(sent?.expected).toEqual(plan);
  });

  it('rechecks inventory before the dispatch intent, and refuses rotation without sending a switch', async () => {
    const { dispatch, set } = fixture();
    const intent = vi.fn();
    expect(await reconcileManagedTarget(dispatch, plan)).toBe('unchanged');
    set({ appsDigest: 'f'.repeat(64) });
    await expect(activateManagedTarget(dispatch, plan, intent)).rejects.toThrow(/inventory/);
    expect(intent).not.toHaveBeenCalled();
    expect(dispatch.mock.calls.every(([request]) => request.operation === 'observe')).toBe(true);
  });

  it('rolls back the exact candidate after a failed postcondition with the same owner and unchanged inventory', async () => {
    const { dispatch, set } = fixture();
    const run = async (r: ManagedHostRequest) => {
      const result = await dispatch(r);
      if (r.operation === 'switch' && r.to === candidate) set({ unhealthy: ['test/main'] });
      return result;
    };
    await expect(activateManagedTarget(run, plan)).rejects.toMatchObject({ outcome: 'rolled-back' });
    expect(await reconcileManagedTarget(run, plan)).toBe('rolled-back');
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

it('rejects an SSH alias of the coordinating owner before staging or uploading any bytes', async () => {
  const sender = {
    inspectInstalledBundle: vi.fn().mockResolvedValue({ managed: { ownerId: 'coordinator-owner' } }),
    readFromNode: vi.fn(), uploadToNode: vi.fn(),
  };
  await expect(stageCatalogRuntime(sender, { host: 'alias', expectedHostFingerprint: 'pinned' }, commit, 'coordinator-owner'))
    .rejects.toThrow('coordinating execution owner');
  expect(sender.readFromNode).not.toHaveBeenCalled();
  expect(sender.uploadToNode).not.toHaveBeenCalled();
});
