import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface RuntimeArtifact {
  protocol: 1;
  sha256: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  packages: number;
}

/** Hash bytes and relative links; no dependency may escape the immutable release. */
export async function runtimeArtifactDigest(root: string): Promise<string> {
  root = await fs.realpath(root);
  const digest = createHash('sha256');
  let files = 0;
  const walk = async (relative: string): Promise<void> => {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Runtime entry belongs to another user: ${relative || '.'}`);
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolute);
      const real = await fs.realpath(absolute);
      if (!real.startsWith(root + path.sep)) throw new Error(`Runtime dependency escapes its release: ${relative}`);
      digest.update(`link\0${relative}\0${target}\0`);
    } else if (stat.isDirectory()) {
      if ((stat.mode & 0o022) !== 0) throw new Error(`Runtime directory is writable by other users: ${relative || '.'}`);
      for (const name of (await fs.readdir(absolute)).sort()) {
        if (!relative && name === 'RUNTIME.json') continue;
        await walk(path.join(relative, name));
      }
    } else if (stat.isFile()) {
      if (++files > 200_000) throw new Error('Runtime exceeds file audit capacity');
      if ((stat.mode & 0o022) !== 0) throw new Error(`Runtime file is writable by other users: ${relative}`);
      digest.update(`file\0${relative}\0${stat.mode & 0o111}\0`);
      digest.update(await fs.readFile(absolute)); digest.update('\0');
    } else throw new Error(`Unsupported runtime file: ${relative}`);
  };
  await walk('');
  return digest.digest('hex');
}

export async function verifyRuntimeArtifact(root: string, expectedHash?: string): Promise<RuntimeArtifact> {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'RUNTIME.json'), 'utf8')) as RuntimeArtifact;
  if (manifest.protocol !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      manifest.platform !== process.platform || manifest.arch !== process.arch ||
      (expectedHash && expectedHash !== manifest.sha256)) throw new Error('Runtime manifest does not match this release or host');
  if (await runtimeArtifactDigest(root) !== manifest.sha256) throw new Error('Runtime files or dependencies changed after sealing; activation is refused');
  return manifest;
}
