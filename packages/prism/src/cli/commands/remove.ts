/**
 * Prism CLI - Remove Command
 *
 * Remove components or blocks from your project.
 *
 * @module @omnitron/prism/cli/commands/remove
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../constants.js';
import { loadConfig, getComponentPath, getBlockPath, type PrismConfig } from '../config.js';

interface RemoveOptions {
  cwd?: string;
  yes?: boolean;
  force?: boolean;
}

/**
 * Create the remove command.
 */
export function removeCommand(): Command {
  const command = new Command('remove');

  command
    .description('Remove components or blocks from your project')
    .argument('<items...>', 'Components or blocks to remove')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('-f, --force', 'Force removal even if files have been modified')
    .option('-c, --cwd <path>', 'Working directory', process.cwd())
    .action(async (items: string[], options: RemoveOptions) => {
      await runRemove(items, options);
    });

  return command;
}

/**
 * Run the remove command.
 */
async function runRemove(items: string[], options: RemoveOptions): Promise<void> {
  const cwd = options.cwd || process.cwd();

  // Load config
  const config = await loadConfig(cwd);
  if (!config) {
    log.error('No prism.config.json found. Run `prism init` first.');
    process.exit(1);
  }

  if (items.length === 0) {
    log.error('No items specified. Use `prism remove <component>` or `prism remove block:<name>`');
    process.exit(1);
  }

  console.log('');
  log.info(`Removing ${items.length} item(s)...`);
  console.log('');

  const results: { name: string; success: boolean; error?: string }[] = [];

  for (const item of items) {
    try {
      const result = await removeItem(item, config, options);
      results.push(result);
    } catch (error) {
      results.push({
        name: item,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  // Summary
  console.log('');
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  if (successCount > 0) {
    log.success(`Removed ${successCount} item(s) successfully.`);
  }

  if (failCount > 0) {
    log.error(`Failed to remove ${failCount} item(s):`);
    for (const result of results.filter((r) => !r.success)) {
      log.muted(`  - ${result.name}: ${result.error}`);
    }
    process.exit(1);
  }
}

/**
 * Remove a single item (component or block).
 */
async function removeItem(
  item: string,
  config: PrismConfig,
  options: RemoveOptions
): Promise<{ name: string; success: boolean; error?: string }> {
  const isBlock = item.startsWith('block:');
  const name = isBlock ? item.replace('block:', '') : item;

  // Get the installed path
  const itemPath = isBlock ? getBlockPath(name, config) : getComponentPath(name, config);

  // Check if it exists
  if (!fs.existsSync(itemPath)) {
    return {
      name: item,
      success: false,
      error: `Not installed at ${path.relative(config.rootDir, itemPath)}`,
    };
  }

  // Remove the directory
  try {
    await fs.promises.rm(itemPath, { recursive: true, force: true });
    log.success(`Removed ${name} from ${path.relative(config.rootDir, itemPath)}/`);

    // Update lockfile
    await updateLockfile(config.rootDir, name, isBlock);

    return { name: item, success: true };
  } catch (error) {
    return {
      name: item,
      success: false,
      error: `Failed to remove: ${(error as Error).message}`,
    };
  }
}

/**
 * Update the lockfile after removing an item.
 */
async function updateLockfile(rootDir: string, name: string, isBlock: boolean): Promise<void> {
  const lockfilePath = path.join(rootDir, 'prism.lock.json');

  if (!fs.existsSync(lockfilePath)) {
    return;
  }

  try {
    const lockfile = JSON.parse(await fs.promises.readFile(lockfilePath, 'utf-8')) as {
      version: string;
      components: Record<string, unknown>;
      blocks: Record<string, unknown>;
    };

    if (isBlock) {
      delete lockfile.blocks[name];
    } else {
      delete lockfile.components[name];
    }

    await fs.promises.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2) + '\n', 'utf-8');
    log.muted(`  Updated prism.lock.json`);
  } catch {
    log.warning('  Could not update lockfile');
  }
}
