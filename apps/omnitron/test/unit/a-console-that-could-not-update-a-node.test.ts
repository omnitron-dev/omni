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
 *
 * Since a9866bc8 `start` is a rollout of one: it goes through the queue
 * (`a-fleet-rolled-out-one-node-at-a-time`), is refused in the plan's words,
 * waits as `queued` while the one bundle is built in a child process, and the
 * build itself lives in `bundle-build-worker.ts`. This court moved with it.
 */

import { describe, it, expect, vi } from 'vitest';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

import { NodeUpgradeService } from '../../src/services/node-upgrade.service.js';
import { ownBundleStaging } from '../../src/services/bundle-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

/** The registry as the daemon wires it: one node, and the candidate list the plan decides on. */
const node = (over: { isLocal?: boolean } = {}) => ({
  getNode: (id: string) => (id === 'n1' ? { id: 'n1', name: 'daos-test', ...over } : null),
  listCandidates: () => [
    {
      nodeId: 'n1',
      name: 'daos-test',
      currentVersion: '0.2.0',
      isLocal: over.isLocal === true,
      sshReachable: true,
      address: '37.27.130.185:22',
    },
  ],
});

/** A build that never finishes — these tests are about the decisions, not the bundle. */
const neverBuilds = () => new Promise<never>(() => undefined);

const service = (
  source: object = node(),
  deployer: Record<string, unknown> = {},
  audit?: { record: (e: unknown) => Promise<void> },
) =>
  new NodeUpgradeService(
    logger,
    source as never,
    (async () => ({}) as never) as never,
    (() => deployer as never) as never,
    audit as never,
    neverBuilds as never,
  );

describe('what it refuses, and why', () => {
  it('refuses a node it does not have', async () => {
    const out = await service().start('nope');
    expect(out).toEqual({ started: false, reason: 'No such node: nope.' });
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
    expect(second).toEqual({ started: false, reason: 'An upgrade of this node is already queued or running' });
  });

  it('refuses in the plan\'s words when it cannot list the fleet, not with «No such node»', async () => {
    const out = await service({ getNode: node().getNode }).start('n1');

    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/cannot list its fleet/);
  });
});

describe('what it reports while it works', () => {
  it('has something to show the moment it starts', async () => {
    const svc = service();
    await svc.start('n1');

    // Waiting for its slot while the one bundle of the rollout is built —
    // said, with its place, rather than no record at all.
    const p = svc.progressFor('n1')!;
    expect(p.phase).toBe('queued');
    expect(p.position).toBe(1);
    expect(p.message).toMatch(/Building one bundle/);
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

/**
 * Two ways to upgrade a node, two copies of the build.
 *
 * `omnitron fleet upgrade` from a terminal and the console's button through
 * the daemon do the same first thing — build omnitron from this working tree
 * and pack it — and each wrote it out: the same package name, the same
 * `os.tmpdir()` staging path spelled twice, the same `buildBundle` and
 * `archiveBundle` pair. The copies had already drifted. The daemon removes
 * its staging tree in a `finally` because "the staging tree is hundreds of
 * megabytes; leaving it behind fills /tmp one upgrade at a time"; the CLI
 * left both the tree and the tarball behind on every run, including every
 * `--dry-run` that shipped nothing.
 *
 * One function builds it now, and the label is the only thing the two
 * callers still choose for themselves — so that a console upgrade of one
 * node and a fleet upgrade from a terminal cannot stage into each other's
 * directory.
 */
describe('one bundle of omnitron itself, two callers', () => {
  it('stages each caller somewhere of its own', () => {
    const fleet = ownBundleStaging('4212');
    const console1 = ownBundleStaging('4212-16f3dd5a');
    const console2 = ownBundleStaging('4212-126457d0');

    expect(new Set([fleet, console1, console2]).size).toBe(3);
    expect(ownBundleStaging('4212')).toBe(fleet);
  });

  it('stages under the temporary directory, not the working one', () => {
    expect(ownBundleStaging('4212').startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(ownBundleStaging('4212'))).toContain('4212');
  });

  it('is what both callers use', () => {
    const cli = stripComments(fs.readFileSync(path.join(here, '../../src/commands/fleet.ts'), 'utf8'));
    // The daemon builds in a child process since a9866bc8 — the worker is
    // where its call to the one builder now lives.
    const worker = stripComments(fs.readFileSync(path.join(here, '../../src/services/bundle-build-worker.ts'), 'utf8'));
    const service = stripComments(fs.readFileSync(path.join(here, '../../src/services/node-upgrade.service.ts'), 'utf8'));

    expect(service, 'the daemon hands the build to the worker').toMatch(/bundle-build-worker/);
    for (const [what, source] of [['the CLI', cli], ['the daemon\'s worker', worker]] as const) {
      expect(source, what).toMatch(/buildOwnBundle\(/);
      // Neither spells out what omnitron's own package is called, nor where
      // a bundle is staged: that is one answer, in one place.
      expect(source, what).not.toMatch(/'@omnitron-dev\/omnitron'/);
      expect(source, what).not.toMatch(/omnitron-bundle-/);
    }
  });

  it('is cleaned up by both, including the run that shipped nothing', () => {
    const cli = stripComments(fs.readFileSync(path.join(here, '../../src/commands/fleet.ts'), 'utf8'));
    const service = stripComments(fs.readFileSync(path.join(here, '../../src/services/node-upgrade.service.ts'), 'utf8'));

    // In a `finally`, because a dry run returns early and a failure throws.
    expect(cli).toMatch(/finally\s*\{[^}]*cleanup\(\)/s);
    expect(service).toMatch(/finally\s*\{[^}]*cleanup\(\)/s);
  });
});
