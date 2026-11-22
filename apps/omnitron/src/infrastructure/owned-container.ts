import path from 'node:path';
import type { ContainerState, ResolvedContainer } from './types.js';

/** Docker exposes the host path of every mount, including named volumes. */
export function mountSourceMatches(source: string, observed: { type?: string; source: string; name?: string }): boolean {
  if (path.isAbsolute(source) || source.startsWith('.')) return observed.type === 'bind' && observed.source === path.resolve(source);
  return observed.type === 'volume' && observed.name === source;
}

/** Immutable Docker target only when its native ownership labels match the declaration. */
export function ownedContainerId(desired: Pick<ResolvedContainer, 'labels' | 'name'>, actual: ContainerState): string {
  const labels = actual.labels;
  const owners = ['omnitron.service', 'omnitron.project', 'omnitron.stack', 'omnitron.app', 'omnitron.internal'];
  if (actual.name !== desired.name || desired.labels?.['omnitron.managed'] !== 'true' || labels?.['omnitron.managed'] !== 'true' ||
      owners.some(key => labels[key] !== desired.labels[key])) {
    throw new Error(`Container '${desired.name}' belongs to another allocation`);
  }
  if (!actual.containerId || !/^[a-f0-9]{64}$/.test(actual.containerId)) throw new Error(`Container '${desired.name}' has no immutable identity`);
  return actual.containerId;
}

/** Keep persistent storage attached. Read-only bind mounts can be replaced with the next release's assets. */
export function assertReplacementVolumes(desired: ResolvedContainer, actual: ContainerState): void {
  if (!actual.mounts) throw Error(`Cannot verify existing volumes for ${desired.name}`);
  for (const mount of actual.mounts) {
    if (mount.type === 'tmpfs' || (mount.type === 'bind' && mount.readOnly === true)) continue;
    const next = desired.volumes.find(volume => volume.target === mount.target);
    if (next && mountSourceMatches(next.source, mount)) continue;
    throw Error(`Replacement of ${desired.name} requires an explicit data transition for the retained mount at ${mount.target}`);
  }
}
