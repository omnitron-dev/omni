/**
 * A package shipped a `dist` months older than its sources.
 *
 * Six daos packages declare `publishConfig.main = "dist/index.js"` — a
 * tarball cannot ship TypeScript and expect `node` to read it — while the
 * working tree keeps `main = "src/index.ts"`, because Vite and tsx transpile
 * on the way through and nobody wants to rebuild a package to see an edit.
 *
 * That is the right arrangement and it has one consequence nothing was
 * watching: inside this workspace, `dist` is imported by NOBODY. It is
 * written by a `build` script somebody runs occasionally and read for the
 * first time on the far side of a deployment. Measured the first time one
 * shipped:
 *
 *     The requested module '@daos/titan-kit' does not provide an export
 *     named 'DEFAULT_PAGE_SIZE'
 *
 * — a constant that had been in `src/like-pattern.ts` for months and in
 * `dist/like-pattern.js` never. That failure is worse than a missing package:
 * it reads as an API mistake in the code doing the importing, and sends the
 * reader to the wrong file.
 *
 * The guard runs at the only moment it can: just before `pnpm pack`, which
 * packs whatever is on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { staleDist, staleBuild } from '../../src/services/bundle-builder.js';

let dir: string;

/** Write a file with an explicit mtime, so the ordering is the test's. */
function write(rel: string, content: string, minutesAgo: number): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  const when = new Date(Date.now() - minutesAgo * 60_000);
  fs.utimesSync(full, when, when);
}

const manifest = (m: Record<string, unknown>): void =>
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@x/pkg', version: '1.0.0', ...m }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-dist-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the question is only asked of packages that ship a dist', () => {
  it('says nothing about a package consumed as TypeScript', () => {
    // No `publishConfig`, `main` points at src: whatever transpiles it reads
    // the source, and a stale `dist` beside it is nobody's problem.
    manifest({ main: 'src/index.ts' });
    write('src/index.ts', 'export const a = 1;', 0);
    write('dist/index.js', 'export const a = 0;', 500);

    expect(staleDist(dir)).toBeNull();
  });

  it('asks it of a package whose publishConfig points at dist', () => {
    // The shape this exists for: `main` says src, the TARBALL says dist, and
    // `pnpm pack` applies `publishConfig`. Asking about `main` would have
    // read the wrong field on every package in the set.
    manifest({ main: 'src/index.ts', publishConfig: { main: 'dist/index.js' } });
    write('src/index.ts', 'export const DEFAULT_PAGE_SIZE = 20;', 0);
    write('dist/index.js', 'export const a = 0;', 500);

    expect(staleDist(dir)).toMatch(/src\/index\.ts is newer/);
  });

  it('asks it of a package that points at dist outright', () => {
    manifest({ exports: { '.': { import: './dist/index.js' } } });
    write('src/index.ts', 'export const a = 1;', 0);
    write('dist/index.js', 'export const a = 0;', 500);

    expect(staleDist(dir)).toMatch(/is newer/);
  });
});

describe('what counts as out of date', () => {
  beforeEach(() => {
    manifest({ main: 'src/index.ts', publishConfig: { main: 'dist/index.js' } });
  });

  it('accepts a dist built after the sources', () => {
    write('src/index.ts', 'export const a = 1;', 500);
    write('dist/index.js', 'export const a = 1;', 0);

    expect(staleDist(dir)).toBeNull();
  });

  it('names the newest source, because "rebuild it" needs a reason', () => {
    write('src/index.ts', 'export * from "./like-pattern.js";', 500);
    write('src/like-pattern.ts', 'export const DEFAULT_PAGE_SIZE = 20;', 0);
    write('dist/index.js', 'export * from "./like-pattern.js";', 200);

    expect(staleDist(dir)).toContain('src/like-pattern.ts');
  });

  it('reports a dist that does not exist at all', () => {
    write('src/index.ts', 'export const a = 1;', 0);

    expect(staleDist(dir)).toBe('there is no dist at all');
  });

  it('reports a dist directory with no compiled output in it', () => {
    write('src/index.ts', 'export const a = 1;', 0);
    write('dist/index.d.ts', 'export declare const a: number;', 0);

    expect(staleDist(dir)).toBe('dist holds no compiled JavaScript');
  });

  it('does not count a test file as evidence about dist', () => {
    // Tests are excluded from the build, so their timestamps say nothing
    // about whether the shipped code is current — and editing one is the
    // most common reason a source tree is touched.
    write('src/index.ts', 'export const a = 1;', 500);
    write('dist/index.js', 'export const a = 1;', 200);
    write('src/index.spec.ts', 'it("works", () => {});', 0);
    write('src/other.test.ts', 'it("works", () => {});', 0);

    expect(staleDist(dir)).toBeNull();
  });

  it('ignores node_modules under the package', () => {
    write('src/index.ts', 'export const a = 1;', 500);
    write('dist/index.js', 'export const a = 1;', 200);
    write('src/node_modules/dep/index.ts', 'export const dep = 1;', 0);

    expect(staleDist(dir)).toBeNull();
  });
});

