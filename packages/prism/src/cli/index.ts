/**
 * Prism CLI
 *
 * Command-line interface for the Prism design system.
 * Provides shadcn/ui-style component installation and management.
 *
 * @module @omnitron/prism/cli
 */

import { Command } from 'commander';
import { addCommand } from './commands/add.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { diffCommand } from './commands/diff.js';
import { updateCommand } from './commands/update.js';
import { removeCommand } from './commands/remove.js';
import { doctorCommand } from './commands/doctor.js';
import { PRISM_VERSION } from './constants.js';

/**
 * Create and configure the Prism CLI.
 */
export function createCli(): Command {
  const program = new Command();

  program
    .name('prism')
    .description('Prism Design System CLI - Component installation and management')
    .version(PRISM_VERSION, '-v, --version', 'Display the current version');

  // Add commands
  program.addCommand(initCommand());
  program.addCommand(addCommand());
  program.addCommand(removeCommand());
  program.addCommand(listCommand());
  program.addCommand(diffCommand());
  program.addCommand(updateCommand());
  program.addCommand(doctorCommand());

  return program;
}

/**
 * Run the CLI with process arguments.
 */
export async function cli(): Promise<void> {
  const program = createCli();
  await program.parseAsync(process.argv);
}

// Export for programmatic use
export { addCommand } from './commands/add.js';
export { removeCommand } from './commands/remove.js';
export { initCommand } from './commands/init.js';
export { listCommand } from './commands/list.js';
export { diffCommand } from './commands/diff.js';
export { updateCommand } from './commands/update.js';
export { doctorCommand } from './commands/doctor.js';
export { PRISM_VERSION, DEFAULT_CONFIG } from './constants.js';
export type { PrismConfig, PrismConfigSchema } from './config.js';
