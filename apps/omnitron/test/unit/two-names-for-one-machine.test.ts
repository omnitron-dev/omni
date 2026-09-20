/**
 * One host received the bundle twice, at the same time.
 *
 * A node registry holds NAMES, and nothing stops two of them pointing at the
 * same box. Measured on the console's own registry:
 *
 *     16f3dd5a  daos-test          37.27.130.185:22
 *     126457d0  acme-deploy-test   37.27.130.185:22
 *
 * `fleet upgrade` listed both as targets, so one machine got the transfer,
 * the `npm install` and the daemon restart twice — the second beginning
 * while the first was still moving `current` and restarting the daemon under
 * it. Two installs racing on one host is not a slower upgrade; it is an
 * upgrade whose outcome nobody can predict, and the layout exists precisely
 * so that a version is installed beside the running one and switched once.
 *
 * The registry is not wrong to hold two names — a node can be reached by two
 * aliases, and an operator may have reasons. The plan is wrong to treat them
 * as two machines.
 */

import { describe, it, expect } from 'vitest';

import { planUpgrade, type UpgradeCandidate } from '../../src/services/node-upgrade.js';

const node = (name: string, over: Partial<UpgradeCandidate> = {}): UpgradeCandidate => ({
  nodeId: name,
  name,
  currentVersion: '0.2.0+old',
  isLocal: false,
  sshReachable: true,
  ...over,
});

const TARGET = '0.2.0+local.abc.202609201400';

describe('one machine, one upgrade', () => {
  it('upgrades a host once when two names point at it', () => {
    const plan = planUpgrade(
      [
        node('daos-test', { address: '37.27.130.185:22' }),
        node('acme-deploy-test', { address: '37.27.130.185:22' }),
      ],
      TARGET,
    );

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['daos-test']);
  });

  it('says which name has it, rather than doing nothing quietly', () => {
    // An operator who asked for `acme-deploy-test` and saw no line at all
    // would reasonably try again.
    const plan = planUpgrade(
      [
        node('daos-test', { address: '37.27.130.185:22' }),
        node('acme-deploy-test', { address: '37.27.130.185:22' }),
      ],
      TARGET,
    );

    const skipped = plan.steps.find((s) => s.node.name === 'acme-deploy-test')!;
    expect(skipped.decision.action).toBe('skip');
    if (skipped.decision.action !== 'skip') return;
    expect(skipped.decision.because).toContain('daos-test');
    expect(skipped.decision.because).toContain('37.27.130.185:22');
  });

  it('keeps upgrading genuinely different machines', () => {
    const plan = planUpgrade(
      [
        node('a', { address: '10.0.0.1:22' }),
        node('b', { address: '10.0.0.2:22' }),
        node('c', { address: '10.0.0.3:22' }),
      ],
      TARGET,
    );

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['a', 'b', 'c']);
  });

  it('tells a different SSH port on the same host apart', () => {
    // Two daemons on one box, reached through different ports, are two
    // installations — different prefixes, different `current`.
    const plan = planUpgrade(
      [node('a', { address: '10.0.0.1:22' }), node('b', { address: '10.0.0.1:2222' })],
      TARGET,
    );

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['a', 'b']);
  });

  it('does not treat two unknown addresses as the same machine', () => {
    // An unknown address is not evidence that two nodes are one, and
    // collapsing on it would silently skip a node that needed the upgrade.
    const plan = planUpgrade([node('a'), node('b')], TARGET);

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['a', 'b']);
  });

  it('does not resurrect a node that was already being skipped', () => {
    // A node already on the target version, or refused for being
    // unreachable, must not become the one that "claims" the address and
    // leaves the upgradable one skipped behind it.
    const plan = planUpgrade(
      [
        node('already-current', { address: '10.0.0.1:22', currentVersion: TARGET }),
        node('needs-it', { address: '10.0.0.1:22' }),
      ],
      TARGET,
    );

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['needs-it']);
  });

  it('still refuses a name that matches nothing', () => {
    // The deduplication must not weaken the typo guard: a name that matched
    // nothing runs nothing at all.
    const plan = planUpgrade([node('a', { address: '10.0.0.1:22' })], TARGET, { only: ['typo'] });

    expect(plan.refusal).toContain('typo');
    expect(plan.toUpgrade).toEqual([]);
  });
});
