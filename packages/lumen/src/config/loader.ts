import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { defineLumenConfig } from './define.js';
import { expandEnvVariables } from './env.js';
import type { LumenConfig, LumenUserConfig } from './schema.js';

const CONFIG_FILENAMES = ['lumen.config.ts', 'lumen.config.mjs', 'lumen.config.js'];

export async function resolveConfigFile(cwd: string = process.cwd()): Promise<string | null> {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = resolve(cwd, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function loadLumenConfig(cwdOrFilePath: string = process.cwd()): Promise<LumenConfig> {
  let configPath: string | null = null;
  if (
    existsSync(cwdOrFilePath) &&
    !cwdOrFilePath.endsWith('.ts') &&
    !cwdOrFilePath.endsWith('.mjs') &&
    !cwdOrFilePath.endsWith('.js')
  ) {
    configPath = await resolveConfigFile(cwdOrFilePath);
  } else if (existsSync(cwdOrFilePath)) {
    configPath = cwdOrFilePath;
  }

  if (!configPath) {
    return defineLumenConfig({ title: 'Documentation' });
  }

  let rawConfig: unknown;
  try {
    const fileUrl = pathToFileURL(configPath).href;
    const importedModule = await import(fileUrl);
    rawConfig = importedModule.default ?? importedModule.config ?? importedModule;
  } catch (err: any) {
    const code = err?.code;
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' || code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      const { loadConfigFromFile } = await import('vite');
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configPath);
      if (!loaded) throw new Error(`Unable to load Lumen configuration: ${configPath}`, { cause: err });
      rawConfig = loaded.config;
    } else {
      throw err;
    }
  }

  const expanded = expandEnvVariables(rawConfig) as LumenUserConfig;
  return defineLumenConfig(expanded);
}
