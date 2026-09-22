/**
 * A stack that takes releases only.
 *
 * There is one test server and one production estate, and whatever reached
 * them was whichever developer's disk deployed last. A stack can now declare
 * `release: { mode: 'required' }`: it takes a release — two commits, built in
 * clean clones, every gate run — or nothing. This court holds the three doors
 * a release passes through to the policy they are there to enforce:
 *
 *   - `decideStackRelease`: every gate the release RECORDED passed, the floor
 *     the stack names is among them, every app the stack runs is carried;
 *   - `loadRelease`: the files on this disk are the ones the manifest names,
 *     by size and by sha256, and an id cannot name a directory elsewhere;
 *   - `treeEqualsCommit`: the directory the stack definition is read from is
 *     exactly the release's commit — the definition deployed is the release's.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { decideStackRelease, type ReleaseManifest } from '../../src/release/manifest.js';
import { loadRelease, treeEqualsCommit } from '../../src/release/load.js';
import { ProjectService } from '../../src/services/project.service.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'releases-only-')));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function manifest(over: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    id: 'daos-202609221500-aaaaaaaa-bbbbbbbb',
    project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: true },
    omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: true },
    artifacts: [{ app: 'main', version: '0.0.1', sha256: 'c'.repeat(64), bytes: 10 }],
    gates: [
      { name: 'build', status: 'passed' },
      { name: 'unit:main', status: 'passed' },
    ],
    builtWith: { omnitron: '0.2.0', packages: [] },
    builtAt: '2026-09-22T15:00:00.000Z',
    builtBy: 'test',
    ...over,
  };
}

describe('what a stack demands of a release', () => {
  it('takes one whose every recorded gate passed and that carries every app', () => {
    expect(decideStackRelease(manifest(), { mode: 'required', requiredGates: ['build'] }, ['main']).action).toBe('promote');
  });

  it('refuses one with a failed gate, naming it — the number of gates is not a list it can hide behind', () => {
    const m = manifest({ gates: [{ name: 'build', status: 'passed' }, { name: 'unit:geo', status: 'failed', detail: '1 of 56' }] });
    expect(decideStackRelease(m, { mode: 'required' }, ['main'])).toEqual({
      action: 'refuse',
      because: "the gate 'unit:geo' failed: 1 of 56",
    });
  });

  it('refuses one missing a gate from the floor — a gate that disappeared is noticed', () => {
    expect(decideStackRelease(manifest(), { mode: 'required', requiredGates: ['security:paysys'] }, ['main'])).toEqual({
      action: 'refuse',
      because: "the gate 'security:paysys' is not in this release — it did not run",
    });
  });

  it('refuses one that recorded no gates at all, with or without requirements', () => {
    expect(decideStackRelease(manifest({ gates: [] }), undefined, ['main'])).toEqual({
      action: 'refuse',
      because: 'the release recorded no gates at all',
    });
  });

  it('refuses one built from a commit on no remote, when the stack says so', () => {
    const m = manifest({ omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: false } });
    expect(decideStackRelease(m, { mode: 'required', requireOnRemote: true }, ['main'])).toEqual({
      action: 'refuse',
      because: 'the omni commit bbbbbbbb is on no remote branch — nobody else could rebuild this release',
    });
    // …and does not ask it of a stack that did not.
    expect(decideStackRelease(m, { mode: 'required' }, ['main']).action).toBe('promote');
  });

  it('refuses one that does not carry an app the stack runs', () => {
    expect(decideStackRelease(manifest(), undefined, ['main', 'geo'])).toEqual({
      action: 'refuse',
      because: "the release carries no artifact for 'geo'",
    });
  });
});

/** A release on disk: its manifest, and its artifacts with their real sums. */
function releaseOnDisk(id: string, contents: Record<string, string>): string {
  const root = path.join(scratch, `store-${id}`);
  fs.mkdirSync(path.join(root, id, 'artifacts'), { recursive: true });
  const artifacts = Object.entries(contents).map(([app, body]) => {
    fs.writeFileSync(path.join(root, id, 'artifacts', `${app}-0.0.1.tar.gz`), body);
    return { app, version: '0.0.1', sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
  });
  fs.writeFileSync(path.join(root, id, 'manifest.json'), JSON.stringify(manifest({ id, artifacts })));
  return root;
}

describe('the files on this disk are the release that was built', () => {
  it('loads a release whose artifacts match their manifest', async () => {
    const root = releaseOnDisk('r1', { main: 'main-bytes', geo: 'geo-bytes' });
    const r = await loadRelease('r1', root);
    expect(r.files.map((f) => [f.app, f.bytes])).toEqual([
      ['main', 10],
      ['geo', 9],
    ]);
  });

  it('refuses a truncated tarball by its size, before hashing', async () => {
    const root = releaseOnDisk('r2', { main: 'main-bytes' });
    fs.writeFileSync(path.join(root, 'r2', 'artifacts', 'main-0.0.1.tar.gz'), 'main-by');
    await expect(loadRelease('r2', root)).rejects.toThrow(/main's tarball is 7 bytes, and the manifest recorded 10/);
  });

  it('refuses a different tarball of the same size by its hash', async () => {
    const root = releaseOnDisk('r3', { main: 'main-bytes' });
    fs.writeFileSync(path.join(root, 'r3', 'artifacts', 'main-0.0.1.tar.gz'), 'MAIN-BYTES');
    await expect(loadRelease('r3', root)).rejects.toThrow(/main's tarball hashes to .*and the manifest recorded/);
  });

  it('refuses an id that would name a directory elsewhere', async () => {
    await expect(loadRelease('../etc', scratch)).rejects.toThrow(/is not a release id/);
    await expect(loadRelease('a/../../b', scratch)).rejects.toThrow(/is not a release id/);
  });

  it('refuses a release that is not there, and says where it looked', async () => {
    await expect(loadRelease('nope', scratch)).rejects.toThrow(/No release 'nope' on this machine/);
  });
});

describe('the directory the definition is read from is the release commit', () => {
  function repo(): { dir: string; git: (...a: string[]) => string } {
    const dir = fs.mkdtempSync(path.join(scratch, 'repo-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'infra/secrets/\n');
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default {};\n');
    git('add', '.');
    git('commit', '-qm', 'one');
    return { dir, git };
  }

  it('is equal on a clean checkout of the commit', async () => {
    const { dir, git } = repo();
    expect(await treeEqualsCommit(dir, git('rev-parse', 'HEAD'))).toEqual({ equal: true });
  });

  it('names an edited file and an untracked one, and not an ignored one', async () => {
    const { dir, git } = repo();
    const head = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default { edited: true };\n');
    fs.writeFileSync(path.join(dir, 'new.ts'), '');
    fs.mkdirSync(path.join(dir, 'infra', 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'infra', 'secrets', 'jwt-secret.dev'), 'machine-local');
    expect(await treeEqualsCommit(dir, head)).toEqual({ equal: false, files: ['omnitron.config.ts', 'new.ts (untracked)'] });
  });

  it('compares with the RELEASE commit, not HEAD: a clean tree that moved on is not the release', async () => {
    const { dir, git } = repo();
    const releaseCommit = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default { later: true };\n');
    git('commit', '-qam', 'two');
    expect(await treeEqualsCommit(dir, releaseCommit)).toEqual({ equal: false, files: ['omnitron.config.ts'] });
  });
});

describe('a stack that says so takes nothing else', () => {
  function service(release?: object) {
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record: vi.fn(async () => {}) },
      registry: { get: () => null, list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({ apps: [{ name: 'main', script: 'x' }] })),
      resolveStacks: () => ({
        test: { type: 'remote', apps: 'all', nodes: [{ host: '203.0.113.7', port: 9700 }], ...(release ? { release } : {}) },
      }),
      startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'remote', apps: [] }),
      emit: vi.fn(),
    });
    return svc;
  }

  it('refuses an operator start without a release, and says how to make one', async () => {
    const svc = service({ mode: 'required' });
    await expect(svc.startStack('daos', 'test', { source: 'operator' })).rejects.toThrow(
      /daos\/test takes releases only: `omnitron release build daos --for test`, then `omnitron stack start daos test --release <id>`/,
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });

  it('deploys the working tree as before when the stack declares nothing — the control', async () => {
    const svc = service();
    await svc.startStack('daos', 'test', { source: 'operator' });
    expect(svc.startRemoteStack).toHaveBeenCalledTimes(1);
  });

  it('refuses a named release that does not exist, before anything moves', async () => {
    const svc = service({ mode: 'required' });
    svc.releaseStore = async () => scratch;
    await expect(svc.startStack('daos', 'test', { source: 'operator', release: 'no-such-release' })).rejects.toThrow(
      /No release 'no-such-release' on this machine/,
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });
});

describe('a release is admitted only onto its own commit', () => {
  function setup(gates: ReleaseManifest['gates'] = [{ name: 'build', status: 'passed' }]) {
    const dir = fs.mkdtempSync(path.join(scratch, 'project-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default {};\n');
    git('add', '.');
    git('commit', '-qm', 'one');
    const commit = git('rev-parse', 'HEAD');

    const id = `daos-${crypto.randomBytes(4).toString('hex')}`;
    const store = path.join(scratch, `store-${id}`);
    fs.mkdirSync(path.join(store, id, 'artifacts'), { recursive: true });
    const body = 'main-tarball';
    fs.writeFileSync(path.join(store, id, 'artifacts', 'main-0.0.1.tar.gz'), body);
    fs.writeFileSync(
      path.join(store, id, 'manifest.json'),
      JSON.stringify(
        manifest({
          id,
          project: { repo: 'gitlab', commit, onRemote: true },
          artifacts: [{ app: 'main', version: '0.0.1', sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length }],
          gates,
        }),
      ),
    );

    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record: vi.fn(async () => {}) },
      registry: { get: () => ({ name: 'daos', path: dir }), list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({ apps: [{ name: 'main', script: 'x' }] })),
      resolveStacks: () => ({
        test: { type: 'remote', apps: 'all', nodes: [{ host: '203.0.113.7', port: 9700 }], release: { mode: 'required' } },
      }),
      startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'remote', apps: [{ name: 'main', status: 'online' }] }),
      emit: vi.fn(),
      releaseStore: async () => store,
    });
    return { dir, id, svc, commit };
  }

  it('admits a release onto the directory that is its commit, and records it', async () => {
    const { id, svc, commit } = setup();
    await svc.startStack('daos', 'test', { source: 'operator', release: id });

    expect(svc.startRemoteStack).toHaveBeenCalledTimes(1);
    expect(svc.startRemoteStack.mock.calls[0][4].id).toBe(id);
    // Flat fields: `scrubDetails` replaces a nested object with `[object]`,
    // which is what the first deployed release's row recorded.
    const { scrubDetails } = await import('../../src/services/audit.service.js');
    const details = scrubDetails(svc.audit.record.mock.calls[0][0].details)!;
    expect(details['release']).toBe(id);
    expect(details['releaseProjectCommit']).toBe(commit.slice(0, 8));
    expect(details['releaseOmniCommit']).toBe('b'.repeat(8));
  });

  it('refuses it onto a directory that is not its commit, naming the file', async () => {
    const { dir, id, svc } = setup();
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default { edited: true };\n');

    await expect(svc.startStack('daos', 'test', { source: 'operator', release: id })).rejects.toThrow(
      /is not its commit [0-9a-f]{8} — 1 file\(s\) differ \(omnitron\.config\.ts\)/,
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });

  it('refuses a release with a gate that did not pass, before anything moves', async () => {
    const { id, svc } = setup([
      { name: 'build', status: 'passed' },
      { name: 'unit:geo', status: 'failed', detail: 'Tests 1 failed | 55 passed (56)' },
    ]);

    await expect(svc.startStack('daos', 'test', { source: 'operator', release: id })).rejects.toThrow(
      /Refusing release daos-[0-9a-f]+ for daos\/test: the gate 'unit:geo' failed: Tests 1 failed \| 55 passed \(56\)/,
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });
});
