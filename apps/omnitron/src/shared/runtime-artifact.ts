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
const AUDIT_CONCURRENCY = 16;
const SMALL_FILE_BYTES = 256n * 1024n;

/** A failed audit must settle its other filesystem operations before its caller can clean up or retry. */
async function settle<T>(pending: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(pending);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}

interface RuntimeEntry {
  relative: string;
  absolute: string;
  stat: BigIntStats;
  before: Metadata;
  children?: string[];
  link?: string;
}

/** Protocol 1 uses this prefix for regular-file bytes and this complete record for a link. */
export function runtimeDigestRecord(relative: string, entry: { mode: number } | { link: string }): string {
  return 'link' in entry ? `link\0${relative}\0${entry.link}\0` : `file\0${relative}\0${entry.mode & 0o111}\0`;
}

/** The same walk owns byte admission and subsequent metadata freshness checks. */
async function inspectTree(root: string, unchangedSince?: number, expected?: RuntimeSnapshot): Promise<{ sha256: string; entries: RuntimeSnapshot }> {
  const digest = createHash('sha256'), entries: RuntimeSnapshot = new Map();
  const deadline = unchangedSince === undefined ? undefined : BigInt(Math.trunc(unchangedSince * 1_000_000));
  const inventory = new Map<string, RuntimeEntry>(), pending = [''];
  let files = 0;
  const inspect = async (relative: string): Promise<RuntimeEntry> => {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute, { bigint: true }), before = metadata(stat);
    if (deadline !== undefined && stat.ctimeNs > deadline) throw new Error(`Runtime entry changed after process startup: ${relative || '.'}`);
    if (process.getuid && stat.uid !== BigInt(process.getuid())) throw new Error(`Runtime entry belongs to another user: ${relative || '.'}`);
    if (expected && (!expected.has(relative) || !same(expected.get(relative)!, before)))
      throw new Error(`Runtime entry changed after verification: ${relative || '.'}`);
    const entry: RuntimeEntry = { relative, absolute, stat, before };
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(absolute), real = await fs.realpath(absolute);
      if (!real.startsWith(root + path.sep)) throw new Error(`Runtime dependency escapes its release: ${relative}`);
      entry.link = target;
    } else if (stat.isDirectory()) {
      if ((stat.mode & 0o022n) !== 0n) throw new Error(`Runtime directory is writable by other users: ${relative || '.'}`);
      entry.children = (await fs.readdir(absolute)).sort().map(name => path.join(relative, name));
    } else if (stat.isFile()) {
      if (relative !== 'RUNTIME.json' && ++files > 200_000) throw new Error('Runtime exceeds file audit capacity');
      if ((stat.mode & 0o022n) !== 0n) throw new Error(`Runtime file is writable by other users: ${relative}`);
    } else throw new Error(`Unsupported runtime file: ${relative}`);
    return entry;
  };

  // Only a bounded frontier performs I/O. Hash order is independent of completion order.
  for (let offset = 0; offset < pending.length;) {
    const next = pending.slice(offset, offset + AUDIT_CONCURRENCY);
    offset += next.length;
    const batch = await settle(next.map(inspect));
    for (const entry of batch) {
      inventory.set(entry.relative, entry); entries.set(entry.relative, entry.before);
      for (const child of entry.children ?? []) pending.push(child);
    }
  }
  if (expected && entries.size !== expected.size) throw new Error('Runtime inventory changed after verification');

  const recheck = async (entry: RuntimeEntry): Promise<void> => {
    if (!same(entry.before, metadata(await fs.lstat(entry.absolute, { bigint: true }))))
      throw new Error(`Runtime entry changed during verification: ${entry.relative || '.'}`);
  };
  if (!expected) {
    // Protocol 1 is depth-first name order, not a sort of complete paths (a/x precedes a-x).
    const ordered: RuntimeEntry[] = [], stack = [''];
    while (stack.length) {
      const entry = inventory.get(stack.pop()!)!;
      if (entry.children) {
        for (let index = entry.children.length - 1; index >= 0; index--) stack.push(entry.children[index]!);
      }
      else ordered.push(entry);
    }
    const read = async (entry: RuntimeEntry, small: boolean): Promise<Buffer | undefined> => {
      const handle = await fs.open(entry.absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!same(entry.before, metadata(await handle.stat({ bigint: true }))))
          throw new Error(`Runtime entry changed while opening: ${entry.relative}`);
        if (small) {
          // Bound memory even if the file grows; the post-read metadata check rejects any growth.
          const buffer = Buffer.allocUnsafe(Number(entry.stat.size));
          let length = 0;
          while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
          }
          if (BigInt(length) !== entry.stat.size) throw new Error(`Runtime entry changed while reading: ${entry.relative}`);
          return buffer.subarray(0, length);
        }
        let length = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024,
          end: Number(entry.stat.size) - 1 })) {
          digest.update(chunk); length += chunk.length;
        }
        if (BigInt(length) !== entry.stat.size) throw new Error(`Runtime entry changed while reading: ${entry.relative}`);
      } finally { await handle.close(); }
      return undefined;
    };
    for (let offset = 0; offset < ordered.length; offset += AUDIT_CONCURRENCY) {
      const batch = ordered.slice(offset, offset + AUDIT_CONCURRENCY);
      // At most 4 MiB of small buffers; large files stream individually in the original digest order.
      const buffers = await settle(batch.map(entry => entry.stat.isFile() && entry.relative !== 'RUNTIME.json' &&
        entry.stat.size <= SMALL_FILE_BYTES ? read(entry, true) : Promise.resolve(undefined)));
      for (const [index, entry] of batch.entries()) {
        if (entry.relative === 'RUNTIME.json') continue;
        if (entry.link !== undefined) digest.update(runtimeDigestRecord(entry.relative, { link: entry.link }));
        else {
          digest.update(runtimeDigestRecord(entry.relative, { mode: Number(entry.stat.mode) }));
          const buffer = buffers[index];
          if (buffer !== undefined) digest.update(buffer);
          else await read(entry, false);
          digest.update('\0');
        }
      }
      await settle(batch.map(recheck));
    }
  }
  // Metadata-only files finish at lstat; links and directories must remain stable through the whole walk.
  const structural = [...inventory.values()].filter(entry => !entry.stat.isFile());
  for (let offset = 0; offset < structural.length; offset += AUDIT_CONCURRENCY)
    await settle(structural.slice(offset, offset + AUDIT_CONCURRENCY).map(recheck));
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
