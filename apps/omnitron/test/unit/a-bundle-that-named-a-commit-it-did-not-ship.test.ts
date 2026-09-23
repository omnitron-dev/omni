/**
 * A bundle that named a commit it did not ship.
 *
 * A node bundle copies omnitron's `dist` and `webapp/dist` as they are on
 * disk and takes its version from the working tree's HEAD; nothing compared
 * the two. Measured 2026-09-23: the test node was installed as
 * `0.2.0+local.f1715106…` and received a console build older than f1715106 —
 * whose only change was that console. And the master itself reported
 * `Version: 0.2.0` whatever it ran.
 *
 * Every build now carries a stamp of what it was compiled from
 * (`scripts/stamp-build.mjs` → `BUILD.json`); the bundle refuses unless both
 * builds name the tree's commit from a clean tree, and the daemon reports its
 * own.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { buildOwnBundle, ownBuildRefusal } from '../../src/services/bundle-builder.js';
import { readBuildStamp } from '../../src/shared/build-stamp.js';
import { describeBuild } from '../../src/commands/status.js';

const STAMPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/stamp-build.mjs');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const made: string[] = [];

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-stamp-'));
  made.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const stampIn = (dir: string, stamp: Record<string, unknown> | null) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), '// built\n');
  if (stamp) fs.writeFileSync(path.join(dir, 'BUILD.json'), JSON.stringify(stamp));
};

const packageWith = (dist: Record<string, unknown> | null | 'absent', webapp?: Record<string, unknown> | null) => {
  const dir = tmp();
  if (dist !== 'absent') stampIn(path.join(dir, 'dist'), dist);
  if (webapp !== undefined) stampIn(path.join(dir, 'webapp/dist'), webapp);
  return dir;
};

const clean = { commit: A, dirty: false, builtAt: '2026-09-23T15:00:00.000Z' };

describe('a build ships under the tree\'s commit only when it was built from it', () => {
  const tree = { commit: A, dirty: false };

  it('passes both builds stamped from the tree\'s commit', () => {
    expect(ownBuildRefusal({ packageDir: packageWith(clean, clean), tree })).toBeNull();
    // No console build at all is not a mismatch.
    expect(ownBuildRefusal({ packageDir: packageWith(clean), tree })).toBeNull();
  });

  it('refuses a dist compiled from another commit, naming both', () => {
    const why = ownBuildRefusal({ packageDir: packageWith({ ...clean, commit: B }), tree });
    expect(why).toMatch(/dist was compiled from bbbbbbbb .* the tree is at aaaaaaaa/);
  });

  it('refuses a console build older than the commit — the measured case', () => {
    const why = ownBuildRefusal({ packageDir: packageWith(clean, { ...clean, commit: B }), tree });
    expect(why).toMatch(/webapp\/dist was compiled from bbbbbbbb/);
  });

  it('refuses a build nobody stamped, and a build from uncommitted changes', () => {
    expect(ownBuildRefusal({ packageDir: packageWith(null), tree })).toMatch(/carries no build stamp/);
    expect(ownBuildRefusal({ packageDir: packageWith({ ...clean, dirty: true }), tree })).toMatch(/uncommitted changes/);
    expect(ownBuildRefusal({ packageDir: packageWith('absent'), tree })).toMatch(/there is no build to ship/);
  });

  it('reads nothing it cannot trust as a stamp', () => {
    const dir = tmp();
    stampIn(dir, { commit: 'not a sha', dirty: false, builtAt: 'x' });
    expect(readBuildStamp(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'BUILD.json'), '{');
    expect(readBuildStamp(dir)).toBeNull();
  });
});

describe('the bundle builder asks before it copies', () => {
  it('refuses to build a node bundle from a stale dist', async () => {
    const root = tmp();
    const pkg = path.join(root, 'apps/omnitron');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@omnitron-dev/omnitron', version: '0.2.0' }));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one');
    stampIn(path.join(pkg, 'dist'), { ...clean, commit: B });

    await expect(buildOwnBundle({ workspaceRoot: root, label: `stamp-${process.pid}` })).rejects.toThrow(
      /was compiled from bbbbbbbb .* the tree is at/,
    );
  });
});

describe('the build writes its own stamp', () => {
  it('stamps the repository\'s HEAD, and says when the tree was dirty', () => {
    const root = tmp();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one');
    const dist = path.join(root, 'dist');
    fs.mkdirSync(dist);

    execFileSync('node', [STAMPER, dist]);
    expect(readBuildStamp(dist)).toMatchObject({ commit: git('rev-parse', 'HEAD'), dirty: false });

    fs.writeFileSync(path.join(root, 'edited.ts'), 'x');
    execFileSync('node', [STAMPER, dist]);
    expect(readBuildStamp(dist)!.dirty).toBe(true);
  });

  it('stamps an exported commit as given, clean by construction', () => {
    const dist = tmp();
    execFileSync('node', [STAMPER, dist, '--commit', B]);
    expect(readBuildStamp(dist)).toMatchObject({ commit: B, dirty: false });
  });
});

describe('the daemon says which commit it runs', () => {
  it('prints the commit, and says so when it cannot', () => {
    expect(describeBuild(clean)).toContain('aaaaaaaa');
    expect(describeBuild({ ...clean, dirty: true })).toContain('uncommitted');
    expect(describeBuild(null)).toContain('unstamped');
    expect(describeBuild(undefined)).toContain('older daemon');
  });
});
