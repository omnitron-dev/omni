#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, CommanderError } from 'commander';

import { verifyCommand } from './commands/verify.js';
import { migrateDocusaurusCommand } from './commands/docusaurus.js';

export async function runLumenMigrateCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  const program = new Command()
    .name('lumen-migrate')
    .version(version, '-v, --version')
    .description('Create a separate Lumen source project with mandatory static route and anchor parity')
    .configureOutput({ writeOut: (output) => console.log(output.trimEnd()) })
    .exitOverride();
  program
    .command('docusaurus <sourceDir> <targetDir>')
    .description('Migrate into a new, non-overlapping target directory')
    .option('--json', 'Output the result or failure as JSON')
    .action(async (sourceDir, targetDir, options) => {
      await migrateDocusaurusCommand(sourceDir, targetDir, options);
    });
  program
    .command('verify <source> <target>')
    .description('Verify static documentation routes and anchors; fail on incomplete inventory or missing parity')
    .option('--json', 'Output the report or failure as JSON')
    .action(async (source, target, options) => {
      await verifyCommand(source, target, options);
    });
  try {
    await program.parseAsync(argv.length ? argv : ['--help'], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    process.exitCode = 1;
    if (argv.includes('--json'))
      console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    throw error;
  }
}
