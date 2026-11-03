/**
 * Resolve framework inputs from the project commit's pnpm lock. External
 * workspace links have to land on an isolated checkout at the same relative
 * path. Archive inputs pin the SHA-512 of either a configured registry tarball or
 * a regular file committed in the project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';

export interface LinkLayout {
  /** omni's checkout relative to the project root, as the lockfile implies it. */
  readonly omniRel: string;
  /** How many directories above the project root the links climb. */
  readonly climbs: number;
  /** The omni workspace directories the project links, relative to omni's root. */
  readonly linkedDirs: readonly string[];
}

type Dependency = { version: string; specifier?: string };
type LockDocument = {
  importers?: Record<string, Record<string, Record<string, Dependency>>>;
  snapshots?: Record<string, unknown>;
  packages?: Record<string, { version?: string; resolution?: { integrity?: string; tarball?: string; type?: string } }>;
  patchedDependencies?: Record<string, unknown>;
};
const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
export type RegistryPackage = { name: string; version: string; integrity: string; tarball?: string };
export type VendoredPackage = RegistryPackage & { file: string };
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/;

type FrameworkInput = { importer: string; name: string; dependency: Dependency };
type Link = { importer: string; name: string; rel: string };

function externalFile(importer: string, dependency: string) {
  const file = dependency.slice('file:'.length);
  const target = path.posix.normalize(path.posix.join(importer, file));
  return path.posix.isAbsolute(file) || file.includes('\\') || target === '..' || target.startsWith('../');
}

function readGraph(lockfile: string) {
  const links: Link[] = [], packages: RegistryPackage[] = [], importers: string[] = [];
  const vendored: VendoredPackage[] = [], frameworkInputs: FrameworkInput[] = [];
  const snapshots = new Set<string>();
  for (const document of parseAllDocuments(lockfile)) {
    if (document.errors.length) throw Error('Invalid pnpm-lock.yaml: ' + document.errors[0]!.message);
    const graph = document.toJS() as LockDocument | null;
    if (!graph) continue;
    for (const key of Object.keys(graph.snapshots ?? {})) {
      if (key.startsWith('@omnitron-dev/')) snapshots.add(key);
    }
    for (const [importer, dependencies] of Object.entries(graph.importers ?? {})) {
      if (importer !== '.' && (path.posix.normalize(importer) !== importer || importer.startsWith('/') ||
          importer.split('/').includes('..') || importer.includes('\\'))) throw Error('Unsafe lockfile importer: ' + importer);
      importers.push(importer);
      for (const section of sections) for (const [name, entry] of Object.entries(dependencies[section] ?? {})) {
        if (typeof entry?.version !== 'string') throw Error('Unsupported pnpm lockfile dependency: ' + name);
        if (entry.version.startsWith('file:') && externalFile(importer, entry.version))
          throw Error('File dependency resolves outside the committed project: ' + name);
        if (entry.version.startsWith('link:')) links.push({ importer, name, rel: entry.version.slice(5) });
        if (name.startsWith('@omnitron-dev/')) frameworkInputs.push({ importer, name, dependency: entry });
      }
    }
    for (const [key, pkg] of Object.entries(graph.packages ?? {})) {
      const filePrefix = key.indexOf('@file:');
      if (filePrefix !== -1 && externalFile('.', key.slice(filePrefix + 1))) throw Error('File dependency resolves outside the committed project: ' + key);
      if (!key.startsWith('@omnitron-dev/')) continue;
      const match = /^(@omnitron-dev\/[a-z0-9][a-z0-9._-]*)@(.+)$/.exec(key);
      const resolution = pkg.resolution;
      if (!match || !resolution || typeof resolution.integrity !== 'string' || !INTEGRITY.test(resolution.integrity) || resolution.type)
        throw Error('Framework dependency requires an exact archive with SHA-512: ' + key);
      const name = match[1]!, locator = match[2]!, integrity = resolution.integrity;
      if (locator.startsWith('file:')) {
        const file = locator.slice(5);
        if (!file.endsWith('.tgz') || !file.split('/').every(part => /^[A-Za-z0-9_@.-]+$/.test(part) && part !== '.' && part !== '..')) {
          throw Error('Unsafe committed framework archive path: ' + file);
        }
        if (resolution.tarball !== locator || Object.keys(resolution).some(field => field !== 'tarball' && field !== 'integrity') ||
            typeof pkg.version !== 'string' || !VERSION.test(pkg.version)) {
          throw Error('Vendored framework package requires a matching file tarball and an exact version: ' + key);
        }
        vendored.push({ name, version: pkg.version, file, integrity });
      } else {
        if (!VERSION.test(locator)) {
          throw Error('Framework dependency must resolve to an exact registry archive with SHA-512: ' + name);
        }
        if (resolution.tarball !== undefined) {
          let url: URL;
          try { url = new URL(resolution.tarball); } catch { throw Error('Invalid locked framework archive URL: ' + name); }
          // Credentials belong to pnpm's operator auth configuration, never to
          // a committed lockfile or the public release source receipt.
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
              resolution.tarball.length > 8192)
            throw Error('Locked framework archive URL must be credential-free HTTP(S): ' + name);
        }
        packages.push({ name, version: locator, integrity, ...(resolution.tarball === undefined ? {} : { tarball: resolution.tarball }) });
      }
    }
    if (Object.keys(graph.patchedDependencies ?? {}).some(key => key.startsWith('@omnitron-dev/')))
      throw Error('Local patches of framework packages cannot be attested');
  }
  return { links, packages, vendored, frameworkInputs, snapshots, importers: [...new Set(importers)] };
}

