/**
 * A fleet upgrade that blamed the package for the directory.
 *
 * `fleet upgrade` builds omnitron from the working tree. Run from another
 * project's repository — `cd ~/projects/dao/daos && omnitron fleet upgrade` —
 * it found daos's workspace root and failed inside the bundler with
 * «@omnitron-dev/omnitron is not a package in this workspace», which reads as
 * a broken omnitron checkout. And on a tree with uncommitted changes it only
 * warned, and shipped: the node then reports a version naming a commit that
 * is not what it runs, a record that outlives everyone who knew better.
 *
 * Both are refused now before anything is built, each naming the place; a
 * dirty tree ships only with `--allow-dirty`, as `stack start` does.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OMNITRON_PACKAGE,
  findWorkspaceRoot,
  readWorkspace,
  upgradeWorkspaceRefusal,
} from '../../src/services/bundle-builder.js';

const clean = { cwd: '/w', root: '/w', hasOmnitron: true, dirty: false, allowDirty: false };

describe('fleet upgrade refuses before it builds, naming the place', () => {
  it('no workspace above the directory', () => {
    expect(upgradeWorkspaceRefusal({ ...clean, cwd: '/tmp/x', root: null })).toMatch(/no workspace above \/tmp\/x/);
  });

  it("somebody else's workspace — named as such, not as a missing package", () => {
    const msg = upgradeWorkspaceRefusal({ ...clean, root: '/Users/me/projects/dao/daos', hasOmnitron: false });
    expect(msg).toMatch(/\/Users\/me\/projects\/dao\/daos is a workspace — but not omnitron's/);
    expect(msg).toContain(OMNITRON_PACKAGE);
  });

  it('a dirty tree is refused, and told how to ship it deliberately', () => {
    expect(upgradeWorkspaceRefusal({ ...clean, dirty: true })).toMatch(/uncommitted changes.*--allow-dirty/);
  });

  it('--allow-dirty lifts that refusal and no other', () => {
    expect(upgradeWorkspaceRefusal({ ...clean, dirty: true, allowDirty: true })).toBeNull();
    expect(upgradeWorkspaceRefusal({ ...clean, hasOmnitron: false, allowDirty: true })).toMatch(/not omnitron's/);
  });

  it('a clean omnitron tree passes — the control', () => {
    expect(upgradeWorkspaceRefusal(clean)).toBeNull();
  });

  it('this repository is a workspace that holds omnitron', () => {
    // The control against the real disk: were `has` asked the wrong way, the
    // command would refuse its own checkout.
    const root = findWorkspaceRoot(path.resolve(__dirname));
    expect(root).not.toBeNull();
    expect(readWorkspace(root!).has(OMNITRON_PACKAGE)).toBe(true);
  });
});
