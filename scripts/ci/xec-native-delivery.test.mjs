import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { retainNativeRuntime } from '../../.xec/native-delivery.mjs';
import { runtimeArtifactDigest } from '../../apps/omnitron/src/shared/runtime-artifact.ts';

async function seal(root, nodeVersion, platform = process.platform, arch = process.arch) {
  const sha256 = await runtimeArtifactDigest(root);
  await fs.writeFile(path.join(root, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256, nodeVersion, platform, arch, packages: 1 }));
  return sha256;
}

test('native delivery binds the run and verifies bytes before calling the trusted extractor', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-native-delivery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'trusted'), directory = path.join(root, 'retained'), extracted = path.join(root, 'extracted');
  const commit = 'a'.repeat(40), previous = 'b'.repeat(40);
  const bytes = Buffer.from('native archive fixture');
  await fs.mkdir(path.join(extracted, 'packages/0/dist'), { recursive: true });
  await fs.writeFile(path.join(extracted, 'packages/0/dist/BUILD.json'), JSON.stringify({ commit, dirty: false }));
  await fs.writeFile(path.join(extracted, 'node'), 'retained native fixture bytes');
  const runtime = await seal(extracted, 'v22.23.4', 'linux', 'x64');
  const proof = { schema: 1, commit, previous, runId: 7, attempt: 2, node: 'v22.23.4',
    runtime, platform: 'linux', arch: 'x64', archive: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  const module = path.join(local, 'packages/0/dist');
  await fs.mkdir(path.join(module, 'shared'), { recursive: true });
  await fs.mkdir(path.join(module, 'release'));
  await fs.writeFile(path.join(local, 'package.json'), '{"type":"module"}');
  // Trusted source checks real bytes. The artifact's own verifier module must
  // never execute, even when inspecting an already retained native runtime.
  await fs.writeFile(path.join(module, 'shared/runtime-artifact.js'),
    "throw Error('Artifact verifier must never execute');");
  await fs.writeFile(path.join(module, 'BUILD.json'), JSON.stringify({ commit, dirty: false }));
  await fs.writeFile(path.join(module, 'release/frozen-installation.js'),
    "import fs from 'node:fs/promises'; export async function extractFrozenArchive(_archive, root) {" +
    "await fs.cp(" + JSON.stringify(extracted) + ",root,{recursive:true}); }");
  await seal(local, process.version);
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

test('native delivery refuses a changed local extractor before import or download', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-native-untrusted-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'local'), release = path.join(local, 'packages/0/dist/release');
  await fs.mkdir(release, { recursive: true });
  await fs.writeFile(path.join(local, 'package.json'), '{"type":"module"}');
  const extractor = path.join(release, 'frozen-installation.js');
  await fs.writeFile(extractor, 'export async function extractFrozenArchive() {}');
  await seal(local, process.version);
  const marker = path.join(root, 'untrusted-extractor-executed');
  await fs.writeFile(extractor, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed');`);
  let downloads = 0;
  await assert.rejects(retainNativeRuntime({ directory: path.join(root, 'retained'), localRuntime: local,
    evidence: { id: 7, attempt: 1 }, context: { commit: 'a'.repeat(40), previous: 'b'.repeat(40), node: '22.23.4' },
    download: async () => { downloads++; }, observeOnly: false }), /changed after sealing/);
  assert.equal(downloads, 0);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, 'retained')), { code: 'ENOENT' });
});
