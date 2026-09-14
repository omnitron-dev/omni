/**
 * Upgrading a fleet, and stopping when it goes wrong.
 *
 * A fleet upgrade that continues past a failure turns one broken node into
 * all of them. Whatever made the first one fail — a bad build, a missing
 * dependency, a bundle that does not unpack — is almost never specific to a
 * machine, so the second fails the same way, and by the time anyone reads the
 * output there is nothing left serving.
 *
 * So the run is sequential and the first failure ends it. What matters as
 * much is the report: "seven of twelve" is not a state anybody can act on.
 * The nodes that were upgraded, the ones that were skipped and why, the one
 * that failed, and the ones never reached, each by name.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  planUpgrade,
  runUpgrade,
  type UpgradeCandidate,
  type UpgradeRunner,
} from '../../src/services/node-upgrade.js';

const node = (over: Partial<UpgradeCandidate> & { name: string }): UpgradeCandidate => ({
  nodeId: `id-${over.name}`,
  currentVersion: '0.2.0+local.old.202609010000',
  isLocal: false,
  reachable: true,
  ...over,
});

const TARGET = '0.2.0+local.new.202609141900';

/** A runner whose per-node outcome is scripted. */
function runner(script: Record<string, { install?: boolean; activate?: boolean }> = {}): UpgradeRunner & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async install(n) {
      calls.push(`install:${n.name}`);
      return script[n.name]?.install ?? true;
    },
    async activate(n) {
      calls.push(`activate:${n.name}`);
      return script[n.name]?.activate ?? true;
    },
  };
}

describe('deciding what to do with each node', () => {
  it('upgrades a node running something else', () => {
    const plan = planUpgrade([node({ name: 'edge-1' })], TARGET);

    expect(plan.steps[0]!.decision).toEqual({ action: 'upgrade', from: '0.2.0+local.old.202609010000' });
  });

  it('skips a node already on the target, so a re-run finishes rather than redoes', () => {
    // And this is why the version has to be one the registry cannot mint: two
    // different builds both calling themselves `0.2.0` would make every node
    // look up to date.
    const plan = planUpgrade([node({ name: 'edge-1', currentVersion: TARGET })], TARGET);

    expect(plan.steps[0]!.decision).toMatchObject({ action: 'skip' });
    expect(plan.toUpgrade).toEqual([]);
  });

  it('skips the local daemon, which runs from a build and not a bundle', () => {
    const plan = planUpgrade([node({ name: 'Local Machine', isLocal: true })], TARGET);

    expect(plan.steps[0]!.decision).toMatchObject({ action: 'skip', because: 'this is the local daemon' });
  });

  it('refuses an unreachable node without stopping the rest', () => {
    // Attempting it would spend the whole transfer timeout discovering what
    // the health check already knows — but one unreachable machine must not
    // prevent upgrading the others.
    const plan = planUpgrade([node({ name: 'down', reachable: false }), node({ name: 'up' })], TARGET);

    expect(plan.steps[0]!.decision).toMatchObject({ action: 'refuse' });
    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['up']);
  });

  it('upgrades a node whose version is unknown', () => {
    // Null is "we could not ask", not "it is current". Treating it as current
    // would leave exactly the nodes that are misbehaving on the old build.
    const plan = planUpgrade([node({ name: 'edge-1', currentVersion: null })], TARGET);

    expect(plan.steps[0]!.decision).toMatchObject({ action: 'upgrade', from: null });
  });
});

describe('choosing a subset', () => {
  const fleet = [node({ name: 'a' }), node({ name: 'b' }), node({ name: 'c' })];

  it('takes the nodes named, in the fleet’s order', () => {
    const plan = planUpgrade(fleet, TARGET, { only: ['c', 'a'] });

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['a', 'c']);
  });

  it('accepts an id as readily as a name', () => {
    const plan = planUpgrade(fleet, TARGET, { only: ['id-b'] });

    expect(plan.toUpgrade.map((n) => n.name)).toEqual(['b']);
  });

  it('refuses the whole run when a name matches nothing', () => {
    // A typo that silently upgrades a different set than the operator meant
    // is the worst way to find out. Nothing runs.
    const plan = planUpgrade(fleet, TARGET, { only: ['a', 'edge-7'] });

    expect(plan.refusal).toMatch(/edge-7/);
    expect(plan.toUpgrade).toEqual([]);
  });

  it('upgrades everything when no subset is named', () => {
    expect(planUpgrade(fleet, TARGET).toUpgrade).toHaveLength(3);
  });
});

describe('running the plan', () => {
  it('goes one node at a time', async () => {
    const r = runner();
    await runUpgrade(planUpgrade([node({ name: 'a' }), node({ name: 'b' })], TARGET), r);

    // Install and activate for the first node BEFORE the second is touched —
    // concurrent upgrades mean concurrent failures.
    expect(r.calls).toEqual(['install:a', 'activate:a', 'install:b', 'activate:b']);
  });

  it('stops at the first failed install, and does not activate it', async () => {
    const r = runner({ b: { install: false } });
    const report = await runUpgrade(
      planUpgrade([node({ name: 'a' }), node({ name: 'b' }), node({ name: 'c' })], TARGET), r,
    );

    expect(r.calls).toEqual(['install:a', 'activate:a', 'install:b']);
    expect(report.failed).toMatchObject({ name: 'b' });
    expect(report.failed!.detail).toMatch(/unchanged/);
  });

  it('stops at the first failed activation', async () => {
    const r = runner({ b: { activate: false } });
    const report = await runUpgrade(
      planUpgrade([node({ name: 'a' }), node({ name: 'b' }), node({ name: 'c' })], TARGET), r,
    );

    expect(r.calls).toEqual(['install:a', 'activate:a', 'install:b', 'activate:b']);
    expect(report.failed!.detail).toMatch(/previous one is still installed/);
  });

  it('names the nodes it never reached', async () => {
    // The boundary, stated — rather than left to be inferred from a count.
    const r = runner({ a: { install: false } });
    const report = await runUpgrade(
      planUpgrade([node({ name: 'a' }), node({ name: 'b' }), node({ name: 'c' })], TARGET), r,
    );

    expect(report.notAttempted).toEqual(['b', 'c']);
  });

  it('reports what each upgraded node came from', async () => {
    const report = await runUpgrade(planUpgrade([node({ name: 'a' })], TARGET), runner());

    expect(report.upgraded[0]!.detail).toBe(`0.2.0+local.old.202609010000 → ${TARGET}`);
  });

  it('records a skip as a skip, not as a success', async () => {
    const report = await runUpgrade(
      planUpgrade([node({ name: 'a', currentVersion: TARGET })], TARGET), runner(),
    );

    expect(report.upgraded).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ name: 'a', ok: true });
  });

  it('touches nothing when every node is already current', async () => {
    const r = runner();
    await runUpgrade(
      planUpgrade([node({ name: 'a', currentVersion: TARGET }), node({ name: 'b', currentVersion: TARGET })], TARGET),
      r,
    );

    expect(r.calls).toEqual([]);
  });

  it('carries on past a refused node rather than stopping', async () => {
    // A refusal is a decision made before the run; a failure happens during
    // it. Only the second is a reason to stop.
    const r = runner();
    const report = await runUpgrade(
      planUpgrade([node({ name: 'down', reachable: false }), node({ name: 'up' })], TARGET), r,
    );

    expect(r.calls).toEqual(['install:up', 'activate:up']);
    expect(report.skipped[0]).toMatchObject({ name: 'down', ok: false });
    expect(report.upgraded.map((o) => o.name)).toEqual(['up']);
  });
});
