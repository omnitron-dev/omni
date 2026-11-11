import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { retainNativeRuntime } from '../../.xec/native-delivery.mjs';

test('native delivery binds the run and verifies bytes before calling the trusted extractor', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-native-delivery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'trusted'), directory = path.join(root, 'retained');
  const commit = 'a'.repeat(40), previous = 'b'.repeat(40);
  const bytes = Buffer.from('native archive fixture');
  const runtime = 'c'.repeat(64);
  const proof = { schema: 1, commit, previous, runId: 7, attempt: 2, node: 'v22.23.4',
    runtime, platform: 'linux', arch: 'x64', archive: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  const module = path.join(local, 'packages/0/dist');
  await fs.mkdir(path.join(module, 'shared'), { recursive: true });
  await fs.mkdir(path.join(module, 'release'));
  await fs.writeFile(path.join(local, 'package.json'), '{"type":"module"}');
  // The fixture isolates delivery identity; production supplies the platform's tested archive verifier.
  await fs.writeFile(path.join(module, 'shared/runtime-artifact.js'),
    "import fs from 'node:fs/promises'; export async function readRuntimeManifest(root) { return JSON.parse(await fs.readFile(root+'/RUNTIME.json')); } export async function runtimeArtifactDigest(root) { return (await readRuntimeManifest(root)).sha256; }");
  await fs.writeFile(path.join(module, 'release/frozen-installation.js'),
    "import fs from 'node:fs/promises'; export async function extractFrozenArchive(_archive, root) {" +
    "await fs.mkdir(root+'/packages/0/dist/shared', {recursive:true});" +
    "await fs.writeFile(root+'/packages/0/dist/shared/runtime-artifact.js', \"throw Error('Downloaded code must never execute')\");" +
    "await fs.writeFile(root+'/packages/0/dist/BUILD.json', JSON.stringify(" + JSON.stringify({ commit, dirty: false }) + "));" +
    "await fs.writeFile(root+'/RUNTIME.json', JSON.stringify(" + JSON.stringify({ sha256: runtime, nodeVersion: proof.node, platform: 'linux', arch: 'x64' }) + ")); }");
  let downloads = 0, corrupt = true;
  const options = { directory, localRuntime: local, evidence: { id: 7, attempt: 2 }, context: { commit, previous, node: '22.23.4' },
    download: async destination => {
      downloads++;
      await fs.writeFile(path.join(destination, 'NATIVE.json'), JSON.stringify(proof));
      await fs.writeFile(path.join(destination, 'runtime.tgz'), corrupt ? 'wrong bytes' : bytes);
    } };
  await assert.rejects(retainNativeRuntime(options), /checksum differs/);
  await assert.rejects(fs.access(directory), { code: 'ENOENT' });
  corrupt = false;
  assert.equal(await retainNativeRuntime(options), path.join(directory, 'runtime'));
  assert.equal(downloads, 2);
  await retainNativeRuntime({ ...options, observeOnly: true });
  assert.equal(downloads, 2);
  await assert.rejects(retainNativeRuntime({ ...options, evidence: { id: 8, attempt: 2 } }), /qualified transition/);
  await fs.writeFile(path.join(directory, 'runtime.tgz'), 'changed');
  await assert.rejects(retainNativeRuntime(options), /checksum differs/);
  assert.equal(downloads, 2, 'corruption must not be hidden by replacement');
});
