import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolvePnpm } from '../shared/pnpm.js';

const exec = promisify(execFile);
export interface BundleOverrideArchive {
  selector: string;
  name: string;
  version: string;
  source: string;
  filename: string;
  sha256: string;
}

function archiveChecksum(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Refuse a dependency changed after planning, before the bundle can be published. */
export function copyBundleOverride(archive: BundleOverrideArchive, directory: string): void {
  const destination = path.join(directory, archive.filename);
  fs.copyFileSync(archive.source, destination);
  if (archiveChecksum(destination) !== archive.sha256) {
    fs.rmSync(destination, { force: true });
    throw new Error(`Local override ${archive.name} changed while the bundle was being built`);
  }
}

/** Read resolution inputs without translating their package manager semantics.
 * Checked application releases retain the installed pnpm closure; their build
 * cache must not require that pnpm rules can also be expressed by npm. */
export async function readWorkspaceOverrideInputs(roots: readonly string[]): Promise<{
  overrides: Record<string, string>;
  archives: BundleOverrideArchive[];
}> {
  const overrides: Record<string, string> = {};
  const archives: BundleOverrideArchive[] = [];
  for (const root of roots) {
    const { stdout } = await exec(resolvePnpm(), ['config', 'get', 'overrides', '--json'], { cwd: root });
    const text = stdout.trim();
    const config: unknown = !text || text === 'undefined' ? {} : JSON.parse(text) ?? {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid workspace overrides');
    for (const [selector, range] of Object.entries(config)) {
      if (Object.hasOwn(overrides, selector)) continue;
      if (typeof range !== 'string') throw new Error(`Invalid override for ${selector}`);
      // The builder gives its primary workspace exact-selector precedence. Preserve
      // values and order, including aliases, removals and parent-scoped rules.
      Object.defineProperty(overrides, selector, { value: range, enumerable: true });
      if (!range.startsWith('file:')) continue;
      const source = fs.realpathSync(path.resolve(root, range.slice(5)));
      const relative = path.relative(fs.realpathSync(root), source);
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))
        throw new Error(`Local override ${selector} must be inside its source workspace`);
      if (!fs.statSync(source).isFile() || !/\.(tgz|tar\.gz)$/.test(source))
        throw new Error(`Local override ${selector} must be a package archive`);
      const sha256 = archiveChecksum(source);
      const { stdout: manifest } = await exec('tar', ['-xOf', source, 'package/package.json'], {
        maxBuffer: 1024 * 1024,
      });
      const metadata = JSON.parse(manifest) as { name?: string; version?: string };
      if (typeof metadata.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(metadata.name) ||
          typeof metadata.version !== 'string' || !metadata.version)
        throw new Error(`Local override ${selector} contains no valid package name or version`);
      if (archiveChecksum(source) !== sha256) throw new Error(`Local override ${selector} changed while it was being read`);
      const filename = `${metadata.name.replace(/^@/, '').replace('/', '-')}-${sha256}.tgz`;
      archives.push({ selector, name: metadata.name, version: metadata.version, source, filename, sha256 });
    }
  }
  return { overrides, archives };
}

/** npm bundles are a different output contract from an installed release.
 * In particular pnpm's parent>child targets an immediate dependency, while npm
 * nested overrides also affect deeper descendants. Never broaden that rule. */
export async function readBundleOverrides(roots: readonly string[]): Promise<{
  overrides: Record<string, string>;
  archives: BundleOverrideArchive[];
}> {
  const inputs = await readWorkspaceOverrideInputs(roots);
  const overrides: Record<string, string> = {};
  const refuse = (selector: string, reason: string): never => {
    throw new Error(`Cannot create an npm-installable bundle for override ${selector}: ${reason}. ` +
      'Use omnitron release build <project> to package the verified, target-specific installed dependency graph.');
  };
  for (const [name, range] of Object.entries(inputs.overrides)) {
    // Linked workspace packages are packed by the existing workspace planner.
    if (range.startsWith('link:') || range.startsWith('workspace:')) continue;
    if (name.includes('>')) refuse(name, 'this dependency selector is outside the supported npm bundle representation');
    if (range === '-' || range.startsWith('catalog:') || range.startsWith('$') || name.includes(':') || name.includes('*'))
      refuse(name, 'this pnpm resolution rule has no supported npm bundle representation');
    const archive = inputs.archives.find(item => item.selector === name);
    if (archive) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name))
        refuse(name, 'version-qualified local archive selection is not supported by the npm bundle');
      if (archive.name !== name) throw new Error(`Local override ${name} contains a different package`);
      Object.defineProperty(overrides, name, { value: `file:./vendor/${archive.filename}`, enumerable: true });
    } else {
      Object.defineProperty(overrides, name, { value: range, enumerable: true });
    }
  }
  return { overrides, archives: inputs.archives };
}
