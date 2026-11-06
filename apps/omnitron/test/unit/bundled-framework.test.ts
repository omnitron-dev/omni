import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { create } from 'tar';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { installedGraph, materializeGraph } from '../../src/release/installed-graph.js';
import { inspectFrameworkArchive, verifiedFramework } from '../../src/release/registry-framework.js';

const name = '@omnitron-dev/kb', version = '0.3.1', commit = 'ab'.repeat(20);
let root: string, directory: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bundled-framework-'));
  directory = path.join(root, 'package');
  const packages = [
    ['', { name, version, gitHead: commit, dependencies: { parser: '1.0.0', '@scope/scanner': '1.0.0' }, bundledDependencies: ['parser', '@scope/scanner'] }],
    ['node_modules/parser', { name: 'parser', version: '1.0.0', dependencies: { matcher: '1.0.0', '@scope/scanner': '1.0.0' } }],
    ['node_modules/parser/node_modules/matcher', { name: 'matcher', version: '1.0.0' }],
    ['node_modules/@scope/scanner', { name: '@scope/scanner', version: '1.0.0', dependencies: { matcher: '2.0.0', parser: '1.0.0' } }],
    ['node_modules/matcher', { name: 'matcher', version: '2.0.0' }],
  ] as const;
  for (const [folder, manifest] of packages) {
    const target = path.join(directory, folder);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(target, 'index.js'), 'module.exports = ' + JSON.stringify(manifest.name + '@' + manifest.version) + ';\n');
  }
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function evidence() {
  const file = path.join(root, 'archive.tgz');
  await create({ cwd: root, file, gzip: true, portable: true, noMtime: true }, ['package']);
  const bytes = await fs.readFile(file);
  return inspectFrameworkArchive({ name, version, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }, Readable.from(bytes));
}

it('verifies hoisted, nested, scoped and cyclic bundles before and after portable graph materialization', async () => {
  const packed = await evidence();
  expect(packed.files.size).toBe(10);
  const framework = verifiedFramework({ repo: 'fixture', commit, onRemote: false }, new Map([[name, packed]]));
  await framework.verifyPackage(name, directory);
  const installed = path.join(root, 'consumer/node_modules', name);
  await fs.cp(directory, installed, { recursive: true });
  const graph = await installedGraph(installed);
  expect(graph).toHaveLength(5);
  const destinations = graph.map((_, index) => path.join(root, 'sealed', String(index)));
  await materializeGraph(graph, destinations);
  await framework.verifyPackage(name, destinations[0]!);
  const matcher = graph.findIndex(pkg => pkg.metadata.name === 'matcher' && pkg.metadata.version === '2.0.0');
  const file = path.join(destinations[matcher]!, 'index.js');
  const original = await fs.readFile(file);
  await fs.writeFile(file, 'module.exports = "tampered";\n');
  await expect(framework.verifyPackage(name, destinations[0]!)).rejects.toThrow(/differs/);
  await fs.writeFile(file, original);
  await fs.writeFile(path.join(destinations[matcher]!, 'injected.js'), 'extra');
  await expect(framework.verifyPackage(name, destinations[0]!)).rejects.toThrow(/differs/);
  await fs.rm(path.join(destinations[matcher]!, 'injected.js'));
  await fs.rm(file);
  await expect(framework.verifyPackage(name, destinations[0]!)).rejects.toThrow(/missing/);
});

it('rejects bundles not authorized by the root manifest', async () => {
  const file = path.join(directory, 'package.json');
  const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
  delete metadata.bundledDependencies;
  await fs.writeFile(file, JSON.stringify(metadata));
  await expect(evidence()).rejects.toThrow(/undeclared bundled/);
});

it('rejects missing declared bundles and packages with a forged path identity', async () => {
  const file = path.join(directory, 'node_modules/parser/package.json');
  const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...metadata, name: 'impostor' }));
  await expect(evidence()).rejects.toThrow(/identity differs/);
  await fs.rm(path.join(directory, 'node_modules/parser'), { recursive: true });
  await expect(evidence()).rejects.toThrow(/bundled dependency is missing/);
});

it('rejects unreferenced bundled packages and dependency trees hidden in code directories', async () => {
  const orphan = path.join(directory, 'node_modules/orphan');
  await fs.mkdir(orphan);
  await fs.writeFile(path.join(orphan, 'package.json'), JSON.stringify({ name: 'orphan', version: '1.0.0' }));
  await expect(evidence()).rejects.toThrow(/undeclared bundled/);
  await fs.rm(orphan, { recursive: true });
  const hidden = path.join(directory, 'dist/node_modules/hidden');
  await fs.mkdir(hidden, { recursive: true });
  await fs.writeFile(path.join(hidden, 'index.js'), 'hidden');
  await expect(evidence()).rejects.toThrow(/Invalid bundled package surface/);
});

it('keeps the prohibition on archive symlinks inside declared bundles', async () => {
  await fs.symlink('../../../../outside', path.join(directory, 'node_modules/parser/link'));
  await expect(evidence()).rejects.toThrow(/Unexpected or duplicate npm archive entry/);
});
