import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readFrameworkLayout, type VendoredPackage } from './layout.js';
import { verifyCommittedArchive } from './vendored-framework.js';
import { inspectFrameworkContents, verifyFrameworkPackageFiles } from './registry-framework.js';
import { installedGraph, requiresInstalledDependency, type InstalledPackage } from './installed-graph.js';
import { resolveInstalledDependency } from './package-resolution.js';

interface SdkImporter {
  directory: string;
  manifest: {
    dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
}

type DependencyMap<T> = {
  dependencies?: Record<string, T>;
  optionalDependencies?: Record<string, T>;
  devDependencies?: Record<string, T>;
};
interface SdkLock {
  importers: Record<string, DependencyMap<{ version: string }>>;
  packages: Record<string, { name?: string; version?: string }>;
  snapshots: Record<string, DependencyMap<string>>;
}

/** Follow the peer snapshot selected by each importer through the actual Node
 * resolutions. An installed lock receipt alone cannot detect a redirected link. */
function verifySnapshotBindings(graph: InstalledPackage[], roots: { directory: string; name: string; ref: string }[], lock: SdkLock) {
  const ids = new Map(graph.map((node, id) => [node.root, id]));
  const visited = new Set<string>();
  function visit(id: number, name: string, ref: string) {
    // Workspace links have their own importers and can omit a package version.
    if (ref.startsWith('link:')) {
      if (graph[id]!.metadata.name.startsWith('@omnitron-dev/')) throw Error('A framework dependency must resolve to its committed archive: ' + name);
      return;
    }
    const key = Object.hasOwn(lock.snapshots, name + '@' + ref) ? name + '@' + ref : ref.replace(/^npm:/, '');
    const pair = id + '\0' + key;
    if (visited.has(pair)) return;
    visited.add(pair);
    const node = graph[id]!, locator = key.split('(')[0]!, snapshot = lock.snapshots[key];
    const pkg = lock.packages[locator], prefix = node.metadata.name + '@';
    if (!pkg || !snapshot || !(locator.startsWith(prefix) || pkg.name === node.metadata.name) ||
        (pkg.version ?? locator.slice(prefix.length)) !== node.metadata.version)
      throw Error('Installed dependency differs from its committed snapshot: ' + name + ' → ' + ref);
    for (const [dependency, target] of node.dependencies) {
      const next = snapshot.optionalDependencies?.[dependency] ?? snapshot.dependencies?.[dependency];
      // Bundled files have their own archive proof. Optional peers can be
      // present through hoisting even when pnpm did not lock a binding here.
      if (next !== undefined) visit(target, dependency, next);
    }
  }
  for (const { directory, name, ref } of roots) visit(ids.get(directory)!, name, ref);
}

async function verifyWorkingArchive(root: string, pkg: VendoredPackage, size: number) {
  const file = path.join(root, pkg.file);
  if (await fs.realpath(file) !== file || !(await fs.lstat(file)).isFile())
    throw Error('The working SDK archive must be a physical regular file: ' + pkg.file);
  const input = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await input.stat();
    if (stat.isFile() && stat.size === size) {
      const hash = createHash('sha512');
      let read = 0;
      for await (const chunk of input.createReadStream({ end: size })) {
        read += chunk.length;
        hash.update(chunk);
      }
      if (read === size && 'sha512-' + hash.digest('base64') === pkg.integrity) return;
    }
    throw Error('The working SDK archive differs from its committed Git blob: ' + pkg.file);
  } finally { await input.close(); }
}

/** A local SDK inspection trusts the committed consumer lock and archives. The
 * release producer separately reproduces those bytes from the upstream commit. */
export async function inspectVendoredSdk(root: string, distribution: string, projectCommit: string) {
  const layout = readFrameworkLayout(distribution, { requireCore: false });
  if (layout.kind !== 'vendored') throw Error('The project requires committed vendored SDK archives');
  const verified = new Map<string, Awaited<ReturnType<typeof inspectFrameworkContents>>>();
  const revisions = new Set<string>();
  const sizes = new Map<string, number>();
  for (const pkg of layout.packages) {
    const bytes = await verifyCommittedArchive(root, projectCommit, pkg);
    sizes.set(pkg.name, bytes.length);
    await verifyWorkingArchive(root, pkg, bytes.length);
    const evidence = await inspectFrameworkContents(pkg, Readable.from(bytes));
    if (evidence.stamp) revisions.add(evidence.stamp.commit);
    if (evidence.metadata.gitHead !== undefined) revisions.add(evidence.metadata.gitHead);
    verified.set(pkg.name, evidence);
  }
  if (revisions.size > 1 || [...revisions].some(value => !/^[a-f0-9]{40}$/.test(value)))
    throw Error('The committed framework archives disagree about their SDK source revision');

  return {
    projectCommit, frameworkCommit: [...revisions][0],
    async verifyWorkingArchives() {
      for (const pkg of layout.packages) await verifyWorkingArchive(root, pkg, sizes.get(pkg.name)!);
    },
    async verifyInstallation(importers: SdkImporter[], allowedModules: string[], lock: SdkLock) {
      const workspaces = new Set(importers.map(importer => importer.directory)), roots = new Set<string>();
      const bindings: { directory: string; name: string; ref: string }[] = [];
      for (const { directory, manifest } of importers) {
        const importer = lock.importers[path.relative(root, directory).split(path.sep).join('/') || '.']!;
        const locked = { ...importer.dependencies, ...importer.optionalDependencies, ...importer.devDependencies };
        const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies, ...manifest.devDependencies };
        for (const name of Object.keys(declared)) {
          const location = await resolveInstalledDependency(directory, name);
          if (!location) {
            if (requiresInstalledDependency(manifest, name)) throw Error('Missing installed dependency: ' + directory + ' → ' + name);
            continue;
          }
          const real = await fs.realpath(location);
          if (workspaces.has(real)) continue;
          roots.add(real);
          if (locked[name]) bindings.push({ directory: real, name, ref: locked[name].version });
        }
      }
      const graph = await installedGraph([...roots], undefined, [root, ...allowedModules]);
      verifySnapshotBindings(graph, bindings, lock);
      for (const node of graph) {
        for (const [name, target] of node.dependencies) {
          if (name.startsWith('@omnitron-dev/') && graph[target]!.metadata.name !== name)
            throw Error('Installed dependency resolves to a different framework package: ' + name);
        }
        const name = node.metadata.name;
        if (!name.startsWith('@omnitron-dev/')) continue;
        if (!allowedModules.some(base => node.root.startsWith(base + path.sep)))
          throw Error('Installed framework dependency escapes the pnpm installation: ' + name);
        const evidence = verified.get(name);
        if (!evidence) throw Error('Installed framework package is absent from the committed SDK lock: ' + name);
        await verifyFrameworkPackageFiles(evidence, node.root);
      }
    },
  };
}
