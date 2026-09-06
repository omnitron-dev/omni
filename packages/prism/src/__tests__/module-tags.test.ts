/**
 * What a `@module` tag at the top of a file claims.
 *
 * 279 of the 314 tags in this package named a path that cannot be imported —
 * `@omnitron-dev/prism/components/lightbox`, `@omnitron-dev/prism/utils` and
 * so on. The exports map ships five subpaths and three component entries on
 * purpose: tsup builds one entry per exported subpath and each one bloats the
 * build matrix, so the answer is not to widen `exports` — that is exactly the
 * arrangement `fdf3e50` removed, where a glob made every component directory
 * resolve for TypeScript while only three shipped JavaScript.
 *
 * So the tags changed shape instead, and the rule is now one a reader can
 * apply without checking anything:
 *
 *   `@module @omnitron-dev/prism…`  — an import specifier. It works.
 *   `@module components/lightbox`   — where the file lives. Import from the
 *                                     root, or from whichever subpath
 *                                     `package.json` exports.
 *
 * Nothing machine-reads these tags, which is why they drifted: a claim with
 * no reader is a claim with no check. This is the check.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const exported = new Set(
  Object.keys(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).exports).map((k) =>
    k === '.' ? '@omnitron-dev/prism' : `@omnitron-dev/prism${k.slice(1)}`
  )
);

// Test files are excluded: they carry no module header, and the first run of
// this scan failed on the explanation above — prose quoting the tag form is
// indistinguishable from a tag once you are matching text.
const tags = execSync('find src -name "*.ts" -o -name "*.tsx"', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/\.test\.tsx?$/.test(f))
  .flatMap((file) =>
    [...readFileSync(path.join(root, file), 'utf8').matchAll(/@module\s+(\S+)/g)].map((m) => ({
      file,
      tag: m[1]!,
    }))
  );

describe('@module tags', () => {
  it('reads the tags and the exports map', () => {
    // Guard the guard: either side coming back empty would make every
    // assertion below pass without looking at anything.
    expect(tags.length).toBeGreaterThan(250);
    expect(exported.size).toBeGreaterThan(10);
  });

  it.each(tags.filter((t) => t.tag.startsWith('@omnitron-dev')))(
    'a package-qualified tag is importable ($file)',
    ({ tag }) => {
      expect(exported).toContain(tag);
    }
  );

  it('has no tag that looks like a specifier but is not one', () => {
    const liars = tags.filter((t) => t.tag.startsWith('@omnitron-dev') && !exported.has(t.tag));
    expect(liars).toEqual([]);
  });
});
