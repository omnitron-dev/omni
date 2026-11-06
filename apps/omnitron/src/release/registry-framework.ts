import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sha256File } from './portable-archive.js';
import { list } from 'tar';
import { parseBuildStamp } from '../shared/build-stamp.js';
import type { RegistryPackage } from './layout.js';
import type { ReleaseSource } from './manifest.js';
import { parseFrameworkSource, type FrameworkSource } from '../shared/framework-source.js';
import { checkoutFrameworkSource, defaultFrameworkSource, frameworkRepositoryLocation, type FrameworkStep } from './framework-source.js';
import { sourcePublication } from './source.js';
import { withRegistryArchive, type RegistryTransportOptions } from './registry-transport.js';
import { resolveInstalledDependency } from './package-resolution.js';

const CORE = '@omnitron-dev/omnitron';
const SHA = /^[a-f0-9]{40}$/;
type FileEvidence = { digest: string; size: number; executable: boolean };
type ArchiveNode = { files: Map<string, FileEvidence>; dependencies: Map<string, string> };
type PackageEvidence = { commit: string; files: Map<string, FileEvidence>; nodes: Map<string, ArchiveNode>; repository?: unknown };
type PackageManifest = {
  name: string; version: string; gitHead?: string; bin?: string | Record<string, string>; repository?: unknown;
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean; bundleDependencies?: string[] | boolean;
};
const packageName = (name: string) => /^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) &&
  name.split('/').every(part => !part.startsWith('.'));

/** Standard npm bundle placement. Code directories cannot introduce a second
 * dependency installation hidden below a package's publication surface. */
function archiveSurface(relative: string): { directory: string; file: string; name?: string } {
  const parts = relative.split('/');
  let end = 0, name: string | undefined;
  while (parts[end] === 'node_modules') {
    const first = parts[++end];
    name = first?.startsWith('@') ? first + '/' + parts[++end] : first;
    if (!name || !packageName(name)) throw Error('Invalid bundled package path: ' + relative);
    end++;
  }
  const file = parts.slice(end).join('/');
  if (!file || parts.slice(end).includes('node_modules')) throw Error('Invalid bundled package surface: ' + relative);
  return { directory: parts.slice(0, end).join('/'), file, ...(name && { name }) };
}

function archiveManifest(bytes: Buffer | undefined, label: string): PackageManifest {
  const value = JSON.parse(bytes?.toString('utf8') ?? '{}') as PackageManifest;
  if (!value || typeof value.name !== 'string' || !packageName(value.name) || typeof value.version !== 'string' || !value.version)
    throw Error('Missing or invalid package metadata: ' + label);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const dependencies = value[field];
    if (dependencies !== undefined && (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies) ||
        Object.entries(dependencies).some(([name, range]) => !packageName(name) || typeof range !== 'string')))
      throw Error('Invalid package dependency metadata: ' + label);
  }
  return value;
}

/** Bind each included package to a declared edge, retaining npm's hoisted or
 * nested resolution. The same edges can later point into a portable closure. */
