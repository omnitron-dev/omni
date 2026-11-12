import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readRuntimeManifest, runtimeArtifactDigest, verifyRuntimeArtifact } from '../apps/omnitron/src/shared/runtime-artifact.ts';

const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function sha256(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

/** Decode with the already qualified local SDK; never execute code from the download. */
export async function retainNativeRuntime({ directory, localRuntime, evidence, context, download, observeOnly }) {
  const load = file => import(pathToFileURL(path.join(localRuntime, 'packages/0/dist', file)).href);
  async function verify(root) {
    const proof = await json(path.join(root, 'NATIVE.json'));
    if (proof.schema !== 1 || proof.commit !== context.commit || proof.previous !== context.previous ||
        proof.node !== 'v' + context.node || proof.runId !== evidence.id || proof.attempt !== evidence.attempt ||
        proof.platform !== 'linux' || !/^[a-f0-9]{64}$/.test(proof.archive) ||
        !Number.isSafeInteger(proof.bytes) || proof.bytes < 1 || proof.bytes > 2 * 1024 ** 3)
      throw Error('Native artifact does not belong to the qualified transition');
    const archive = path.join(root, 'runtime.tgz');
    if ((await fs.stat(archive)).size !== proof.bytes || await sha256(archive) !== proof.archive) throw Error('Native archive checksum differs');
    return proof;
  }
  async function verifyExtracted(root, proof) {
    const runtime = path.join(root, 'runtime');
    const manifest = await readRuntimeManifest(runtime);
    const stamp = await json(path.join(runtime, 'packages/0/dist/BUILD.json'));
    if (manifest.sha256 !== proof.runtime || manifest.nodeVersion !== proof.node ||
        manifest.platform !== proof.platform || manifest.arch !== proof.arch ||
        stamp.commit !== proof.commit || stamp.dirty !== false || await runtimeArtifactDigest(runtime) !== proof.runtime)
      throw Error('Native runtime differs from its sealed proof');
    return runtime;
  }
  try {
    const proof = await verify(directory);
    return await verifyExtracted(directory, proof);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // An existing incomplete result is never overwritten or accepted as evidence.
    if (await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) throw error;
  }
  if (observeOnly) throw Error('The qualified native runtime has not been retained: ' + context.node);
  await verifyRuntimeArtifact(localRuntime);
  const temporary = await fs.mkdtemp(path.join(path.dirname(directory), '.native-'));
  try {
    await download(temporary);
    const proof = await verify(temporary);
    const runtime = path.join(temporary, 'runtime');
    await fs.mkdir(runtime, { mode: 0o700 });
    const { extractFrozenArchive } = await load('release/frozen-installation.js');
    await extractFrozenArchive(path.join(temporary, 'runtime.tgz'), runtime);
    await verifyExtracted(temporary, proof);
    await fs.rename(temporary, directory);
    return path.join(directory, 'runtime');
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
