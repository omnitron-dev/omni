/**
 * Build freshness — the check that asks whether the running code is the
 * written code.
 *
 * The defect it exists for: every package resolves through `dist`, nothing
 * verifies `dist` matches `src`, and so a package's tests can pass against
 * `src` while the application runs a build from months earlier. Neither suite
 * is wrong; neither one asks the question.
 *
 * The tests below are mostly about what the comparison does when it *cannot*
 * answer, because that is where this class of check normally fails: an empty
 * listing read as "nothing stale" is a broken probe reporting success.
 */

import { describe, it, expect } from 'vitest';

import {
  compareTrees,
  processPredatesBuild,
  artifactFor,
  isCompiledSource,
  type TreeEntry,
} from '../../src/shared/build-freshness.js';

const src = (rel: string, mtimeMs: number): TreeEntry => ({ rel, mtimeMs });

describe('compareTrees', () => {
  it('names a source edited after its build output', () => {
    const report = compareTrees(
      [src('services/backup.service.ts', 2000), src('daemon/state.ts', 500)],
      [src('services/backup.service.js', 1000), src('daemon/state.js', 1000)]
    );

    expect(report.stale).toEqual(['services/backup.service.ts']);
    expect(report.unbuilt).toEqual([]);
    expect(report.comparable).toBe(true);
  });

  it('separates a file that was never built from one that is merely stale', () => {
    // Different remedies read the same to an operator otherwise: one means
    // "rebuild", the other means "this file has never run at all".
    const report = compareTrees(
      [src('services/backup-schedule.ts', 2000), src('daemon/state.ts', 2000)],
      [src('daemon/state.js', 1000)]
    );

    expect(report.unbuilt).toEqual(['services/backup-schedule.ts']);
    expect(report.stale).toEqual(['daemon/state.ts']);
  });

  it('is not fooled by a build output that is merely present', () => {
    const report = compareTrees([src('a.ts', 2000)], [src('a.js', 2000)]);
    expect(report.stale).toEqual([]);
  });

  it('refuses to call an empty comparison fresh', () => {
    // The failure this module is about, in its own implementation: a probe
    // that finds nothing must not report a pass.
    expect(compareTrees([], []).comparable).toBe(false);
    expect(compareTrees([src('a.ts', 1)], []).comparable).toBe(false);
    expect(compareTrees([], [src('a.js', 1)]).comparable).toBe(false);
    expect(compareTrees([src('a.ts', 1)], [src('a.js', 2)]).comparable).toBe(true);
  });

  it('ignores sources that are never compiled into the tree', () => {
    const report = compareTrees(
      [
        src('a.test.ts', 9000),
        src('b.spec.tsx', 9000),
        src('types.d.ts', 9000),
        src('__mocks__/pm.ts', 9000),
        src('README.md', 9000),
        src('real.ts', 500),
      ],
      [src('real.js', 1000)]
    );

    expect(report.stale).toEqual([]);
    expect(report.unbuilt).toEqual([]);
  });

  it('reports the newest timestamp on each side, for the process check', () => {
    const report = compareTrees(
      [src('a.ts', 100), src('b.ts', 900)],
      [src('a.js', 300), src('b.js', 700)]
    );

    expect(report.newestSourceMs).toBe(900);
    expect(report.newestArtifactMs).toBe(700);
  });

  it('does not let an uncompiled source raise the newest-source mark', () => {
    // Otherwise a freshly edited test file would make the whole tree look
    // stale, and the check would cry wolf until it was ignored.
    const report = compareTrees([src('a.ts', 100), src('a.test.ts', 9000)], [src('a.js', 300)]);
    expect(report.newestSourceMs).toBe(100);
  });
});

describe('processPredatesBuild', () => {
  it('detects a daemon that started before the build it loaded was written', () => {
    // Today's case exactly: daemon up at 10:22, dist rebuilt at 11:22. It is
    // running code that no longer exists on disk, and nothing else says so.
    expect(processPredatesBuild(1000, 2000)).toBe(true);
  });

  it('is quiet when the build is older than the process', () => {
    expect(processPredatesBuild(2000, 1000)).toBe(false);
    expect(processPredatesBuild(2000, 2000)).toBe(false);
  });

  it('answers null rather than "no" when it cannot tell', () => {
    for (const [started, built] of [[0, 2000], [1000, 0], [NaN, 1], [1, Infinity], [-1, 5]]) {
      expect(processPredatesBuild(started!, built!), `${started}/${built}`).toBeNull();
    }
  });
});

describe('path mapping', () => {
  it('maps a source to the artifact tsc would emit', () => {
    expect(artifactFor('services/backup.service.ts')).toBe('services/backup.service.js');
    expect(artifactFor('ui/panel.tsx')).toBe('ui/panel.js');
    expect(artifactFor('nested/deep/file.ts')).toBe('nested/deep/file.js');
  });

  it('recognises what does and does not get compiled', () => {
    expect(isCompiledSource('a.ts')).toBe(true);
    expect(isCompiledSource('a.tsx')).toBe(true);
    expect(isCompiledSource('a.test.ts')).toBe(false);
    expect(isCompiledSource('a.spec.tsx')).toBe(false);
    expect(isCompiledSource('a.d.ts')).toBe(false);
    expect(isCompiledSource('__tests__/a.ts')).toBe(false);
    expect(isCompiledSource('deep/__mocks__/a.ts')).toBe(false);
    expect(isCompiledSource('a.json')).toBe(false);
    expect(isCompiledSource('a.md')).toBe(false);
  });
});
