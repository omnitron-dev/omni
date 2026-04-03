/**
 * Daemon entry point — spawned as a detached child process by `omnitron up`.
 *
 * Resolves config from registered projects or CWD.
 * Reads saved daemon config (~/.omnitron/config.json) for role/master settings.
 * Daemon can start with default config if no projects registered.
 */

import { loadEcosystemConfig, loadEcosystemConfigFile } from '../config/loader.js';
import { defineEcosystem } from '../config/define-ecosystem.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { OmnitronDaemon } from './daemon.js';
import { readSavedDaemonConfig } from '../commands/up.js';

async function main() {
  const cwd = process.env['OMNITRON_CWD'] ?? process.cwd();
  process.chdir(cwd);

  const registry = new ProjectRegistry();
  let config;

  // Try auto-detect from CWD
  const detected = registry.autoDetect(cwd);
  if (detected) {
    const configPath = registry.getConfigPath(detected.name);
    config = configPath ? await loadEcosystemConfigFile(configPath) : await loadEcosystemConfig(cwd);
  } else {
    // Try first registered project
    const projects = registry.list();
    if (projects.length > 0) {
      const configPath = registry.getConfigPath(projects[0]!.name);
      config = configPath ? await loadEcosystemConfigFile(configPath) : await loadEcosystemConfig(cwd);
    } else {
      // No projects — start daemon with default config
      try {
        config = await loadEcosystemConfig(cwd);
      } catch {
        config = defineEcosystem({ apps: [] });
      }
    }
  }

  // Read saved daemon config for role/master settings
  const savedConfig = readSavedDaemonConfig();
  const dc = savedConfig
    ? {
        ...DEFAULT_DAEMON_CONFIG,
        role: savedConfig.role,
        ...(savedConfig.master ? { master: savedConfig.master } : {}),
      }
    : DEFAULT_DAEMON_CONFIG;

  const daemon = new OmnitronDaemon();
  await daemon.start(config, {
    noInfra: process.env['OMNITRON_NO_INFRA'] === '1',
    noWatch: process.env['OMNITRON_NO_WATCH'] === '1',
    watch: process.env['OMNITRON_NO_WATCH'] !== '1',
  }, dc);
}

main().catch((err) => {
  console.error('Daemon fatal error:', err);
  process.exit(1);
});
