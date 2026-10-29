import type { FileRootConfig } from '../shared/dto/files.js';

/** Defaults are explicit and fail closed on malformed configuration. OS privileges are never elevated. */
export function configuredFileRoots(config?: { enabled?: boolean; roots?: FileRootConfig[] }): FileRootConfig[] {
  if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config)))
    throw new Error('daemon.files must be an object');
  if (config?.enabled !== undefined && typeof config.enabled !== 'boolean')
    throw new Error('daemon.files.enabled must be a boolean');
  if (config?.roots !== undefined && !Array.isArray(config.roots))
    throw new Error('daemon.files.roots must be an array');
  return config?.enabled === false ? [] : (config?.roots ?? [{ id: 'system', label: 'Filesystem', path: '/' }]);
}