/**
 * Read the layout the lockfile implies, or say why there is none.
 *
 * A link that leaves the project root is an omni link; its target minus the
 * trailing `packages/<name>` or `apps/<name>` is omni's root. All of them
 * must agree on that root: links into two outside checkouts cannot be laid
 * out by one clone, and guessing which one is "omni" would build from the
 * wrong one.
 */
function layoutOf(links: Link[]): LinkLayout | { refusal: string } | null {
  const roots = new Set<string>();
  const dirs = new Set<string>();
  const strays: string[] = [];
  for (const { importer, name, rel } of links) {
    if (path.posix.isAbsolute(rel) || rel.includes('\\')) return { refusal: 'nonportable lockfile link: ' + rel };
    const target = path.posix.normalize(path.posix.join(importer === '.' ? '' : importer, rel));
    if (target !== '..' && !target.startsWith('../')) continue; // inside the project: its own workspace
    const parts = target.split('/');
    const kind = parts[parts.length - 2];
    if (!name.startsWith('@omnitron-dev/') || parts.length < 3 || (kind !== 'packages' && kind !== 'apps')) {
      strays.push(target);
      continue;
    }
    roots.add(parts.slice(0, -2).join('/'));
    dirs.add(parts.slice(-2).join('/'));
  }
  if (strays.length > 0) {
    return { refusal: `the lockfile links outside the project to something that is not a workspace package: ${strays.slice(0, 3).join(', ')}` };
  }
  if (roots.size === 0) return null;
  if (roots.size > 1) {
    return { refusal: `the lockfile links into ${roots.size} outside checkouts (${[...roots].join(', ')}) — one clone cannot stand in for them` };
  }
  const omniRel = [...roots][0]!;
  const climbs = omniRel.split('/').filter((p) => p === '..').length;
  return { omniRel, climbs, linkedDirs: [...dirs].sort() };
}

/** Compatibility API for projects which explicitly reproduce a linked checkout. */
export function readLinkLayout(lockfile: string): LinkLayout | { refusal: string } {
  try {
    return layoutOf(readGraph(lockfile).links) ?? { refusal: 'the lockfile links nothing outside the project — there is no omni checkout to lay out' };
  } catch (error) { return { refusal: (error as Error).message }; }
}

export type FrameworkLayout =
  | { kind: 'linked'; layout: LinkLayout }
  | { kind: 'registry'; packages: RegistryPackage[]; importers: string[] }
  | { kind: 'vendored'; packages: VendoredPackage[]; importers: string[] };