describe('it refuses to guess', () => {
  it('says nothing about a directory with no manifest', () => {
    expect(staleDist(dir)).toBeNull();
  });

  it('says nothing about a package that ships dist and has no src', () => {
    // A published tarball unpacked somewhere, or a package whose sources are
    // elsewhere. There is nothing to compare, and inventing an answer would
    // fail a deployment for a package that is perfectly current.
    manifest({ main: 'dist/index.js' });
    write('dist/index.js', 'export const a = 1;', 0);

    expect(staleDist(dir)).toBeNull();
  });
});

describe('a built frontend is the same question without a manifest', () => {
  /**
   * The gateway serves `apps/portal/dist` and the deployment shipped it
   * exactly as it found it. Measured on the test stack: the `index.html` on
   * the node was built on 2026-09-10 and **1 152 source files were newer than
   * it** — so the "test portal", the thing the whole deployment exists to put
   * in front of someone, was ten days behind the tree it was supposedly
   * testing, and nothing said so because nothing looked.
   */
  it('counts what is behind, because one file and a thousand are different news', () => {
    write('src/app.tsx', 'export const App = 1;', 0);
    write('src/config.ts', 'export const c = 1;', 0);
    write('src/old.ts', 'export const o = 1;', 900);
    write('dist/index.html', '<!doctype html>', 500);

    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toMatch(/2 source files newer/);
  });

  it('names the most recent one', () => {
    write('src/app.tsx', 'export const App = 1;', 10);
    write('src/late.tsx', 'export const L = 1;', 0);
    write('dist/index.html', '<!doctype html>', 500);

    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toContain('late.tsx');
  });

  it('accepts a build made after its sources', () => {
    write('src/app.tsx', 'export const App = 1;', 500);
    write('dist/index.html', '<!doctype html>', 0);
    write('dist/assets/index-abc.js', 'console.log(1)', 0);

    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toBeNull();
  });

  it('reports a build that is not there, and one that is empty', () => {
    write('src/app.tsx', 'export const App = 1;', 0);
    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toBe('there is no build at all');

    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toBe('the build directory is empty');
  });

  /**
   * A frontend's sources are not all under its own `src`.
   *
   * The portal resolves seven workspace packages from source through Vite
   * aliases, two of them in a different repository. A change confined to the
   * design system therefore left `apps/portal/src` untouched, this check
   * answered «current», and the deployment shipped yesterday's bundle —
   * measured 2026-09-21, where all ten «behind its sources» lines in the
   * daemon log named portal files and not one came from prism.
   *
   * Under pnpm every dependency is a symlink (57 of 57 for the portal), so
   * the link says nothing. Where it LANDS does: outside `node_modules` means
   * a package being developed here.
   */
  it('sees a source under a linked package, not only its own src', () => {
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-pkg-'));
    try {
      fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
      const late = path.join(pkg, 'src', 'button.tsx');
      fs.writeFileSync(late, 'export const Button = 1;');

      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: '@x/app', dependencies: { '@scope/design': 'workspace:*' } })
      );
      const link = path.join(dir, 'node_modules', '@scope', 'design');
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(pkg, link);

      write('src/app.tsx', 'export const App = 1;', 500);
      write('dist/index.html', '<!doctype html>', 100);

      const answer = staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'));
      expect(answer).toContain('button.tsx');
      // The REAL path, not the name under node_modules: in production this
      // reads `prism/src`, which is where a reader would go looking.
      expect(answer).toContain(`${path.basename(pkg)}/src`);
    } finally {
      fs.rmSync(pkg, { recursive: true, force: true });
    }
  });

  it('ignores a dependency that resolves inside node_modules', () => {
    // An installed package, which is what every dependency looks like under
    // pnpm until you follow the link. Its files move when it is reinstalled
    // and say nothing about whether this build is current.
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: '@x/app', dependencies: { installed: '^1.0.0' } })
    );
    const store = path.join(dir, 'node_modules', '.pnpm', 'installed@1.0.0', 'node_modules', 'installed');
    fs.mkdirSync(path.join(store, 'src'), { recursive: true });
    fs.writeFileSync(path.join(store, 'src', 'index.ts'), 'export const x = 1;');
    fs.symlinkSync(store, path.join(dir, 'node_modules', 'installed'));

    write('src/app.tsx', 'export const App = 1;', 500);
    write('dist/index.html', '<!doctype html>', 100);

    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toBeNull();
  });

  it('names the directories it watched, so «none» is distinguishable from «never looked»', () => {
    write('src/app.tsx', 'export const App = 1;', 0);
    write('dist/index.html', '<!doctype html>', 500);

    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toMatch(/watched: [^)]+\/src/);
  });

  it('does not count a test file, and does count a stylesheet', () => {
    // A frontend's sources are not only TypeScript: a changed stylesheet or
    // an added SVG is a changed build. A changed test is not.
    write('src/app.tsx', 'export const App = 1;', 500);
    write('dist/index.html', '<!doctype html>', 200);
    write('src/app.test.tsx', 'it("x", () => {});', 0);
    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toBeNull();

    write('src/theme.css', 'body { color: red }', 0);
    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toMatch(/theme\.css/);
  });

  it('says nothing when there are no sources to compare', () => {
    write('dist/index.html', '<!doctype html>', 0);
    expect(staleBuild(path.join(dir, 'src'), path.join(dir, 'dist'))).toBeNull();
  });
});
