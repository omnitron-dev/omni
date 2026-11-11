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

  const fileUrl = pathToFileURL(configPath).href;
  const importedModule = await import(fileUrl);
  const rawConfig = importedModule.default ?? importedModule.config ?? importedModule;

  const expanded = expandEnvVariables(rawConfig) as LumenUserConfig;
  return defineLumenConfig(expanded);
}
