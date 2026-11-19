/**
 * The published omnitron could not start: a dependency it imports was never
 * declared.
 *
 * `src/services/system-info.service.ts` imports `systeminformation`, and
 * `apps/omnitron/package.json` did not list it. Inside this workspace that is
 * invisible — the package resolves from the repository root's `node_modules`,
 * which declares it — so every local run, every test and every build works.
 *
 * Anywhere else it does not exist. Measured by installing the published
 * package on a remote host and starting it:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'systeminformation'
 *   imported from /opt/omnitron/runtime/lib/node_modules/@omnitron-dev/
 *   omnitron/dist/services/system-info.service.js
 *
 * That is the whole npm install channel: a node prepared from the registry
 * gets an omnitron that cannot boot. The version on npm has been in that
 * state since it was published.
 *
 * This checks the property rather than the one package: every bare import in
 * `src` resolves to something the package claims to depend on.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { packageOf, specifiersOf } from '../../../../scripts/lib/package-imports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * What a consumer of this package will actually have.
 *
 * `devDependencies` are deliberately excluded, and that is the whole
 * distinction this file turns on: npm does not install them for a published
 * package. Everything under `src/` is shipped code, so a runtime import that
 * resolves only because of a devDependency resolves only here.
 *
 * Counting them was this test's own first weakness. With devDependencies in
 * the set, moving `tsx` back out of `dependencies` — the exact regression —
 * left it green, because the name was still somewhere in the file. A check
 * that accepts the defect it was written for is worth less than no check, so
 * it is measured the way the consumer experiences it.
 */
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  pkg.name,
]);

/** Every .ts file under src. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function importedPackages(files: string[]) {
  const references: Array<{ name: string; specifier: string; location: string }> = [];
  for (const file of files) {
    for (const { spec, line } of specifiersOf(file)) {
      const name = packageOf(spec);
      if (name) references.push({ name, specifier: spec, location: `${path.relative(root, file)}:${line}` });
    }
  }
  return references;
}

describe('every package src imports is declared', () => {
  const files = sources(path.join(root, 'src'));

  it('finds the sources at all', () => {
    // A scan over nothing passes. Pinned so a moved directory reads as a
    // broken test rather than a clean bill of health.
    expect(files.length).toBeGreaterThan(50);
  });

  it('declares packages loaded by imports, require calls and child process loader flags', () => {
    const imports = importedPackages(files);
    expect(imports.filter(({ name }) => !declared.has(name))).toEqual([]);
    expect(imports.filter(({ specifier }) => specifier === 'tsx/esm').length).toBeGreaterThan(3);
  });

  it('distinguishes imports in generated starter text from modules resolved by the platform', () => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), 'omni-imports-'));
    try {
      const file = path.join(directory, 'generator.ts');
      fs.writeFileSync(file, [
        'const emitted = `',
        "import 'starter-only';",
        "const lazy = import('starter-lazy');",
        '`;',
        'import {',
        '  render,',
        "} from '@example/render/client';",
        "const plugin = import('@example/plugin');",
        "const reader = require('@example/reader');",
        "const childArgs = ['--import', '@example/loader/register'];",
      ].join('\n'));
      expect(importedPackages([file]).map(({ name }) => name)).toEqual([
        '@example/render', '@example/plugin', '@example/reader', '@example/loader',
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('declares systeminformation, the one this file was written for', () => {
    expect(pkg.dependencies?.systeminformation, 'the published package could not boot without it').toBeTruthy();
  });
});

describe('packages handed to a child process are dependencies too', () => {
  it('ships the runtime halves of the TypeScript path, both of them', () => {
    // A `.ts` app goes: compile with esbuild, and on failure fall back to a
    // child spawned with `--import tsx/esm`. Both halves were devDependencies,
    // so on a published install the fallback had nothing to fall back to.
    expect(pkg.dependencies?.esbuild, 'the build path needs it at runtime').toBeTruthy();
    expect(pkg.dependencies?.tsx, 'the fallback path needs it at runtime').toBeTruthy();
  });
});
