import type { ContainerState, ResolvedContainer } from './types.js';

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

/** Recreating an image with VOLUME otherwise silently attaches a fresh, empty anonymous volume. */
export function assertReplacementVolumes(desired: ResolvedContainer, actual: ContainerState): void {
  if (!actual.mounts) throw Error(`Cannot verify existing volumes for ${desired.name}`);
  for (const mount of actual.mounts) {
    if (mount.type === 'bind' || mount.type === 'tmpfs') continue;
    if (mount.type !== 'volume' || !mount.name || !desired.volumes.some(v => v.target === mount.target && v.source === mount.name))
      throw Error(`Replacement of ${desired.name} requires an explicit data transition for the retained mount at ${mount.target}`);
  }
}
