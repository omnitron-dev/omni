/**
 * Daemon entry point — spawned as a detached child process by `omnitron up`.
 *
 * Resolves config from registered projects or CWD.
 * Reads saved daemon config (~/.omnitron/config.json) for role/master settings.
 * Daemon can start with default config if no projects registered.
 */

import fs from 'node:fs';
import { loadEcosystemConfig, loadEcosystemConfigFile } from '../config/loader.js';
import { defineEcosystem } from '../config/define-ecosystem.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { OmnitronDaemon } from './daemon.js';
import { readSavedDaemonConfig } from '../commands/up.js';

/** Load config from a registry config path, falling back to CWD or defaults */
async function loadConfigSafe(configPath: string | null, cwd: string) {
  if (configPath && fs.existsSync(configPath)) {
    return loadEcosystemConfigFile(configPath);
  }
  try {
    return await loadEcosystemConfig(cwd);
  } catch {
    return defineEcosystem({ apps: [] });
  }
}

async function main() {
  const cwd = process.env['OMNITRON_CWD'] ?? process.cwd();
  process.chdir(cwd);

  const registry = new ProjectRegistry();

  // Try auto-detect from CWD, then first registered project, then defaults
  const detected = registry.autoDetect(cwd);
  const projectName = detected?.name ?? registry.list()[0]?.name;
  const configPath = projectName ? registry.getConfigPath(projectName) : null;
  const config = await loadConfigSafe(configPath, cwd);

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
