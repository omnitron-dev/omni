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

    await service.plan();

    expect(cleanup, 'the staging directory is released').toHaveBeenCalled();
    vi.doUnmock('../../src/services/bundle-builder.js');
  });
});
