import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { parseAllDocuments } from 'yaml';
import { readFrameworkLayout, type VendoredPackage } from '../release/layout.js';
import type { ReleaseManifest } from '../release/manifest.js';
import { verifyCommittedArchive } from '../release/vendored-framework.js';

type Source = { manifest: ReleaseManifest; root: string };
type GitEntry = { mode: string; oid: string };
type Archive = VendoredPackage & { sha256: string };
type Swap = { from: Archive; to: Archive };
type Fields = Record<string, unknown>;

const exec = promisify(execFile);
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const fields = (value: unknown): value is Fields => !!value && typeof value === 'object' && !Array.isArray(value);

async function git(root: string, ...args: string[]) {
  return (await exec('git', ['--no-replace-objects', ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })).stdout;
}

async function tree(source: Source): Promise<Map<string, GitEntry>> {
  const listing = await git(source.root, 'ls-tree', '-rz', '--full-tree', source.manifest.project.commit);
  const result = new Map<string, GitEntry>();
  for (const line of new TextDecoder('utf-8', { fatal: true }).decode(listing).split('\0').filter(Boolean)) {
    const tab = line.indexOf('\t'), [mode, , oid] = line.slice(0, tab).split(' ');
    result.set(line.slice(tab + 1), { mode: mode!, oid: oid! });
  }
  return result;
}

