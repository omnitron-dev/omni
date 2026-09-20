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

import { staleDist } from '../../src/services/bundle-builder.js';

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
