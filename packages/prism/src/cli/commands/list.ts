/**
 * Prism CLI - List Command
 *
 * List available components and blocks from the registry.
 *
 * @module @omnitron-dev/prism/cli/commands/list
 */

import { Command } from 'commander';
import { COLORS, log, COMPONENT_CATEGORIES, BLOCK_CATEGORIES } from '../constants.js';
import { defaultRegistrySchema } from '../../registry/index.js';

interface ListOptions {
  components?: boolean;
  blocks?: boolean;
  category?: string;
  json?: boolean;
}

/**
 * Create the list command.
 */
export function listCommand(): Command {
  const command = new Command('list');

  command
    .description('List available components and blocks')
    .option('-c, --components', 'List only components')
    .option('-b, --blocks', 'List only blocks')
    .option('--category <category>', 'Filter by category')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      await runList(options);
    });

  return command;
}

/**
 * Run the list command.
 */
async function runList(options: ListOptions): Promise<void> {
  const showComponents = options.components || (!options.components && !options.blocks);
  const showBlocks = options.blocks || (!options.components && !options.blocks);

  if (options.json) {
    const output = {
      ...(showComponents && { components: defaultRegistrySchema.components }),
      ...(showBlocks && { blocks: defaultRegistrySchema.blocks }),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('');

  if (showComponents) {
    log.info('Available Components:');
    console.log('');
    listItems(defaultRegistrySchema.components, options.category, COMPONENT_CATEGORIES);
  }

  if (showBlocks) {
    if (showComponents) console.log('');
    log.info('Available Blocks:');
    console.log('');
    listItems(defaultRegistrySchema.blocks, options.category, BLOCK_CATEGORIES);
  }

  console.log('');
  log.muted('Use `prism add <name>` to add a component to your project.');
  log.muted('Use `prism add block:<name>` to add a block to your project.');
  console.log('');
}

/**
 * List items grouped by category.
 */
function listItems(
  items: Record<string, { name: string; displayName?: string; category: string; description?: string }>,
  filterCategory: string | undefined,
  categoryOrder: readonly string[]
): void {
  // Group by category
  const byCategory: Record<string, (typeof items)[string][]> = {};

  for (const item of Object.values(items)) {
    if (filterCategory && item.category !== filterCategory) {
      continue;
    }

    if (!byCategory[item.category]) {
      byCategory[item.category] = [];
    }
    byCategory[item.category].push(item);
  }

  // Sort categories
  const sortedCategories = Object.keys(byCategory).sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a as (typeof categoryOrder)[number]);
    const bIndex = categoryOrder.indexOf(b as (typeof categoryOrder)[number]);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  for (const category of sortedCategories) {
    const categoryItems = byCategory[category];
    const categoryTitle = category
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    console.log(`  ${COLORS.primary}${categoryTitle}${COLORS.reset}`);

    for (const item of categoryItems.sort((a, b) => a.name.localeCompare(b.name))) {
      const displayName = item.displayName || item.name;
      const description = item.description ? ` - ${item.description}` : '';
      console.log(
        `    ${COLORS.muted}•${COLORS.reset} ${item.name} ${COLORS.muted}(${displayName})${description}${COLORS.reset}`
      );
    }

    console.log('');
  }
}