function blob(source: Source, entry?: GitEntry): Promise<string> {
  if (entry?.mode !== '100644') throw Error('SDK metadata must be a committed, non-executable regular file');
  return git(source.root, 'cat-file', 'blob', entry.oid).then(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function archives(source: Source, entries: Map<string, GitEntry>) {
  const reproduced = source.manifest.omni.reproduced;
  if (!reproduced || source.manifest.omni.registry || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(reproduced.tree))
    throw Error('A reproduced vendored SDK is required for differing project inputs');
  const lock = await blob(source, entries.get('pnpm-lock.yaml'));
  const layout = readFrameworkLayout(lock);
  if (layout.kind !== 'vendored' || !isDeepStrictEqual(layout.packages,
    [...reproduced.packages].sort((a, b) => a.name.localeCompare(b.name))))
    throw Error('Vendored SDK release provenance differs from the committed lockfile');
  const result = new Map<string, Archive>();
  for (const pkg of layout.packages) {
    if (entries.get(pkg.file)?.mode !== '100644') throw Error('Unsafe SDK archive mode: ' + pkg.file);
    const bytes = await verifyCommittedArchive(source.root, source.manifest.project.commit, pkg);
    result.set(pkg.name, { ...pkg, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return result;
}

function yaml(text: string): unknown[] {
  return parseAllDocuments(text).map(doc => {
    if (doc.errors.length) throw Error('Invalid SDK consumer YAML');
    return doc.toJS();
  });
}

function swapBindings(bindings: unknown, swaps: Swap[], dir: string, peerVersions = false) {
  if (!fields(bindings)) return;
  for (const { from, to } of swaps) {
    if (bindings[from.name] === 'file:' + path.posix.relative(dir, from.file))
      bindings[from.name] = 'file:' + path.posix.relative(dir, to.file);
    else if (peerVersions && bindings[from.name] === from.version) bindings[from.name] = to.version;
  }
}

/** pnpm embeds archive locators in peer-qualified snapshot keys and values. Translate
 * whole locators only, leaving the rest of the graph (including every peer) intact. */
function swapLocator(value: string, swaps: Swap[]) {
  const targets = new Map(swaps.map(({ from, to }) => [from.file, to.file]));
  return value.replace(/file:([^()\s]+)(?=[()]|$)/g, (original, file: string) =>
    targets.has(file) ? 'file:' + targets.get(file) : original);
}

function expectedLock(text: string, swaps: Swap[]): unknown[] {
  const docs = yaml(text);
  for (const doc of docs) {
    if (!fields(doc)) throw Error('Invalid SDK consumer lockfile');
    swapBindings(doc['overrides'], swaps, '.');
    if (fields(doc['importers'])) for (const [dir, importer] of Object.entries(doc['importers'])) {
      if (!fields(importer)) throw Error('Invalid pnpm importer');
      for (const section of sections) {
        const dependencies = importer[section];
        if (!fields(dependencies)) continue;
        for (const [name, dep] of Object.entries(dependencies)) {
          if (!fields(dep) || typeof dep['version'] !== 'string') throw Error('Invalid locked dependency');
          const swap = swaps.find(s => s.from.name === name);
          if (swap && dep['specifier'] === 'file:' + path.posix.relative(dir, swap.from.file))
            dep['specifier'] = 'file:' + path.posix.relative(dir, swap.to.file);
          dep['version'] = swapLocator(dep['version'], swaps);
        }
      }
    }
    for (const section of ['packages', 'snapshots']) {
      const graph = doc[section];
      if (!fields(graph)) continue;
      const next = new Map<string, unknown>();
      for (const [key, entry] of Object.entries(graph)) {
        if (!fields(entry)) throw Error('Invalid pnpm graph entry: ' + key);
        const translated = swapLocator(key, swaps);
        if (next.has(translated)) throw Error('Ambiguous pnpm graph key: ' + translated);
        const swap = swaps.find(s => key === s.from.name + '@file:' + s.from.file);
        if (section === 'packages' && swap) {
          entry['version'] = swap.to.version;
          entry['resolution'] = { tarball: 'file:' + swap.to.file, integrity: swap.to.integrity };
          swapBindings(entry['peerDependencies'], swaps, '.', true);
        }
        if (section === 'snapshots') for (const field of ['dependencies', 'optionalDependencies']) {
          const deps = entry[field];
          if (fields(deps)) for (const [name, locator] of Object.entries(deps))
            if (typeof locator === 'string') deps[name] = swapLocator(locator, swaps);
        }
        next.set(translated, entry);
      }
      doc[section] = Object.fromEntries(next);
    }
  }
  return docs;
}

function vendorIndex(text: string, which: 'from' | 'to', swaps: Swap[], commit: string, file: string) {
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length !== swaps.length) throw Error('Invalid vendor package index');
  const result = new Map<string, Fields>();
  for (const row of rows) {
    if (!fields(row) || typeof row['name'] !== 'string' || result.has(row['name'])) throw Error('Invalid vendor package row');
    const pkg = swaps.find(s => s[which].name === row['name'])?.[which];
    if (!pkg || row['sourceRevision'] !== commit || row['sourceDirty'] !== false || row['version'] !== pkg.version ||
        row['sha256'] !== pkg.sha256 || row['integrity'] !== pkg.integrity ||
        row['filename'] !== path.posix.basename(pkg.file) || path.posix.dirname(pkg.file) !== path.posix.dirname(file))
      throw Error('Vendor index is inconsistent with reproduced archive: ' + row['name']);
    const metadata = { ...row };
    for (const field of ['sourceRevision', 'version', 'filename', 'sha256', 'integrity']) delete metadata[field];
    if (which === 'from') for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'])
      swapBindings(metadata[field], swaps, '.', true);
    result.set(pkg.name, metadata);
  }
  return result;
}

function equivalentMetadata(file: string, before: string, after: string, swaps: Swap[], from: Source, to: Source) {
  if (file === 'pnpm-lock.yaml') return isDeepStrictEqual(expectedLock(before, swaps), yaml(after));
  if (file === 'pnpm-workspace.yaml') {
    const docs = yaml(before);
    for (const doc of docs) if (fields(doc)) swapBindings(doc['overrides'], swaps, '.');
    return isDeepStrictEqual(docs, yaml(after));
  }
  if (path.posix.basename(file) === 'package.json') {
    const value: unknown = JSON.parse(before);
    if (!fields(value)) return false;
    for (const section of sections) swapBindings(value[section], swaps, path.posix.dirname(file));
    return isDeepStrictEqual(value, JSON.parse(after));
  }
  if (path.posix.basename(file) === 'framework-manifest.json') return isDeepStrictEqual(
    vendorIndex(before, 'from', swaps, from.manifest.omni.commit, file), vendorIndex(after, 'to', swaps, to.manifest.omni.commit, file));
  return false;
}

/** Compare authenticated Git trees, including modes and non-code inputs. Only verified
 * SDK archives and their exact dependency bindings may differ across builds. */
export async function verifyRecoveryConsumerSources(from: Source, to: Source): Promise<void> {
  const [before, after] = await Promise.all([tree(from), tree(to)]);
  const sameTree = isDeepStrictEqual(before, after);
  if (sameTree && isDeepStrictEqual(from.manifest.omni, to.manifest.omni)) return;
  const [a, b] = await Promise.all([archives(from, before), archives(to, after)]);
  if (!isDeepStrictEqual(new Set(a.keys()), new Set(b.keys()))) throw Error('The SDK package set changed');
  const swaps = [...a.values()].map(pkg => ({ from: pkg, to: b.get(pkg.name)! }));
  const fromFiles = new Set(swaps.map(s => s.from.file)), toFiles = new Set(swaps.map(s => s.to.file));
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(file), right = after.get(file);
    if (isDeepStrictEqual(left, right) || ((!left || fromFiles.has(file)) && (!right || toFiles.has(file)))) continue;
    if (!left || !right || left.mode !== '100644' || right.mode !== '100644' ||
        !['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'framework-manifest.json'].includes(path.posix.basename(file)))
      throw Error('The recovery release changes consumer source: ' + file);
    const [oldText, newText] = await Promise.all([blob(from, left), blob(to, right)]);
    if (!equivalentMetadata(file, oldText, newText, swaps, from, to)) throw Error('The recovery release changes consumer inputs: ' + file);
  }
}
