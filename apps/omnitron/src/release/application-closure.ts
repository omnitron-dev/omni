import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { IEcosystemAppEntry } from '../config/types.js';
import { installedGraph, materializeGraph } from './installed-graph.js';
import { frameworkDependencyDigest, releaseTreeDigest } from './runtime-provenance.js';
import { targetRuntime, releaseOptionsForEnv, type TargetRuntime } from './target-runtime.js';

export const CLOSURE_FILE = '.omnitron-closure.json';

interface ApplicationClosure {
  protocol: 1;
  runtime: TargetRuntime;
  nodeOptions: string;
  bindings: Record<string, string[]>;
  frameworkSha256: string;
  payloadSha256: string;
}

export async function stageApplicationClosure(source: string, directory: string, entry: IEcosystemAppEntry, checkouts: readonly string[],
  verifyPackage?: import('./registry-framework.js').RegistryFramework['verifyPackage']): Promise<void> {
  const nodeOptions = releaseOptionsForEnv(entry.env);
  const packages = await installedGraph(source, new Map(), await Promise.all(checkouts.map(root => fs.realpath(root))));
  const destinations = packages.map((_, index) => index === 0 ? directory : path.join(directory, 'node_modules/.omnitron', String(index)));
  await materializeGraph(packages, destinations, { application: true });
  if (entry.bootstrap) {
    // Every bootstrap resolves its private Titan from the application package.
    // An ancestor or NODE_PATH on the build machine is outside the portable graph.
    const titan = packages[0]!.dependencies.get('@omnitron-dev/titan');
    if (titan === undefined) throw Error(`Bootstrap application ${entry.name} must declare @omnitron-dev/titan as a runtime dependency`);
    const request = createRequire(path.join(directory, 'package.json'));
    const resolved = await fs.realpath(request.resolve('@omnitron-dev/titan'));
    const shipped = await fs.realpath(destinations[titan]!);
    if (!resolved.startsWith(shipped + path.sep)) throw Error(`Bootstrap application ${entry.name} resolved Titan outside its packaged dependency`);
  }
  if (verifyPackage) {
    // An app build controls its installed tree. A renamed manifest must not
    // erase the identity promised by the dependency edge pointing at it.
    const checks = new Map<string, Set<number>>();
    const requireArchive = (name: string, index: number) => {
      if (!name.startsWith('@omnitron-dev/')) return;
      const locations = checks.get(name) ?? new Set<number>();
      locations.add(index);
      checks.set(name, locations);
    };
    for (const [index, pkg] of packages.entries()) {
      requireArchive(pkg.metadata.name, index);
      for (const [name, child] of pkg.dependencies) requireArchive(name, child);
    }
    for (const [name, locations] of checks) {
      for (const index of locations) await verifyPackage(name, destinations[index]!);
    }
  }
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
