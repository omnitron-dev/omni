import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { create, extract } from 'tar';

/** Canonical archive of a staged tree. No host metadata, traversal order, or clock in its identity. */
export async function writePortableArchive(directory: string, destination: string): Promise<void> {
  const cwd = await fs.realpath(directory);
  const entries: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    for (const name of (await fs.readdir(path.join(cwd, folder))).sort()) {
      const relative = path.join(folder, name);
      if (entries.length >= 200_000) throw new Error('Release archive exceeds file count limit');
      entries.push(relative);
      const file = path.join(cwd, relative);
      const stat = await fs.lstat(file);
      if (stat.isDirectory()) await walk(relative);
      else if (stat.isSymbolicLink()) {
        if (path.isAbsolute(await fs.readlink(file)) || !(await fs.realpath(file)).startsWith(cwd + path.sep))
          throw new Error(`Release archive contains a non-portable link: ${relative}`);
      } else if (!stat.isFile()) throw new Error(`Unsupported release archive entry: ${relative}`);
    }
  };
  await walk('');
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
    await fs.rename(temporary, destination);
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
