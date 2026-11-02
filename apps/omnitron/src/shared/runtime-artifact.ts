import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
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

/** Protocol 1 uses this prefix for regular-file bytes and this complete record for a link. */
export function runtimeDigestRecord(relative: string, entry: { mode: number } | { link: string }): string {
  return 'link' in entry ? `link\0${relative}\0${entry.link}\0` : `file\0${relative}\0${entry.mode & 0o111}\0`;
}

/** Hash bytes and relative links; no dependency may escape the immutable release. */
export async function runtimeArtifactDigest(root: string, unchangedSince?: number): Promise<string> {
  root = await fs.realpath(root);
  const digest = createHash('sha256');
  let files = 0;
  const walk = async (relative: string): Promise<void> => {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (unchangedSince !== undefined && stat.ctimeMs > unchangedSince) throw new Error(`Runtime entry changed after process startup: ${relative || '.'}`);
    if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Runtime entry belongs to another user: ${relative || '.'}`);
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolute);
      const real = await fs.realpath(absolute);
      if (!real.startsWith(root + path.sep)) throw new Error(`Runtime dependency escapes its release: ${relative}`);
      digest.update(runtimeDigestRecord(relative, { link: target }));
    } else if (stat.isDirectory()) {
      if ((stat.mode & 0o022) !== 0) throw new Error(`Runtime directory is writable by other users: ${relative || '.'}`);
      for (const name of (await fs.readdir(absolute)).sort()) {
        if (!relative && name === 'RUNTIME.json') continue;
        await walk(path.join(relative, name));
      }
    } else if (stat.isFile()) {
      if (++files > 200_000) throw new Error('Runtime exceeds file audit capacity');
      if ((stat.mode & 0o022) !== 0) throw new Error(`Runtime file is writable by other users: ${relative}`);
      digest.update(runtimeDigestRecord(relative, stat));
      if (stat.size <= 256 * 1024) digest.update(await fs.readFile(absolute));
      else for await (const chunk of createReadStream(absolute)) digest.update(chunk);
      digest.update('\0');
    } else throw new Error(`Unsupported runtime file: ${relative}`);
    if (unchangedSince !== undefined) {
      const after = await fs.lstat(absolute);
      if (after.ctimeMs > unchangedSince || after.ino !== stat.ino || after.dev !== stat.dev || after.ctimeMs !== stat.ctimeMs) {
        throw new Error(`Runtime entry changed during verification: ${relative || '.'}`);
      }
    }
  };
  await walk('');
  return digest.digest('hex');
}

/** Inspect a sealed build for distribution without executing its Node binary. */
export async function readRuntimeManifest(root: string): Promise<RuntimeArtifact> {
  const manifestFile = path.join(root, 'RUNTIME.json');
  const stat = await fs.lstat(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384 || (stat.mode & 0o022) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Runtime manifest must be a bounded regular file owned by this user');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as RuntimeArtifact;
  if (manifest.protocol !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid runtime manifest');
  return manifest;
}

export async function verifyRuntimeArtifact(root: string, expectedHash?: string, unchangedSince?: number): Promise<RuntimeArtifact> {
  const manifest = await readRuntimeManifest(root);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch ||
      (expectedHash && expectedHash !== manifest.sha256)) throw new Error('Runtime manifest does not match this release or host');
  if (await runtimeArtifactDigest(root, unchangedSince) !== manifest.sha256) throw new Error('Runtime files or dependencies changed after sealing; activation is refused');
  return manifest;
}
