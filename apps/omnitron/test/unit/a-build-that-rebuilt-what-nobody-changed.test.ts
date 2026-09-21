/**
 * Six applications compiled from scratch, on every restart of the master.
 *
 * A deployment stops shipping what the node already has — measured, six
 * artifacts not transferred and six applications left running. What it did
 * not stop was producing them. Every autostart runs `rm -rf dist && tsc` for
 * each of the six, and only afterwards does anything ask whether the result
 * differs from what the node is running. Measured on this machine, one
 * restart with nothing changed:
 *
 *   18:21:59  Starting remote stack — deploying to slave daemons
 *   18:25:38  Artifacts built for deployment          3 min 39 s
 *   18:27:28  Stack started                                 11 s
 *
 * The eleven seconds are the deployment. The three and a half minutes are
 * six compilers proving that nothing moved.
 *
 * `rm -rf dist` is there for a reason and stays: `tsc` only writes, it never
 * removes, and a deleted source leaves its compiled file in `dist` forever —
 * measured on `@daos/paysys`, 34 migrations in `src` and 40 in `dist`, one
 * of them a migration whose source had been replaced. So the question is not
 * "is dist newer" — a deletion makes nothing newer — but "is this dist the
 * one these inputs produce". That is a content question and it is answered
 * with a content hash: the app's own sources, and every workspace package
 * that travels with it, against what was recorded when that dist was built.
 *
 * Every unknown compiles. Nothing recorded, no dist, a dist that is not what
 * the record says, inputs that cannot be read — each of them is a build.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { decideBuild, buildRecordPath, type BuildRecord } from '../../src/project/build-decision.js';
import { buildInputsChecksum } from '../../src/services/bundle-builder.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INPUTS = 'a'.repeat(64);
const DIST = 'b'.repeat(64);
const recorded: BuildRecord = { inputs: INPUTS, dist: DIST };

describe('whether an app has to be compiled again', () => {
  it('reuses a dist that is what these inputs produced', () => {
    const d = decideBuild({ recorded, inputs: INPUTS, distChecksum: DIST });

    expect(d.action).toBe('reuse');
  });

  it('builds when the sources moved', () => {
    const d = decideBuild({ recorded, inputs: 'c'.repeat(64), distChecksum: DIST });

    expect(d.action).toBe('build');
    expect(d.because).toMatch(/input/i);
  });

  it('builds when nothing records what this dist was built from', () => {
    const d = decideBuild({ recorded: null, inputs: INPUTS, distChecksum: DIST });

    expect(d.action).toBe('build');
    expect(d.because).toMatch(/record/i);
  });

  it('builds when there is no dist at all', () => {
    const d = decideBuild({ recorded, inputs: INPUTS, distChecksum: null });

    expect(d.action).toBe('build');
    expect(d.because).toMatch(/dist/i);
  });

  it('builds when dist is not what that build produced', () => {
    const d = decideBuild({ recorded, inputs: INPUTS, distChecksum: 'e'.repeat(64) });

    expect(d.action).toBe('build');
    expect(d.because).toMatch(/dist/i);
  });

  it('builds when the inputs cannot be read', () => {
    // No workspace above the app, a plan that refuses, an unreadable
    // directory: all of them are "ask the compiler", never "nothing to do".
    const d = decideBuild({ recorded, inputs: null, distChecksum: DIST });

    expect(d.action).toBe('build');
  });

  it('says why, in words a build log can carry', () => {
    for (const input of [
      { recorded: null, inputs: INPUTS, distChecksum: DIST },
      { recorded, inputs: null, distChecksum: DIST },
      { recorded, inputs: 'c'.repeat(64), distChecksum: DIST },
      { recorded, inputs: INPUTS, distChecksum: null },
    ]) {
      expect(decideBuild(input).because.length, JSON.stringify(input)).toBeGreaterThan(10);
    }
  });
});

describe('where the record of a build is kept', () => {
  it('is one file per application, outside the application', () => {
    const one = buildRecordPath('/cache', '/repo/apps/main');
    const other = buildRecordPath('/cache', '/repo/apps/paysys');

    expect(one).not.toBe(other);
    expect(path.dirname(one)).toBe('/cache');
    // Not inside somebody else's repository: an artifact build runs against
    // a project that is not omnitron's, and leaving files in it is not ours
    // to do.
    expect(one.startsWith('/repo')).toBe(false);
  });

  it('names the same application the same way twice', () => {
    expect(buildRecordPath('/cache', '/repo/apps/main')).toBe(buildRecordPath('/cache', '/repo/apps/main'));
  });

  it('tells two applications of the same name in different repositories apart', () => {
    expect(buildRecordPath('/cache', '/a/apps/main')).not.toBe(buildRecordPath('/cache', '/b/apps/main'));
  });
});

/**
 * The block a marker opens, by its braces.
 *
 * Not a window of N characters. A distance window breaks in one direction
 * only: it loosens when code is deleted and tightens when code is
 * EXPLAINED, so the first person to write a comment inside the region gets
 * a red test and looks like the cause. Measured elsewhere in this
 * repository: 51 assertions carry such a window, and one of them went red
 * because somebody documented the very `catch` it was checking.
 */