function archiveNodes(files: Map<string, FileEvidence>, records: Map<string, Buffer>, metadata: PackageManifest): Map<string, ArchiveNode> {
  const nodes = new Map<string, ArchiveNode>();
  const manifests = new Map<string, PackageManifest>([['', metadata]]);
  for (const [relative, evidence] of files) {
    const { directory, file, name } = archiveSurface(relative);
    if (!nodes.has(directory)) {
      nodes.set(directory, { files: new Map(), dependencies: new Map() });
      if (directory) {
        if (nodes.size > 4096) throw Error('Bundled graph exceeds 4096 packages');
        const manifest = archiveManifest(records.get(directory + '/package.json'), directory);
        if (manifest.name !== name) throw Error('Bundled package identity differs from its path: ' + directory);
        manifests.set(directory, manifest);
      }
    }
    nodes.get(directory)!.files.set(file, evidence);
  }
  const declaration = metadata.bundledDependencies ?? metadata.bundleDependencies ?? [];
  if (metadata.bundledDependencies !== undefined && metadata.bundleDependencies !== undefined)
    throw Error('Use only one bundled dependency declaration');
  const declared = declaration === true ? Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies })
    : declaration === false ? [] : declaration;
  if (!Array.isArray(declared) || new Set(declared).size !== declared.length || declared.some(name =>
    typeof name !== 'string' || !packageName(name) ||
    !Object.hasOwn({ ...metadata.dependencies, ...metadata.optionalDependencies }, name)))
    throw Error('Invalid bundled dependency declaration');
  const resolve = (directory: string, name: string): string | undefined => {
    let current = directory || '.';
    while (true) {
      const candidate = path.posix.join(current, 'node_modules', name);
      if (path.posix.basename(current) !== 'node_modules' && nodes.has(candidate)) return candidate;
      const parent = path.posix.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  };
  const visited = new Set<string>();
  const visit = (directory: string, names: string[]) => {
    visited.add(directory);
    for (const name of names) {
      const target = resolve(directory, name);
      if (target === undefined) {
        if (!directory) throw Error('Declared bundled dependency is missing: ' + name);
        continue; // An unbundled dependency remains part of the installed graph.
      }
      nodes.get(directory)!.dependencies.set(name, target);
      if (visited.has(target)) continue;
      const manifest = manifests.get(target)!;
      visit(target, Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }));
    }
  };
  visit('', declared);
  if (visited.size !== nodes.size) throw Error('Archive contains an undeclared bundled package');
  // npm and pnpm mark declared binaries executable during installation.
  for (const [directory, manifest] of manifests) {
    const bins = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
    for (const bin of bins) {
      if (typeof bin !== 'string') throw Error('Invalid package binary metadata: ' + directory);
      const file = nodes.get(directory)!.files.get(bin.replace(/^\.\//, ''));
      if (file) file.executable = true;
    }
  }
  return nodes;
}
export interface RegistryFramework {
  source: ReleaseSource;
  verifyPackage(name: string, directory: string): Promise<void>;
}

function limitedBytes(maximum: number, digest?: ReturnType<typeof createHash>) {
  let total = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, next) {
    total += chunk.length;
    if (total > maximum) next(Error('Framework archive exceeds the byte limit'));
    else { digest?.update(chunk); next(null, chunk); }
  } });
}

/** Hash the compressed archive as received. Stream its contents without
 * extracting paths to disk or executing package lifecycle scripts. */
async function registryArchive(pkg: RegistryPackage, options: RegistryTransportOptions): Promise<PackageEvidence> {
  return withRegistryArchive(pkg, options, (input, signal) => inspectFrameworkArchive(pkg, input, signal));
}

/** Compare the exact compressed bytes and record the installed file tree. A
 * reproduced commit is supplied only after building a clean upstream checkout. */
export async function inspectFrameworkArchive(
  pkg: RegistryPackage, input: Readable, signal?: AbortSignal, reproducedCommit?: string,
): Promise<PackageEvidence> {
  const label = pkg.name + '@' + pkg.version;
  const archiveHash = createHash('sha512');
  const files = new Map<string, FileEvidence>();
  const records = new Map<string, Buffer>();
  const seen = new Set<string>();
  const tar = list({ strict: true, onReadEntry(entry) {
    if (entry.type === 'Directory') return;
    const relative = entry.path.slice('package/'.length);
    if (entry.type !== 'File' || !entry.path.startsWith('package/') || relative.includes('\\') ||
        relative.split('/').some(part => !part || part === '.' || part === '..') ||
        seen.has(relative) || seen.size >= 50_000) {
      tar.abort(Error('Unexpected or duplicate npm archive entry in ' + label + ': ' + entry.path)); return;
    }
    seen.add(relative);
    let surface: ReturnType<typeof archiveSurface>;
    try { surface = archiveSurface(relative); }
    catch (error) { tar.abort(error as Error); return; }
    const hash = createHash('sha256');
    const metadataEntry = surface.file === 'package.json' || relative === 'dist/BUILD.json';
    if (metadataEntry && entry.size > 1024 * 1024) { tar.abort(Error('Oversized package metadata: ' + label)); return; }
    const chunks: Buffer[] = [];
    entry.on('data', (chunk: Buffer) => { hash.update(chunk); if (metadataEntry) chunks.push(chunk); });
    entry.on('end', () => {
      files.set(relative, { digest: hash.digest('hex'), size: entry.size, executable: Boolean((entry.mode ?? 0) & 0o111) });
      if (metadataEntry) records.set(relative, Buffer.concat(chunks));
    });
  } });
  await pipeline(input, limitedBytes(64 * 1024 * 1024, archiveHash), createGunzip(),
    limitedBytes(256 * 1024 * 1024), tar, { signal });
  if ('sha512-' + archiveHash.digest('base64') !== pkg.integrity) throw Error('Framework archive differs from the committed SHA-512: ' + label);
  const metadata = archiveManifest(records.get('package.json'), label);
  if (metadata?.name !== pkg.name || metadata.version !== pkg.version)
    throw Error('Framework archive name or version differs from the lockfile: ' + label);
  const commit = reproducedCommit ?? metadata.gitHead;
  if (typeof commit !== 'string' || !SHA.test(commit))
    throw Error('No exact source commit in the npm archive for ' + label + '; use a release with a packed gitHead or a linked checkout');
  if (metadata.gitHead !== undefined && metadata.gitHead !== commit)
    throw Error('Framework archive names a different Git commit: ' + label);
  if (pkg.name === CORE) {
    const stamp = parseBuildStamp(JSON.parse(records.get('dist/BUILD.json')?.toString('utf8') ?? 'null'));
    if (stamp?.commit !== commit || stamp.dirty !== false || stamp.timeBasis !== 'source')
      throw Error('The Omnitron build stamp does not confirm its clean release commit: ' + label);
  }
  const nodes = archiveNodes(files, records, metadata);
  return { commit, files, nodes, ...(metadata.repository !== undefined && { repository: metadata.repository }) };
}