export function readFrameworkLayout(lockfile: string): FrameworkLayout {
  const graph = readGraph(lockfile);
  const linked = layoutOf(graph.links);
  if (linked && 'refusal' in linked) throw Error(linked.refusal);
  if (graph.vendored.length) {
    if (linked || graph.packages.length) throw Error('Cannot combine local framework archives with a linked checkout or npm release inputs');
    if (new Set(graph.vendored.map(pkg => pkg.file)).size !== graph.vendored.length)
      throw Error('A committed framework archive must identify a single package');
    const byName = new Map(graph.vendored.map(pkg => [pkg.name, pkg]));
    for (const { importer, name, dependency } of graph.frameworkInputs) {
      const pkg = byName.get(name);
      const suffix = dependency.version.indexOf('(');
      const base = suffix === -1 ? dependency.version : dependency.version.slice(0, suffix);
      if (!pkg || base !== 'file:' + pkg.file || (suffix !== -1 && !graph.snapshots.has(name + '@' + dependency.version)))
        throw Error('Framework importer must resolve to its committed archive and exact peer snapshot: ' + importer + ' / ' + name);
      if (dependency.specifier?.startsWith('file:') && dependency.specifier.slice(5) !== path.posix.relative(importer, pkg.file))
        throw Error('Importer file specifier differs from its committed framework archive: ' + importer + ' / ' + name);
    }
  } else {
    if (linked && !graph.packages.length && !graph.frameworkInputs.some(input => input.dependency.version.startsWith('file:')))
      return { kind: 'linked', layout: linked };
    if (linked || graph.frameworkInputs.some(input => /^(?:link:|file:|workspace:)/.test(input.dependency.version)))
      throw Error('Cannot combine local framework packages and npm release inputs');
  }
  const archives = graph.vendored.length ? graph.vendored : graph.packages;
  if (!archives.some(pkg => pkg.name === '@omnitron-dev/omnitron'))
    throw Error('The lockfile must include @omnitron-dev/omnitron with a verifiable archive or checkout');
  if (new Set(archives.map(pkg => pkg.name)).size !== archives.length)
    throw Error('Multiple versions of the same framework package cannot identify one release');
  const byName = (a: RegistryPackage, b: RegistryPackage) => a.name.localeCompare(b.name);
  return graph.vendored.length
    ? { kind: 'vendored', packages: graph.vendored.sort(byName), importers: graph.importers }
    : { kind: 'registry', packages: graph.packages.sort(byName), importers: graph.importers };
}

/** Lay out complete checkouts while preserving the registered project's location inside Git. */
export function planBuildRoot(
  srcRoot: string,
  projectPath: string,
  layout: LinkLayout | undefined,
  repositoryPath = projectPath,
): { repositoryDir: string; projectDir: string; omniDir: string | null } | { refusal: string } {
  const subdirectory = path.relative(repositoryPath, projectPath);
  if (subdirectory === '..' || subdirectory.startsWith('..' + path.sep) || path.isAbsolute(subdirectory)) {
    return { refusal: `project ${projectPath} is outside its Git checkout ${repositoryPath}` };
  }
  if (!layout) {
    const repositoryDir = path.join(srcRoot, 'project');
    return { repositoryDir, projectDir: path.join(repositoryDir, subdirectory), omniDir: null };
  }

  const segments = path.resolve(projectPath).split(path.sep).filter(Boolean);
  if (layout.climbs < 1 || layout.climbs > segments.length) {
    return { refusal: `the links climb ${layout.climbs} directories above a project at ${projectPath}` };
  }
  const prefixDepth = subdirectory.split(path.sep).filter(Boolean).length;
  const retained = Math.max(layout.climbs, prefixDepth + 1);
  const projectDir = path.join(srcRoot, ...segments.slice(-retained));
  const repositoryDir = path.resolve(projectDir, path.relative(projectPath, repositoryPath));
  const omniDir = path.resolve(projectDir, layout.omniRel);
  if (!omniDir.startsWith(path.resolve(srcRoot) + path.sep)) {
    return { refusal: `omni would land at ${omniDir}, outside the build root ${srcRoot}` };
  }
  if (omniDir === repositoryDir || omniDir.startsWith(repositoryDir + path.sep) || repositoryDir.startsWith(omniDir + path.sep)) {
    return { refusal: 'project and framework need separate Git checkouts in the build root' };
  }
  return { repositoryDir, projectDir, omniDir };
}

/**
 * The project's real directory and the omni checkout its links point to.
 *
 * From the REAL path, because that is where pnpm resolves a relative link
 * from. The registry holds `omni/internal/sample`, a symlink to
 * `~/projects/examples/sample`; resolved from the symlink, `../../luxquant/…` named
 * a directory that does not exist, and the first `git` run there failed with
 * a bare `spawn git ENOENT`.
 */
export function resolveCheckouts(projectPath: string, layout: LinkLayout): { projectReal: string; omniPath: string } {
  const projectReal = fs.realpathSync(projectPath);
  return { projectReal, omniPath: path.resolve(projectReal, layout.omniRel) };
}
