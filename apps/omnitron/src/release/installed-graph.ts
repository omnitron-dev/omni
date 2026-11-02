import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolveInstalledDependency } from './package-resolution.js';
import path from 'node:path';

interface PackageInfo {
  name: string;
  version: string;
  files?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  publishConfig?: Record<string, unknown>;
}
export interface InstalledPackage {
  root: string;
  metadata: PackageInfo;
  dependencies: Map<string, number>;
}
const validName = (name: string) => /^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) &&
  name.split('/').every(part => part !== '.' && part !== '..' && !part.startsWith('.'));
const readManifest = async (root: string): Promise<PackageInfo> => {
  const meta = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as PackageInfo;
  if (!meta || !validName(meta.name) || typeof meta.version !== 'string' || !meta.version)
    throw Error('Invalid installed package at ' + root);
  return meta;
};

/** Resolve the installed *production* graph. Real paths distinguish different peer
 * bindings of the same version; discovery order is stable and cycles are finite. */
export async function installedGraph(source: string, overlays: ReadonlyMap<string, string> = new Map(), allowedRoots?: readonly string[]): Promise<InstalledPackage[]> {
  const packages: InstalledPackage[] = [], known = new Map<string, number>();
  async function visit(directory: string): Promise<number> {
    let root = await fs.realpath(directory);
    if (allowedRoots && !allowedRoots.some(parent => root === parent || root.startsWith(parent + path.sep)))
      throw Error('Installed dependency escapes the frozen checkouts: ' + root);
    let id = known.get(root); if (id !== undefined) return id;
    let metadata = await readManifest(root);
    const overlay = overlays.get(metadata.name);
    if (overlay && root !== overlay) {
      const replacement = await readManifest(overlay);
      if (replacement.name !== metadata.name || replacement.version !== metadata.version)
        throw Error('Overlay changes installed package identity: ' + metadata.name);
      root = overlay; metadata = replacement;
      id = known.get(root); if (id !== undefined) return id;
    }
    if (packages.length >= 4096) throw Error('Installed graph exceeds 4096 packages');
    id = packages.length; known.set(root, id);
    const item: InstalledPackage = { root, metadata, dependencies: new Map() }; packages.push(item);
    const names = Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies }).sort();
    for (const name of names) {
      const target = await resolveInstalledDependency(root, name);
      if (target) item.dependencies.set(name, await visit(target));
      else if (!Object.hasOwn(metadata.optionalDependencies ?? {}, name) && !metadata.peerDependenciesMeta?.[name]?.optional)
        throw Error('Missing installed dependency: ' + metadata.name + ' → ' + name);
    }
    return id;
  }
  await visit(source);
  return packages;
}

const excluded = new Set(['node_modules', '.git', '.npmrc', '.DS_Store', '.codex', '.agents', '.turbo', '.cache', 'coverage']);
const reserved = new Set(['.omnitron-closure.json', '.omnitron-release.json', '.artifact-sha256']);

/** Copy only published files for workspaces. Registry packages and previously
 * verified sealed packages are already packed. Never follow a link outside a package. */
export async function materializeGraph(
  packages: readonly InstalledPackage[], destinations: readonly string[],
  options: { verifiedPackages?: ReadonlySet<string>; application?: boolean } = {},
): Promise<void> {
  if (destinations.length !== packages.length || new Set(destinations).size !== packages.length)
    throw Error('Invalid package destinations');
  for (const [id, item] of packages.entries()) {
    const target = destinations[id]!;
    await fs.mkdir(target, { recursive: true, mode: 0o755 });
    const registry = item.root.split(path.sep).includes('node_modules') || options.verifiedPackages?.has(item.root);
    // Select a publication surface even for a private workspace without a files list.
    const files = !registry ? new Set(['package.json', 'LICENSE', 'README.md', ...(item.metadata.files ??
      ['dist', 'config']), ...(id === 0 && options.application ? ['dist', 'config'] : [])]) : null;
    const copy = async (name: string): Promise<void> => {
      if (name !== '.' && (path.isAbsolute(name) || name.split(/[\\/]/).some(p => !p || p === '.' || p === '..') || /[*?{}!]/.test(name)))
        throw Error('Unsupported publication path in ' + item.metadata.name + ': ' + name + '; use an unpacked publication surface');
      const from = path.resolve(item.root, name), to = path.resolve(target, name);
      try { await fs.lstat(from); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e;
      }
      // Check intermediate components of a declared path too.
      const real = await fs.realpath(from);
      if (real !== item.root && !real.startsWith(item.root + path.sep)) throw Error('Publication path escapes package ' + item.metadata.name);
      await fs.cp(from, to, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true, filter: async file => {
        const base = path.basename(file);
        if (file !== item.root && (excluded.has(base) || base === '.env' || base.startsWith('.env.'))) return false;
        if (reserved.has(base)) throw Error('Reserved release metadata in package ' + item.metadata.name);
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) {
          const link = await fs.readlink(file), resolved = await fs.realpath(file);
          if (path.isAbsolute(link) || !resolved.startsWith(item.root + path.sep))
            throw Error('Non-portable symbolic link in package ' + item.metadata.name);
        } else if (!stat.isFile() && !stat.isDirectory()) throw Error('Unsupported file in package ' + item.metadata.name);
        return true;
      } });
    };
    for (const name of files ?? ['.']) await copy(name);
    if (!registry) {
      // Equivalent to publish-time entry points. Keep the install's runtime metadata;
      // private manifest ranges never trigger a package manager on the target.
      const manifest = { ...item.metadata };
      for (const name of ['main', 'module', 'exports', 'types', 'bin', 'imports'] as const)
        if (item.metadata.publishConfig?.[name] !== undefined) Object.assign(manifest, { [name]: item.metadata.publishConfig[name] });
      // Dev-only metadata can include absolute developer links and does not belong in an artifact.
      for (const key of ['devDependencies', 'publishConfig', 'overrides', 'pnpm', 'packageManager'] as const) Reflect.deleteProperty(manifest, key);
      for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
        const deps = manifest[key]; if (!deps) continue;
        manifest[key] = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, version]) => {
          const child = item.dependencies.get(name);
          if (/^(?:workspace:|link:|file:|\/)/.test(version)) {
            if (child === undefined) throw Error('Cannot publish an unbound local dependency: ' + name);
            return [name, packages[child]!.metadata.version];
          }
          return [name, version];
        }));
      }
      await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
  }
  for (const [id, item] of packages.entries()) for (const [name, child] of item.dependencies) {
    const link = path.join(destinations[id]!, 'node_modules', name);
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(path.relative(path.dirname(link), destinations[child]!), link, 'dir');
  }
}
