import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Give the sealed receiver the same relative package links as an installed runtime. */
export async function stageFixtureExtractor(dist, receiverPackage, destinations) {
  const load = file => import(pathToFileURL(path.join(dist, 'release', file + '.js')).href);
  const { installedGraph, materializeGraph } = await load('installed-graph');
  const { resolveInstalledDependency } = await load('package-resolution');
  const source = await resolveInstalledDependency(path.dirname(dist), 'tar');
  if (!source) throw Error('The Omnitron build has no installed tar dependency');
  const graph = await installedGraph(source), locations = graph.map((_, i) => destinations(i));
  await materializeGraph(graph, locations);
  const modules = path.join(receiverPackage, 'node_modules');
  await fs.mkdir(modules, { recursive: true });
  await fs.symlink(path.relative(modules, locations[0]), path.join(modules, 'tar'), 'dir');
  return graph.length;
}
