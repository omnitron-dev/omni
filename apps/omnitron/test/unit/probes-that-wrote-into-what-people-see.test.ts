/**
 * Probes that wrote into what people see.
 *
 * An attestation runs the release's promotion probes on a stack's node, and
 * the probes write into the system they measure: accounts, organisations,
 * paysys accounts with the deposit addresses paysys makes with them. On
 * daos/test, 2026-09-24, the census counted 91 probe organisations in the
 * public catalogue and 10 mainnet deposit addresses on accounts nobody owns.
 * That is the price of measuring a test stand; it is not one a stand where
 * people are should pay.
 *
 * `release attest --on-node` took any stack it was given. It now runs only on
 * a stack that declared `release.attest` — the stack said its probes may run
 * there — and never on one that declares `verifiedOn`: a stack that takes
 * releases verified elsewhere is verified elsewhere.
 */

import { describe, expect, it } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

/** An attestation request against a stack configured as given; it stops at the first step past the guard. */
async function attest(release: Record<string, unknown> | undefined): Promise<string> {
  const svc: any = Object.create(ProjectService.prototype);
  svc.loadProjectConfig = async () => ({});
  svc.resolveStacks = () => ({ s: { type: 'remote', nodes: [{ host: '10.0.0.9' }], ...(release ? { release } : {}) } });
  svc.registry = { get: () => null };
  try {
    await svc.attestOnNode('daos', 's', 'daos-202609250000-00000000');
    return 'ran';
  } catch (err) {
    return (err as Error).message;
  }
}

describe('where the probes may run', () => {
  it('not on a stack that never said they may', async () => {
    expect(await attest(undefined)).toMatch(/does not declare `release\.attest`/);
    expect(await attest({ mode: 'required' })).toMatch(/does not declare `release\.attest`/);
  });

  it('not on a stack verified elsewhere — even one that also declares `attest`', async () => {
    const said = await attest({ mode: 'required', verifiedOn: { stack: 'test', gates: [] }, attest: { provision: true } });
    expect(said).toMatch(/takes releases verified on 'test'/);
  });

  it('on a stack that declared them, as test does — the run goes on past the guard', async () => {
    // Past the guard the next refusal is the registry's: the guard let it through.
    expect(await attest({ mode: 'required', attest: { provision: true } })).toMatch(/is not in the registry/);
  });
});
