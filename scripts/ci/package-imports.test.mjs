import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertConsumerArchives, inlinedDevDependencies, retainedBuildImports } from '../lib/package-imports.mjs';

test('the dependency gate rejects an internal peer left on the previous release minor', t => {
  const directory = mkdtempSync(join(tmpdir(), 'omni-workspace-peer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src'));
  const manifest = { name: 'peer-probe', version: '0.4.0', peerDependencies: {
    '@omnitron-dev/titan': '^0.3.0', react: '^19.0.0',
  } };
  const file = join(directory, 'package.json');
  const args = [fileURLToPath(new URL('../undeclared-dependencies.mjs', import.meta.url)), directory];
  writeFileSync(file, JSON.stringify(manifest));
  const denied = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(denied.status, 1, denied.stderr);
  assert.match(denied.stdout, /WORKSPACE.*peerDependencies\.@omnitron-dev\/titan.*workspace:\*/);
  manifest.peerDependencies['@omnitron-dev/titan'] = 'workspace:*';
  writeFileSync(file, JSON.stringify(manifest));
  const accepted = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /0 invalid workspace references/);
});

test('the dependency gate recognizes DefinitelyTyped declarations without allowing runtime imports', t => {
  const directory = mkdtempSync(join(tmpdir(), 'omni-types-consumer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'types-probe', dependencies: {
    '@types/hast': '*', '@types/example__schema': '*',
  } }));
  const source = "import type { Root } from 'hast'; import type { Node } from '@example/schema';\n";
  const file = join(directory, 'src/index.ts');
  writeFileSync(file, source);
  const args = [fileURLToPath(new URL('../undeclared-dependencies.mjs', import.meta.url)), directory];
  const accepted = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /0 runtime, 0 type-only/);
  writeFileSync(file, source + "import { render } from 'hast';\n");
  const denied = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(denied.status, 1, denied.stderr);
  assert.match(denied.stdout, /RUNTIME\s+hast/);
});

test('an installed archive graph rejects a nested SDK version outside the qualified inventory', { timeout: 30_000 }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'omni-archive-consumer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const npm = (cwd, args) => execFileSync('npm', [...args, '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], {
    cwd, encoding: 'utf8', timeout: 15_000, env: { ...process.env, NPM_CONFIG_CACHE: join(directory, 'cache') },
  });
  const pack = (folder, name, version, dependencies) => {
    const source = join(directory, folder); mkdirSync(source);
    const manifest = { name, version, files: ['index.js'], main: 'index.js', ...(dependencies && { dependencies }) };
    writeFileSync(join(source, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(source, 'index.js'), `exports.version = ${JSON.stringify(version)};`);
    const [packed] = JSON.parse(npm(source, ['pack', '--json', '--pack-destination', directory]));
    return { manifest, filename: join(directory, packed.filename) };
  };
  const name = '@omnitron-dev/qualification-base';
  const old = pack('old', name, '0.1.0');
  const current = pack('current', name, '0.2.0');
  const parent = pack('parent', '@omnitron-dev/qualification-parent', '0.2.0', { [name]: 'file:' + old.filename });
  const archives = new Map([[name, current], [parent.manifest.name, parent]]);
  const consumer = join(directory, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies: { [name]: 'file:' + current.filename } }));
  npm(consumer, ['install']);
  assert.equal(assertConsumerArchives(consumer, archives), 1);
  const lockfile = join(consumer, 'package-lock.json');
  const lock = readFileSync(lockfile, 'utf8');
  const incomplete = JSON.parse(lock);
  delete incomplete.packages['node_modules/' + name];
  writeFileSync(lockfile, JSON.stringify(incomplete));
  assert.throws(() => assertConsumerArchives(consumer, archives), /Missing required SDK archive/);
  writeFileSync(lockfile, lock);
  npm(consumer, ['install', 'file:' + parent.filename]);
  assert.throws(() => assertConsumerArchives(consumer, archives), /qualified archive.*qualification-parent\/node_modules\/.*qualification-base/);
});

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
