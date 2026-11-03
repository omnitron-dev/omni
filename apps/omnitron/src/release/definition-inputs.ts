/**
 * The files a deployment reads from the project's working tree.
 *
 * A release carries its artifacts; the stack DEFINITION — which apps, which
 * infrastructure, what each app declares it needs — is still read from the
 * project directory on the master. So admission refused a release unless the
 * whole working tree equalled its commit: on 2026-09-24 every deployment of
 * sample/test froze the shared checkout for three sessions, and a colleague's
 * edit to a file no deployment reads twice sent a release back to its build.
 *
 * What the definition actually reads is knowable:
 *   - `omnitron.config.*` and its relative import graph;
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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { CONFIG_FILE_NAMES } from '../config/loader.js';

/** A partial source comparison must never hide inputs outside its Git boundary. */
export class UnverifiableDefinitionInputError extends Error {
  override name = 'UnverifiableDefinitionInputError';
}

/** Paths relative to the configuration root, including siblings in the same repository. */
export async function definitionInputs(
  projectPath: string,
  bootstraps: readonly string[],
  /** Directories shipped to nodes, as declared — relative to the project, or absolute. */
  shipped: readonly string[] = [],
): Promise<string[]> {
  const root = fs.realpathSync(projectPath);
  const git = async (...args: string[]) => (await promisify(execFile)('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const repository = fs.realpathSync((await git('rev-parse', '--show-toplevel')).trimEnd());
  const inside = (file: string) => {
    const relative = path.relative(repository, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const configFile = CONFIG_FILE_NAMES.map((name) => path.join(root, name)).find((p) => fs.existsSync(p));
  const entries = [
    ...(configFile ? [configFile] : []),
    ...bootstraps.map((b) => path.resolve(root, b)),
  ];
  for (const entry of entries) {
    if (!fs.existsSync(entry)) throw new Error(`a definition entry is missing from the working tree: ${path.relative(root, entry)}`);
  }

  const esbuild = await import('esbuild');
  const result = entries.length ? await esbuild.build({
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
  }) : undefined;

  const inputs = new Set<string>(Object.keys(result?.metafile?.inputs ?? {}).map((p) => path.relative(root, path.resolve(root, p))));
  const imported = [...inputs];

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

  for (const input of inputs) {
    const file = path.resolve(root, input);
    if (!inside(file) || (fs.existsSync(file) && !inside(fs.realpathSync(file))))
      throw new UnverifiableDefinitionInputError(`A deployment input is outside the source repository: ${input}`);
  }
  // esbuild reports resolved targets. A tracked symlink can redirect an import
  // while both old and new targets are unchanged, so bind the repository's link
  // declarations as well. Their targets are still checked above when consumed.
  const links = await git('ls-files', '--stage', '--full-name', '-z', '--', ':(top,glob)**');
  for (const entry of links.split('\0')) {
    if (entry.startsWith('120000 ')) inputs.add(path.relative(root, path.join(repository, entry.slice(entry.indexOf('\t') + 1))));
    if (entry.startsWith('160000 ')) {
      const submodule = path.join(repository, entry.slice(entry.indexOf('\t') + 1));
      if ([...inputs].some(input => {
        const relative = path.relative(submodule, path.resolve(root, input));
        return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      })) throw new UnverifiableDefinitionInputError('Deployment source inside a Git submodule requires its own verified source binding');
    }
  }
  // Imported ignored source has no commit identity. Machine-local secrets read
  // explicitly by configuration remain runtime inputs, rather than code imports.
  if (imported.length) {
    try {
      const ignored = await git('--literal-pathspecs', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...imported);
      if (ignored) throw new UnverifiableDefinitionInputError(`A deployment input is ignored by Git: ${ignored.split('\0')[0]}`);
    } catch (error) {
      if (error instanceof UnverifiableDefinitionInputError) throw error;
      throw new UnverifiableDefinitionInputError('Deployment inputs could not be checked against the source repository', { cause: error });
    }
  }
  return [...inputs].sort();
}
