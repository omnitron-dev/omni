import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FileArchiveFormat, FileArchiveManifest, FileUpload } from '../shared/dto/files.js';
import { restoreArchive } from './archive-codec.js';

type Identity = { device: string; inode: string };
export interface ArchiveWriteState {
  format: FileArchiveFormat;
  manifest: FileArchiveManifest;
  expectedSha256: string;
  restored?: boolean;
  /** Written before mkdir: a lost reservation acknowledgement must never adopt an unrelated directory. */
  reservationAttempted?: boolean;
  directories?: Record<string, Identity>;
}
const identity = (stat: BigIntStats): Identity => ({ device: String(stat.dev), inode: String(stat.ino) });
const same = (stat: BigIntStats, value: Identity) =>
  String(stat.dev) === value.device && String(stat.ino) === value.inode;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
async function sync(directory: string): Promise<void> {
  const fd = await fs.open(directory, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function checksum(file: string, size: number, signal: AbortSignal): Promise<string> {
  const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const initial = await fd.stat({ bigint: true });
    if (!initial.isFile() || initial.size !== BigInt(size)) throw new Error('Archive staging file changed');
    const hash = createHash('sha256');
    for await (const chunk of fd.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      signal.throwIfAborted();
      hash.update(chunk);
    }
    const final = await fd.stat({ bigint: true });
    if (
      initial.ino !== final.ino ||
      initial.dev !== final.dev ||
      initial.size !== final.size ||
      initial.mtimeNs !== final.mtimeNs ||
      initial.ctimeNs !== final.ctimeNs
    )
      throw new Error('Archive staging file changed while verifying');
    return hash.digest('hex');
  } finally {
    await fd.close();
  }
}

/** Portable no-overwrite publication. The reserved directory is visible until the durable receipt completes. */
export async function publishArchiveDirectory(options: {
  upload: FileUpload;
  archive: ArchiveWriteState;
  staged: string;
  tree: string;
  target: () => Promise<string>;
  persist: () => void;
  signal: AbortSignal;
}): Promise<void> {
  const { upload, archive, staged, tree, signal, persist } = options;
  signal.throwIfAborted();
  if ((await checksum(staged, upload.size, signal)) !== archive.expectedSha256)
    throw new Error('Transferred archive SHA-256 does not match its admitted source');
  upload.sha256 = archive.expectedSha256;
  upload.phase = 'restoring';
  persist();
  if (!archive.restored) {
    if (archive.reservationAttempted)
      throw new Error('Archive restore receipt is inconsistent with a publication reservation');
    await fs.rm(tree, { recursive: true, force: true });
    await fs.mkdir(tree, { mode: 0o700 });
    const total = archive.manifest.entries.reduce((sum, entry) => sum + entry.size, 0);
    const space = await fs.statfs(path.dirname(tree));
    if (space.bavail * space.bsize < total + 64 * 1024 ** 2)
      throw new Error('Insufficient free space for verified archive restoration');
    let last = 0;
    await restoreArchive({
      format: archive.format,
      manifest: archive.manifest,
      archiveFile: staged,
      outputDirectory: tree,
      signal,
      preserveModes: false,
      onProgress(bytes) {
        upload.restoredBytes = bytes;
        if (Date.now() - last > 500) {
          persist();
          last = Date.now();
        }
      },
    });
    await sync(tree);
    archive.restored = true;
    persist();
  }
  // Never trust paths from the decoder or a private tree left by a previous process.
  const expectedChildren = new Map<string, Set<string>>();
  expectedChildren.set('', new Set([archive.manifest.rootName]));
  for (const item of archive.manifest.entries) {
    if (item.kind === 'directory') expectedChildren.set(item.path, new Set());
    expectedChildren
      .get(path.posix.dirname(item.path) === '.' ? '' : path.posix.dirname(item.path))
      ?.add(path.posix.basename(item.path));
    signal.throwIfAborted();
    const stat = await fs.lstat(path.join(tree, item.path), { bigint: true });
    if (stat.isSymbolicLink() || (item.kind === 'directory' ? !stat.isDirectory() : !stat.isFile()))
      throw new Error('Restored archive tree changed');
    if (item.kind === 'file') {
      // A crash may follow final chmod on an owned hard-linked file. Restore owner-read only
      // inside the unfinished private tree so its exact bytes can be checked again.
      await fs.chmod(path.join(tree, item.path), (Number(stat.mode) & 0o777) | 0o400);
      if ((await checksum(path.join(tree, item.path), item.size, signal)) !== item.sha256)
        throw new Error('Restored archive file checksum changed');
    }
  }
  for (const [relative, children] of expectedChildren) {
    const actual = await fs.readdir(path.join(tree, relative));
    if (actual.length !== children.size || actual.some((name) => !children.has(name)))
      throw new Error('Unexpected entries in private archive tree');
  }
  upload.phase = 'publishing';
  persist();
  signal.throwIfAborted();
  const root = await options.target();
  if (!archive.directories?.['']) {
    if (
      archive.reservationAttempted &&
      (await fs.lstat(root).catch((error) => {
        if (absent(error)) return null;
        throw error;
      }))
    )
      throw new Error(
        'Directory reservation outcome is uncertain; inspect the destination before creating a new transfer'
      );
    archive.reservationAttempted = true;
    upload.publication = 'partial';
    persist();
    try {
      await fs.mkdir(root, { mode: 0o700 }); // Exclusive: an existing empty directory is never replaced.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // A rejected exclusive mkdir has a known outcome: this transfer owns no destination.
        archive.reservationAttempted = false; delete upload.publication; persist();
      }
      throw error;
    }
    const stat = await fs.lstat(root, { bigint: true });
    archive.directories = { '': identity(stat) };
    persist();
    await sync(path.dirname(root));
  }
  const checked = async (relative: string): Promise<string> => {
    const target = await options.target();
    if (target !== root) throw new Error('Publication root changed');
    const parts = relative ? relative.split('/') : [];
    let candidate = root;
    for (let index = 0; index <= parts.length; index++) {
      const key = parts.slice(0, index).join('/'),
        bound = archive.directories?.[key];
      if (!bound) throw new Error('Publication directory has no durable identity');
      const stat = await fs.lstat(candidate, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || !same(stat, bound))
        throw new Error('Publication directory was replaced; nothing will be overwritten');
      if (index < parts.length) candidate = path.join(candidate, parts[index]!);
    }
    return candidate;
  };
  for (const item of archive.manifest.entries.slice(1)) {
    signal.throwIfAborted();
    const relative = item.path.slice(archive.manifest.rootName.length + 1),
      parent = path.posix.dirname(relative);
    const parentPath = await checked(parent === '.' ? '' : parent),
      target = path.join(parentPath, path.posix.basename(relative));
    if (item.kind === 'directory') {
      if (!archive.directories![relative]) {
        await fs.mkdir(target, { mode: 0o700 });
        archive.directories![relative] = identity(await fs.lstat(target, { bigint: true }));
        persist();
        await sync(parentPath);
      } else await checked(relative);
    } else {
      const source = path.join(tree, item.path),
        sourceStat = await fs.lstat(source, { bigint: true });
      try {
        await fs.link(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const stat = await fs.lstat(target, { bigint: true });
        if (!stat.isFile() || !same(stat, identity(sourceStat)))
          throw new Error('Publication destination exists; nothing was overwritten', { cause: error });
      }
      await sync(parentPath);
    }
  }
  // A failed/resumed publication cannot silently accept additional or modified user content.
  for (const item of [...archive.manifest.entries].reverse()) {
    signal.throwIfAborted();
    const relative =
      item.path === archive.manifest.rootName ? '' : item.path.slice(archive.manifest.rootName.length + 1);
    if (item.kind === 'file') {
      const parent = path.posix.dirname(relative),
        target = path.join(await checked(parent === '.' ? '' : parent), path.posix.basename(relative));
      const actual = await fs.lstat(target, { bigint: true }),
        source = await fs.lstat(path.join(tree, item.path), { bigint: true });
      if (
        !actual.isFile() ||
        !same(actual, identity(source)) ||
        (await checksum(target, item.size, signal)) !== item.sha256
      )
        throw new Error('Published archive file changed before completion');
      const fd = await fs.open(path.join(tree, item.path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await fd.chmod(item.mode);
        await fd.sync();
      } finally {
        await fd.close();
      }
    } else {
      const target = await checked(relative),
        names = await fs.readdir(target),
        expected = expectedChildren.get(item.path)!;
      if (names.length !== expected.size || names.some((name) => !expected.has(name)))
        throw new Error('Publication directory contains unexpected content');
      const fd = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await fd.chmod(item.mode);
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
  }
  await sync(path.dirname(root));
  upload.publication = 'complete';
  upload.state = 'complete';
  persist();
}
