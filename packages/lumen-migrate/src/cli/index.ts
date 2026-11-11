#!/usr/bin/env node
/**
 * Lumen Migrate CLI dispatcher
 */
import { Command } from 'commander';
import { migrateDocusaurusCommand } from './commands/docusaurus.js';
import { verifyCommand } from './commands/verify.js';

export async function runLumenMigrateCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const firstArg = argv[0];

  if (firstArg === '--version' || firstArg === '-v') {
    console.log('0.3.4');
    return;
  }

  if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h' || argv.length === 0) {
    console.log(`Lumen Migrate CLI v0.3.4
Usage:
  lumen-migrate docusaurus <sourceDir> <targetDir>   Migrate Docusaurus repository to Lumen
  lumen-migrate verify <source> <target>            Verify route and anchor parity

Options:
  -v, --version                                     output the version number
  -h, --help                                        display help for command
`);
    return;
  }

  const program = new Command();
  program
    .name('lumen-migrate')
    .version('0.3.4')
    .description('Docusaurus to Lumen migration engine and parity verification tool');

  program
    .command('docusaurus <sourceDir> <targetDir>')
    .description('Migrate Docusaurus repository to Lumen')
    .option('--verify', 'Run parity verification after migration')
    .option('--json', 'Output migration result in JSON format')
    .option('--format <format>', 'Report format (summary or json)')
    .action(async (sourceDir, targetDir, options) => {
      await migrateDocusaurusCommand(sourceDir, targetDir, options);
    });

  program
    .command('verify <source> <target>')
    .description('Verify route and anchor parity between source and target')
    .option('--json', 'Output verification result in JSON format')
    .option('--format <format>', 'Report format (summary or json)')
    .action(async (source, target, options) => {
      await verifyCommand(source, target, options);
    });

  // Handle custom argv
  await program.parseAsync(argv, { from: 'user' });
}
