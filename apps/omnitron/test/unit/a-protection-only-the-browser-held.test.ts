/**
 * A protection only the browser held.
 *
 * `OmnitronRelease.prune` removed everything older than `keep` except what
 * the CALLER listed in `protect`. The console built that list from
 * `deployments()`, which answers `[]` on a daemon with no audit trail — so it
 * sent `protect: []`, and the second click removed the release a stack was
 * running. A direct call with admin rights and no `protect` did the same, and
 * a stack whose release name was not recorded was never protected by anyone.
 *
 * And `deployments()` itself read the newest 200 `stack.start` rows: 80 in
 * three days on the master (every daemon start writes one for the local
 * stack), so a stack left running longer than ~3.5 days read as never
 * deployed.
 *
 * Now the daemon decides from its own trail, one row per stack however old;
 * a caller's `protect` only adds; and `apply` without knowing is refused
 * unless the caller says `allowUnprotected`.
 */

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import { ReleaseRpcService } from '../../src/services/release.rpc-service.js';

const startRow = (resourceId: string, release: unknown, createdAt = '2026-09-10T08:00:00.000Z') => ({
  id: resourceId,
  action: 'stack.start',
  actorId: null,
  actorType: 'user',
  resourceType: 'stack',
  resourceId,
  details: release === undefined ? { source: 'boot' } : { source: 'operator', release },
  ipAddress: null,
  createdAt,
});

const serviceWith = (audit: { available: boolean; rows: ReturnType<typeof startRow>[] } | null) => {
  const pruned: Array<{ keep?: number; apply?: boolean; protect?: readonly string[] }> = [];
  const releases = {
    prune: (options: { keep?: number; apply?: boolean; protect?: readonly string[] }) => {
      pruned.push(options);
      return { doomed: [], removed: options.apply ? ['old-one'] : [], kept: 5, freedBytes: 0, spared: [...(options.protect ?? [])] };
    },
  };
  const trail = audit && {
    available: audit.available,
    latestPerResource: async () => audit.rows,
    // The window this replaced; answering it would hide the fix.
    list: async () => {
      throw new Error('deployments() must not read a window of the trail');
    },
    record: async () => undefined,
  };
  return { svc: new ReleaseRpcService(releases as never, (trail ?? undefined) as never), pruned };
};

describe('the daemon protects what its stacks run, whatever the caller sends', () => {
  it('protects the deployed release when the caller sent no protect at all', async () => {
    const { svc, pruned } = serviceWith({
      available: true,
      rows: [startRow('daos/test', 'daos-202609230810-66740d9c-5a3315fc'), startRow('daos/dev', undefined)],
    });

    const answer = await svc.prune({ keep: 5, apply: true });

    expect(pruned[0]!.protect).toEqual(['daos-202609230810-66740d9c-5a3315fc']);
    expect(answer.protectedByDeployment).toEqual(['daos-202609230810-66740d9c-5a3315fc']);
    expect(answer.unknown).toBeNull();
  });

  it('adds what the caller protects, never replaces it with it', async () => {
    const { svc, pruned } = serviceWith({ available: true, rows: [startRow('daos/test', 'R-deployed')] });

    await svc.prune({ apply: true, protect: [] });
    await svc.prune({ apply: true, protect: ['R-pinned'] });

    expect(pruned[0]!.protect).toEqual(['R-deployed']);
    expect(pruned[1]!.protect).toEqual(['R-deployed', 'R-pinned']);
  });

  it('refuses to apply with no audit trail, and says why', async () => {
    const { svc, pruned } = serviceWith({ available: false, rows: [] });

    await expect(svc.prune({ apply: true, protect: [] })).rejects.toThrow(/no audit trail/);
    expect(pruned).toEqual([]);

    // A look is still answered, with the reason on it.
    const look = await svc.prune({});
    expect(look.unknown).toMatch(/no audit trail/);
  });

  it('refuses to apply when a stack took a release whose name was not recorded', async () => {
    const { svc } = serviceWith({ available: true, rows: [startRow('daos/test', '[object]')] });

    await expect(svc.prune({ apply: true })).rejects.toThrow(/daos\/test took a release whose name was not recorded/);
  });

  it('applies without knowing only when the caller says so', async () => {
    const { svc, pruned } = serviceWith({ available: false, rows: [] });

    const answer = await svc.prune({ apply: true, allowUnprotected: true });

    expect(answer.removed).toEqual(['old-one']);
    expect(pruned).toHaveLength(1);
  });
});

describe('deployments() answers every stack, however long ago it was started', () => {
  it('reads one row per stack from the whole trail, not a window of it', async () => {
    const { svc } = serviceWith({
      available: true,
      rows: [startRow('daos/test', 'R-old', '2026-08-01T00:00:00.000Z'), startRow('acme/prod', 'R-prod')],
    });

    const deployed = await svc.deployments();

    expect(deployed.map((d) => `${d.project}/${d.stack}=${d.release}`)).toEqual(['daos/test=R-old', 'acme/prod=R-prod']);
  });
});
