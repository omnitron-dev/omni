import path from 'node:path';
import type { IEcosystemAppEntry } from './types.js';

/** Per-app paths are relative to its declared working directory, itself relative to the config. */
export function resolveAppPath(projectRoot: string, entry: Pick<IEcosystemAppEntry, 'cwd'>, file = '.'): string {
  return path.resolve(projectRoot, entry.cwd ?? '.', file);
}
