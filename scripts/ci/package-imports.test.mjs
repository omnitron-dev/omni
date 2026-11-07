import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inlinedDevDependencies, retainedBuildImports } from '../lib/package-imports.mjs';

test('only explicitly bundled dev dependencies are build inputs', () => {
  const pkg = {
    tsup: { noExternal: ['*', 'unknown', '@tools/syntax', 'optional', 'peer', 'runtime'] },
    devDependencies: { '@tools/syntax': '1', other: '1', optional: '1', peer: '1', runtime: '1' },
    optionalDependencies: { optional: '1' }, dependencies: { runtime: '1' }, peerDependencies: { peer: '1' },
  };
  assert.deepEqual([...inlinedDevDependencies(pkg)], ['@tools/syntax']);
  assert.equal(inlinedDevDependencies({ devDependencies: pkg.devDependencies }).size, 0);
});

test('shipped JS chunks and declarations cannot refer consumers back to a private build input', t => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-pack-imports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = {
    'clean.js': '/* import "@tools/syntax"; */ export const text = "@tools/syntax";',
    'clean.d.ts': 'export interface Token { value: string }',
    'chunk.mjs': 'export const lazy = () => import("@tools/syntax/parse");',
    'main.cjs': 'module.exports = require.resolve("@tools/syntax");',
    'esbuild.cjs': 'const syntax = __require("@tools/syntax");',
    'api.d.mts': 'export type Token = import("@tools/syntax/types").Token;',
    'refs.d.cts': '/// <reference types="@tools/syntax" />\nexport {};',
    'source.js.map': JSON.stringify({ sourcesContent: ['import "@tools/syntax";'] }),
  };
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
  assert.deepEqual(retainedBuildImports(dir, Object.keys(files), new Set(['@tools/syntax'])), [
    'chunk.mjs:1 imports @tools/syntax/parse', 'main.cjs:1 imports @tools/syntax',
    'esbuild.cjs:1 imports @tools/syntax', 'api.d.mts:1 imports @tools/syntax/types',
    'refs.d.cts:1 imports @tools/syntax',
  ]);
});
