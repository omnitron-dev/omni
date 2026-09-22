/**
 * The plan a rollout shows before it ships anything.
 *
 * `planUpgrade` in `node-upgrade.ts` is the pure decision and already has its
 * own court. This is the layer above it: the service that gathers what it
 * needs, and the projection onto the wire that the console reads.
 *
 * Three things can go wrong in that layer and none of them are visible in the
 * pure function:
 *
 *   - a daemon that cannot list its fleet answering an EMPTY plan, which the
 *     console draws as «nothing to upgrade» — the same absence-read-as-an-
 *     answer that the stubs were written to avoid;
 *   - `because` being dropped or shortened, which turns «the same machine as
 *     'daos-test'» into a row an operator cannot act on;
 *   - the bundle built to learn the target version being left behind, once
 *     per press of the Plan button, at tens of megabytes each.
 */

import { describe, it, expect, vi } from 'vitest';

import { NodeUpgradeService } from '../../src/services/node-upgrade.service.js';
import type { UpgradeCandidate } from '../../src/services/node-upgrade.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

const candidate = (over: Partial<UpgradeCandidate> = {}): UpgradeCandidate => ({
  nodeId: 'n1',
  name: 'daos-test',
  currentVersion: '0.1.0',
  isLocal: false,
  sshReachable: true,
  address: '203.0.113.7:22',
  ...over,
});

/** A service with no candidate source — the shape a partially wired daemon has. */
const unwired = () =>
  new NodeUpgradeService(
    silent as never,
    { getNode: () => null } as never,
    (async () => ({})) as never,
    (() => ({})) as never,
  );

describe('a plan the console can act on', () => {
  it('refuses rather than answering an empty plan when it cannot list the fleet', async () => {
    const plan = await unwired().plan();

    expect(plan.refusal, 'a reason, not an empty list').toBeTruthy();
    expect(plan.refusal).toMatch(/cannot list its fleet/);
    expect(plan.steps).toEqual([]);
  });

  it('refuses when the daemon has nothing to build from', async () => {
    // A daemon installed from a bundle — which is every node — has no
    // workspace. It must say that rather than produce a plan with an empty
    // target version, which would compare every node against nothing and
    // call them all out of date.
    const service = new NodeUpgradeService(
      silent as never,
      { getNode: () => null, listCandidates: () => [candidate()] } as never,
      (async () => ({})) as never,
      (() => ({})) as never,
    );
    vi.spyOn(service as never, 'workspaceRoot' as never).mockReturnValue(null as never);

    const plan = await service.plan();

    expect(plan.refusal).toMatch(/no source to build a bundle from/);
    expect(plan.targetVersion, 'no version invented').toBe('');
  });

  it('answers without building, and says it did not compare', async () => {
    // The default, and the reason for it: building names the target version
    // but stops the daemon while it does. An unbuilt plan still says which
    // nodes are local and which refused SSH — everything except «already on
    // it» — and must not let «upgrade» be read as «out of date».
    const service = new NodeUpgradeService(
      silent as never,
      {
        getNode: () => null,
        listCandidates: () => [candidate(), candidate({ nodeId: 'n2', name: 'local', isLocal: true })],
      } as never,
      (async () => ({})) as never,
      (() => ({})) as never,
    );
    vi.spyOn(service as never, 'workspaceRoot' as never).mockReturnValue('/w' as never);

    const started = Date.now();
    const plan = await service.plan();

    expect(plan.compared, 'nothing was built, so nothing was compared').toBe(false);
    expect(Date.now() - started, 'and it did not take a build to say so').toBeLessThan(1_000);
    // The decisions that need no target version still stand.
    expect(plan.steps.find((s) => s.node.isLocal)?.decision.action).toBe('skip');
    expect(plan.steps.find((s) => !s.node.isLocal)?.decision.action).toBe('upgrade');
  });

  it('never reads an unknown version as «already on it»', async () => {
    // The sentinel earns its keep here. With `''` as the unbuilt target, a
    // node whose own version is unknown — `currentVersion: null` — would
    // have to be compared against it, and any node reporting an empty
    // version string would match outright and be skipped as up to date.
    const service = new NodeUpgradeService(
      silent as never,
      {
        getNode: () => null,
        // Distinct addresses on purpose: two rows naming ONE machine are
        // collapsed by the planner — correctly — and that skip would be
        // mistaken here for the «already on it» skip under test.
        listCandidates: () => [
          candidate({ nodeId: 'n3', currentVersion: '', address: '203.0.113.7:22' }),
          candidate({ nodeId: 'n4', currentVersion: null, address: '203.0.113.8:22' }),
        ],
      } as never,
      (async () => ({})) as never,
      (() => ({})) as never,
    );
    vi.spyOn(service as never, 'workspaceRoot' as never).mockReturnValue('/w' as never);

    const plan = await service.plan();

    for (const step of plan.steps) {
      expect(step.decision.action, `${step.node.nodeId} must not be skipped as up to date`).not.toBe('skip');
    }
  });

  it('cleans up the bundle it built to learn the version', async () => {
    // A plan ships nothing, so the staging directory it made has no further
    // use. Left behind once per Plan press, it is tens of megabytes each.
    const cleanup = vi.fn(async () => undefined);
    const service = new NodeUpgradeService(
      silent as never,
      { getNode: () => null, listCandidates: () => [candidate()] } as never,
      (async () => ({})) as never,
      (() => ({})) as never,
    );
    vi.spyOn(service as never, 'workspaceRoot' as never).mockReturnValue('/w' as never);
    vi.doMock('../../src/services/bundle-builder.js', () => ({
      buildOwnBundle: async () => ({ version: '0.2.0', dirty: false, pack: async () => '', cleanup }),
    }));

    await service.plan(undefined, { build: true });

    expect(cleanup, 'the staging directory is released').toHaveBeenCalled();
    vi.doUnmock('../../src/services/bundle-builder.js');
  });
});
