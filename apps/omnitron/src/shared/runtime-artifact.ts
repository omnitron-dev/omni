import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
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

type Metadata = readonly bigint[];
type RuntimeSnapshot = Map<string, Metadata>;
const metadata = (stat: BigIntStats): Metadata => [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid,
  stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs];
const same = (before: Metadata, after: Metadata): boolean => before.every((value, index) => value === after[index]);

/** Protocol 1 uses this prefix for regular-file bytes and this complete record for a link. */
export function runtimeDigestRecord(relative: string, entry: { mode: number } | { link: string }): string {
  return 'link' in entry ? `link\0${relative}\0${entry.link}\0` : `file\0${relative}\0${entry.mode & 0o111}\0`;
}

/** The same walk owns byte admission and subsequent metadata freshness checks. */
async function inspectTree(root: string, unchangedSince?: number, expected?: RuntimeSnapshot): Promise<{ sha256: string; entries: RuntimeSnapshot }> {
  const digest = createHash('sha256'), entries: RuntimeSnapshot = new Map();
  const deadline = unchangedSince === undefined ? undefined : BigInt(Math.trunc(unchangedSince * 1_000_000));
  let files = 0;
  const walk = async (relative: string): Promise<void> => {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute, { bigint: true }), before = metadata(stat);
    if (deadline !== undefined && stat.ctimeNs > deadline) throw new Error(`Runtime entry changed after process startup: ${relative || '.'}`);
    if (process.getuid && stat.uid !== BigInt(process.getuid())) throw new Error(`Runtime entry belongs to another user: ${relative || '.'}`);
    if (expected && (!expected.has(relative) || !same(expected.get(relative)!, before)))
      throw new Error(`Runtime entry changed after verification: ${relative || '.'}`);
    entries.set(relative, before);
    const hashBytes = !expected && relative !== 'RUNTIME.json';
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolute), real = await fs.realpath(absolute);
      if (!real.startsWith(root + path.sep)) throw new Error(`Runtime dependency escapes its release: ${relative}`);
      if (hashBytes) digest.update(runtimeDigestRecord(relative, { link: target }));
    } else if (stat.isDirectory()) {
      if ((stat.mode & 0o022n) !== 0n) throw new Error(`Runtime directory is writable by other users: ${relative || '.'}`);
      for (const name of (await fs.readdir(absolute)).sort()) await walk(path.join(relative, name));
    } else if (stat.isFile()) {
      if (relative !== 'RUNTIME.json' && ++files > 200_000) throw new Error('Runtime exceeds file audit capacity');
      if ((stat.mode & 0o022n) !== 0n) throw new Error(`Runtime file is writable by other users: ${relative}`);
      if (hashBytes) {
        digest.update(runtimeDigestRecord(relative, { mode: Number(stat.mode) }));
        const handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          if (!same(before, metadata(await handle.stat({ bigint: true })))) throw new Error(`Runtime entry changed while opening: ${relative}`);
          if (stat.size <= 256n * 1024n) digest.update(await handle.readFile());
          else for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
        } finally { await handle.close(); }
        digest.update('\0');
      }
    } else throw new Error(`Unsupported runtime file: ${relative}`);
    // A metadata-only file check finishes at lstat. Recheck after byte reads, link resolution or directory traversal.
    if ((!expected || !stat.isFile()) && !same(before, metadata(await fs.lstat(absolute, { bigint: true }))))
      throw new Error(`Runtime entry changed during verification: ${relative || '.'}`);
  };
  await walk('');
  if (expected && entries.size !== expected.size) throw new Error('Runtime inventory changed after verification');
  return { sha256: digest.digest('hex'), entries };
}

/** Hash bytes and relative links; no dependency may escape the immutable release. */
export async function runtimeArtifactDigest(root: string, unchangedSince?: number): Promise<string> {
  return (await inspectTree(await fs.realpath(root), unchangedSince)).sha256;
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

/** A process-local proof can be reused only while the complete filesystem snapshot stays unchanged. */
export async function inspectRuntimeArtifact(root: string, expectedHash?: string, unchangedSince?: number): Promise<{
  manifest: RuntimeArtifact; assertUnchanged: () => Promise<void>;
}> {
  root = await fs.realpath(root);
  const manifestBefore = metadata(await fs.lstat(path.join(root, 'RUNTIME.json'), { bigint: true }));
  const manifest = await readRuntimeManifest(root);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch ||
      (expectedHash && expectedHash !== manifest.sha256)) throw new Error('Runtime manifest does not match this release or host');
  const inspected = await inspectTree(root, unchangedSince);
  const manifestAfter = inspected.entries.get('RUNTIME.json');
  if (!manifestAfter || !same(manifestBefore, manifestAfter)) throw new Error('Runtime manifest changed during verification');
  if (inspected.sha256 !== manifest.sha256) throw new Error('Runtime files or dependencies changed after sealing; activation is refused');
  // Detect changes to an earlier entry while later files were being hashed.
  await inspectTree(root, unchangedSince, inspected.entries);
  let valid = true;
  return { manifest: Object.freeze(manifest), async assertUnchanged() {
    if (!valid) throw new Error('Runtime verification was invalidated by a filesystem change');
    try {
      if (await fs.realpath(root) !== root) throw new Error('Runtime directory changed after verification');
      await inspectTree(root, unchangedSince, inspected.entries);
    } catch (error) { valid = false; throw error; }
  } };
}

export async function verifyRuntimeArtifact(root: string, expectedHash?: string, unchangedSince?: number): Promise<RuntimeArtifact> {
  return (await inspectRuntimeArtifact(root, expectedHash, unchangedSince)).manifest;
}
