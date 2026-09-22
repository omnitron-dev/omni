/**
 * A declared-but-unbuilt method must refuse, not answer emptily.
 *
 * The fleet-rollout methods are declared ahead of their implementation so the
 * console can be written against the real contract instead of an untyped
 * `invoke`. That is worth doing and it has one trap: the natural stub for
 * something returning a list is an empty list.
 *
 *     planUpgrade  → { rows: [], refusal: null }   «this fleet needs no upgrades»
 *     upgradeNodes → { accepted: [], refused: [] }  «nothing was queued, and nothing was wrong»
 *
 * Both are lies an operator would act on, and both look like success. This is
 * the same shape as every defect found today — an absence read as an answer —
 * except here it would be introduced on purpose, by someone being helpful.
 *
 * So the stubs throw, and this court holds them to it until they are built.
 * When they are, this file is the thing that has to change, which is the
 * point: the change is visible.
 *
 * `planUpgrade` has since been built, and this file did change — the entry
 * for it moved from «throws» to «refuses with a reason», which is the same
 * rule surviving the implementation rather than being dropped with the stub.
 * Its behaviour is covered in `a-plan-the-console-can-act-on`.
 *
 * `upgradeNodes` and `cancelUpgrade` followed. On a daemon with no upgrade
 * service each node comes back in `refused` with the reason, and a cancel
 * says it stopped nothing and why; an empty selection is a bad request, since
 * `{ accepted: [], refused: [] }` is exactly the answer this file exists to
 * forbid. The queue itself is judged in `a-fleet-rolled-out-one-node-at-a-time`.
 */

import { describe, it, expect } from 'vitest';

import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';

/** Constructed with nothing: the stubs must refuse before touching a dependency. */
const service = () => new NodeManagerRpcService(...([] as never[]));

describe('a stub that refuses rather than answers empty', () => {
  it('planUpgrade, now built, still refuses rather than answering emptily', async () => {
    // Built, so it no longer throws — but an unconfigured daemon must still
    // say WHY there is no plan instead of returning `rows: []`, which the
    // console draws as «nothing to upgrade».
    const plan = await service().planUpgrade();

    expect(plan.refusal, 'a reason travels with the empty rows').toBeTruthy();
    expect(plan.rows).toEqual([]);
  });

  it('upgradeNodes, now built, names every node it did not queue', async () => {
    const outcome = await service().upgradeNodes({ nodeIds: ['a', 'b'] });

    expect(outcome.accepted).toEqual([]);
    expect(outcome.refused.map((r) => r.nodeId), 'each node is accounted for').toEqual(['a', 'b']);
    for (const r of outcome.refused) expect(r.because, `a reason for ${r.nodeId}`).toBeTruthy();
  });

  it('upgradeNodes refuses an empty selection instead of reporting nothing queued', async () => {
    await expect(service().upgradeNodes({ nodeIds: [] })).rejects.toThrow(/at least one node/i);
  });

  it('cancelUpgrade, now built, says it stopped nothing and why', async () => {
    const outcome = await service().cancelUpgrade({ nodeId: 'a' });

    expect(outcome.stopped).toBe(false);
    expect(outcome.because).toBeTruthy();
  });

  it('names what is missing rather than what is broken', async () => {
    // The reason says the capability is absent on this daemon, which is
    // what the operator can act on — not a generic failure.
    const outcome = await service().upgradeNodes({ nodeIds: ['a'] });

    expect(outcome.refused[0]?.because).toMatch(/not configured/i);
  });
});
