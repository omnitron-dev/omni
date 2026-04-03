/**
 * Prism CLI - Init Command
 *
 * Initialize a new Prism project with configuration.
 *
 * @module @omnitron-dev/prism/cli/commands/init
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_BLOCKS_DIR,
  DEFAULT_HOOKS_DIR,
  DEFAULT_UTILS_DIR,
  log,
} from '../constants.js';
import { findConfigFile, saveConfig, type PrismConfigSchema } from '../config.js';

/**
 * Prompt user for input.
 */
async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const displayQuestion = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;

    rl.question(displayQuestion, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt user for yes/no confirmation.
 */
async function confirm(question: string, defaultValue: boolean = true): Promise<boolean> {
  const hint = defaultValue ? '(Y/n)' : '(y/N)';
  const answer = await prompt(`${question} ${hint}`);

  if (!answer) {
    return defaultValue;
  }

  return ['y', 'yes', 'да'].includes(answer.toLowerCase());
}

interface InitOptions {
  yes?: boolean;
  defaults?: boolean;
  cwd?: string;
}

/**
 * Create the init command.
 */
export function initCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize Prism in your project')
    .option('-y, --yes', 'Skip prompts and use defaults')
    .option('-d, --defaults', 'Use default configuration')
    .option('-c, --cwd <path>', 'Working directory', process.cwd())
    .action(async (options: InitOptions) => {
      await runInit(options);
    });

  return command;
}

/**
 * Run the init command.
 */
async function runInit(options: InitOptions): Promise<void> {
  const cwd = options.cwd || process.cwd();

  console.log('');
  log.info('Initializing Prism...');
  console.log('');

  // Check for existing config
  const existingConfig = findConfigFile(cwd);
  if (existingConfig) {
    log.warning(`Config already exists at ${existingConfig}`);
    const overwrite = options.yes || (await confirm('Overwrite existing configuration?', false));
    if (!overwrite) {
      log.info('Initialization cancelled.');
      return;
    }
  }

  let config: PrismConfigSchema;

  if (options.yes || options.defaults) {
    // Use defaults
    config = { ...DEFAULT_CONFIG };
  } else {
    // Interactive prompts
    config = await interactiveInit(cwd);
  }

  // Create directories
  const dirs = [
    path.join(cwd, DEFAULT_COMPONENTS_DIR),
    path.join(cwd, DEFAULT_BLOCKS_DIR),
    path.join(cwd, DEFAULT_HOOKS_DIR),
    path.join(cwd, DEFAULT_UTILS_DIR),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
      log.success(`Created ${path.relative(cwd, dir)}/`);
    }
  }

  // Save config
  const configPath = path.join(cwd, CONFIG_FILE_NAME);
  await saveConfig(config, configPath);
  log.success(`Created ${CONFIG_FILE_NAME}`);

  console.log('');
  log.success('Prism initialized successfully!');
  console.log('');
  log.info('Next steps:');
  console.log('  1. Run `prism add button` to add your first component');
  console.log('  2. Run `prism list` to see available components');
  console.log('  3. Visit https://prism.omnitron.dev/docs for documentation');
  console.log('');
}

/**
 * Interactive initialization with prompts.
 */
async function interactiveInit(cwd: string): Promise<PrismConfigSchema> {
  console.log('This will guide you through configuring Prism for your project.\n');

  // Style
  const styleAnswer = await prompt('Which style would you like to use? (default/new-york)', 'default');
  const style = styleAnswer === 'new-york' ? 'new-york' : 'default';

  // Components alias
  const componentsAlias = await prompt('Where should components be installed?', '@/components/ui');

  // Blocks alias
  const blocksAlias = await prompt('Where should blocks be installed?', '@/blocks');

  // Hooks alias
  const hooksAlias = await prompt('Where should hooks be installed?', '@/hooks');

  // Utils alias
  const utilsAlias = await prompt('Where should utils be installed?', '@/utils');

  // Check for Tailwind config
  const tailwindConfigPath = path.join(cwd, 'tailwind.config.js');
  const tailwindTsConfigPath = path.join(cwd, 'tailwind.config.ts');
  const hasTailwind = fs.existsSync(tailwindConfigPath) || fs.existsSync(tailwindTsConfigPath);

  let tailwindConfig: PrismConfigSchema['tailwind'];

  if (hasTailwind) {
    const useTailwind = await confirm('Tailwind CSS detected. Configure CSS variables?', true);
    if (useTailwind) {
      const cssFile = await prompt('Where is your global CSS file?', 'src/index.css');
      const baseColor = await prompt('What base color would you like?', 'slate');

      tailwindConfig = {
        config: fs.existsSync(tailwindTsConfigPath) ? 'tailwind.config.ts' : 'tailwind.config.js',
        css: cssFile,
        baseColor,
        cssVariables: true,
      };
    }
  }

  return {
    $schema: 'https://prism.omnitron.dev/schema.json',
    style,
    tailwind: tailwindConfig,
    aliases: {
      components: componentsAlias,
      blocks: blocksAlias,
      hooks: hooksAlias,
      utils: utilsAlias,
    },
    registries: DEFAULT_CONFIG.registries,
  };
}
