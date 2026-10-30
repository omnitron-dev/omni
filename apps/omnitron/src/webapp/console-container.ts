import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { OMNITRON_HOME } from '../config/defaults.js';
import type { ContainerState } from '../infrastructure/types.js';

export const CONSOLE_INSTANCE_LABEL = 'omnitron.instance-home';

/** Console identity belongs to the daemon instance, never a stack's async scope. */
export function consoleContainerName(home = OMNITRON_HOME): string {
  const instance = path.resolve(home);
  return instance === path.join(os.homedir(), '.omnitron') ? 'omnitron-nginx'
    : `omnitron-${createHash('sha256').update(instance).digest('hex').slice(0, 16)}-nginx`;
}

/** Old containers prove ownership through their instance-local configuration mount. */
export function assertConsoleOwnership(state: ContainerState, home = OMNITRON_HOME): void {
  const instance = path.resolve(home);
  const owner = state.labels?.[CONSOLE_INSTANCE_LABEL];
  const config = path.join(instance, 'webapp', 'nginx', 'nginx.conf');
  const owned = owner === undefined
    ? state.mounts?.some(mount => mount.target === '/etc/nginx/nginx.conf' && path.resolve(mount.source) === config)
    : owner === instance;
  if (!owned) throw new Error(`Refusing to change Console container ${state.name}: it does not belong to instance ${instance}`);
}
