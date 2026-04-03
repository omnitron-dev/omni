/**
 * Prism CLI - Update Command
 *
 * Update installed components and blocks to latest versions.
 *
 * @module @omnitron/prism/cli/commands/update
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../constants.js';
import { loadConfig, getComponentPath, getBlockPath, type PrismConfig } from '../config.js';
import { defaultRegistrySchema } from '../../registry/index.js';

interface UpdateOptions {
  cwd?: string;
  yes?: boolean;
  overwrite?: boolean;
  all?: boolean;
}

/**
 * Create the update command.
 */
export function updateCommand(): Command {
  const command = new Command('update');

  command
    .description('Update installed components and blocks')
    .argument('[items...]', 'Components or blocks to update (default: all installed)')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('-o, --overwrite', 'Overwrite modified files')
    .option('-a, --all', 'Update all installed items')
    .option('-c, --cwd <path>', 'Working directory', process.cwd())
    .action(async (items: string[], options: UpdateOptions) => {
      await runUpdate(items, options);
    });

  return command;
}

/**
 * Run the update command.
 */
async function runUpdate(items: string[], options: UpdateOptions): Promise<void> {
  const cwd = options.cwd || process.cwd();

  // Load config
  const config = await loadConfig(cwd);
  if (!config) {
    log.error('No prism.config.json found. Run `prism init` first.');
    process.exit(1);
  }

  console.log('');
  log.info('Checking for updates...');
  console.log('');

  // Find installed items
  const installedItems = await findInstalledItems(config, items, options.all);

  if (installedItems.length === 0) {
    log.info('No Prism components or blocks found to update.');
    return;
  }

  // Check for updates
  const toUpdate: { name: string; type: 'component' | 'block'; path: string }[] = [];

  for (const item of installedItems) {
    const hasUpdate = await checkForUpdate(item, config);
    if (hasUpdate) {
      toUpdate.push(item);
    }
  }

  if (toUpdate.length === 0) {
    log.success('All items are up to date!');
    return;
  }

  log.info(`Found ${toUpdate.length} item(s) to update:`);
  for (const item of toUpdate) {
    console.log(`  • ${item.name}`);
  }
  console.log('');

  // Perform updates
  const results: { name: string; success: boolean; error?: string }[] = [];

  for (const item of toUpdate) {
    try {
      await updateItem(item, config, options);
      results.push({ name: item.name, success: true });
      log.success(`Updated ${item.name}`);
    } catch (error) {
      results.push({ name: item.name, success: false, error: (error as Error).message });
      log.error(`Failed to update ${item.name}: ${(error as Error).message}`);
    }
  }

  // Summary
  console.log('');
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  if (successCount > 0) {
    log.success(`Updated ${successCount} item(s) successfully.`);
  }
  if (failCount > 0) {
    log.error(`Failed to update ${failCount} item(s).`);
  }
  console.log('');
}

interface InstalledItem {
  name: string;
  type: 'component' | 'block';
  path: string;
}

/**
 * Find installed Prism items.
 */
async function findInstalledItems(config: PrismConfig, filterItems: string[], all?: boolean): Promise<InstalledItem[]> {
  const items: InstalledItem[] = [];

  // Check components directory
  const componentsDir = getComponentPath('', config);
  if (fs.existsSync(componentsDir)) {
    const entries = await fs.promises.readdir(componentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (all || filterItems.length === 0 || filterItems.includes(name)) {
          items.push({
            name,
            type: 'component',
            path: path.join(componentsDir, name),
          });
        }
      }
    }
  }

  // Check blocks directory
  const blocksDir = getBlockPath('', config);
  if (fs.existsSync(blocksDir)) {
    const entries = await fs.promises.readdir(blocksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (all || filterItems.length === 0 || filterItems.includes(name) || filterItems.includes(`block:${name}`)) {
          items.push({
            name,
            type: 'block',
            path: path.join(blocksDir, name),
          });
        }
      }
    }
  }

  return items;
}

/**
 * Check if an item has an update available.
 */
async function checkForUpdate(item: InstalledItem, config: PrismConfig): Promise<boolean> {
  // Look up in registry
  const registry = item.type === 'block' ? defaultRegistrySchema.blocks : defaultRegistrySchema.components;

  const definition = registry[item.name];

  if (!definition) {
    return false;
  }

  // Check for prism.lock.json file to get installed version info
  const lockfilePath = path.join(config.rootDir, 'prism.lock.json');

  if (fs.existsSync(lockfilePath)) {
    try {
      const lockfile = JSON.parse(await fs.promises.readFile(lockfilePath, 'utf-8'));
      const installed = item.type === 'block' ? lockfile.blocks?.[item.name] : lockfile.components?.[item.name];

      if (installed?.version && installed.version !== definition.version) {
        return true;
      }
    } catch {
      // Ignore lockfile errors, assume update may be needed
    }
  }

  return false;
}

/**
 * Update an item to the latest version.
 */
async function updateItem(item: InstalledItem, config: PrismConfig, options: UpdateOptions): Promise<void> {
  // Look up in registry
  const registry = item.type === 'block' ? defaultRegistrySchema.blocks : defaultRegistrySchema.components;

  const definition = registry[item.name];

  if (!definition) {
    throw new Error('Item not found in registry');
  }

  // Backup existing files unless --overwrite
  if (!options.overwrite) {
    const backupDir = path.join(item.path, '.prism-backup');
    await fs.promises.mkdir(backupDir, { recursive: true });

    for (const file of definition.files) {
      const filePath = path.join(item.path, file.path);
      if (fs.existsSync(filePath)) {
        const backupPath = path.join(backupDir, file.path);
        await fs.promises.copyFile(filePath, backupPath);
      }
    }
    log.muted(`  Backed up ${definition.files.length} file(s) to .prism-backup/`);
  }

  // Re-generate files using the template system
  const { generateFileContent } = await import('./add.js');

  for (const file of definition.files) {
    const filePath = path.join(item.path, file.path);
    // Cast to ComponentDefinition as the function handles both types
    const content = generateFileContent(
      item.name,
      file.path,
      file.type as string,
      definition as import('../../types/registry.js').ComponentDefinition,
      item.type === 'block'
    );
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  log.muted(`  Updated ${definition.files.length} file(s) in ${path.relative(config.rootDir, item.path)}/`);

  // Update lockfile
  const lockfilePath = path.join(config.rootDir, 'prism.lock.json');
  let lockfile: {
    version: string;
    components: Record<string, { name: string; version: string; installedAt: string }>;
    blocks: Record<string, { name: string; version: string; installedAt: string }>;
  } = {
    version: '1',
    components: {},
    blocks: {},
  };

  if (fs.existsSync(lockfilePath)) {
    try {
      lockfile = JSON.parse(await fs.promises.readFile(lockfilePath, 'utf-8'));
    } catch {
      // Use default lockfile
    }
  }

  const entry = {
    name: item.name,
    version: definition.version,
    installedAt: new Date().toISOString(),
  };

  if (item.type === 'block') {
    lockfile.blocks[item.name] = entry;
  } else {
    lockfile.components[item.name] = entry;
  }

  await fs.promises.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2), 'utf-8');
}
