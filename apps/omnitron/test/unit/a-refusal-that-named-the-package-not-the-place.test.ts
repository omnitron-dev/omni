/**
 * Run from another project's repository, the refusal blamed the package.
 *
 *     $ cd ~/projects/dao/daos && omnitron fleet upgrade --dry-run
 *     Fleet upgrade failed: @omnitron-dev/omnitron is not a package in this workspace.
 *
 * True of that workspace, and useless: nothing in the sentence says which
 * workspace was searched, or that the answer is «you are standing in the
 * wrong repository». The operator reads it as a broken checkout of omnitron.
 *
 * `commands/fleet.ts` already has the guard for the neighbouring case and a
 * comment describing this exact trap — «is true of the directory and says
 * nothing about the mistake» — for a `cwd` with NO workspace above it. What
 * it does not cover is a cwd with a workspace above it that is somebody
 * else's: `findWorkspaceRoot` succeeds, returns the daos root, and the
 * refusal arrives one layer deeper, in the same words, about the same
 * package.
 *
 * The fix is for the refusal to name the PLACE it looked, and it belongs in
 * `planBundle`, which is the only code that knows both the package it wanted
 * and the workspace it searched.
 */

import { describe, it, expect } from 'vitest';

import { planBundle, type Workspace } from '../../src/services/local-bundle.js';

/** A workspace that is a real one — just not omnitron's. */
const anotherProject: Workspace = new Map([
  ['@daos/main', { name: '@daos/main', version: '1.0.0', dir: '/Users/x/projects/dao/daos/apps/main' }],
  ['@daos/paysys', { name: '@daos/paysys', version: '1.0.0', dir: '/Users/x/projects/dao/daos/apps/paysys' }],
]) as unknown as Workspace;

describe('a refusal that named the package, not the place', () => {
  it('says which workspace it searched', () => {
    const plan = planBundle('@omnitron-dev/omnitron', anotherProject);

    expect(plan.refusal, 'there is a refusal').toBeTruthy();
    expect(plan.refusal, 'the package it wanted').toContain('@omnitron-dev/omnitron');
    // The part that was missing: enough about the workspace to recognise it
    // as the wrong one from the sentence alone.
    expect(plan.refusal, 'and what it found instead').toMatch(/@daos\/main|2 packages|daos/);
  });

  it('still refuses an empty workspace, and says that', () => {
    // Control: no packages at all is a different mistake — a checkout with
    // nothing installed — and must not be described as the wrong directory.
    const plan = planBundle('@omnitron-dev/omnitron', new Map() as unknown as Workspace);

    expect(plan.refusal).toBeTruthy();
    expect(plan.refusal).toMatch(/no packages|empty/i);
  });

  it('names nothing when the package is there', () => {
    // Control: the happy path must not acquire a refusal.
    const ours: Workspace = new Map([
      ['@omnitron-dev/omnitron', { name: '@omnitron-dev/omnitron', version: '0.2.0', dir: '/w/apps/omnitron' }],
    ]) as unknown as Workspace;

    expect(planBundle('@omnitron-dev/omnitron', ours).refusal).toBeFalsy();
  });
});
