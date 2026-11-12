import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface CorpusScanLimits {
  maxEntries?: number;
  maxBytes?: number;
  maxDepth?: number;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function isCanonicalDocumentPath(path: unknown, extensions: ReadonlySet<string>): path is string {
  if (typeof path !== 'string' || !path || Buffer.byteLength(path) > 1024 || /[\\%:?#]/.test(path) || isAbsolute(path)) return false;
  if ([...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (path.split('/').some((part) => !part || part.startsWith('.') || ['~', 'node_modules', 'dist'].includes(part))) return false;
  const extension = extname(path).toLowerCase();
  return !extension || extensions.has(extension);
}

/** Read a regular file through one bounded descriptor; deny symlinks and concurrent replacement. */
export async function readCorpusFile(root: string, path: string, maxBytes: number): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('Corpus byte budget must be a non-negative safe integer');
  const target = resolve(root, path);
  if (!inside(root, target)) return null;
  let current = root;
  for (const component of relative(root, target).split(sep)) {
    current = resolve(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  const before = await lstat(target);
  if (!before.isFile()) return null;
  if (before.size > maxBytes) throw new RangeError(`Corpus file exceeds ${maxBytes} bytes`);
  const canonical = await realpath(target);
  if (!inside(root, canonical)) return null;
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Corpus file changed before reading');
    const buffer = Buffer.alloc(Math.min(opened.size + 1, maxBytes + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await file.stat();
    const currentPath = await lstat(target);
    if (offset > maxBytes || after.size > maxBytes) throw new RangeError(`Corpus file exceeds ${maxBytes} bytes`);
    if (after.size !== offset || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
        currentPath.ino !== opened.ino || currentPath.dev !== opened.dev || currentPath.isSymbolicLink() ||
        await realpath(target) !== canonical) throw new Error('Corpus file changed while reading');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, offset));
  } finally { await file.close(); }
}

/** A deterministic, bounded corpus inventory. Read failures never become a successful partial corpus. */
export async function scanCorpusFiles(
  root: string, extensions: ReadonlySet<string>, maxFileBytes: number, options: CorpusScanLimits = {},
  ownedPaths: ReadonlySet<string> = new Set()
): Promise<Array<{ path: string; content: string }>> {
  const maxEntries = options.maxEntries ?? 10_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const maxDepth = options.maxDepth ?? 32;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new TypeError('Corpus file limit must be a positive safe integer');
  if ([maxEntries, maxDepth].some((value) => !Number.isSafeInteger(value) || value < 1) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('Corpus entry/depth limits must be positive and byte budget non-negative safe integers');
  }
  const files: Array<{ path: string; content: string }> = [];
  const directories = [{ path: root, depth: 0 }];
  let entries = 0;
  let bytes = 0;
  while (directories.length) {
    const directory = directories.pop()!;
    if (directory.depth > maxDepth) throw new RangeError(`Corpus directory depth exceeds ${maxDepth}`);
    if (await realpath(directory.path) !== directory.path) throw new Error('Corpus directory changed during scan');
    for await (const entry of await opendir(directory.path)) {
      if (++entries > maxEntries) throw new RangeError(`Corpus entries exceed ${maxEntries}`);
      if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const target = resolve(directory.path, entry.name);
      if (entry.isDirectory()) directories.push({ path: target, depth: directory.depth + 1 });
      else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        const path = relative(root, target).split(sep).join('/');
        if (ownedPaths.has(path)) continue;
        const content = await readCorpusFile(root, path, Math.min(maxFileBytes, maxBytes - bytes));
        if (content === null) throw new Error('Corpus file changed during scan');
        bytes += Buffer.byteLength(content);
        files.push({ path, content });
      }
    }
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
