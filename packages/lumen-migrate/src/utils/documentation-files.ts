import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Fixed admission bounds for documentation input, including ancillary files. */
export const DOCUMENTATION_LIMITS = Object.freeze({
  entries: 10_000,
  depth: 64,
  fileBytes: 16 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
});
export interface DocumentationFile {
  path: string;
  relativePath: string;
  identity: string;
  content: Buffer;
}
export interface DocumentationInventory {
  root: string;
  directories: Map<string, string>;
  files: DocumentationFile[];
}

const identity = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
export const nativeDirectoryIdentity = (directory: string): string => {
  const stat = lstatSync(directory, { bigint: true });
  if (stat.isSymbolicLink()) throw Error('Symlinked directory paths are not supported: ' + directory);
  if (!stat.isDirectory()) throw Error('Expected a real directory: ' + directory);
  return `${stat.dev}:${stat.ino}`;
};

export function physicalDirectory(directory: string): string {
  const absolute = resolve(directory);
  nativeDirectoryIdentity(absolute);
  if (realpathSync(absolute) !== absolute) throw Error('Symlinked directory paths are not supported: ' + absolute);
  return absolute;
}

export function directoryStamp(directory: string): string {
  physicalDirectory(directory);
  return identity(lstatSync(directory, { bigint: true }));
}

export function pathExists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function readDocumentationFile(file: string, relativePath = file): DocumentationFile {
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || realpathSync(file) !== file)
    throw Error('Expected a real regular file without symlink aliases: ' + file);
  if (before.size > BigInt(DOCUMENTATION_LIMITS.fileBytes))
    throw Error('Documentation file exceeds the 16 MiB limit: ' + file);
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (identity(fstatSync(descriptor, { bigint: true })) !== identity(before))
      throw Error('File changed while opening: ' + file);
    // Read at most the admitted size plus one byte, even if another writer grows it.
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== Number(before.size) || identity(fstatSync(descriptor, { bigint: true })) !== identity(before))
      throw Error('File changed while reading: ' + file);
    return { path: file, relativePath, identity: identity(before), content: bytes.subarray(0, length) };
  } finally {
    closeSync(descriptor);
  }
}

export function documentationText(file: DocumentationFile): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.content);
  } catch (cause) {
    throw new Error('Invalid UTF-8 documentation input: ' + file.path, { cause });
  }
}

export function documentationRoot(directory: string): string {
  const root = physicalDirectory(directory),
    docs = join(root, 'docs');
  return pathExists(docs) ? physicalDirectory(docs) : root;
}

export function inventoryDocumentation(directory: string): DocumentationInventory {
  const root = physicalDirectory(directory),
    directories = new Map<string, string>(),
    files: DocumentationFile[] = [];
  let entries = 0,
    bytes = 0;
  const visit = (current: string, depth: number): void => {
    if (depth > DOCUMENTATION_LIMITS.depth) throw Error('Documentation tree exceeds the depth limit: ' + current);
    physicalDirectory(current);
    const stamp = directoryStamp(current);
    directories.set(relative(root, current), nativeDirectoryIdentity(current));
    const names: string[] = [];
    const directory = opendirSync(current);
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++entries > DOCUMENTATION_LIMITS.entries)
          throw Error('Documentation tree exceeds the entry limit: ' + root);
        names.push(entry.name);
      }
    } finally {
      directory.closeSync();
    }
    names.sort();
    for (const name of names) {
      const file = join(current, name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Symlinks are not supported in documentation input: ' + file);
      if (stat.isDirectory()) visit(file, depth + 1);
      else {
        const snapshot = readDocumentationFile(file, relative(root, file));
        bytes += snapshot.content.length;
        if (bytes > DOCUMENTATION_LIMITS.totalBytes)
          throw Error('Documentation tree exceeds the 128 MiB limit: ' + root);
        files.push(snapshot);
      }
    }
    if (directoryStamp(current) !== stamp) throw Error('Directory changed while reading: ' + current);
  };
  visit(root, 0);
  return { root, directories, files };
}

export function assertFileUnchanged(file: DocumentationFile): void {
  const current = readDocumentationFile(file.path, file.relativePath);
  if (current.identity !== file.identity || !current.content.equals(file.content))
    throw Error('Input file changed during migration: ' + file.path);
}

export function assertInventoryUnchanged(original: DocumentationInventory): void {
  const current = inventoryDocumentation(original.root);
  if (
    current.directories.size !== original.directories.size ||
    current.files.length !== original.files.length ||
    [...original.directories].some(([directory, id]) => current.directories.get(directory) !== id) ||
    original.files.some(
      (file, index) =>
        current.files[index]?.relativePath !== file.relativePath ||
        current.files[index]?.identity !== file.identity ||
        !current.files[index]?.content.equals(file.content)
    )
  )
    throw Error('Documentation inventory changed during migration: ' + original.root);
}

export const isDocumentationFile = (file: string): boolean => /\.(md|mdx|pdx)$/i.test(file);
