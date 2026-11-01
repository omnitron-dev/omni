/** Exercise serialized remote commands against compiled output: release-provenance.mjs <dist>. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] ?? 'dist');
const { sealReleaseArtifactCommand, verifyLaunchRelease, frameworkDigestCommand, artifactPayloadDigestCommand } =
  await import(pathToFileURL(path.join(dist, 'release/runtime-provenance.js')));
const run = async command => (await promisify(exec)(command, {
  timeout: 10_000, env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
})).stdout.trim();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-receipt-command-'));
try {
  const root = path.join(directory, 'artifact'); await fs.mkdir(root);
  const bootstrap = path.join(root, 'bootstrap.js'); await fs.writeFile(bootstrap, 'export default {}');
  const framework = path.join(root, 'node_modules', '@omnitron-dev', 'titan'); await fs.mkdir(framework, { recursive: true });
  await fs.writeFile(path.join(framework, 'package.json'), JSON.stringify({ name: '@omnitron-dev/titan', version: '1.0.0' }));
  await fs.writeFile(path.join(framework, 'index.js'), 'export default 1');
  assert.match(await run(frameworkDigestCommand(root)), /^[a-f0-9]{64}$/);
  const initialPayload = await run(artifactPayloadDigestCommand(root, 'archive.tgz'));
  await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
  assert.equal(await run(artifactPayloadDigestCommand(root, 'archive.tgz')), initialPayload);
  await fs.writeFile(bootstrap, 'export default {changed:true}');
  assert.notEqual(await run(artifactPayloadDigestCommand(root, 'archive.tgz')), initialPayload);
  await fs.writeFile(bootstrap, 'export default {}');
  const origin = { releaseId: 'sample-release', app: 'api', manifestSha256: 'a'.repeat(64),
    artifactSha256: 'b'.repeat(64), artifactBytes: 100, frameworkCommit: 'c'.repeat(40) };
  const command = sealReleaseArtifactCommand(root, origin, origin.frameworkCommit, true, true);
  await run(command);
  const entry = { name: 'sample/deployed/api', cwd: directory, releaseRoot: root, bootstrap };
  assert.equal((await verifyLaunchRelease(entry, 'launch-1')).state, 'confirmed');
  await assert.rejects(run(command));
  await fs.writeFile(bootstrap, 'export default {changed:true}');
  assert.equal((await verifyLaunchRelease(entry, 'launch-1')).state, 'modified');
  console.log(JSON.stringify({ test: 'compiled-release-provenance', checks: 6, platform: process.platform }));
} finally { await fs.rm(directory, { recursive: true, force: true }); }
