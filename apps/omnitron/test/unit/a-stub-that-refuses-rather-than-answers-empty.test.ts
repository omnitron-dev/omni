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
 */

import { describe, it, expect } from 'vitest';

import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';

/** Constructed with nothing: the stubs must refuse before touching a dependency. */
const service = () => new NodeManagerRpcService(...([] as never[]));

describe('a stub that refuses rather than answers empty', () => {
  it('planUpgrade refuses instead of reporting an empty plan', async () => {
    await expect(service().planUpgrade()).rejects.toThrow(/not built yet|not implemented/i);
  });

  it('upgradeNodes refuses instead of reporting nothing queued', async () => {
    await expect(service().upgradeNodes({ nodeIds: ['a', 'b'] })).rejects.toThrow(
      /not built yet|not implemented/i,
    );
  });

  it('cancelUpgrade refuses instead of reporting a stop that did not happen', async () => {
    await expect(service().cancelUpgrade({ nodeId: 'a' })).rejects.toThrow(
      /not built yet|not implemented/i,
    );
  });

  it('names the CLI equivalent where there is one', async () => {
    // A refusal that says where the capability already exists saves the
    // reader a search. `fleet upgrade --dry-run` is this plan today.
    const err = await service().planUpgrade().catch((e: unknown) => e as Error);

    expect(err.message).toMatch(/fleet upgrade/);
  });
});
