/**
 * A fleet rolled out one node at a time.
 *
 * `upgradeNodes` was declared, drawn in the console and implemented as a
 * throw; the per-node path it replaces built a bundle on the daemon's own
 * thread — ~150 seconds with the master answering nothing — built it again
 * for every node, and installed it outside the node's deploy lease. This
 * court holds the queue that replaces all three:
 *
 *   - one bundle for the whole rollout, and every node gets that version —
 *     two rollouts at once do not trade nodes or bundles;
 *   - never more than `concurrency` nodes at once, the rest `queued` with a
 *     position that moves;
 *   - the plan's refusals stand — the local daemon, the second name for one
 *     machine, an unknown node, one already in a rollout;
 *   - a queued node can be dropped, a running one is not interrupted;
 *   - a build that fails leaves no node «queued» for ever;
 *   - install and activate run under the node's lease when the deployer has one.
 */

import { describe, expect, it } from 'vitest';

import { NodeUpgradeService, type BuiltBundle, type NodeUpgradeProgress } from '../../src/services/node-upgrade.service.js';

type Node = { id: string; name: string; isLocal?: boolean; address: string };

const NODES: Node[] = [
  { id: 'local', name: 'Local Machine', isLocal: true, address: '127.0.0.1:22' },
  { id: 'a', name: 'alpha', address: '10.0.0.1:22' },
  { id: 'b', name: 'beta', address: '10.0.0.2:22' },
  { id: 'c', name: 'gamma', address: '10.0.0.3:22' },
  { id: 'a2', name: 'alpha-again', address: '10.0.0.1:22' },
];

const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } } as never;

function harness(options: { buildFails?: boolean; installMs?: number } = {}) {
  const events: Array<{ at: number; kind: string; node?: string; version?: string }> = [];
  let builds = 0;
  let concurrent = 0;
  let peak = 0;
  const release: Array<() => void> = [];

  const build = async (): Promise<BuiltBundle> => {
    builds += 1;
    if (options.buildFails) throw new Error('tsc exited 2');
    // Each build names its own version, so a node given another rollout's bundle shows.
    return { version: `0.3.0+build${builds}`, archive: `/tmp/bundle-${builds}.tar.gz`, cleanup: async () => { events.push({ at: Date.now(), kind: 'cleanup' }); } };
  };

  const deployer = {
    async installBundle(target: never, _archive: string, version: string) {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      events.push({ at: Date.now(), kind: 'install', node: String(target), version });
      // Held until the court lets it go, so concurrency can be observed.
      await new Promise<void>((r) => release.push(r));
      concurrent -= 1;
      return true;
    },
    async activateBundle(target: never, version: string) {
      events.push({ at: Date.now(), kind: 'activate', node: String(target), version });
      return true;
    },
    async underLease<T>(target: never, _purpose: string, work: () => Promise<T>): Promise<T> {
      events.push({ at: Date.now(), kind: 'lease', node: String(target) });
      return work();
    },
  };

  const service = new NodeUpgradeService(
    silent,
    {
      getNode: (id: string) => NODES.find((n) => n.id === id) ?? null,
      listCandidates: () =>
        NODES.map((n) => ({ nodeId: n.id, name: n.name, currentVersion: '0.2.0', isLocal: n.isLocal === true, sshReachable: true, address: n.address })),
    } as never,
    async (id: string) => id as never,
    () => deployer as never,
    undefined,
    build,
  );
  return { service, events, releaseOne: () => release.shift()?.(), pending: () => release.length, builds: () => builds, peak: () => peak };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  if (!cond()) throw new Error('condition never became true');
}
function phase(service: NodeUpgradeService, id: string): NodeUpgradeProgress | null {
  return service.progressFor(id);
}

