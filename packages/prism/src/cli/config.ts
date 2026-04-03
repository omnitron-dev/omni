/**
 * Prism CLI Configuration
 *
 * Handles loading, validating, and saving Prism configuration.
 *
 * @module @omnitron-dev/prism/cli/config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_FILE_NAME, DEFAULT_CONFIG, log } from './constants.js';

/**
 * Prism configuration schema.
 */
export interface PrismConfigSchema {
  $schema?: string;
  style: 'default' | 'new-york';
  tailwind?: {
    config: string;
    css: string;
    baseColor: string;
    cssVariables: boolean;
  };
  aliases: {
    components: string;
    blocks: string;
    hooks: string;
    utils: string;
  };
  registries: string[];
}

/**
 * Runtime Prism configuration with resolved paths.
 */
export interface PrismConfig extends PrismConfigSchema {
  /** Resolved root directory */
  rootDir: string;
  /** Resolved config file path */
  configPath: string;
}

/**
 * Find the prism.config.json file by walking up the directory tree.
 */
export function findConfigFile(startDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const configPath = path.join(currentDir, CONFIG_FILE_NAME);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Load Prism configuration from file.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<PrismConfig | null> {
  const configPath = findConfigFile(cwd);

  if (!configPath) {
    return null;
  }

  try {
    const content = await fs.promises.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as PrismConfigSchema;

    return {
      ...DEFAULT_CONFIG,
      ...config,
      rootDir: path.dirname(configPath),
      configPath,
    };
  } catch (error) {
    log.error(`Failed to load config: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Save Prism configuration to file.
 */
export async function saveConfig(
  config: PrismConfigSchema,
  outputPath: string = path.join(process.cwd(), CONFIG_FILE_NAME)
): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await fs.promises.writeFile(outputPath, content, 'utf-8');
}

/**
 * Validate Prism configuration.
 */
export function validateConfig(config: unknown): config is PrismConfigSchema {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Required fields
  if (typeof c.style !== 'string' || !['default', 'new-york'].includes(c.style)) {
    return false;
  }

  if (!c.aliases || typeof c.aliases !== 'object') {
    return false;
  }

  const aliases = c.aliases as Record<string, unknown>;
  if (
    typeof aliases.components !== 'string' ||
    typeof aliases.blocks !== 'string' ||
    typeof aliases.hooks !== 'string' ||
    typeof aliases.utils !== 'string'
  ) {
    return false;
  }

  if (!Array.isArray(c.registries) || c.registries.length === 0) {
    return false;
  }

  return true;
}

/**
 * Resolve an alias to an actual file path.
 */
export function resolveAlias(alias: string, config: PrismConfig): string {
  // Handle @ alias
  if (alias.startsWith('@/')) {
    return path.join(config.rootDir, 'src', alias.slice(2));
  }

  // Handle ~ alias (common in some setups)
  if (alias.startsWith('~/')) {
    return path.join(config.rootDir, alias.slice(2));
  }

  // Handle relative paths
  if (alias.startsWith('./') || alias.startsWith('../')) {
    return path.join(config.rootDir, alias);
  }

  // Assume it's relative to rootDir
  return path.join(config.rootDir, alias);
}

/**
 * Get the output path for a component.
 */
export function getComponentPath(componentName: string, config: PrismConfig): string {
  const componentsDir = resolveAlias(config.aliases.components, config);
  return path.join(componentsDir, componentName);
}

/**
 * Get the output path for a block.
 */
export function getBlockPath(blockName: string, config: PrismConfig): string {
  const blocksDir = resolveAlias(config.aliases.blocks, config);
  return path.join(blocksDir, blockName);
}

/**
 * Get the output path for a hook.
 */
export function getHookPath(hookName: string, config: PrismConfig): string {
  const hooksDir = resolveAlias(config.aliases.hooks, config);
  return path.join(hooksDir, `${hookName}.ts`);
}

/**
 * Get the output path for a utility.
 */
export function getUtilPath(utilName: string, config: PrismConfig): string {
  const utilsDir = resolveAlias(config.aliases.utils, config);
  return path.join(utilsDir, `${utilName}.ts`);
}
