/**
 * The published package carried code from sources that no longer exist.
 *
 * `tsc` writes files; it never removes them. Delete a source and its compiled
 * output stays in `dist` for ever — and `package.json` says
 * `files: ["dist", …]`, so it is published, shipped to every node, and would
 * be carried by the local-install bundle.
 *
 * Measured here on 2026-09-14: 68 artefacts from 17 deleted sources, the
 * oldest dated March. One of them, `dist/services/metrics.service.js`,
 * imports `prom-client` — a package this one does not depend on, so anything
 * reaching it gets ERR_MODULE_NOT_FOUND. Nothing does reach it; none of the
 * seventeen is imported from live code, which is what makes this housekeeping
 * rather than an outage.
 *
 * Found by taking a colleague's correction seriously rather than as news
 * about their package. They had removed dependencies using a scanner that
 * reads `src`, then verified afterwards that no `dist` imported what they
 * removed — and said the check belonged before the removal. The boundary
 * generalises: a consumer runs `dist`, and `dist` can hold what `src` no
 * longer does.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { sourcesFor, findStale } = await import(path.join(root, 'scripts/prune-stale-build.mjs'));

/** A dist/src pair on disk, for the rules that need real files. */
function tree(layout: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-prune-'));
  for (const [rel, body] of Object.entries(layout)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return { dir, dist: path.join(dir, 'dist'), src: path.join(dir, 'src') };
}

describe('what counts as an artefact with no source', () => {
  it('keeps everything a live source emits', () => {
    const t = tree({
      'src/a.ts': 'export const a = 1;',
      'dist/a.js': '', 'dist/a.d.ts': '', 'dist/a.js.map': '', 'dist/a.d.ts.map': '',
    });

    expect(findStale(t.dist, t.src)).toEqual([]);
  });

  it('finds all four files a deleted source left behind', () => {
    // One source, four artefacts. A rule that only matched `.js` would leave
    // the declarations and maps in the package.
    const t = tree({
      'src/live.ts': '',
      'dist/live.js': '',
      'dist/gone.js': '', 'dist/gone.d.ts': '', 'dist/gone.js.map': '', 'dist/gone.d.ts.map': '',
    });

    expect(findStale(t.dist, t.src).map((f: string) => path.basename(f)).sort()).toEqual([
      'gone.d.ts', 'gone.d.ts.map', 'gone.js', 'gone.js.map',
    ]);
  });

  it('follows the directory structure rather than the file name', () => {
    // `dist/a/x.js` comes from `src/a/x.ts`, not from `src/x.ts`. Matching on
    // the basename alone would keep an orphan that happens to share a name
    // with a live file somewhere else.
    const t = tree({
      'src/a/x.ts': '',
      'dist/a/x.js': '',
      'dist/b/x.js': '',
    });

    expect(findStale(t.dist, t.src).map((f: string) => path.relative(t.dist, f))).toEqual([
      path.join('b', 'x.js'),
    ]);
  });

  it('accepts a .tsx source for a .js artefact', () => {
    const t = tree({ 'src/view.tsx': '', 'dist/view.js': '' });

    expect(findStale(t.dist, t.src)).toEqual([]);
  });

  it('leaves alone anything tsc did not emit', () => {
    // `dist` can hold assets a build step copied there. Deleting them because
    // they have no `.ts` beside them would be a different bug.
    const t = tree({ 'src/a.ts': '', 'dist/a.js': '', 'dist/schema.sql': '', 'dist/logo.png': '' });

    expect(sourcesFor(path.join(t.dist, 'schema.sql'), t.dist, t.src)).toBeNull();
    expect(findStale(t.dist, t.src)).toEqual([]);
  });

  it('says nothing about a dist that is not there', () => {
    const t = tree({ 'src/a.ts': '' });

    expect(findStale(t.dist, t.src)).toEqual([]);
  });
});

describe('this package', () => {
  it('ships dist, which is why any of this matters', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(pkg.files).toContain('dist');
  });
});
