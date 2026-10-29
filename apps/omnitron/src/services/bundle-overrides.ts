import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolvePnpm } from '../shared/pnpm.js';

const exec = promisify(execFile);
export interface BundleOverrideArchive {
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

/** Resolve with pnpm itself so workspace YAML and package.json use identical precedence. */
export async function readBundleOverrides(roots: readonly string[]): Promise<{
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
    for (const [name, range] of Object.entries(config)) {
      if (Object.hasOwn(overrides, name)) continue;
      if (typeof range !== 'string') throw new Error(`Invalid override for ${name}`);
      // Linked workspace packages are packed by the existing workspace planner.
      if (range.startsWith('link:') || range.startsWith('workspace:')) continue;
      if (name.includes('>'))
        throw new Error(`Contextual override ${name} needs an explicit npm-compatible bundle mapping`);
      if (!range.startsWith('file:')) {
        overrides[name] = range;
        continue;
      }
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name))
        throw new Error(`Unsupported local override selector: ${name}`);
      const source = fs.realpathSync(path.resolve(root, range.slice(5)));
      const relative = path.relative(fs.realpathSync(root), source);
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))
        throw new Error(`Local override ${name} must be inside its source workspace`);
      if (!fs.statSync(source).isFile() || !/\.(tgz|tar\.gz)$/.test(source))
        throw new Error(`Local override ${name} must be a package archive`);
      const sha256 = archiveChecksum(source);
      const { stdout: manifest } = await exec('tar', ['-xOf', source, 'package/package.json'], {
        maxBuffer: 1024 * 1024,
      });
      const metadata = JSON.parse(manifest) as { name?: string; version?: string };
      if (metadata.name !== name || typeof metadata.version !== 'string' || !metadata.version)
        throw new Error(`Local override ${name} contains a different package or no version`);
      if (archiveChecksum(source) !== sha256) throw new Error(`Local override ${name} changed while it was being read`);
      const filename = `${name.replace(/^@/, '').replace('/', '-')}-${sha256}.tgz`;
      archives.push({ name, version: metadata.version, source, filename, sha256 });
      overrides[name] = `file:./vendor/${filename}`;
    }
  }
  return { overrides, archives };
}
