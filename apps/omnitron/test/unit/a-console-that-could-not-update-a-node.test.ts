/**
 * The console could see every node and update none of them.
 *
 * `installBundleOnNode` and `activateBundleOnNode` have been on the daemon
 * since nodes could be upgraded at all, and both take an archive path on the
 * DAEMON's filesystem. Only the CLI knew how to produce one: it builds a
 * bundle from the working tree, archives it to a temp path, and — running on
 * the same machine as the daemon — hands that path over. A browser has no
 * such path to hand, so the console's node page could do everything except
 * the one thing an operator opens it for after a release.
 *
 * So the middle step moved into the daemon: it builds its own bundle, from
 * the workspace it runs out of, and then calls exactly the two methods the
 * CLI calls. A node ends up with the same artifact whichever surface asked.
 *
 * Started and polled rather than awaited, because a build is minutes and an
 * RPC that takes minutes is one that times out somewhere in the middle.
 */

import { describe, it, expect, vi } from 'vitest';

import { NodeUpgradeService } from '../../src/services/node-upgrade.service.js';

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

const node = (over: Record<string, unknown> = {}) => ({
  getNode: (id: string) => (id === 'n1' ? { id: 'n1', name: 'daos-test', ...over } : null),
});

/** A service whose build never runs — these tests are about the decisions. */
const service = (
  source = node(),
  deployer: Record<string, unknown> = {},
  audit?: { record: (e: unknown) => Promise<void> },
) =>
  new NodeUpgradeService(
    logger,
    source as never,
    (async () => ({}) as never) as never,
    (() => deployer as never) as never,
    audit as never,
  );

describe('what it refuses, and why', () => {
  it('refuses a node it does not have', async () => {
    const out = await service().start('nope');
    expect(out).toEqual({ started: false, reason: 'No such node' });
  });

  it('refuses the local daemon', async () => {
    // It runs from a build, not from a bundle; shipping one to itself would
    // install a second copy beside the tree it was built from.
    const out = await service(node({ isLocal: true })).start('n1');

    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/local daemon/);
  });

  it('refuses a second upgrade of the same node', async () => {
    // Two installs racing on one machine is not a slower upgrade; it is an
    // upgrade whose outcome nobody can predict.
    const svc = service();
    const first = await svc.start('n1');
    const second = await svc.start('n1');

    expect(first.started).toBe(true);
    expect(second).toEqual({ started: false, reason: 'An upgrade of this node is already running' });
  });
});

describe('what it reports while it works', () => {
  it('has something to show the moment it starts', async () => {
    const svc = service();
    await svc.start('n1');

    const p = svc.progressFor('n1')!;
    expect(p.phase).toBe('building');
    expect(p.percent).toBeGreaterThan(0);
    expect(p.message).toMatch(/Building/);
  });

  it('lists the nodes it has been asked about, newest first', async () => {
    const svc = service();
    await svc.start('n1');

    const all = svc.listProgress();
    expect(all).toHaveLength(1);
    expect(all[0]!.nodeId).toBe('n1');
  });

  it('answers nothing for a node nobody has upgraded', () => {
    expect(service().progressFor('n1')).toBeNull();
  });
});

describe('a daemon with nothing to build from', () => {
  it('says so rather than failing inside a build', async () => {
    // Every node is such a daemon: installed from a bundle, no workspace.
    const svc = service();
    (svc as unknown as { workspaceRoot(): string | null }).workspaceRoot = () => null;

    const out = await svc.start('n1');

    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/does not run from an omnitron workspace/);
    expect(svc.progressFor('n1')!.phase).toBe('refused');
  });
});

describe('the trail it leaves', () => {
  it('records the outcome, not the attempt', async () => {
    // An attempt that refused is recorded by the RPC; what this records is
    // what actually happened to the node.
    const recorded: Array<Record<string, unknown>> = [];
    const svc = service(node(), {}, { record: async (e) => { recorded.push(e as Record<string, unknown>); } });

    (svc as unknown as { emit(n: string, p: string, pc: number, m: string, v: string | null): void }).emit(
      'n1', 'done', 100, 'Running 0.2.0+local.abc', '0.2.0+local.abc',
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!['action']).toBe('node.upgrade');
    expect(recorded[0]!['resourceId']).toBe('n1');
  });

  it('records a failure as a failure', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const svc = service(node(), {}, { record: async (e) => { recorded.push(e as Record<string, unknown>); } });

    (svc as unknown as { emit(n: string, p: string, pc: number, m: string, v: string | null): void }).emit(
      'n1', 'failed', 40, 'the install failed', null,
    );

    expect(recorded[0]!['action']).toBe('node.upgrade.failed');
  });

  it('does not record the steps in between', async () => {
    const recorded: unknown[] = [];
    const svc = service(node(), {}, { record: async (e) => { recorded.push(e); } });

    for (const phase of ['building', 'transferring', 'activating'] as const) {
      (svc as unknown as { emit(n: string, p: string, pc: number, m: string, v: string | null): void }).emit(
        'n1', phase, 10, 'working', null,
      );
    }

    expect(recorded).toEqual([]);
  });
});
