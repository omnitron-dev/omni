/**
 * Config Loader — Load and validate omnitron.config.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { IEcosystemConfig } from './types.js';
import { defineEcosystem } from './define-ecosystem.js';

const CONFIG_FILE_NAMES = ['omnitron.config.ts', 'omnitron.config.js', 'omnitron.config.mjs'];

/**
 * Stamp every app entry with the project root that owns this config file.
 *
 * This is the SOURCE-OF-TRUTH cwd for relative-path resolution (watch
 * directories, bootstrap script, env-file lookups). Without it, callers
 * fall back to `process.cwd()` of the daemon — which is whatever
 * directory the daemon was launched from and has nothing to do with the
 * project. That breaks file watching for stacks started from registered
 * projects whose registered path differs from the daemon's launch cwd.
 *
 * Existing `entry.cwd` (e.g. set by stack namespacing in
 * `project.service.ts`) is respected and not overwritten.
 */
function stampProjectRoot(config: IEcosystemConfig, projectRoot: string): IEcosystemConfig {
  if (!config.apps?.length) return config;
  config.apps = config.apps.map((app) => (app.cwd ? app : { ...app, cwd: projectRoot }));
  return config;
}

export async function loadEcosystemConfig(cwd: string = process.cwd()): Promise<IEcosystemConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    const configPath = path.resolve(cwd, name);

    // Check if file exists before attempting import (avoids confusing error paths)
    if (!fs.existsSync(configPath)) continue;

    try {
      const url = pathToFileURL(configPath).href;
      // Cache-bust: Node.js ESM caches by URL; appending timestamp forces re-evaluation on reload
      const mod = await import(`${url}?t=${Date.now()}`);
      const raw = mod.default ?? mod;

      if (!raw || !Array.isArray(raw.apps)) {
        throw new Error(`Invalid config in ${name}: 'apps' must be an array`);
      }

      // Validate each app entry
      for (const app of raw.apps) {
        if (!app.name) throw new Error(`App entry missing 'name' in ${name}`);
        if (!app.bootstrap && !app.script) {
          throw new Error(`App '${app.name}' must have either 'bootstrap' or 'script' path`);
        }
      }

      // Apply defaults — the config file doesn't need to import defineEcosystem
      const config = defineEcosystem(raw);
      return stampProjectRoot(config, path.dirname(configPath));
    } catch (err: any) {
      throw new Error(`Failed to load ${name}: ${err.message}`, { cause: err });
    }
  }

  throw Object.assign(
    new Error(
      `No omnitron config found. Create one of: ${CONFIG_FILE_NAMES.join(', ')}\n` +
        `Run 'omnitron init' to generate a config file.`
    ),
    { code: ECOSYSTEM_CONFIG_NOT_FOUND }
  );
}

/**
 * Load config from a specific file path (e.g., `omnitron up -c ./omnitron.config.ts`)
 */
export async function loadEcosystemConfigFile(filePath: string): Promise<IEcosystemConfig> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const url = pathToFileURL(filePath).href;
  const mod = await import(`${url}?t=${Date.now()}`);
  const raw = mod.default ?? mod;

  if (!raw || !Array.isArray(raw.apps)) {
    throw new Error(`Invalid config in ${filePath}: 'apps' must be an array`);
  }

  for (const app of raw.apps) {
    if (!app.name) throw new Error(`App entry missing 'name' in ${filePath}`);
    if (!app.bootstrap && !app.script) {
      throw new Error(`App '${app.name}' must have either 'bootstrap' or 'script' path`);
    }
  }

  const config = defineEcosystem(raw);
  return stampProjectRoot(config, path.dirname(path.resolve(filePath)));
}

/**
 * The config that is not there, as opposed to the one that is wrong.
 *
 * `loadEcosystemConfig` throws for both, and `loadEcosystemConfigSafe` used
 * to answer null to both. So a typo in someone's `omnitron.config.ts` — a
 * missing `name`, an app with neither `bootstrap` nor `script`, a file that
 * does not parse — read as "this directory was never an omnitron project",
 * which is the one conclusion that stops anybody looking for the typo.
 */
export const ECOSYSTEM_CONFIG_NOT_FOUND = 'ECOSYSTEM_CONFIG_NOT_FOUND';

/**
 * Load the config, answering null when there is none.
 *
 * "Safe" means the config may not be there. It does not mean the config may
 * be broken: absence is one of the answers this function is built to give,
 * and a file that exists and does not load is not an absent file. The line is
 * drawn by the code above, not by reading the message — the loader tags the
 * one error that means "nothing to load" and everything else is rethrown.
 */
export async function loadEcosystemConfigSafe(cwd?: string): Promise<IEcosystemConfig | null> {
  try {
    return await loadEcosystemConfig(cwd);
  } catch (err) {
    if ((err as { code?: string })?.code === ECOSYSTEM_CONFIG_NOT_FOUND) return null;
    throw err;
  }
}