/** Compare real files in the installation or staged artifact with the archive.
 * Its node_modules edges are checked separately by the closure graph. */
async function verifyTree(root: string, files: Map<string, FileEvidence>): Promise<void> {
  let count = 0;
  async function visit(subdir: string) {
    for (const item of await fs.readdir(path.join(root, subdir), { withFileTypes: true })) {
      if (!subdir && item.name === 'node_modules') continue;
      const name = path.posix.join(subdir, item.name);
      if (item.isDirectory()) { await visit(name); continue; }
      const expected = files.get(name), location = path.join(root, name);
      const stat = await fs.lstat(location);
      if (!stat.isFile() || !expected || stat.size !== expected.size ||
          (process.platform !== 'win32' && Boolean(stat.mode & 0o111) !== expected.executable) ||
          await sha256File(location) !== expected.digest)
        throw Error('Installed framework file differs from its verified archive: ' + location);
      count++;
    }
  }
  await visit('');
  if (count !== files.size) throw Error('Installed framework is missing files from its verified archive: ' + root);
}

export interface RegistryFrameworkOptions extends RegistryTransportOptions {
  readonly requestedCommit?: string;
  readonly frameworkSource?: FrameworkSource;
  readonly sourceBase: string;
  readonly run: FrameworkStep;
  readonly sourcePhase?: (source: FrameworkSource, commit: string) => void;
}

export async function resolveRegistryFramework(packages: RegistryPackage[], options: RegistryFrameworkOptions): Promise<RegistryFramework> {
  const verified = new Map<string, PackageEvidence>();
  let commit: string | undefined;
  for (const pkg of packages) {
    const archive = await registryArchive(pkg, options);
    if (commit && archive.commit !== commit) throw Error('Registry framework packages were built from different commits: ' + pkg.name);
    commit = archive.commit;
    verified.set(pkg.name, archive);
  }
  if (!commit || !verified.has(CORE)) throw Error('The lockfile lacks an attested Omnitron package');
  if (options.requestedCommit !== undefined && options.requestedCommit !== commit) throw Error('--omni-commit must match the full registry source commit ' + commit);
  const selected = options.frameworkSource !== undefined ? parseFrameworkSource(options.frameworkSource) : defaultFrameworkSource(verified.get(CORE)!.repository);
  options.sourcePhase?.(selected, commit);
  let source: ReleaseSource;
  if (selected.ref) {
    source = await checkoutFrameworkSource(path.join(options.scratch, 'source-proof'), {
      source: selected, commit, sourceBase: options.sourceBase, env: options.env, run: options.run,
      ...(options.signal && { signal: options.signal }),
    });
  } else {
    source = { repo: selected.repository, commit, onRemote: await sourcePublication(options.checkout,
      frameworkRepositoryLocation(selected.repository, options.sourceBase), commit, { ...(options.signal && { signal: options.signal }) }) };
  }
  return verifiedFramework({ ...source, registry: { packages } }, verified);
}

export function verifiedFramework(source: ReleaseSource, verified: ReadonlyMap<string, PackageEvidence>): RegistryFramework {
  return {
    source,
    async verifyPackage(name, directory) {
      const evidence = verified.get(name);
      if (!evidence) throw Error('Framework package is absent from the verified framework lock: ' + name);
      const visited = new Set<string>();
      const verify = async (installed: string, packed: string): Promise<void> => {
        const real = await fs.realpath(installed), identity = packed + '\0' + real;
        if (visited.has(identity)) return;
        visited.add(identity);
        const node = evidence.nodes.get(packed)!;
        await verifyTree(real, node.files);
        for (const [dependency, target] of node.dependencies) {
          const resolved = await resolveInstalledDependency(real, dependency);
          if (!resolved) throw Error('Installed bundled dependency is missing: ' + dependency);
          await verify(resolved, target);
        }
      };
      await verify(directory, '');
    },
  };
}