function blockAt(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, marker).toBeGreaterThan(0);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

describe('the builder asks before it compiles', () => {
  const builder = stripComments(
    fs.readFileSync(path.join(here, '../../src/project/artifact-builder.ts'), 'utf8'),
  );

  it('decides, and records what it built', () => {
    expect(builder).toMatch(/decideBuild\(/);
    expect(builder).toMatch(/buildRecordPath\(/);
  });

  it('still clears dist when it does build', () => {
    // The skip must not become a reason to stop removing the output: see
    // `runBuild`.
    const body = blockAt(builder, 'private async runBuild(');

    expect(body).toMatch(/rmSync\(path\.join\(appDir, 'dist'\)/);
    expect(body).toMatch(/clearBuildInfo\(appDir\)/);
  });

  it('records only after a build that finished', () => {
    // A record written before the compiler ran, or after one that threw,
    // says a dist exists that does not.
    const body = blockAt(builder, 'if (!options?.skipBuild) {');

    expect(body.indexOf('runBuild(')).toBeLessThan(body.indexOf('recordBuild('));
  });
});

describe('what the inputs of a build are', () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A workspace of one app and one package it depends on. */
  const workspace = (): { root: string; appDir: string; depDir: string } => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-inputs-'));
    made.push(root);
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'packages/*'\n");

    const appDir = path.join(root, 'apps', 'main');
    fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify({ name: '@fixture/main', version: '1.0.0', dependencies: { '@fixture/kit': 'workspace:*' } }),
    );
    fs.writeFileSync(path.join(appDir, 'src', 'index.ts'), 'export const run = () => 1;\n');

    const depDir = path.join(root, 'packages', 'kit');
    fs.mkdirSync(path.join(depDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(depDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(depDir, 'package.json'), JSON.stringify({ name: '@fixture/kit', version: '1.0.0' }));
    fs.writeFileSync(path.join(depDir, 'src', 'index.ts'), 'export const PAGE = 20;\n');
    fs.writeFileSync(path.join(depDir, 'dist', 'index.js'), 'export const PAGE = 20;\n');
    return { root, appDir, depDir };
  };

  it('is the same number for a tree nobody touched', async () => {
    const { appDir } = workspace();

    expect(await buildInputsChecksum(appDir)).toBe(await buildInputsChecksum(appDir));
  });

  it('moves when the application\'s own source moves', async () => {
    const { appDir } = workspace();
    const before = await buildInputsChecksum(appDir);
    fs.writeFileSync(path.join(appDir, 'src', 'index.ts'), 'export const run = () => 2;\n');

    expect(await buildInputsChecksum(appDir)).not.toBe(before);
  });

  it('moves when a package that travels with it moves', async () => {
    // The whole reason the closure is in the hash: this app's own files did
    // not change, and what it compiles against — and ships beside — did.
    const { appDir, depDir } = workspace();
    const before = await buildInputsChecksum(appDir);
    fs.writeFileSync(path.join(depDir, 'src', 'index.ts'), 'export const PAGE = 50;\n');

    expect(await buildInputsChecksum(appDir)).not.toBe(before);
  });

  it('moves when a dependency\'s compiled output moves, not only its source', async () => {
    const { appDir, depDir } = workspace();
    const before = await buildInputsChecksum(appDir);
    fs.writeFileSync(path.join(depDir, 'dist', 'index.js'), 'export const PAGE = 50;\n');

    expect(await buildInputsChecksum(appDir)).not.toBe(before);
  });

  it('does not move when the application\'s own output moves', async () => {
    // `dist` is what this decides whether to produce. Reading it as an input
    // would make every build its own reason to build again.
    const { appDir } = workspace();
    fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
    const before = await buildInputsChecksum(appDir);
    fs.writeFileSync(path.join(appDir, 'dist', 'index.js'), 'export const run = () => 1;\n');

    expect(await buildInputsChecksum(appDir)).toBe(before);
  });

  it('answers nothing at all when there is no workspace above the app', async () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-orphan-'));
    made.push(orphan);
    fs.writeFileSync(path.join(orphan, 'package.json'), JSON.stringify({ name: '@fixture/lost', version: '1.0.0' }));

    expect(await buildInputsChecksum(orphan)).toBeNull();
    expect(decideBuild({ recorded, inputs: null, distChecksum: DIST }).action).toBe('build');
  });
});
