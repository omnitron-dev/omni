import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { CONFIG_FILE_NAMES } from '../config/loader.js';
import { starterConfiguration } from './starter-plan.js';
import { writeStarter } from './starter.js';

const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function document(file: string, yaml = false): Record<string, unknown> {
  if (!fs.lstatSync(file).isFile()) throw Error('Expected a regular file at ' + file);
  let value: unknown;
  try {
    const content = fs.readFileSync(file, 'utf8');
    value = yaml ? parse(content) : JSON.parse(content);
  } catch { throw Error('Cannot read the manifest at ' + file); }
  if (yaml && value == null) return {};
  if (!isRecord(value)) throw Error('Expected a manifest object at ' + file);
  return value;
}

function workspaceManifests(root: string, declared: unknown): string[] {
  if (declared === undefined) return [];
  if (!Array.isArray(declared) || declared.some(pattern => typeof pattern !== 'string' || !pattern.trim()))
    throw Error('Workspace packages must be an array of directory patterns');
  const includes: string[] = [];
  const excludes = ['**/node_modules', '**/.git'];
  for (const declaration of declared as string[]) {
    const negative = declaration.startsWith('!');
    const pattern = path.posix.normalize(negative ? declaration.slice(1) : declaration).replace(/\/$/, '');
    if (!pattern || pattern === '..' || pattern.startsWith('../') || path.isAbsolute(pattern) ||
        path.win32.isAbsolute(pattern) || pattern.includes('\\'))
      throw Error('Workspace patterns must stay inside the selected project directory');
    if (negative) excludes.push(pattern);
    else includes.push(path.posix.join(pattern, 'package.json'));
  }
  return fs.globSync(includes, { cwd: root, exclude: excludes }).filter(file => {
    const absolute = path.resolve(root, file);
    return file !== 'package.json' && !file.split(path.sep).some(part => part === 'node_modules' || part === '.git') &&
      absolute.startsWith(root + path.sep) && fs.realpathSync(absolute) === absolute && fs.lstatSync(absolute).isFile();
  }).sort();
}

function requireAvailableConfig(root: string, published?: string) {
  const occupied = CONFIG_FILE_NAMES.find(name => name !== published && fs.lstatSync(path.join(root, name), { throwIfNoEntry: false }));
  if (occupied) throw Error(occupied + ' already exists. Review the existing configuration before registration.');
}

/** Read declarations under the selected root. Package scripts, dependency sources and lockfiles play no part. */
export function reviewExistingProject(directory: string) {
  const root = fs.realpathSync(directory);
  requireAvailableConfig(root);
  const packageFile = path.join(root, 'package.json');
  const pnpmFile = path.join(root, 'pnpm-workspace.yaml');
  const hasPnpm = !!fs.lstatSync(pnpmFile, { throwIfNoEntry: false });
  const rootPackage = fs.lstatSync(packageFile, { throwIfNoEntry: false }) ? document(packageFile) : undefined;
  if (!rootPackage && !hasPnpm) throw Error('Select a package or workspace directory containing package.json or pnpm-workspace.yaml');
  const workspaces = rootPackage?.['workspaces'];
  const manager = rootPackage?.['packageManager'];
  const pnpm = typeof manager === 'string' ? manager.startsWith('pnpm@') : hasPnpm;
  const patterns = pnpm ? (hasPnpm ? document(pnpmFile, true)['packages'] : undefined)
    : isRecord(workspaces) ? workspaces['packages'] : workspaces;
  const members = workspaceManifests(root, patterns);
  const manifests = [...(rootPackage ? ['package.json'] : []), ...members];
  if (!manifests.length) throw Error('The selected workspace contains no package manifests');
  const declarations: Array<{ manifest: string; section: string; dependency: string; framework: 'Xec' | 'Kysera' }> = [];
  for (const manifest of manifests) {
    const pkg = manifest === 'package.json' ? rootPackage! : document(path.join(root, manifest));
    for (const section of dependencySections) {
      const group = pkg[section];
      if (group === undefined) continue;
      if (!isRecord(group)) throw Error('Expected a dependency map in ' + manifest + ' under ' + section);
      for (const [name, spec] of Object.entries(group)) {
        if (typeof spec !== 'string') throw Error('Expected a dependency specification in ' + manifest + ' under ' + section);
        const alias = /^(?:npm|workspace):(@[^/]+\/[^@/]+)(?:@|$)/.exec(spec);
        const dependency = alias?.[1] ?? (spec.startsWith('npm:') ? '' : name);
        const framework = dependency.startsWith('@xec-sh/') ? 'Xec' : dependency.startsWith('@kysera/') ? 'Kysera' : null;
        if (framework) declarations.push({ manifest, section, dependency, framework });
      }
    }
  }
  return { directory: root, manifests, declarations, config: starterConfiguration(null) };
}

export function writeExistingProject(review: ReturnType<typeof reviewExistingProject>) {
  requireAvailableConfig(review.directory);
  const rollback = writeStarter(review.directory, [review.config]);
  // A concurrently published JS or MJS config must stay visible to the loader.
  try { requireAvailableConfig(review.directory, review.config.path); }
  catch (error) { rollback(); throw error; }
}
