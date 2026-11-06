/** Declarative artifact mounts. Only the ordinary local release installer supplies roots. */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IEcosystemAppEntry, IEcosystemConfig } from '../config/types.js';
import type { ArtifactVolumeBinding, InfrastructureConfig, IVolumeMount } from '../infrastructure/types.js';
import { mergeInfrastructure } from '../infrastructure/merge-config.js';

const name = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) && !value.includes('..');
// eslint-disable-next-line no-control-regex -- Deliberately reject control bytes in declarative Docker mount paths.
const relative = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(value) &&
  value.split('/').every(part => !!part && part !== '.' && part !== '..' && part.toLowerCase() !== 'node_modules');
const target = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && relative(value.slice(1));
const overlap = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

/** Synchronous structural checks run before archive preparation or deployment mutations. */
export function artifactVolumeBindings(infrastructure?: InfrastructureConfig, requireServices = true): Array<[string, ArtifactVolumeBinding]> {
  const raw = infrastructure?.artifactVolumes;
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 64) throw Error('Invalid artifact volume declarations');
  const selected: Array<[string, ArtifactVolumeBinding]> = [];
  for (const [key, binding] of Object.entries(raw)) {
    if (!name(key) || !binding || typeof binding !== 'object' || Array.isArray(binding) ||
        Object.keys(binding).some(field => !['service', 'app', 'directory', 'target'].includes(field)) ||
        !name(binding.service) || !name(binding.app) || !relative(binding.directory) || !target(binding.target))
      throw Error('Artifact volume requires an exact service, artifact and physical package-relative directory: ' + key);
    const service = infrastructure?.services?.[binding.service];
    if (requireServices && (!service || 'preset' in service || !service.docker))
      throw Error('Artifact volume requires a custom Docker service: ' + binding.service);
    const docker = service && !('preset' in service) ? service.docker : undefined;
    for (const volumes of [docker?.volumes, ...Object.values(docker?.variants ?? {}).map(variant => variant.volumes)]) {
      if (volumes && Object.hasOwn(volumes, key)) throw Error('Artifact volume conflicts with an existing volume key: ' + key);
      for (const value of Object.values(volumes ?? {})) {
        const destination = typeof value === 'string' ? value : value.target;
        if (!target(destination) || overlap(binding.target, destination)) throw Error('Artifact volume overlaps another mount target: ' + binding.target);
      }
    }
    if (selected.some(([, other]) => other.service === binding.service && overlap(other.target, binding.target)))
      throw Error('Artifact volumes have overlapping mount targets: ' + binding.target);
    selected.push([key, { ...binding }]);
  }
  return selected;
}

export function artifactVolumeEntries(infrastructure: InfrastructureConfig | undefined, entries: readonly IEcosystemAppEntry[], requireServices = true): IEcosystemAppEntry[] {
  const names = new Set(artifactVolumeBindings(infrastructure, requireServices).map(([, binding]) => binding.app));
  return [...names].map(app => {
    const found = entries.filter(entry => entry.name === app);
    if (found.length !== 1) throw Error('Artifact volume requires one declared consumer application: ' + app);
    return found[0]!;
  });
}

/** Include disabled payload declarations only when a stack explicitly mounts their artifacts. */
export function releaseBuildEntries(config: IEcosystemConfig): IEcosystemAppEntry[] {
  const required = new Set(artifactVolumeEntries(config.infrastructure, config.apps, false).map(entry => entry.name));
  for (const stack of Object.values(config.stacks ?? {})) {
    for (const entry of artifactVolumeEntries(mergeInfrastructure(config, stack), config.apps, false)) required.add(entry.name);
  }
  // enabled is a runtime membership switch. The importer/builders see an explicitly required payload.
  return config.apps.filter(entry => entry.enabled !== false || required.has(entry.name)).map(entry =>
    required.has(entry.name) ? { ...entry, enabled: true } : entry);
}

/** No symlink at any source segment or within the served tree, and no dependency exposure. */
async function physicalDirectory(root: string, directory: string): Promise<string> {
  if (!relative(directory) || !path.isAbsolute(root) || await fs.realpath(root) !== root) throw Error('Artifact volume root is not physical');
  // The ordinary Docker encoder uses colon-delimited -v. A physical
  // installation root must not introduce separators or control characters.
  // eslint-disable-next-line no-control-regex -- Physical installation paths must reject the same control bytes as declarations.
  if (/[\\:\x00-\x1f\x7f]/.test(path.join(root, directory))) throw Error('Artifact volume source cannot be encoded as a Docker mount');
  let selected = root;
  for (const part of directory.split('/')) {
    selected = path.join(selected, part);
    if (!(await fs.lstat(selected)).isDirectory() || await fs.realpath(selected) !== selected) throw Error('Artifact volume directory is not physical');
  }
  const pending = [selected];
  let count = 0;
  while (pending.length) {
    const parent = pending.pop()!;
    for (const child of await fs.readdir(parent)) {
      if (++count > 200_000 || child.toLowerCase() === 'node_modules') throw Error('Artifact volume exposes dependencies or exceeds its member limit');
      const file = path.join(parent, child), stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1))
        throw Error('Artifact volume contains a link or special file');
      if (stat.isDirectory()) pending.push(file);
    }
  }
  return selected;
}

/** Replace declarations only in an ephemeral provisioning copy. No config/store/selection writes. */
export async function bindArtifactVolumes(infrastructure: InfrastructureConfig | undefined, roots: ReadonlyMap<string, string>): Promise<InfrastructureConfig | undefined> {
  const bindings = artifactVolumeBindings(infrastructure);
  if (!bindings.length) return infrastructure;
  const { artifactVolumes: _declared, ...resolved } = structuredClone(infrastructure!);
  for (const [key, binding] of bindings) {
    const root = roots.get(binding.app);
    if (!root) throw Error('No verified local installation for artifact volume: ' + binding.app);
    const source = await physicalDirectory(root, binding.directory);
    const service = resolved.services![binding.service]!;
    if ('preset' in service || !service.docker) throw Error('Artifact volume service changed');
    const mount: IVolumeMount = { source, target: binding.target, readonly: true };
    service.docker.volumes = { ...service.docker.volumes, [key]: mount };
  }
  return resolved;
}
