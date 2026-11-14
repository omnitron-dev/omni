import { loadDaemonBootConfig, loadEcosystemConfigFile } from '../config/loader.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { readSavedDaemonConfig, savedDaemonOverrides, ensurePersistedJwtSecret } from '../config/saved.js';

/** Resolve the registered ecosystem consistently for cold starts and explicit reloads. */
export async function loadStartupEcosystem(cwd: string) {
  const { OMNITRON_HOME } = await import('../config/defaults.js');
  const { readColdBatch } = await import('../project/cold-stack-start.js');
  const batch = await readColdBatch(OMNITRON_HOME);
  if (batch?.configuration) {
    const { readRestartConfiguration } = await import('../project/runtime-restart.js');
    return (await readRestartConfiguration(OMNITRON_HOME, batch.configuration)).watchConfig;
  }
  return loadRegisteredStartupEcosystem(cwd);
}

/** The input an older resident owner reads before accepting its controller. */
export async function loadRegisteredStartupEcosystem(cwd: string) {
  const registry = ProjectRegistry.open();
  const detected = registry.autoDetect(cwd);
  const projectName = detected?.name ?? registry.list()[0]?.name;
  const configPath = projectName ? registry.getConfigPath(projectName) : null;
  // A registration is the authority for its runtime namespace, including an
  // imported configuration's retained alias. Generated remote configs need not
  // repeat `project`; losing this association produced bare handles on recovery.
  // An explicitly selected file must not fall back to another cwd's config if it
  // disappears between lookup and loading.
  return configPath && projectName
    ? { ...await loadEcosystemConfigFile(configPath), project: projectName }
    : await loadDaemonBootConfig(null, cwd);
}

/** Shared cold-start configuration for the control plane and resident owner. */
export async function loadStartupConfig(cwd: string) {
  const config = await loadStartupEcosystem(cwd);
  const jwtSecret = ensurePersistedJwtSecret();
  const daemonConfig = {
    ...DEFAULT_DAEMON_CONFIG,
    ...savedDaemonOverrides(readSavedDaemonConfig()),
    auth: { ...DEFAULT_DAEMON_CONFIG.auth, jwtSecret },
  };
  return { config, daemonConfig };
}