describe('a fleet rollout', () => {
  it('builds one bundle, installs that version on every node, one at a time', async () => {
    const h = harness();
    const start = h.service.rollout(['a', 'b', 'c'], 1);
    expect(start.accepted).toEqual(['a', 'b', 'c']);

    await until(() => h.pending() === 1);
    // One running, two waiting — and the waiting ones know their place.
    expect(phase(h.service, 'b')).toMatchObject({ phase: 'queued', position: 1 });
    expect(phase(h.service, 'c')).toMatchObject({ phase: 'queued', position: 2 });

    for (let i = 0; i < 3; i++) {
      await until(() => h.pending() === 1);
      h.releaseOne();
    }
    await until(() => ['a', 'b', 'c'].every((id) => phase(h.service, id)?.phase === 'done'));

    expect(h.builds()).toBe(1);
    expect(h.peak()).toBe(1);
    const installed = h.events.filter((e) => e.kind === 'install');
    expect(installed.map((e) => e.node)).toEqual(['a', 'b', 'c']);
    expect(new Set(installed.map((e) => e.version))).toEqual(new Set(['0.3.0+build1']));
    // Every install under the node's lease, and the bundle removed at the end.
    expect(h.events.filter((e) => e.kind === 'lease').map((e) => e.node)).toEqual(['a', 'b', 'c']);
    expect(h.events.at(-1)?.kind).toBe('cleanup');
  });

  it('never runs more than `concurrency` nodes at once', async () => {
    const h = harness();
    h.service.rollout(['a', 'b', 'c'], 2);
    await until(() => h.pending() === 2);
    expect(h.peak()).toBe(2);
    expect(phase(h.service, 'c')).toMatchObject({ phase: 'queued', position: 1 });
    h.releaseOne();
    h.releaseOne();
    await until(() => h.pending() === 1);
    h.releaseOne();
    await until(() => ['a', 'b', 'c'].every((id) => phase(h.service, id)?.phase === 'done'));
    expect(h.peak()).toBe(2);
  });

  it('two rollouts do not trade nodes: each node gets the bundle its own rollout built', async () => {
    const h = harness();
    h.service.rollout(['a', 'b'], 1);
    await until(() => h.pending() === 1); // a installing build1, b waiting
    h.service.rollout(['c'], 1);
    await until(() => h.builds() === 2);

    for (let i = 0; i < 3; i++) {
      await until(() => h.pending() >= 1);
      h.releaseOne();
    }
    await until(() => ['a', 'b', 'c'].every((id) => phase(h.service, id)?.phase === 'done'));

    const byNode = Object.fromEntries(h.events.filter((e) => e.kind === 'install').map((e) => [e.node, e.version]));
    expect(byNode).toEqual({ a: '0.3.0+build1', b: '0.3.0+build1', c: '0.3.0+build2' });
  });

  it("refuses what the plan refuses, in the plan's words", () => {
    const h = harness();
    const start = h.service.rollout(['local', 'a', 'a2', 'nope'], 1);
    // An unknown name refuses the whole rollout: a typo must not upgrade a
    // different set of machines than the operator meant.
    expect(start.accepted).toEqual([]);
    expect(start.refused.every((r) => /No such node: nope/.test(r.because))).toBe(true);

    const second = h.service.rollout(['local', 'a', 'a2'], 1);
    expect(second.accepted).toEqual(['a']);
    const why = Object.fromEntries(second.refused.map((r) => [r.nodeId, r.because]));
    expect(why['local']).toMatch(/local/i);
    expect(why['a2']).toMatch(/same machine as 'alpha'/);

    const third = h.service.rollout(['a'], 1);
    expect(third.refused[0]?.because).toMatch(/already queued or running/);
  });

  it('drops a queued node, and will not interrupt a running one', async () => {
    const h = harness();
    h.service.rollout(['a', 'b'], 1);
    await until(() => h.pending() === 1);
    expect(h.service.cancel('a')).toMatchObject({ stopped: false, because: expect.stringMatching(/not interrupted/) });
    expect(h.service.cancel('b')).toMatchObject({ stopped: true });
    expect(phase(h.service, 'b')).toMatchObject({ phase: 'refused' });
    h.releaseOne();
    await until(() => phase(h.service, 'a')?.phase === 'done');
    expect(h.events.filter((e) => e.kind === 'install').map((e) => e.node)).toEqual(['a']);
  });

  it('a bundle that fails to build leaves no node queued for ever', async () => {
    const h = harness({ buildFails: true });
    const start = h.service.rollout(['a', 'b'], 1);
    expect(start.accepted).toEqual(['a', 'b']);
    await until(() => ['a', 'b'].every((id) => phase(h.service, id)?.phase === 'failed'));
    expect(phase(h.service, 'a')?.message).toMatch(/could not build its bundle: tsc exited 2/);
    // And the nodes are free for the next attempt.
    expect(h.service.rollout(['a'], 1).accepted).toEqual(['a']);
  });
});
