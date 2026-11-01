import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runtimeArtifactDigest, verifyRuntimeArtifact } from '../src/shared/runtime-artifact.ts';

const run = promisify(execFile);
const freezer = fileURLToPath(new URL('./freeze-backend.mjs', import.meta.url));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-freeze-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const release = path.join(root, 'release'), source = path.join(release, 'packages/0');
  const dependency = path.join(release, 'packages/1');
  await fs.mkdir(path.join(source, 'dist/shared'), { recursive: true });
  await fs.mkdir(path.join(source, 'node_modules'), { recursive: true });
  await fs.mkdir(dependency, { recursive: true });
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '1.0.0', type: 'module', files: ['dist'], dependencies: { 'fixture-dep': '1.0.0' } }));
  // The production verifier is used by the subprocess too, not a permissive
  // fake that would hide accidental trust in a forged manifest.
  await fs.writeFile(path.join(source, 'dist/shared/runtime-artifact.js'),
    `export * from ${JSON.stringify(new URL('../src/shared/runtime-artifact.ts', import.meta.url).href)};`);
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dep', version: '1.0.0', files: ['*.js', '!test/**'] }));
  await fs.writeFile(path.join(dependency, 'index.js'), 'module.exports = 42;');
  await fs.symlink('../../1', path.join(source, 'node_modules/fixture-dep'));
  const manifest = { protocol: 1, sha256: await runtimeArtifactDigest(release), platform: process.platform,
    arch: process.arch, nodeVersion: process.version, packages: 2 };
  await fs.writeFile(path.join(release, 'RUNTIME.json'), JSON.stringify(manifest));
  return { root, release, source, dependency, output: path.join(root, 'output') };
}

test('repackages a verified sealed dependency graph without reinterpreting registry publication patterns', async t => {
  const f = await fixture(t);
  const result = JSON.parse((await run(process.execPath, [freezer, f.source, f.output])).stdout);
  assert.equal(result.packages, 2);
  await verifyRuntimeArtifact(f.output, result.sha256);
  assert.equal(await fs.readFile(path.join(f.output, 'packages/1/index.js'), 'utf8'), 'module.exports = 42;');
  assert.equal(await fs.realpath(path.join(f.output, 'packages/0/node_modules/fixture-dep')), path.join(f.output, 'packages/1'));
});

test('refuses a changed sealed package before creating an output artifact', async t => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.dependency, 'index.js'), '\nmodule.exports = 0;');
  await assert.rejects(run(process.execPath, [freezer, f.source, f.output]), /Runtime files or dependencies changed/);
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
});

test('a forged release path does not authorize copying an unpacked tree', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.release, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: '0'.repeat(64) }));
  await assert.rejects(run(process.execPath, [freezer, f.source, f.output]), /Runtime manifest does not match/);
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
});
