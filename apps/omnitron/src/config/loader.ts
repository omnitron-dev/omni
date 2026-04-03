/**
 * Config Loader — Load and validate omnitron.config.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { IEcosystemConfig } from './types.js';
import { defineEcosystem } from './define-ecosystem.js';

const CONFIG_FILE_NAMES = ['omnitron.config.ts', 'omnitron.config.js', 'omnitron.config.mjs'];

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
      return defineEcosystem(raw);
    } catch (err: any) {
      throw new Error(`Failed to load ${name}: ${err.message}`, { cause: err });
    }
  }

  throw new Error(
    `No omnitron config found. Create one of: ${CONFIG_FILE_NAMES.join(', ')}\n` +
      `Run 'omnitron init' to generate a config file.`
  );
}

/**
 * Load config from a specific file path (e.g., `omnitron dev -c ./omnitron.config.ts`)
 */
export async function loadEcosystemConfigFile(filePath: string): Promise<IEcosystemConfig> {
  const url = pathToFileURL(filePath).href;
  const mod = await import(`${url}?t=${Date.now()}`);
  const config = mod.default ?? mod;

  if (!config || !Array.isArray(config.apps)) {
    throw new Error(`Invalid config in ${filePath}: 'apps' must be an array`);
  }

  for (const app of config.apps) {
    if (!app.name) throw new Error(`App entry missing 'name' in ${filePath}`);
    if (!app.bootstrap && !app.script) {
      throw new Error(`App '${app.name}' must have either 'bootstrap' or 'script' path`);
    }
  }

  return defineEcosystem(config);
}

export async function loadEcosystemConfigSafe(cwd?: string): Promise<IEcosystemConfig | null> {
  try {
    return await loadEcosystemConfig(cwd);
  } catch {
    return null;
  }
}
