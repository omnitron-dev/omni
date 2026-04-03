/**
 * Prism CLI - Diff Command
 *
 * Show differences between local and registry versions.
 *
 * @module @omnitron/prism/cli/commands/diff
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log, COLORS } from '../constants.js';
import { loadConfig, getComponentPath, getBlockPath, type PrismConfig } from '../config.js';
import { defaultRegistrySchema } from '../../registry/index.js';

interface DiffOptions {
  cwd?: string;
}

/**
 * Create the diff command.
 */
export function diffCommand(): Command {
  const command = new Command('diff');

  command
    .description('Show differences between local and registry versions')
    .argument('[items...]', 'Components or blocks to diff (default: all installed)')
    .option('-c, --cwd <path>', 'Working directory', process.cwd())
    .action(async (items: string[], options: DiffOptions) => {
      await runDiff(items, options);
    });

  return command;
}

/**
 * Run the diff command.
 */
async function runDiff(items: string[], options: DiffOptions): Promise<void> {
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
  const installedItems = await findInstalledItems(config, items);

  if (installedItems.length === 0) {
    log.info('No Prism components or blocks found in your project.');
    log.muted('Run `prism add <component>` to add components.');
    return;
  }

  // Check each item
  const diffs: { name: string; status: 'up-to-date' | 'outdated' | 'modified' | 'unknown' }[] = [];

  for (const item of installedItems) {
    const status = await checkItemStatus(item, config);
    diffs.push({ name: item.name, status });
  }

  // Display results
  const upToDate = diffs.filter((d) => d.status === 'up-to-date');
  const outdated = diffs.filter((d) => d.status === 'outdated');
  const modified = diffs.filter((d) => d.status === 'modified');
  const unknown = diffs.filter((d) => d.status === 'unknown');

  if (upToDate.length > 0) {
    console.log(`${COLORS.success}Up to date (${upToDate.length}):${COLORS.reset}`);
    for (const item of upToDate) {
      console.log(`  ${COLORS.muted}✓${COLORS.reset} ${item.name}`);
    }
    console.log('');
  }

  if (modified.length > 0) {
    console.log(`${COLORS.warning}Modified locally (${modified.length}):${COLORS.reset}`);
    for (const item of modified) {
      console.log(`  ${COLORS.warning}~${COLORS.reset} ${item.name}`);
    }
    console.log('');
    log.muted('Modified items have local changes. Use --overwrite with update to replace.');
  }

  if (outdated.length > 0) {
    console.log(`${COLORS.primary}Updates available (${outdated.length}):${COLORS.reset}`);
    for (const item of outdated) {
      console.log(`  ${COLORS.primary}↑${COLORS.reset} ${item.name}`);
    }
    console.log('');
    log.info('Run `prism update` to update outdated components.');
  }

  if (unknown.length > 0) {
    console.log(`${COLORS.muted}Unknown (${unknown.length}):${COLORS.reset}`);
    for (const item of unknown) {
      console.log(`  ${COLORS.muted}?${COLORS.reset} ${item.name}`);
    }
    console.log('');
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
async function findInstalledItems(config: PrismConfig, filterItems: string[]): Promise<InstalledItem[]> {
  const items: InstalledItem[] = [];

  // Check components directory
  const componentsDir = getComponentPath('', config);
  if (fs.existsSync(componentsDir)) {
    const entries = await fs.promises.readdir(componentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (filterItems.length === 0 || filterItems.includes(name)) {
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
        if (filterItems.length === 0 || filterItems.includes(name) || filterItems.includes(`block:${name}`)) {
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
 * Check the status of an installed item.
 */
async function checkItemStatus(
  item: InstalledItem,
  config: PrismConfig
): Promise<'up-to-date' | 'outdated' | 'modified' | 'unknown'> {
  // Look up in registry
  const registry = item.type === 'block' ? defaultRegistrySchema.blocks : defaultRegistrySchema.components;

  const definition = registry[item.name];

  if (!definition) {
    return 'unknown';
  }

  // Check for prism.lock.json file to get installed version info
  const lockfilePath = path.join(config.rootDir, 'prism.lock.json');
  let installedVersion: string | undefined;

  if (fs.existsSync(lockfilePath)) {
    try {
      const lockfile = JSON.parse(await fs.promises.readFile(lockfilePath, 'utf-8'));
      const installed = item.type === 'block' ? lockfile.blocks?.[item.name] : lockfile.components?.[item.name];
      installedVersion = installed?.version;
    } catch {
      // Ignore lockfile errors
    }
  }

  // Compare versions
  if (installedVersion && installedVersion !== definition.version) {
    return 'outdated';
  }

  // Check if any files were modified by hashing
  const hasModifications = await checkForLocalModifications(item, definition, config);

  if (hasModifications) {
    return 'modified';
  }

  return 'up-to-date';
}

/**
 * Check if local files have been modified from the generated templates.
 */
async function checkForLocalModifications(
  item: InstalledItem,
  definition: { files: Array<{ path: string }> },
  _config: PrismConfig
): Promise<boolean> {
  // Check if all expected files exist
  for (const file of definition.files) {
    const filePath = path.join(item.path, file.path);
    if (!fs.existsSync(filePath)) {
      // Missing file = modified (user deleted it)
      return true;
    }
  }

  // Check for extra files that weren't in the template
  const localFiles = await fs.promises.readdir(item.path);
  const expectedFiles = new Set(definition.files.map((f) => f.path));

  for (const localFile of localFiles) {
    // Ignore common non-generated files
    if (localFile.startsWith('.') || localFile === 'node_modules') {
      continue;
    }
    if (!expectedFiles.has(localFile)) {
      // Extra file added by user
      return true;
    }
  }

  return false;
}
