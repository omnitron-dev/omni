/**
 * The files a deployment reads from the project's working tree.
 *
 * A release carries its artifacts; the stack DEFINITION — which apps, which
 * infrastructure, what each app declares it needs — is still read from the
 * project directory on the master. So admission refused a release unless the
 * whole working tree equalled its commit: on 2026-09-24 every deployment of
 * daos/test froze the shared checkout for three sessions, and a colleague's
 * edit to a file no deployment reads twice sent a release back to its build.
 *
 * What the definition actually reads is knowable:
 *   - `omnitron.config.*` and every file it imports relatively — the config
 *     loader bundles exactly that graph;
 *   - each app's bootstrap and every file IT imports relatively — the
 *     bootstrap loader bundles exactly that graph (non-relative imports stay
 *     external, as they do there);
 *   - `omnitron.stacks.json`, read by path;
 *   - each app's `config/*.json`, read by path (`default.json`'s `omnitron`
 *     section is what the master reads; the rest are included so a config
 *     edit never passes unseen);
 *   - each directory the deployment ships to its nodes (`shippedDirsOf`) —
 *     the gateway's nginx tree, a service's scripts — whole: a directory is a
 *     pathspec to git, so every file under it is compared.
 * Machine-local files the config reads by path are gitignored, and so are not
 * the commit's business either way.
 *
 * The graph is taken from the working tree. A change that alters the graph
 * — an import added or removed — changes a file already in it, so it is seen.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_FILE_NAMES } from '../config/loader.js';

/** Paths relative to the project root, sorted, each once. */
export async function definitionInputs(
  projectPath: string,
  bootstraps: readonly string[],
  /** Directories shipped to nodes, as declared — relative to the project, or absolute. */
  shipped: readonly string[] = [],
): Promise<string[]> {
  const root = fs.realpathSync(projectPath);
  const configFile = CONFIG_FILE_NAMES.map((name) => path.join(root, name)).find((p) => fs.existsSync(p));
  const entries = [
    ...(configFile ? [configFile] : []),
    ...bootstraps.map((b) => path.resolve(root, b)),
  ];
  if (entries.length === 0) return [];
  for (const entry of entries) {
    if (!fs.existsSync(entry)) throw new Error(`a definition entry is missing from the working tree: ${path.relative(root, entry)}`);
  }

  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: entries,
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    outdir: path.join(root, '.omnitron-definition-inputs'),
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
    plugins: [
      {
        name: 'externalize-non-relative',
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        },
      },
    ],
  });

  const inputs = new Set<string>(Object.keys(result.metafile.inputs).map((p) => path.normalize(p)));

  const stacksFile = path.join(root, 'omnitron.stacks.json');
  if (fs.existsSync(stacksFile)) inputs.add('omnitron.stacks.json');

  for (const bootstrap of bootstraps) {
    const configDir = path.join(path.resolve(path.dirname(path.resolve(root, bootstrap)), '..'), 'config');
    let names: string[] = [];
    try {
      names = fs.readdirSync(configDir).filter((n) => n.endsWith('.json'));
    } catch {
      // An app without a config directory declares nothing by path.
    }
    for (const name of names) inputs.add(path.relative(root, path.join(configDir, name)));
  }

  for (const dir of shipped) inputs.add(path.relative(root, path.resolve(root, dir)));

  return [...inputs].filter((p) => p !== '' && !p.startsWith('..') && !path.isAbsolute(p)).sort();
}
