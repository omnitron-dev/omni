import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInstalledDependency } from '../release/package-resolution.js';
import type { MigrationSdkInspection } from '../../bin/sdk.js';

type Selection = Pick<MigrationSdkInspection, 'root' | 'source' | 'bindings'>;
const within = (root: string, file: string) => file.startsWith(root + path.sep);

/** A nested pnpm importer can expose a package directory or one of its declared executables. */
export function migrationWorkspaceBindings(sdk: Selection, include: (root: string) => void) {
  const observed = new Map<string, { target: string; root: string; identity: string }>();
  const resolve = async (link: string, target: string) => {
    if (!sdk.source || ![sdk.root, sdk.source].some(root => within(root, link))) return undefined;
    const marker = path.sep + 'node_modules' + path.sep, index = link.lastIndexOf(marker);
    if (index < 0) return undefined;
    const importer = link.slice(0, index), entry = link.slice(index + marker.length);
    const command = path.dirname(entry) === '.bin' ? path.basename(entry) : undefined;
    if (!command && !Object.hasOwn(sdk.bindings, entry)) return undefined;
    const manifest = await fs.readFile(path.join(importer, 'package.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (!manifest) return false;
    const info = JSON.parse(manifest);
    const declared = { ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies, ...info.devDependencies };
    for (const name of command ? Object.keys(declared).sort() : [entry]) {
      if (!Object.hasOwn(declared, name)) continue;
      const selected = Object.hasOwn(sdk.bindings, name) ? sdk.bindings[name] : undefined;
      if (selected && target !== selected && !within(selected, target)) continue;
      const installed = await resolveInstalledDependency(importer, name);
      if (!installed) continue;
      const root = await fs.realpath(installed);
      if (selected ? root !== selected || !within(sdk.source, root) :
          name.startsWith('@omnitron-dev/') || ![sdk.root, sdk.source].some(directory => within(directory, root))) continue;
      if (!command) {
        if (root !== target) continue;
        const stat = await fs.stat(root, { bigint: true });
        if (stat.isDirectory()) return { root, identity: [stat.dev, stat.ino, stat.ctimeNs].join(':') };
        continue;
      }
      if (!within(root, target)) continue;
      const relative = path.relative(root, target);
      if (['node_modules', '.git', '.omnitron', '.artifact-sha256', '.omnitron-release.json'].includes(relative.split(path.sep)[0]!)) continue;
      const provider = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      const specifier = declared[name];
      if (provider.name !== name && (selected || typeof provider.name !== 'string' || typeof specifier !== 'string' ||
          specifier !== 'npm:' + provider.name && !specifier.startsWith('npm:' + provider.name + '@'))) continue;
      const bin = typeof provider.bin === 'string' ? (path.basename(provider.name) === command ? provider.bin : undefined) :
        provider.bin && Object.hasOwn(provider.bin, command) ? provider.bin[command] : undefined;
      if (typeof bin !== 'string' || path.isAbsolute(bin)) continue;
      const executable = path.resolve(root, bin);
      if (!within(root, executable) || await fs.realpath(executable) !== target) continue;
      const stat = await fs.lstat(target, { bigint: true });
      if (stat.isFile()) return { root, identity: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':') };
    }
    return false;
  };
  return {
    async inspect(link: string, target: string) {
      const binding = await resolve(link, target);
      if (!binding) return binding;
      const prior = observed.get(link);
      if (prior && (prior.target !== target || prior.root !== binding.root || prior.identity !== binding.identity))
        throw Error('Migration workspace dependency binding changed during verification: ' + link);
      observed.set(link, { ...binding, target });
      include(binding.root);
      return true;
    },
    async verify() {
      for (const [link, prior] of observed) {
        const target = await fs.realpath(link);
        const current = target === prior.target && await resolve(link, target);
        if (!current || current.root !== prior.root || current.identity !== prior.identity)
          throw Error('Migration workspace dependency binding changed during verification: ' + link);
      }
    },
  };
}
