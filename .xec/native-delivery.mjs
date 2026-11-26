import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { releaseCommand } from '@xec-sh/ops/release';
import { readRuntimeManifest, runtimeArtifactDigest, verifyRuntimeArtifact } from '../apps/omnitron/src/shared/runtime-artifact.ts';

const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function sha256(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

/** Decode with the already qualified local SDK; never execute code from the download. */
export async function retainNativeRuntime({ directory, localRuntime, readerCommit, evidence, context, download, observeOnly }) {
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
        stamp.commit !== proof.commit || stamp.dirty !== false)
      throw Error('Native runtime manifest or build stamp differs from its sealed proof');
    const actual = await runtimeArtifactDigest(runtime);
    if (actual !== proof.runtime) throw Error('Native runtime tree digest differs: expected ' + proof.runtime + ', got ' + actual);
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
  const reader = await verifyRuntimeArtifact(localRuntime);
  if (readerCommit) {
    const stamp = await json(path.join(localRuntime, 'packages/0/dist/BUILD.json'));
    if (reader.platform !== process.platform || reader.arch !== process.arch || reader.nodeVersion !== process.version ||
        stamp.commit !== readerCommit || stamp.dirty !== false)
      throw Error('Archive reader differs from the requested clean local build');
  }
  const temporary = await fs.mkdtemp(path.join(path.dirname(directory), '.native-'));
  try {
    await download(temporary);
    const proof = await verify(temporary);
    const runtime = path.join(temporary, 'runtime');
    await fs.mkdir(runtime, { mode: 0o700 });
    // Older sealed readers let open(2) mask file execute bits. Scope the mask
    // to this extraction, retaining the operator's read/write restrictions.
    const readerUrl = pathToFileURL(path.join(localRuntime, 'packages/0/dist/release/frozen-installation.js')).href;
    const worker = `process.umask(process.umask() & 0o666);
const [reader, archive, root] = process.argv.slice(1);
await (await import(reader)).extractFrozenArchive(archive, root);`;
    await releaseCommand(temporary, process.execPath,
      ['--input-type=module', '-e', worker, readerUrl, path.join(temporary, 'runtime.tgz'), runtime],
      { envMode: 'replace', env: {}, signal: context.signal, timeoutMs: 600_000 });
    await verifyExtracted(temporary, proof);
    await fs.rename(temporary, directory);
    return path.join(directory, 'runtime');
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
