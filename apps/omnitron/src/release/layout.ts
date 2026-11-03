/**
 * Resolve framework inputs from the project commit's pnpm lock. External
 * workspace links have to land on an isolated checkout at the same relative
 * path. Registry packages are pinned by the SHA-512 of their public archive.
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

type Dependency = { version: string };
type LockDocument = {
  importers?: Record<string, Record<string, Record<string, Dependency>>>;
  packages?: Record<string, { resolution?: { integrity?: string; tarball?: string; type?: string } }>;
  patchedDependencies?: Record<string, unknown>;
};
const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
export type RegistryPackage = { name: string; version: string; integrity: string };
type Link = { importer: string; name: string; rel: string };

function externalFile(importer: string, dependency: string) {
  const file = dependency.slice('file:'.length);
  const target = path.posix.normalize(path.posix.join(importer, file));
  return path.posix.isAbsolute(file) || file.includes('\\') || target === '..' || target.startsWith('../');
}

function readGraph(lockfile: string) {
  const links: Link[] = [], packages: RegistryPackage[] = [], importers: string[] = [];
  const localFramework: string[] = [];
  for (const document of parseAllDocuments(lockfile)) {
    if (document.errors.length) throw Error('Invalid pnpm-lock.yaml: ' + document.errors[0]!.message);
    const graph = document.toJS() as LockDocument | null;
    if (!graph?.importers) continue;
    for (const [importer, dependencies] of Object.entries(graph.importers)) {
      if (importer !== '.' && (path.posix.normalize(importer) !== importer || importer.startsWith('/') ||
          importer.split('/').includes('..') || importer.includes('\\'))) throw Error('Unsafe lockfile importer: ' + importer);
      importers.push(importer);
      for (const section of sections) for (const [name, entry] of Object.entries(dependencies[section] ?? {})) {
        if (typeof entry?.version !== 'string') throw Error('Unsupported pnpm lockfile dependency: ' + name);
        if (entry.version.startsWith('file:') && externalFile(importer, entry.version))
          throw Error('File dependency resolves outside the committed project: ' + name);
        if (entry.version.startsWith('link:')) links.push({ importer, name, rel: entry.version.slice(5) });
        if (name.startsWith('@omnitron-dev/') && /^(?:link:|file:|workspace:)/.test(entry.version)) localFramework.push(name);
      }
    }
    for (const [key, pkg] of Object.entries(graph.packages ?? {})) {
      const file = key.indexOf('@file:');
      if (file !== -1 && externalFile('.', key.slice(file + 1))) throw Error('File dependency resolves outside the committed project: ' + key);
      if (!key.startsWith('@omnitron-dev/')) continue;
      const match = /^(@omnitron-dev\/([a-z0-9][a-z0-9.-]*))@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/.exec(key);
      const resolution = pkg.resolution;
      if (!match || !resolution || typeof resolution.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(resolution.integrity) ||
          resolution.type || (resolution.tarball && resolution.tarball !== npmTarball(match[1]!, match[3]!))) {
        throw Error('Framework dependency must resolve to an exact public npm archive with SHA-512: ' + key);
      }
      packages.push({ name: match[1]!, version: match[3]!, integrity: resolution.integrity });
    }
    if (Object.keys(graph.patchedDependencies ?? {}).some(key => key.startsWith('@omnitron-dev/')))
      throw Error('Local patches of registry framework packages cannot be attested');
  }
  return { links, packages, importers: [...new Set(importers)], localFramework };
}

export function npmTarball(name: string, version: string): string {
  return 'https://registry.npmjs.org/' + name + '/-/' + name.split('/')[1] + '-' + version + '.tgz';
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
  | { kind: 'registry'; packages: RegistryPackage[]; importers: string[] };

export function readFrameworkLayout(lockfile: string): FrameworkLayout {
  const graph = readGraph(lockfile);
  const linked = layoutOf(graph.links);
  if (linked && 'refusal' in linked) throw Error(linked.refusal);
  if (linked && !graph.packages.length) return { kind: 'linked', layout: linked };
  if (linked || graph.localFramework.length) throw Error('Cannot combine local framework packages and npm release inputs');
  if (!graph.packages.some(pkg => pkg.name === '@omnitron-dev/omnitron'))
    throw Error('The lockfile must include @omnitron-dev/omnitron with a verifiable npm archive or checkout');
  const names = new Set(graph.packages.map(pkg => pkg.name));
  if (names.size !== graph.packages.length) throw Error('Multiple versions of the same framework package cannot identify one release');
  return { kind: 'registry', packages: graph.packages.sort((a, b) => a.name.localeCompare(b.name)), importers: graph.importers };
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
