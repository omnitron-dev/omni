import fs from 'node:fs/promises';
import path from 'node:path';
import type { IEcosystemAppEntry } from '../config/types.js';
import { installedGraph, materializeGraph } from './installed-graph.js';
import { frameworkDependencyDigest, releaseTreeDigest } from './runtime-provenance.js';
import { shellEscape } from '../shared/shell-escape.js';
import { targetRuntime, releaseNodeOptions, releaseOptionsForEnv, type TargetRuntime } from './target-runtime.js';

export const CLOSURE_FILE = '.omnitron-closure.json';

interface ApplicationClosure {
  protocol: 1;
  runtime: TargetRuntime;
  nodeOptions: string;
  bindings: Record<string, string[]>;
  frameworkSha256: string;
  payloadSha256: string;
}

export async function stageApplicationClosure(source: string, directory: string, entry: IEcosystemAppEntry, checkouts: readonly string[]): Promise<void> {
  const nodeOptions = releaseOptionsForEnv(entry.env);
  const packages = await installedGraph(source, new Map(), await Promise.all(checkouts.map(root => fs.realpath(root))));
  const destinations = packages.map((_, index) => index === 0 ? directory : path.join(directory, 'node_modules/.omnitron', String(index)));
  await materializeGraph(packages, destinations, { application: true });
  const bindings: Record<string, string[]> = {}, roots: Record<string, string> = {};
  for (const [index, pkg] of packages.entries()) for (const [name, child] of pkg.dependencies) {
    if (!name.startsWith('@omnitron-dev/') || name === '@omnitron-dev/omnitron') continue;
    if (roots[name] && roots[name] !== destinations[child]) throw Error('Ambiguous shared framework identity: ' + name);
    roots[name] = destinations[child]!;
    (bindings[name] ??= []).push(path.relative(directory, path.join(destinations[index]!, 'node_modules', name)).split(path.sep).join('/'));
  }
  const closure: ApplicationClosure = { protocol: 1, runtime: await targetRuntime(), nodeOptions,
    bindings, frameworkSha256: await frameworkDependencyDigest(directory, roots),
    payloadSha256: await releaseTreeDigest(directory, true, false, [CLOSURE_FILE]) };
  await fs.writeFile(path.join(directory, CLOSURE_FILE), JSON.stringify(closure, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

/** Inspect and bind a freshly extracted candidate only. The shipped package graph
 * and the owner's graph must agree *before* any selected link is replaced. */
export async function bindApplicationClosure(directory: string, ownerPackage: string, transportFile?: string): Promise<string> {
  const io = await import('node:fs/promises'), paths = await import('node:path');
  const root = await io.realpath(directory), owner = await io.realpath(ownerPackage);
  const file = paths.join(root, '.omnitron-closure.json');
  const stat = await io.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > 2_000_000) throw Error('No supported immutable application closure; rebuild this release on a matching builder');
  const c = JSON.parse(await io.readFile(file, 'utf8')) as ApplicationClosure;
  if (c.protocol !== 1 || !c.bindings || Array.isArray(c.bindings) || typeof c.bindings !== 'object' || !/^[a-f0-9]{64}$/.test(c.frameworkSha256)) throw Error('Invalid application closure');
  const excluded = ['.omnitron-closure.json'];
  if (transportFile !== undefined) {
    if (!/^[a-zA-Z0-9._+-]+\.tar\.gz$/.test(transportFile) || transportFile.includes('..')) throw Error('Invalid transport filename');
    excluded.push(transportFile);
  }
  if (!/^[a-f0-9]{64}$/.test(c.payloadSha256) || await releaseTreeDigest(root, true, false, excluded) !== c.payloadSha256)
    throw Error('The unpacked release payload differs from the build');
  const actual = await targetRuntime();
  for (const key of Object.keys(actual) as Array<keyof TargetRuntime>) if (c.runtime?.[key] !== actual[key])
    throw Error('Release runtime mismatch (' + key + '): built for ' + c.runtime?.[key] + ', execution owner has ' + actual[key]);
  const options = releaseNodeOptions(c.nodeOptions);
  const before: Record<string, string> = {}, after: Record<string, string> = {};
  const changes: { link: string; next: string }[] = [];
  for (const [name, links] of Object.entries(c.bindings)) {
    if (!/^@omnitron-dev\/[a-z0-9][a-z0-9_.-]*$/.test(name) || !Array.isArray(links) || !links.length) throw Error('Invalid framework binding');
    const next = await io.realpath(paths.join(owner, 'node_modules', name)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return null; });
    if (name === '@omnitron-dev/titan' && !next) throw Error('Execution owner cannot supply Titan');
    for (const relative of links) {
      if (typeof relative !== 'string' || !/^(?:node_modules\/\.omnitron\/[1-9][0-9]*\/)?node_modules\/@omnitron-dev\/[a-z0-9_.-]+$/.test(relative) || !relative.endsWith('/' + name))
        throw Error('Invalid framework link location');
      const link = paths.join(root, relative);
      if (!(await io.lstat(link)).isSymbolicLink() || !(await io.realpath(paths.dirname(link))).startsWith(root + paths.sep))
        throw Error('Framework link escaped the candidate');
      const current = await io.realpath(link);
      if (!current.startsWith(root + paths.sep) || (before[name] && current !== before[name])) throw Error('Unexpected framework binding in archive');
      before[name] = current; after[name] = next ?? current;
      if (next) changes.push({ link, next });
    }
  }
  if (await frameworkDependencyDigest(root, before) !== c.frameworkSha256)
    throw Error('Shipped dependency bytes or resolution edges differ from the build');
  if (await frameworkDependencyDigest(root, after) !== c.frameworkSha256)
    throw Error('Execution owner dependencies differ from this release; existing applications were retained');
  for (const { link, next } of changes) { await io.unlink(link); await io.symlink(next, link, 'dir'); }
  // Re-check resolution through the candidates' actual links, including nested peers.
  const bound = Object.fromEntries(Object.entries(c.bindings).map(([name, links]) => [name, paths.join(root, links[0]!) ]));
  if (await frameworkDependencyDigest(root, bound) !== c.frameworkSha256) throw Error('Framework graph changed during binding');
  // The delivery hash already identifies the archive. Only execution files belong in the launch receipt.
  if (transportFile !== undefined) await io.unlink(paths.join(root, transportFile));
  return options;
}

export function bindApplicationCommand(root: string, ownerPackage: string, executable: string, transportFile?: string): string {
  if (![root, ownerPackage, executable].every(p => path.isAbsolute(p))) throw Error('Verified absolute release and owner paths are required');
  const source = 'const targetRuntime=' + targetRuntime.toString() + ';const releaseNodeOptions=' + releaseNodeOptions.toString() +
    ';const releaseTreeDigest=' + releaseTreeDigest.toString() + ';const frameworkDependencyDigest=' + frameworkDependencyDigest.toString() +
    ';console.log(JSON.stringify(await (' + bindApplicationClosure.toString() + ')(' + JSON.stringify(root) + ',' + JSON.stringify(ownerPackage) + ',' + (JSON.stringify(transportFile) ?? 'undefined') + ')));';
  return 'env -u NODE_OPTIONS -u NODE_PATH ' + shellEscape(executable) + ' --input-type=module -e ' + shellEscape(source);
}
