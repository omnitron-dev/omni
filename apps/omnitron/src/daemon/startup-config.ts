import { loadDaemonBootConfig } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { readSavedDaemonConfig, savedDaemonOverrides, ensurePersistedJwtSecret } from '../commands/up.js';

/** Shared cold-start configuration for the control plane and resident owner. */
export async function loadStartupConfig(cwd: string) {
  const registry = ProjectRegistry.open();
  const detected = registry.autoDetect(cwd);
  const projectName = detected?.name ?? registry.list()[0]?.name;
  const configPath = projectName ? registry.getConfigPath(projectName) : null;
  const config = await loadDaemonBootConfig(configPath, cwd);
  const jwtSecret = ensurePersistedJwtSecret();
  const daemonConfig = {
    ...DEFAULT_DAEMON_CONFIG,
    ...savedDaemonOverrides(readSavedDaemonConfig()),
    auth: { ...DEFAULT_DAEMON_CONFIG.auth, jwtSecret },
  };
  return { config, daemonConfig };
}
