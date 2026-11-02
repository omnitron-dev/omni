import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { create, extract } from 'tar';

async function* archiveEntries(root: string, folder = ''): AsyncGenerator<{ relative: string; file: string; directory: boolean; link: boolean }> {
  for (const name of (await fs.readdir(path.join(root, folder))).sort()) {
    const relative = path.join(folder, name);
    const file = path.join(root, relative);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) {
      const target = await fs.realpath(file);
      if (path.isAbsolute(await fs.readlink(file)) || (target !== root && !target.startsWith(root + path.sep)))
        throw new Error(`Release archive contains a non-portable link: ${relative}`);
    } else if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported release archive entry: ${relative}`);
    yield { relative, file, directory: stat.isDirectory(), link: stat.isSymbolicLink() };
    if (stat.isDirectory()) yield* archiveEntries(root, relative);
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Deterministic per-file integrity manifest for releases that require a regular-file payload. */
export async function releaseFileHashes(directory: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = Object.create(null);
  for await (const entry of archiveEntries(await fs.realpath(directory))) {
    if (entry.link) throw Error('Release file manifest cannot contain symbolic links: ' + entry.relative);
    if (!entry.directory) hashes[entry.relative.split(path.sep).join('/')] = await sha256File(entry.file);
  }
  return hashes;
}

/** Canonical archive of a staged tree, with executable bits and relative links preserved. */
export async function writePortableArchive(directory: string, destination: string, options: { exclusive?: boolean } = {}): Promise<void> {
  const cwd = await fs.realpath(directory);
  const entries: string[] = [];
  for await (const { relative } of archiveEntries(cwd)) {
    if (entries.length >= 200_000) throw new Error('Release archive exceeds file count limit');
    entries.push(relative);
  }
  if (!entries.length) throw new Error('Cannot pack an empty release');
  const temporary = path.join(path.dirname(destination), '.archive-' + randomUUID());
  try {
    await create({ cwd, file: temporary, gzip: true, portable: true, noMtime: true, strict: true,
    noDirRecurse: true, jobs: 1, filter: (_name, stat) => {
      // Readonly vs writable owner is a property of the staging directory.
      // Preserve executable semantics, never group/other write permission.
      if ('isFile' in stat) {
        stat.mode = (stat.mode & ~0o7777) | (stat.isDirectory() || (stat.mode & 0o111) ? 0o755 : 0o644);
        // Byte-identical files must not change representation because a package
        // store happened to hard-link them on one builder.
        stat.nlink = 1;
      }
      return true;
    } }, entries);
    if (options.exclusive) await fs.link(temporary, destination);
    else await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}

/** pnpm resolves workspace ranges before packing. Canonicalize only unordered
 * dependency maps; export conditions and all executable bytes keep their order. */
export async function normalizePackedWorkspace(archive: string): Promise<void> {
  const temp = await fs.mkdtemp(path.join(path.dirname(archive), '.pack-'));
  try {
    await extract({ cwd: temp, file: archive, strict: true });
    const manifest = path.join(temp, 'package/package.json');
    const meta = JSON.parse(await fs.readFile(manifest, 'utf8')) as Record<string, unknown>;
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'devDependencies']) {
      const map = meta[key];
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        meta[key] = Object.fromEntries(Object.keys(map).sort().map(name => [name, (map as Record<string, unknown>)[name]]));
      }
    }
    await fs.writeFile(manifest, JSON.stringify(meta, null, 2) + '\n');
    await writePortableArchive(temp, archive);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
